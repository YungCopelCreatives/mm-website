/**
 * M&M Laundry — static / SEO web server.
 *
 * This server holds NO user data. Accounts, orders, addresses and tracking live in the
 * same backend as the mobile app:
 *   - Firebase Auth (sign-in)            — called from the browser
 *   - Supabase Postgres under RLS        — called from the browser with the Firebase ID token
 *   - Supabase edge functions            — create-order (Ozow), get-pricing, submit-form
 *
 * It only serves the SPA shell and assets with security headers, renders /config.js with
 * PUBLIC client configuration from env, and answers the Ozow return redirect.
 */
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ========================================================================
   CONFIG
   ======================================================================== */
const env = process.env;
const IS_PROD = env.NODE_ENV === 'production';
const PORT = Number.parseInt(env.PORT || '3000', 10);
const HOST = env.HOST || '0.0.0.0';
const SITE_URL = (env.SITE_URL || (IS_PROD ? '' : `http://localhost:${PORT}`)).replace(/\/+$/, '');

function parseTrustProxy(v) {
  if (v === undefined || v === '') return IS_PROD ? 1 : false;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

const httpsUrl = (v, hostRe) => {
  try { const u = new URL(String(v || '')); return u.protocol === 'https:' && (!hostRe || hostRe.test(u.hostname)) ? u.href : ''; } catch { return ''; }
};
const clean = (v, max = 200) => String(v || '').replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, max);

// Business details the OWNER supplies (see .env.example). Anything left empty is hidden on the
// site instead of showing a placeholder.
const SITE = Object.freeze({
  supportPhone: clean(env.CONTACT_PHONE, 30),          // TODO(owner): e.g. +27 21 000 0000
  supportEmail: clean(env.CONTACT_EMAIL, 254),         // TODO(owner): e.g. support@your-domain.co.za
  privacyEmail: clean(env.PRIVACY_EMAIL || env.CONTACT_EMAIL, 254), // TODO(owner): Information Officer (POPIA)
  supportHours: clean(env.SUPPORT_HOURS, 120),         // TODO(owner): e.g. Monday to Sunday, 07:00 to 20:00
  serviceAreas: clean(env.SERVICE_AREAS, 200),         // TODO(owner): e.g. Johannesburg, Pretoria, Cape Town
  appStoreUrl: httpsUrl(env.APP_STORE_URL, /(^|\.)apple\.com$/i),            // TODO(owner): App Store listing
  playStoreUrl: httpsUrl(env.PLAY_STORE_URL, /(^|\.)play\.google\.com$/i),   // TODO(owner): Google Play listing
  appScheme: 'com.laundromatmarketplace',
  androidPackage: clean(env.ANDROID_PACKAGE, 100) || 'com.laundromatmarketplace',
});

// Search and local SEO (all optional; see .env.example).
const httpsList = (v) => String(v || '').split(',').map((x) => httpsUrl(x.trim())).filter(Boolean);
const SEO = Object.freeze({
  googleVerification: clean(env.GOOGLE_SITE_VERIFICATION, 100).replace(/[^\w-]/g, ''),
  bingVerification: clean(env.BING_SITE_VERIFICATION, 100).replace(/[^\w-]/g, ''),
  socialProfiles: httpsList(env.SOCIAL_PROFILES),          // Facebook, Instagram, TikTok, LinkedIn… page URLs
  street: clean(env.ADDRESS_STREET, 120),
  city: clean(env.ADDRESS_CITY, 80),
  province: clean(env.ADDRESS_PROVINCE, 80),
  postalCode: clean(env.ADDRESS_POSTAL_CODE, 10),
  openingHours: clean(env.OPENING_HOURS, 120),             // schema.org format, e.g. "Mo-Su 07:00-20:00"
});

