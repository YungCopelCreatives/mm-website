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
 *   __LD_CONTACT__                     JSON-LD contact fields (empty when nothing is set)
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
  const ld = {};
  if (SITE.supportPhone) ld.telephone = SITE.supportPhone;
  if (SITE.supportEmail) ld.email = SITE.supportEmail;
  if (SITE.serviceAreas) ld.areaServed = SITE.serviceAreas.split(',').map((x) => x.trim()).filter(Boolean);
  const sameAs = [SITE.appStoreUrl, SITE.playStoreUrl].filter(Boolean);
  if (sameAs.length) ld.sameAs = sameAs;
  const ldText = Object.entries(ld).map(([k, v]) => `"${k}": ${JSON.stringify(v).replace(/</g, '\\u003c')},`).join('\n        ');
  return out.replace('__LD_CONTACT__', ldText);
}
const INDEX_HTML = renderSite(readTemplate('index.html'));
const ROBOTS_TXT = readTemplate('robots.txt');
const SITEMAP_XML = readTemplate('sitemap.xml');
const CONFIG_JS = `window.__MM_CONFIG__ = Object.freeze(${JSON.stringify(PUBLIC_CONFIG).replace(/</g, '\\u003c')});\n`;

// Every route the SPA renders. Keep in sync with data-route in index.html.
const SPA_ROUTES = new Set([
  '/', '/services', '/how-it-works', '/about', '/faq', '/contact', '/business', '/drive', '/partners',
  '/book', '/orders', '/account', '/login', '/signup', '/forgot-password',
  '/privacy', '/terms', '/garment-care', '/accessibility', '/kyc',
]);
const DYNAMIC_ROUTES = [/^\/orders\/[0-9a-f-]{36}$/i];
const NOINDEX = ['/book', '/orders', '/account', '/login', '/signup', '/forgot-password', '/kyc'];

const PAGE_TITLES = {};
for (const m of INDEX_HTML.matchAll(/data-route="([^"]+)" data-title="([^"]+)"/g)) PAGE_TITLES[m[1]] = m[2];

function sendIndex(req, res, status = 200) {
  const p = req.path.replace(/\/+$/, '') || '/';
  const known = SPA_ROUTES.has(p);
  let html = INDEX_HTML.replace(`<link rel="canonical" href="${SITE_URL}/">`, `<link rel="canonical" href="${SITE_URL}${known ? (p === '/' ? '/' : p) : '/'}">`);
  if (known && PAGE_TITLES[p]) html = html.replace(/<title>[^<]*<\/title>/, `<title>${PAGE_TITLES[p]}</title>`);
  if (status !== 200 || NOINDEX.some((x) => p === x || p.startsWith(x + '/'))) {
    html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, nofollow">');
  }
  res.status(status);
  // One cached copy per distinct page (dynamic order pages and 404s all share one).
  const cacheKey = `${status}:${known ? p : p.startsWith('/orders/') ? '/orders/*' : '*'}`;
  sendVariant(req, res, compressedPage(cacheKey, html), 'text/html; charset=utf-8', 'no-cache');
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
