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

// Public client config only. These values ship to every browser; never put a secret here.
const PUBLIC_CONFIG = Object.freeze({
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
const INDEX_HTML = readTemplate('index.html');
const ROBOTS_TXT = readTemplate('robots.txt');
const SITEMAP_XML = readTemplate('sitemap.xml');
const CONFIG_JS = `window.__MM_CONFIG__ = Object.freeze(${JSON.stringify(PUBLIC_CONFIG).replace(/</g, '\\u003c')});\n`;

// Every route the SPA renders. Keep in sync with data-route in index.html.
const SPA_ROUTES = new Set([
  '/', '/services', '/how-it-works', '/about', '/faq', '/contact', '/business', '/drive', '/partners',
  '/book', '/orders', '/account', '/login', '/signup', '/forgot-password',
  '/privacy', '/terms', '/garment-care', '/accessibility',
]);
const DYNAMIC_ROUTES = [/^\/orders\/[0-9a-f-]{36}$/i];
const NOINDEX = ['/book', '/orders', '/account', '/login', '/signup', '/forgot-password'];

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
  res.status(status).type('html').setHeader('Cache-Control', 'no-cache');
  res.send(html);
}

const noCache = (type) => (req, res, next) => { res.type(type).setHeader('Cache-Control', 'no-cache'); next(); };

app.get('/config.js', (req, res) => {
  res.type('application/javascript').setHeader('Cache-Control', 'no-cache');
  res.send(CONFIG_JS);
});
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
app.get('/styles.css', noCache('text/css'), (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
const staticOpts = (maxAge) => ({ dotfiles: 'deny', index: false, redirect: false, maxAge, fallthrough: false });
app.use('/js', (req, res, next) => { res.setHeader('Cache-Control', 'no-cache'); next(); }, express.static(path.join(__dirname, 'js'), staticOpts(0)));
app.use('/vendor', express.static(path.join(__dirname, 'vendor'), staticOpts('1d')));
app.use('/src/assets', express.static(path.join(__dirname, 'src', 'assets'), staticOpts('7d')));

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