// Universal Links / App Links (website URLs open the app when it is installed).
const IOS_BUNDLE_ID = clean(env.IOS_BUNDLE_ID, 100) || 'com.laundromat.marketplace';
const APPLE_TEAM_ID = /^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID || '') ? env.APPLE_TEAM_ID : ''; // TODO(owner)
const ANDROID_SHA256 = String(env.ANDROID_SHA256_CERT_FINGERPRINTS || '') // TODO(owner): Play App Signing key
  .split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x));
// Paths the app opens; keep in sync with src/lib/deepLinks.ts in the app.
const APP_LINK_PATHS = ['/orders', '/orders/*', '/order/*', '/book', '/kyc'];

// Public client config only. These values ship to every browser; never put a secret here.
const PUBLIC_CONFIG = Object.freeze({
  site: SITE,
  firebase: {
    apiKey: env.FIREBASE_API_KEY || '',
    authDomain: env.FIREBASE_AUTH_DOMAIN || '',
    projectId: env.FIREBASE_PROJECT_ID || '',
    storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env.FIREBASE_APP_ID || '',
  },
  supabaseUrl: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
  recaptchaEnterpriseSiteKey: env.RECAPTCHA_ENTERPRISE_SITE_KEY || '',
  googleMapsApiKey: env.GOOGLE_MAPS_API_KEY || '',
});

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}
const SUPABASE_ORIGIN = originOf(PUBLIC_CONFIG.supabaseUrl);
const AUTH_DOMAIN_ORIGIN = PUBLIC_CONFIG.firebase.authDomain ? `https://${PUBLIC_CONFIG.firebase.authDomain}` : null;

function looksLikeServiceKey(key) {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'service_role'; } catch { return false; }
}

function assertConfig() {
  const problems = [];
  if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) problems.push('PORT must be a valid port number');
  if (looksLikeServiceKey(PUBLIC_CONFIG.supabaseAnonKey)) problems.push('SUPABASE_ANON_KEY is a service-role/secret key. Use the anon/publishable key; the service key must never reach a browser.');
  if (PUBLIC_CONFIG.supabaseUrl && !SUPABASE_ORIGIN) problems.push('SUPABASE_URL is not a valid URL');
  if (IS_PROD) {
    if (!/^https:\/\/[^/]+$/.test(SITE_URL)) problems.push('SITE_URL must be the public https origin, e.g. https://www.example.co.za');
    for (const k of ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
      if (!env[k]) problems.push(`${k} must be set`);
    }
    if (SUPABASE_ORIGIN && !SUPABASE_ORIGIN.startsWith('https://')) problems.push('SUPABASE_URL must use https in production');
    if (!PUBLIC_CONFIG.recaptchaEnterpriseSiteKey) console.warn('[warn] RECAPTCHA_ENTERPRISE_SITE_KEY not set: App Check is off for the website.');
  }
  if (problems.length) {
    console.error('Refusing to start — configuration errors:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  for (const [k, v] of [['APP_STORE_URL', SITE.appStoreUrl], ['PLAY_STORE_URL', SITE.playStoreUrl]]) {
    if (env[k] && !v) console.warn(`[warn] ${k} is not an https store URL (apps.apple.com / play.google.com) and is ignored.`);
  }
  if (env.APPLE_TEAM_ID && !APPLE_TEAM_ID) console.warn('[warn] APPLE_TEAM_ID must be the 10-character Apple Developer Team ID.');
  if (env.ANDROID_SHA256_CERT_FINGERPRINTS && !ANDROID_SHA256.length) console.warn('[warn] ANDROID_SHA256_CERT_FINGERPRINTS must be AA:BB:... SHA-256 fingerprints.');
  if (IS_PROD && (!APPLE_TEAM_ID || !ANDROID_SHA256.length)) console.warn('[warn] APPLE_TEAM_ID / ANDROID_SHA256_CERT_FINGERPRINTS not set: website links will not open the app.');
  if (IS_PROD && (!SITE.supportEmail || !SITE.supportPhone)) console.warn('[warn] CONTACT_EMAIL / CONTACT_PHONE not set: contact details are hidden on the site.');
  if (!PUBLIC_CONFIG.supabaseUrl || !PUBLIC_CONFIG.firebase.apiKey) {
    console.warn('[warn] Firebase/Supabase config missing: sign-in and booking will be disabled in the browser.');
  }
}
assertConfig();

/* ========================================================================
   APP & SECURITY HEADERS
   ======================================================================== */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));

const csp = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/', // App Check (reCAPTCHA Enterprise)
    'https://apis.google.com',                                                // Firebase Auth Google sign-in
    'https://maps.googleapis.com',                                            // Google Maps JS
  ],
  scriptSrcAttr: ["'none'"],
  // Google Maps injects inline styles; app markup uses a few style attributes.
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], // Google Maps loads Roboto CSS
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],                 // Inter is self-hosted
  imgSrc: [
    "'self'", 'data:', 'blob:',
    'https://maps.gstatic.com', 'https://maps.googleapis.com', 'https://*.googleapis.com', 'https://*.ggpht.com',
    'https://lh3.googleusercontent.com', 'https://www.gstatic.com',
    ...(SUPABASE_ORIGIN ? [SUPABASE_ORIGIN] : []),
  ],
  connectSrc: [
    "'self'",
    ...(SUPABASE_ORIGIN ? [SUPABASE_ORIGIN, SUPABASE_ORIGIN.replace(/^http/, 'ws')] : []),
    'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com',
    'https://firebaseappcheck.googleapis.com', 'https://content-firebaseappcheck.googleapis.com',
    'https://www.google.com/recaptcha/', 'https://recaptchaenterprise.googleapis.com',
    'https://maps.googleapis.com', 'https://places.googleapis.com',
  ],
  frameSrc: [
    'https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/',
    ...(AUTH_DOMAIN_ORIGIN ? [AUTH_DOMAIN_ORIGIN] : []), 'https://accounts.google.com',
  ],
  manifestSrc: ["'self'"],
  workerSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  // Payment happens on Ozow's hosted page (top-level redirect); Ozow may POST back to /orders/:id.
  formAction: ["'self'", 'https://pay.ozow.com', 'https://*.ozow.com'],
  frameAncestors: ["'none'"],
  ...(IS_PROD ? { upgradeInsecureRequests: [] } : {}),
};

app.use(helmet({
  contentSecurityPolicy: { useDefaults: false, directives: csp },
  strictTransportSecurity: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
  // Firebase signInWithPopup needs to talk to its popup window.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  frameguard: { action: 'deny' },
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()');
  next();
});

/* ---- one URL per page (SEO) ----
   In production, the other spelling of the site's host (example.co.za vs www.example.co.za)
   redirects to SITE_URL, and /page/ redirects to /page. App-link files are never redirected:
   Apple and Google fetch them on both hosts. */
const SITE_HOST = (() => { try { return new URL(SITE_URL).hostname.toLowerCase(); } catch { return ''; } })();
const bareHost = (h) => h.replace(/^www\./, '');
app.use((req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/.well-known/') || req.path === '/apple-app-site-association' || req.path === '/healthz') return next();
  const host = String(req.hostname || '').toLowerCase();
  const query = req.originalUrl.slice(req.path.length);
  const wrongHost = IS_PROD && SITE_HOST && host && host !== SITE_HOST && bareHost(host) === bareHost(SITE_HOST);
  const slash = req.path.length > 1 && req.path.endsWith('/');
  if (!wrongHost && !slash) return next();
  // Collapse leading slashes so //evil.example/ can never become a protocol-relative redirect.
  const pathname = (slash ? req.path.replace(/\/+$/, '') : req.path).replace(/^\/+/, '/') || '/';
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.redirect(301, `${wrongHost ? SITE_URL : ''}${pathname}${query}`);
});

/* ========================================================================
   TEMPLATES & STATIC FILES (explicit allow-list — never serve the project root)
   ======================================================================== */
function readTemplate(file) {
  return fs.readFileSync(path.join(__dirname, file), 'utf8').replaceAll('__SITE_URL__', SITE_URL);
}
const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Owner-supplied business details are rendered on the server (no flash, works without JS):
 *   <!--site:key-->…<!--/site:key-->  kept only when that detail is set (removed otherwise)
 *   {{site.key}}                       the value, HTML-escaped; {{site.key.tel}} digits for tel: links
 */
function renderSite(htmlText) {
  const has = {
    ...Object.fromEntries(Object.entries(SITE).map(([k, v]) => [k, Boolean(v)])),
    anyApp: Boolean(SITE.appStoreUrl || SITE.playStoreUrl),
    contact: Boolean(SITE.supportPhone || SITE.supportEmail),
  };
  let out = htmlText.replace(/<!--site:(\w+)-->([\s\S]*?)<!--\/site:\1-->/g, (m, key, inner) => (has[key] ? inner : ''));
  out = out.replace(/\{\{site\.(\w+)(\.tel)?\}\}/g, (m, key, tel) => {
    const v = SITE[key] || '';
    return escHtml(tel ? v.replace(/[^+\d]/g, '') : v);
  });
  return out;
}
const INDEX_HTML = renderSite(readTemplate('index.html'));
const ROBOTS_TXT = readTemplate('robots.txt');
const CONFIG_JS = `window.__MM_CONFIG__ = Object.freeze(${JSON.stringify(PUBLIC_CONFIG).replace(/</g, '\\u003c')});\n`;

// Every route the SPA renders. Keep in sync with data-route in index.html.
const SPA_ROUTES = new Set([
  '/', '/services', '/how-it-works', '/about', '/faq', '/contact', '/business', '/drive', '/partners',
  '/book', '/orders', '/account', '/login', '/signup', '/forgot-password',
  '/privacy', '/terms', '/garment-care', '/accessibility', '/kyc',
]);
const DYNAMIC_ROUTES = [/^\/orders\/[0-9a-f-]{36}$/i];
const NOINDEX = ['/book', '/orders', '/account', '/login', '/signup', '/forgot-password', '/kyc'];
const isNoindex = (p) => NOINDEX.some((x) => p === x || p.startsWith(x + '/'));

/* ========================================================================
   SEO: per-page head, structured data and sitemap
   Every page is one <section data-route data-title data-description> in index.html. The
   server renders each route's own title, description, canonical, Open Graph tags and JSON-LD,
   and shows that route's section in the HTML, so crawlers and link previews get the right
   page without running JavaScript. The client keeps the same tags in sync (js/main.js).
   ======================================================================== */
const unHtml = (v) => String(v).replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }[e])).replace(/\s+/g, ' ').trim();
const attrOf = (attrs, name) => (attrs.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] || '';

// route -> { title, description (HTML-escaped as in index.html), crumb, html }
const PAGES = {};
{
  const starts = [...INDEX_HTML.matchAll(/<section class="page" data-route="([^"]+)"([^>]*)>/g)];
  starts.forEach((m, i) => {
    const html = INDEX_HTML.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : INDEX_HTML.indexOf('</main>'));
    PAGES[m[1]] = {
      title: attrOf(m[2], 'data-title'),
      description: attrOf(m[2], 'data-description'),
      crumb: unHtml((html.match(/<li aria-current="page">([^<]+)<\/li>/) || [])[1] || ''),
      html,
    };
  });
}
const DEFAULT_DESCRIPTION = PAGES['/'].description;
const PAGE_TYPES = { '/about': 'AboutPage', '/contact': 'ContactPage', '/faq': 'FAQPage' };

// Questions and answers come from the visible FAQ, so the structured data always matches the page.
const FAQ = [...(PAGES['/faq']?.html || '').matchAll(/<details><summary>([\s\S]*?)<\/summary><div class="answer">([\s\S]*?)<\/div><\/details>/g)]
  .map(([, q, a]) => ({
    '@type': 'Question',
    name: unHtml(q),
    acceptedAnswer: { '@type': 'Answer', text: unHtml(a.replace(/<span data-needs-price hidden>(?:[^<]|<span[^>]*><\/span>)*<\/span>/g, '')) },
  }));

// Services from the /services cards (name, description, anchor).
const SERVICES = [...(PAGES['/services']?.html || '').matchAll(/<article class="card[^"]*" id="([^"]+)">\s*<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/g)]
  .map(([, id, name, desc]) => ({ id, name: unHtml(name), description: unHtml(desc) }));

const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const OG_IMAGE = `${SITE_URL}/src/assets/images/og-image-1200x630.jpg`;

function organizationLd() {
  const areas = SITE.serviceAreas.split(',').map((x) => x.trim()).filter(Boolean);
  const country = { '@type': 'Country', name: 'South Africa' };
  const org = {
    '@type': ['DryCleaningOrLaundryService', 'Organization'],
    '@id': ORG_ID,
    name: 'M&M Laundry',
    alternateName: 'M&M Laundry Services',
    legalName: 'M&M Laundry Services (Pty) Ltd',
    url: `${SITE_URL}/`,
    logo: { '@type': 'ImageObject', url: `${SITE_URL}/src/assets/images/icons/icon-512.png`, width: 512, height: 512 },
    image: OG_IMAGE,
    description: unHtml(DEFAULT_DESCRIPTION),
    areaServed: areas.length ? areas.map((name) => ({ '@type': 'City', name, containedInPlace: country })) : country,
    currenciesAccepted: 'ZAR',
    paymentAccepted: 'Ozow instant EFT',
    address: {
      '@type': 'PostalAddress',
      ...(SEO.street ? { streetAddress: SEO.street } : {}),
      ...(SEO.city ? { addressLocality: SEO.city } : {}),
      ...(SEO.province ? { addressRegion: SEO.province } : {}),
      ...(SEO.postalCode ? { postalCode: SEO.postalCode } : {}),
      addressCountry: 'ZA',
    },
    knowsLanguage: 'en-ZA',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Laundry pickup and delivery services',
      itemListElement: SERVICES.map((sv) => ({
        '@type': 'Offer',
        priceCurrency: 'ZAR',
        itemOffered: { '@type': 'Service', name: sv.name, description: sv.description, url: `${SITE_URL}/services#${sv.id}`, provider: { '@id': ORG_ID }, areaServed: country },
      })),
    },
  };
  if (SITE.supportPhone) org.telephone = SITE.supportPhone;
  if (SITE.supportEmail) org.email = SITE.supportEmail;
  if (SEO.openingHours) org.openingHours = SEO.openingHours;
  if (SITE.supportPhone || SITE.supportEmail) {
    org.contactPoint = [{
      '@type': 'ContactPoint',
      contactType: 'customer support',
      ...(SITE.supportPhone ? { telephone: SITE.supportPhone } : {}),
      ...(SITE.supportEmail ? { email: SITE.supportEmail } : {}),
      areaServed: 'ZA',
      availableLanguage: ['English'],
    }];
  }
  const sameAs = [...SEO.socialProfiles, SITE.appStoreUrl, SITE.playStoreUrl].filter(Boolean);
  if (sameAs.length) org.sameAs = sameAs;
  return org;
}
const ORG_LD = organizationLd();
const WEBSITE_LD = { '@type': 'WebSite', '@id': WEBSITE_ID, url: `${SITE_URL}/`, name: 'M&M Laundry', alternateName: 'M&M Laundry Services', inLanguage: 'en-ZA', publisher: { '@id': ORG_ID } };

function pageLd(route, url, title, description) {
  const page = {
    '@type': PAGE_TYPES[route] || 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: 'en-ZA',
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': ORG_ID },
    primaryImageOfPage: { '@type': 'ImageObject', url: OG_IMAGE },
  };
  const graph = [ORG_LD, WEBSITE_LD, page];
  if (route !== '/' && PAGES[route]?.crumb) {
    page.breadcrumb = { '@id': `${url}#breadcrumb` };
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: PAGES[route].crumb, item: url },
      ],
    });
  }
  if (route === '/faq' && FAQ.length) page.mainEntity = FAQ;
  if (route === '/services') page.mainEntity = { '@id': ORG_ID };
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 0).replace(/</g, '\\u003c');
}

const VERIFICATION_META = [
  SEO.googleVerification && `<meta name="google-site-verification" content="${SEO.googleVerification}">`,
  SEO.bingVerification && `<meta name="msvalidate.01" content="${SEO.bingVerification}">`,
].filter(Boolean).join('\n  ');

// Prices and the partner list are fetched from Supabase on marketing pages: open the connection early.
const PRECONNECT = SUPABASE_ORIGIN ? `<link rel="preconnect" href="${SUPABASE_ORIGIN}" crossorigin>` : '';

const setMeta = (html, re, value) => html.replace(re, (m, pre) => `${pre}${value}"`);

function renderPage(route, p, status) {
  const meta = PAGES[route] || PAGES['/'];
  const indexable = status === 200 && !isNoindex(p) && SPA_ROUTES.has(p);
  const canonicalPath = SPA_ROUTES.has(p) ? p : '/';
  const url = `${SITE_URL}${canonicalPath}`;
  const title = meta.title;
  const description = meta.description || DEFAULT_DESCRIPTION;
  let html = INDEX_HTML
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace('<!--seo:verification-->', VERIFICATION_META)
    .replace('<!--seo:preconnect-->', PRECONNECT)
    .replace('__LD_JSON__', pageLd(route, url, unHtml(title), unHtml(description)));
  html = setMeta(html, /(<meta name="description" content=")[^"]*"/, description);
  html = setMeta(html, /(<meta property="og:description" content=")[^"]*"/, description);
  html = setMeta(html, /(<meta name="twitter:description" content=")[^"]*"/, description);
  html = setMeta(html, /(<meta property="og:title" content=")[^"]*"/, title);
  html = setMeta(html, /(<meta name="twitter:title" content=")[^"]*"/, title);
  html = setMeta(html, /(<meta property="og:url" content=")[^"]*"/, url);
  html = setMeta(html, /(<link rel="canonical" href=")[^"]*"/, url);
  html = html.replace(/(<link rel="alternate" hreflang="(?:en-ZA|x-default)" href=")[^"]*"/g, `$1${url}"`);
  if (!indexable) html = setMeta(html, /(<meta name="robots" content=")[^"]*"/, 'noindex, follow');
  // Show this route's section in the HTML (the client router does the same after load).
  html = html.replace(/<section class="page" data-route="([^"]+)"([^>]*?)( hidden)?>/g, (m, r, attrs) => `<section class="page" data-route="${r}"${attrs}${r === route ? '' : ' hidden'}>`);
  return html;
}

// Sitemap: every indexable page. lastmod is when index.html (the page content) last changed.
const LASTMOD = (env.SITEMAP_LASTMOD && /^\d{4}-\d{2}-\d{2}$/.test(env.SITEMAP_LASTMOD))
  ? env.SITEMAP_LASTMOD : fs.statSync(path.join(__dirname, 'index.html')).mtime.toISOString().slice(0, 10);
const PRIORITY = { '/': '1.0', '/services': '0.9', '/how-it-works': '0.8', '/faq': '0.7', '/partners': '0.7', '/drive': '0.7', '/business': '0.7', '/about': '0.6', '/contact': '0.6' };
const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${[...SPA_ROUTES].filter((r) => !isNoindex(r)).map((r) => `  <url>
    <loc>${SITE_URL}${r}</loc>
    <lastmod>${LASTMOD}</lastmod>
    <priority>${PRIORITY[r] || '0.3'}</priority>${r === '/' ? `
    <image:image><image:loc>${OG_IMAGE}</image:loc></image:image>` : ''}
  </url>`).join('\n')}
</urlset>
`;

function sendIndex(req, res, status = 200) {
  const p = req.path.replace(/\/+$/, '') || '/';
  const known = SPA_ROUTES.has(p);
  const route = status !== 200 ? '404' : known ? p : p.startsWith('/orders/') ? '/orders/:id' : '404';
  res.status(status);
  if (status !== 200 || isNoindex(p)) res.setHeader('X-Robots-Tag', 'noindex');
  // One cached copy per distinct page (dynamic order pages and 404s all share one).
  const cacheKey = `${status}:${route}`;
  const hit = compressed.get(`page:${cacheKey}`);
  sendVariant(req, res, hit || compressedPage(cacheKey, renderPage(route, p, status)), 'text/html; charset=utf-8', 'no-cache');
}

/* ---- compressed, revalidated text assets ----
   Text files are compressed once (brotli/gzip) and kept in memory, keyed by path + mtime.
   Unversioned URLs (ES module imports) are `no-cache` with an ETag, so repeat visits cost a
   304; URLs with ?v= (styles.css, main.js in index.html) are cached for a year. */
const TEXT_TYPES = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const compressed = new Map();
function variants(file, body, mtimeMs) {
  const hit = compressed.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  const buf = body ?? fs.readFileSync(file);
  const v = {
    mtimeMs,
    etag: `"${crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20)}"`,
    identity: buf,
    br: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: buf.length > 100_000 ? 9 : 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }),
    gzip: zlib.gzipSync(buf, { level: 9 }),
  };
  compressed.set(file, v);
  return v;
}
function sendVariant(req, res, v, type, cacheControl) {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', v.etag);
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === v.etag) return res.status(304).end();
  const ae = String(req.headers['accept-encoding'] || '');
  let body = v.identity;
  if (/\bbr\b/.test(ae)) { body = v.br; res.setHeader('Content-Encoding', 'br'); }
  else if (/\bgzip\b/.test(ae)) { body = v.gzip; res.setHeader('Content-Encoding', 'gzip'); }
  res.setHeader('Content-Length', body.length);
  return req.method === 'HEAD' ? res.end() : res.end(body);
}
const versioned = (req) => typeof req.query.v === 'string' && req.query.v !== '';
const LONG = 'public, max-age=31536000, immutable';
function serveText(dir, cacheFor) {
  const root = path.join(__dirname, dir);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const type = TEXT_TYPES[path.extname(req.path).toLowerCase()];
    if (!type) return next();
    const file = path.join(root, path.normalize(decodeURIComponent(req.path)).replace(/^([/\\])+/, ''));
    if (!file.startsWith(root + path.sep) || /(^|[/\\])\./.test(path.relative(root, file))) return res.status(404).type('text/plain').send('Not found');
    let st;
    try { st = fs.statSync(file); } catch { return res.status(404).type('text/plain').send('Not found'); }
    if (!st.isFile()) return res.status(404).type('text/plain').send('Not found');
    return sendVariant(req, res, variants(file, null, st.mtimeMs), type, cacheFor(req));
  };
}
const compressedPage = (name, text) => variants(`page:${name}`, Buffer.from(text), 0);

app.get('/config.js', (req, res) => sendVariant(req, res, compressedPage('config', CONFIG_JS), 'application/javascript; charset=utf-8', 'no-cache'));
app.get('/robots.txt', (req, res) => res.type('text/plain').send(ROBOTS_TXT));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(SITEMAP_XML));
app.get('/manifest.json', (req, res) => {
  res.type('application/manifest+json').setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
  res.type('application/javascript').setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

/* ---- Universal Links (iOS) and App Links (Android) ----
   Served as application/json with no redirect, as Apple and Google require. */
const AASA = JSON.stringify({
  applinks: {
    apps: [],
    details: APPLE_TEAM_ID ? [{
      appIDs: [`${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`],
      components: APP_LINK_PATHS.map((p) => ({ '/': p })),
      appID: `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`, // iOS 12 format
      paths: APP_LINK_PATHS,
    }] : [],
  },
  webcredentials: { apps: APPLE_TEAM_ID ? [`${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`] : [] },
});
const ASSETLINKS = JSON.stringify(ANDROID_SHA256.length ? [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: SITE.androidPackage, sha256_cert_fingerprints: ANDROID_SHA256 },
}] : []);
const wellKnown = (body) => (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(body);
};
app.get(['/.well-known/apple-app-site-association', '/apple-app-site-association'], wellKnown(AASA));
app.get('/.well-known/assetlinks.json', wellKnown(ASSETLINKS));

app.get('/styles.css', (req, res) => {
  const file = path.join(__dirname, 'styles.css');
  sendVariant(req, res, variants(file, null, fs.statSync(file).mtimeMs), TEXT_TYPES['.css'], versioned(req) ? LONG : 'no-cache');
});
app.use('/js', serveText('js', (req) => (versioned(req) ? LONG : 'no-cache')));
app.use('/vendor', serveText('vendor', () => 'public, max-age=86400, stale-while-revalidate=604800'));
app.use('/src/assets/illustrations', serveText('src/assets/illustrations', () => 'public, max-age=2592000'));
const staticOpts = (maxAge, immutable = false) => ({ dotfiles: 'deny', index: false, redirect: false, maxAge, immutable, fallthrough: false });
app.use('/src/assets/fonts', express.static(path.join(__dirname, 'src', 'assets', 'fonts'), staticOpts('365d', true)));
app.use('/src/assets', express.static(path.join(__dirname, 'src', 'assets'), staticOpts('30d')));

app.get('/healthz', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ status: 'ok' }); });

/* ========================================================================
   OZOW RETURN
   Ozow may send the customer back with a form POST. The posted fields are never trusted:
   we redirect (303) to the same URL as a GET and the page reads the order status from
   Supabase. Only the `payment` query flag set in create-order's return_url is kept.
   ======================================================================== */
function ozowReturn(req, res) {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.redirect(303, '/orders');
  const flag = String(req.query.payment || '');
  const payment = ['success', 'cancelled', 'error'].includes(flag) ? flag : '';
  res.redirect(303, `/orders/${id}${payment ? `?payment=${payment}` : ''}`);
}
app.post('/orders/:id', ozowReturn);
app.post('/order/:id', ozowReturn);
app.get('/order/:id', ozowReturn); // the backend's default PUBLIC_APP_URL path is /order/<id>

/* ========================================================================
   SPA FALLBACK
   ======================================================================== */
app.get('*', (req, res) => {
  if (/\.[a-zA-Z0-9]+$/.test(req.path)) return res.status(404).type('text/plain').send('Not found');
  const p = req.path.replace(/\/+$/, '') || '/';
  const known = SPA_ROUTES.has(p) || DYNAMIC_ROUTES.some((re) => re.test(p));
  sendIndex(req, res, known ? 200 : 404);
});
app.use((req, res) => res.status(405).type('text/plain').send('Method not allowed'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status === 404 || err.statusCode === 404) return res.status(404).type('text/plain').send('Not found');
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(500).type('text/plain').send('Something went wrong.');
});

/* ========================================================================
   START & SHUTDOWN
   ======================================================================== */
const server = app.listen(PORT, HOST, () => {
  console.log(`M&M web server on http://${HOST}:${PORT} (${IS_PROD ? 'production' : 'development'})`);
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

function shutdown(signal) {
  console.log(`${signal} received: closing server...`);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
