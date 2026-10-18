/**
 * M&M Laundromat — production web server.
 *
 * Storage note: this server keeps data in a single JSON file with atomic writes.
 * That is acceptable for a low-traffic, single-instance pilot ONLY. Before real
 * launch move to a managed database (e.g. Postgres on Supabase/Neon/RDS) — a JSON
 * file cannot be shared between instances, has no transactions/backups, and on
 * most container hosts (Cloud Run, Render free tier, etc.) the disk is ephemeral.
 */
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================================
   CONFIGURATION
   ========================================================================= */
const IS_PROD = process.env.NODE_ENV === 'production';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SITE_URL = (process.env.SITE_URL || (IS_PROD ? '' : `http://localhost:${PORT}`)).replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, 'data', 'data_store.json'));
const SESSION_TTL_MS = Number.parseInt(process.env.SESSION_TTL_HOURS || '168', 10) * 60 * 60 * 1000;
const PROMO_CODES = (process.env.PROMO_CODES || 'MMWELCOME,SAVE50,UBER50,FIRSTWASH,MM50,WELCOME50')
  .split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
const PROMO_DISCOUNT = 50;

// TRUST_PROXY: number of reverse-proxy hops in front of the app (Cloud Run /
// Render / Fly / Nginx = 1). Required so rate limiting sees the real client IP.
function parseTrustProxy(v) {
  if (v === undefined || v === '') return IS_PROD ? 1 : false;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // e.g. "loopback, 10.0.0.0/8"
}
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

function assertConfig() {
  const problems = [];
  if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) problems.push('PORT must be a valid port number');
  if (IS_PROD) {
    if (!/^https:\/\/[^/]+$/.test(SITE_URL)) problems.push('SITE_URL must be set to the public https origin, e.g. https://www.example.co.za');
    if (ADMIN_TOKEN.length < 32) problems.push('ADMIN_TOKEN must be set to a random secret of at least 32 characters');
  }
  if (problems.length) {
    console.error('Refusing to start — configuration errors:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  if (!IS_PROD && !ADMIN_TOKEN) {
    console.warn('[warn] ADMIN_TOKEN not set: admin endpoints are disabled.');
  }
}
assertConfig();

/* =========================================================================
   DATA STORE (JSON file, atomic writes, single process)
   ========================================================================= */
function getInitialData() {
  const policy = 'Rates determined by laundromat based on basket size and individual pricing for sneakers, blankets & carpets';
  return {
    users: [],
    orders: [],
    driverApplications: [],
    laundromatApplications: [],
    laundromatPartners: [
      { id: 'lnd_cpt_1', businessName: 'Kloof Street Laundromat & Garment Care', address: '48 Kloof Street, Gardens', city: 'Cape Town', suburb: 'Gardens & City Bowl', status: 'Active', rating: 4.9, turnaround: '24 Hours Standard', specialties: 'Everyday Wash & Fold, Sneakers Care, Infant Sensitive', pricingPolicy: policy, services: ['wash_fold', 'iron_press', 'sneakers', 'blankets', 'baby_clothes'] },
      { id: 'lnd_cpt_2', businessName: 'Atlantic Seaboard Laundry Hub', address: '112 Regent Road, Sea Point', city: 'Cape Town', suburb: 'Sea Point, Camps Bay & Green Point', status: 'Active', rating: 4.8, turnaround: 'Same-Day & 24h', specialties: 'Airbnb Linens, Blankets & Duvets, Carpets & Rugs', pricingPolicy: policy, services: ['wash_fold', 'blankets', 'carpets', 'sneakers', 'dry_clean'] },
      { id: 'lnd_jhb_1', businessName: 'Rosebank Master Laundromat & Dry Cleaners', address: '15 Tyrwhitt Avenue, Rosebank', city: 'Johannesburg', suburb: 'Rosebank, Parkhurst & Houghton', status: 'Active', rating: 4.9, turnaround: '24 Hours Standard', specialties: 'Suits & Dry Cleaning, Sneakers Deep Clean, Wash & Fold', pricingPolicy: policy, services: ['wash_fold', 'dry_clean', 'sneakers', 'iron_press', 'blankets'] },
      { id: 'lnd_jhb_2', businessName: 'Sandton Elite Laundry & Commercial Wash', address: 'Sandton Drive & Rivonia Road, Sandhurst', city: 'Johannesburg', suburb: 'Sandton, Morningside & Bryanston', status: 'Active', rating: 4.9, turnaround: '12h Express & 24h Standard', specialties: 'Executive Shirts, Blankets & Duvets, Carpets & Area Rugs', pricingPolicy: policy, services: ['wash_fold', 'iron_press', 'blankets', 'carpets', 'express'] },
      { id: 'lnd_dbn_1', businessName: 'Umhlanga Ridge Laundromat', address: 'Palm Boulevard, Gateway Precinct, Umhlanga', city: 'Durban / eThekwini', suburb: 'Umhlanga, Durban North & La Lucia', status: 'Active', rating: 4.8, turnaround: '24 Hours Standard', specialties: 'Holiday Linens, Blankets, Sneakers, Wash & Fold', pricingPolicy: policy, services: ['wash_fold', 'blankets', 'sneakers', 'carpets', 'iron_press'] },
      { id: 'lnd_pta_1', businessName: 'Pretoria East Gentle Laundry & Press', address: 'Atterbury Road, Menlyn', city: 'Pretoria / Tshwane', suburb: 'Menlyn, Brooklyn & Faerie Glen', status: 'Active', rating: 4.9, turnaround: '24 Hours Standard', specialties: 'Steam Press, Hypoallergenic Wash, Blankets & Duvets', pricingPolicy: policy, services: ['wash_fold', 'iron_press', 'blankets', 'sneakers', 'baby_clothes'] }
    ],
    businessInquiries: [],
    supportTickets: []
  };
}

let db = null;
let writeChain = Promise.resolve();
let pendingWrite = false;

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const base = getInitialData();
      for (const key of Object.keys(base)) {
        if (!Array.isArray(parsed[key])) parsed[key] = key === 'laundromatPartners' ? base[key] : [];
      }
      return parsed;
    }
  } catch (err) {
    // Never silently overwrite a corrupt store: that would destroy customer data.
    console.error(`Data file ${DATA_FILE} is unreadable or corrupt; refusing to start.`, err.message);
    process.exit(1);
  }
  const initial = getInitialData();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true, mode: 0o700 });
  writeFileAtomicSync(DATA_FILE, JSON.stringify(initial, null, 2));
  return initial;
}

function writeFileAtomicSync(file, contents) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

// Serialise writes so concurrent requests can never interleave a partial file.
function saveDB() {
  if (pendingWrite) return writeChain;
  pendingWrite = true;
  writeChain = writeChain.then(() => new Promise((resolve) => {
    setImmediate(() => {
      pendingWrite = false;
      try {
        writeFileAtomicSync(DATA_FILE, JSON.stringify(db, null, 2));
      } catch (err) {
        console.error('Error writing data store:', err.message);
      }
      resolve();
    });
  }));
  return writeChain;
}

db = loadDB();

/* =========================================================================
   HELPERS: validation, auth, ids
   ========================================================================= */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;
const PHONE_RE = /^\+?[0-9 ()-]{9,20}$/;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function str(value, { field, max = 200, required = false, multiline = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw new HttpError(400, `${field} must be text`);
  let s = String(value).replace(CONTROL_RE, '').trim();
  if (!multiline) s = s.replace(/[\r\n]+/g, ' '); // blocks header/email injection
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return s;
}
function email(value, required = true) {
  const s = str(value, { field: 'Email', max: 254, required }).toLowerCase();
  if (s && !EMAIL_RE.test(s)) throw new HttpError(400, 'Please enter a valid email address');
  return s;
}
function phone(value, required = false) {
  const s = str(value, { field: 'Phone', max: 20, required });
  if (s && !PHONE_RE.test(s)) throw new HttpError(400, 'Please enter a valid phone number');
  return s;
}
function requireConsent(body) {
  if (body.consent !== true) {
    throw new HttpError(400, 'Please confirm your consent to the processing of your personal information (POPIA).');
  }
  return { consentGiven: true, consentAt: new Date().toISOString() };
}
function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
function timeLabel() {
  return new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
}

// Password hashing with scrypt (no native deps). Format: scrypt$N$salt$hash
const SCRYPT_N = 16384;
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, n, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n) });
  return crypto.timingSafeEqual(actual, expected);
}
// Burn comparable CPU for unknown emails to limit user enumeration via timing.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Sessions are in memory: they are lost on restart and not shared across
// instances. TODO for owner: move to a DB/Redis-backed session store.
const sessions = new Map(); // tokenHash -> { userId, expiresAt }
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(tokenHash(token), { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}
function bearer(req) {
  const h = req.headers.authorization;
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t && t.length <= 200 ? t : null;
}
function getAuthenticatedUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const key = tokenHash(token);
  const s = sessions.get(key);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { sessions.delete(key); return null; }
  return db.users.find((u) => u.id === s.userId) || null;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (s.expiresAt < now) sessions.delete(k);
}, 60 * 60 * 1000).unref();

function requireUser(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = user;
  next();
}
function isAdminRequest(req) {
  if (!ADMIN_TOKEN) return false;
  const supplied = req.get('x-admin-token') || bearer(req);
  return typeof supplied === 'string' && safeEqual(supplied, ADMIN_TOKEN);
}
function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

function publicUser(u) {
  const { passwordHash: _h, password: _p, ...safe } = u;
  return safe;
}

/* =========================================================================
   APP & MIDDLEWARE
   ========================================================================= */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // 'unsafe-inline' is required because index.html/app.js use inline on*
      // event handlers. TODO: migrate to addEventListener and drop it.
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(IS_PROD ? { upgradeInsecureRequests: [] } : {})
    }
  },
  strictTransportSecurity: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' }
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  next();
});
app.use(compression());

// API hygiene: no caching, JSON only, small bodies.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
  // Requiring application/json on bodies also blocks cross-site HTML form posts (CSRF/spam).
  if (hasBody && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
});
app.use('/api', express.json({ limit: '16kb', strict: true }));

const limiterOpts = { standardHeaders: 'draft-7', legacyHeaders: false };
const apiLimiter = rateLimit({ ...limiterOpts, windowMs: 15 * 60 * 1000, limit: 300 });
const authLimiter = rateLimit({ ...limiterOpts, windowMs: 15 * 60 * 1000, limit: 20, message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
const formLimiter = rateLimit({ ...limiterOpts, windowMs: 60 * 60 * 1000, limit: 15, message: { error: 'Too many submissions. Please try again later.' } });
app.use('/api', apiLimiter);

/* =========================================================================
   STATIC FILES (explicit allow-list — never serve the project root)
   ========================================================================= */
function readTemplate(file) {
  return fs.readFileSync(path.join(__dirname, file), 'utf8').replaceAll('__SITE_URL__', SITE_URL);
}
const INDEX_HTML = readTemplate('index.html');
const ROBOTS_TXT = readTemplate('robots.txt');
const SITEMAP_XML = readTemplate('sitemap.xml');
const SPA_ROUTES = new Set(['/', '/services', '/how-it-works', '/about', '/faq', '/contact', '/business', '/book', '/orders', '/account', '/account/addresses', '/login', '/signup', '/forgot-password']);
const NOINDEX_PREFIXES = ['/orders', '/account', '/login', '/signup', '/forgot-password'];

function sendIndex(req, res, status = 200) {
  const p = req.path.replace(/\/+$/, '') || '/';
  const canonicalPath = SPA_ROUTES.has(p) ? (p === '/' ? '/' : p) : '/';
  let html = INDEX_HTML.replace(
    `<link rel="canonical" href="${SITE_URL}/">`,
    `<link rel="canonical" href="${SITE_URL}${canonicalPath}">`
  );
  if (NOINDEX_PREFIXES.some((x) => p === x || p.startsWith(x + '/')) || status !== 200) {
    html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, nofollow">');
  }
  res.status(status).type('html').setHeader('Cache-Control', 'no-cache');
  res.send(html);
}

app.get('/robots.txt', (req, res) => res.type('text/plain').send(ROBOTS_TXT));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(SITEMAP_XML));
app.get('/manifest.json', (req, res) => {
  res.type('application/manifest+json').setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});
app.get('/app.js', (req, res) => {
  res.type('application/javascript').setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'app.js'));
});
app.get('/styles.css', (req, res) => {
  res.type('text/css').setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'styles.css'));
});
app.use('/src/assets', express.static(path.join(__dirname, 'src', 'assets'), {
  dotfiles: 'deny',
  index: false,
  redirect: false,
  maxAge: '7d'
}));

/* =========================================================================
   HEALTH
   ========================================================================= */
app.get('/healthz', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
});
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

/* =========================================================================
   AUTH
   ========================================================================= */
function handleSignup(req, res) {
  const b = req.body || {};
  const name = str(b.name, { field: 'Name', max: 100, required: true });
  const mail = email(b.email);
  const tel = phone(b.phone);
  const address = str(b.address, { field: 'Address', max: 300 });
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200) {
    throw new HttpError(400, 'Password must be between 8 and 200 characters');
  }
  const consent = requireConsent(b);

  if (db.users.some((u) => u.email === mail)) {
    // TODO for owner: once email is wired up, respond identically and email the
    // existing account holder instead, to avoid account enumeration.
    throw new HttpError(409, 'An account with this email already exists');
  }

  const newUser = {
    id: newId('usr'),
    name,
    email: mail,
    passwordHash: hashPassword(b.password),
    phone: tel,
    role: 'customer', // never taken from the request body
    address,
    savedAddresses: address ? [{ id: newId('addr'), label: 'Primary', address }] : [],
    preferences: { detergent: 'Hypoallergenic (Eco)', temperature: 'Cold wash', foldStyle: 'Standard fold' },
    ...consent,
    createdAt: new Date().toISOString()
  };
  db.users.push(newUser);
  saveDB();
  const token = createSession(newUser.id);
  res.status(201).json({ user: publicUser(newUser), token });
}
app.post('/api/auth/signup', authLimiter, handleSignup);
app.post('/api/auth/register', authLimiter, handleSignup);

app.post('/api/auth/login', authLimiter, (req, res) => {
  const b = req.body || {};
  const mail = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const pw = typeof b.password === 'string' ? b.password : '';
  if (!mail || !pw || pw.length > 200) throw new HttpError(400, 'Email and password are required');
  const user = db.users.find((u) => u.email === mail);
  const ok = user ? verifyPassword(pw, user.passwordHash) : (verifyPassword(pw, DUMMY_HASH), false);
  if (!ok) throw new HttpError(401, 'Invalid email or password');
  const token = createSession(user.id);
  res.json({ user: publicUser(user), token });
});

app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/logout', (req, res) => {
  const t = bearer(req);
  if (t) sessions.delete(tokenHash(t));
  res.json({ success: true });
});

app.post('/api/auth/forgot-password', authLimiter, (req, res) => {
  email(req.body?.email);
  // TODO for owner: generate a single-use, expiring reset token and send it via a
  // transactional email provider. Never echo the submitted address back.
  res.json({ success: true, message: 'If an account exists for that email, a reset link will be sent.' });
});

/* =========================================================================
   USER PROFILE & ADDRESSES
   ========================================================================= */
app.get('/api/user/profile', requireUser, (req, res) => res.json({ success: true, user: publicUser(req.user) }));

const PREF_KEYS = ['detergent', 'temperature', 'foldStyle', 'notifications', 'theme', 'payment'];
app.put('/api/user/profile', requireUser, (req, res) => {
  const b = req.body || {};
  const u = req.user;
  if (b.name !== undefined) u.name = str(b.name, { field: 'Name', max: 100, required: true });
  if (b.phone !== undefined) u.phone = phone(b.phone);
  if (b.address) {
    const address = str(b.address, { field: 'Address', max: 300 });
    u.address = address;
    if (!Array.isArray(u.savedAddresses)) u.savedAddresses = [];
    if (!u.savedAddresses.some((sa) => sa.address === address) && u.savedAddresses.length < 20) {
      u.savedAddresses.push({ id: newId('addr'), label: 'Primary', address });
    }
  }
  if (b.preferences && typeof b.preferences === 'object' && !Array.isArray(b.preferences)) {
    const prefs = { ...(u.preferences || {}) };
    for (const k of PREF_KEYS) {
      if (b.preferences[k] !== undefined) prefs[k] = str(b.preferences[k], { field: k, max: 60 });
    }
    u.preferences = prefs;
  }
  if (b.defaultPayment !== undefined) u.defaultPayment = str(b.defaultPayment, { field: 'Default payment', max: 60 });
  saveDB();
  res.json({ success: true, user: publicUser(u), message: 'Profile & preferences updated successfully.' });
});

app.post('/api/user/addresses', requireUser, (req, res) => {
  const b = req.body || {};
  const address = str(b.address, { field: 'Address', max: 300, required: true });
  const label = str(b.label, { field: 'Label', max: 40 }) || 'Home';
  const u = req.user;
  if (!Array.isArray(u.savedAddresses)) u.savedAddresses = [];
  if (u.savedAddresses.length >= 20) throw new HttpError(400, 'You can save up to 20 addresses');
  u.savedAddresses.push({ id: newId('addr'), label, address });
  if (!u.address) u.address = address;
  saveDB();
  res.json({ success: true, savedAddresses: u.savedAddresses, message: 'New address saved to your account.' });
});

app.delete('/api/user/addresses/:id', requireUser, (req, res) => {
  const u = req.user;
  const id = String(req.params.id).slice(0, 300);
  if (!Array.isArray(u.savedAddresses)) throw new HttpError(404, 'Address not found');
  u.savedAddresses = u.savedAddresses.filter((sa) => sa.id !== id && sa.address !== id);
  saveDB();
  res.json({ success: true, savedAddresses: u.savedAddresses, message: 'Address removed.' });
});

/* =========================================================================
   SUPPORT
   ========================================================================= */
app.post('/api/support/message', formLimiter, (req, res) => {
  const b = req.body || {};
  const user = getAuthenticatedUser(req);
  const message = str(b.message, { field: 'Message', max: 2000, required: true, multiline: true });
  const orderId = str(b.orderId, { field: 'Order ID', max: 40 }) || null;
  const name = user ? user.name : (str(b.name, { field: 'Name', max: 100 }) || 'Guest');
  const mail = user ? user.email : (b.email && b.email !== 'guest@client.co.za' ? email(b.email) : '');
  const tel = user ? user.phone : phone(b.phone);
  const reason = str(b.reason, { field: 'Subject', max: 80 });
  // Anonymous visitors who leave contact details must consent (POPIA s11/s18).
  const consent = !user && (mail || tel) ? requireConsent(b) : {};

  const ticket = {
    id: newId('tkt'),
    userId: user ? user.id : null,
    customerName: name,
    customerEmail: mail,
    customerPhone: tel,
    subject: reason,
    orderId,
    message,
    ...consent,
    createdAt: new Date().toISOString()
  };
  db.supportTickets.push(ticket);
  saveDB();
  // TODO for owner: forward tickets to a help-desk / email inbox.

  const lowerMsg = message.toLowerCase();
  let reply = 'Thanks for reaching out! Our M&M operations team will get back to you shortly.';
  if (lowerMsg.includes('track') || lowerMsg.includes('where is') || lowerMsg.includes('status')) {
    // Only disclose order details to the signed-in owner of the order.
    const order = user && orderId ? db.orders.find((o) => o.id === orderId && o.userId === user.id) : null;
    reply = order
      ? `Order #${order.id} is currently in the ${String(order.status).replace(/_/g, ' ').toUpperCase()} stage. Your handover PIN is shown in your order tracker.`
      : "To track an order, sign in and open 'My Orders' to see its live status.";
  } else if (/weight|kg|scale|basket|sneaker|blanket|carpet/.test(lowerMsg)) {
    reply = 'Partner laundromats price everyday laundry by basket size and provide individual item pricing for sneakers, blankets and carpets. You choose your partner laundromat when scheduling a pickup.';
  } else if (/detergent|sensitive|baby/.test(lowerMsg)) {
    reply = 'We offer plant-based, fragrance-free hypoallergenic detergent, standard detergent, and optional eco fabric softener. You can set this in your order preferences.';
  } else if (/cancel|change time|reschedule/.test(lowerMsg)) {
    reply = 'Pickups can be rescheduled or cancelled free of charge up to 2 hours before the scheduled window from your order tracker.';
  } else if (/pin|handover|security/.test(lowerMsg)) {
    reply = 'Every order has a unique 4-digit handover PIN. Share it with the courier only when handing over or receiving your laundry.';
  } else if (/price|cost|how much|rate/.test(lowerMsg)) {
    reply = 'Pricing is based on basket size or item count and the rates of your selected partner laundromat. The amount is shown before you book.';
  }
  res.json({ success: true, ticketId: ticket.id, reply, timestamp: timeLabel() });
});

/* =========================================================================
   PRICING (server is the source of truth for order amounts)
   ========================================================================= */
// Partner laundromat tariffs: everyday laundry is billed per basket size, specialty items per piece/pair.
// Keep in sync with wizardCalculatePricing() in app.js (the client only displays; this decides the amount).
const BASKET_TARIFF = { small: 140, medium: 220, large: 310, family: 430 };
const BASKET_LABELS = { small: 'Small basket', medium: 'Medium basket', large: 'Large basket', family: 'Family basket' };
const SERVICE_RATES = {
  wash_fold: { name: 'Wash & Fold (Everyday Clothes)', pricing: 'basket' },
  iron_press: { name: 'Wash & Steam Table Press', pricing: 'basket' },
  baby_clothes: { name: 'Infant & Sensitive Skin Care', pricing: 'basket' },
  express: { name: 'Express Rush (Same-Day 12h)', pricing: 'basket' },
  sneakers: { name: 'Sneakers & Footwear Deep Clean', pricing: 'item', rate: 125, unit: 'pair', max: 20 },
  blankets: { name: 'Blankets, Duvets & Heavy Bedding', pricing: 'item', rate: 130, unit: 'item', max: 20 },
  carpets: { name: 'Carpets & Area Rugs', pricing: 'item', rate: 180, unit: 'item', max: 10 },
  dry_clean: { name: 'Suits & Tailored Dry Cleaning', pricing: 'item', rate: 115, unit: 'item', max: 25 }
};
function resolveServiceKey(b) {
  for (const candidate of [b.serviceKey, b.service, b.serviceType]) {
    if (typeof candidate !== 'string') continue;
    if (SERVICE_RATES[candidate]) return candidate;
    const byName = Object.keys(SERVICE_RATES).find((k) => SERVICE_RATES[k].name === candidate);
    if (byName) return byName;
  }
  return null;
}
function quote({ serviceKey, quantity, sizeValue, promoCode }) {
  const svc = SERVICE_RATES[serviceKey];
  let qty, subtotal, unit;
  if (svc.pricing === 'item') {
    qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) qty = sizeValue === 'multiple_items' ? 2 : 1;
    qty = Math.min(Math.max(Math.round(qty), 1), svc.max);
    subtotal = qty * svc.rate;
    unit = svc.unit;
  } else {
    const size = oneOf(sizeValue, Object.keys(BASKET_TARIFF), 'medium');
    qty = 1;
    subtotal = BASKET_TARIFF[size];
    unit = BASKET_LABELS[size].toLowerCase();
  }
  subtotal = +subtotal.toFixed(2);
  const deliveryFee = subtotal >= 350 ? 0 : 45;
  const code = typeof promoCode === 'string' ? promoCode.trim().toUpperCase().slice(0, 30) : '';
  const discount = code && PROMO_CODES.includes(code) ? PROMO_DISCOUNT : 0;
  const total = Math.max(0, +(subtotal + deliveryFee - discount).toFixed(2));
  const beforeVat = +(total / 1.15).toFixed(2);
  const vat = +(total - beforeVat).toFixed(2);
  return { serviceName: svc.name, quantity: qty, unit, subtotal, deliveryFee, discount, promoCode: discount ? code : '', total, beforeVat, vat };
}
const describeLoad = (q) => (q.unit.endsWith('basket') ? q.unit[0].toUpperCase() + q.unit.slice(1) : `${q.quantity} ${q.unit}${q.quantity > 1 ? 's' : ''}`);

app.post('/api/pricing/calculate', (req, res) => {
  const b = req.body || {};
  const serviceKey = resolveServiceKey(b) || 'wash_fold';
  const q = quote({ serviceKey, quantity: b.quantity, sizeValue: b.sizeValue, promoCode: b.promoCode });
  res.json({ ...q, weightText: describeLoad(q), currency: 'ZAR', symbol: 'R' });
});

/* =========================================================================
   ORDERS
   ========================================================================= */
const ORDER_STEPS = [
  { key: 'placed', label: 'Order Confirmed', desc: 'Order placed and logged in system.' },
  { key: 'assigned', label: 'Driver Dispatched', desc: 'Local courier dispatched to your address.' },
  { key: 'picked_up', label: 'Picked Up & Verified', desc: 'Bags collected and verified by partner laundromat.' },
  { key: 'washing', label: 'In The Wash & Treatment', desc: 'Washing, sanitizing, and gentle cycle active.' },
  { key: 'inspection', label: 'Quality Check & Folding', desc: 'Hand-inspected, steam-pressed, and crisp folding.' },
  { key: 'out_for_delivery', label: 'Out for Return Delivery', desc: 'Courier en route back to your doorstep.' },
  { key: 'delivered', label: 'Delivered to Door', desc: 'Clean, fresh laundry delivered to doorstep.' }
];

function newOrderId() {
  let id;
  do { id = 'MM-' + crypto.randomInt(10_000_000, 100_000_000); } while (db.orders.some((o) => o.id === id));
  return id;
}
function newPin() {
  let pin;
  do { pin = String(crypto.randomInt(1000, 10000)); } while (['1234', '0000', '1111', '4321'].includes(pin));
  return pin;
}
function findOwnedOrder(req) {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  if (!isAdminRequest(req)) {
    const user = getAuthenticatedUser(req);
    if (!user) throw new HttpError(401, 'Please sign in to view this order');
    // 404 (not 403) so order IDs cannot be probed.
    if (order.userId !== user.id) throw new HttpError(404, 'Order not found');
  }
  return order;
}

app.get('/api/orders', requireUser, (req, res) => {
  res.json({ orders: db.orders.filter((o) => o.userId === req.user.id) });
});

app.get('/api/orders/:id', (req, res) => {
  res.json({ order: findOwnedOrder(req) });
});

app.post('/api/orders', requireUser, formLimiter, (req, res) => {
  const b = req.body || {};
  const user = req.user;
  const pickupAddress = str(b.pickupAddress || b.address, { field: 'Pickup address', max: 300, required: true });
  const serviceKey = resolveServiceKey(b);
  if (!serviceKey) throw new HttpError(400, 'Please choose a valid service.');

  let laundromat = null;
  if (b.laundromatId || b.laundromatName) {
    laundromat = db.laundromatPartners.find((l) => l.status === 'Active' && (l.id === b.laundromatId || l.businessName === b.laundromatName));
    if (!laundromat) throw new HttpError(400, 'Please select a valid partner laundromat.');
  }

  const q = quote({ serviceKey, quantity: b.weight ?? b.quantity, sizeValue: b.sizeValue, promoCode: b.promoCode });
  const orderId = newOrderId();
  const paymentMethod = oneOf(b.paymentMethod, ['instant_eft', 'credit_card', 'doorstep_pos', 'Instant EFT / Capitec Pay', 'Card', 'Cash'], 'instant_eft');

  const newOrder = {
    id: orderId,
    userId: user.id,
    customerName: str(b.customerName, { field: 'Name', max: 100 }) || user.name,
    phone: phone(b.phone) || user.phone || '',
    pickupAddress,
    gateCode: str(b.gateCode, { field: 'Gate code', max: 40 }),
    serviceKey,
    serviceType: q.serviceName,
    laundromatId: laundromat ? laundromat.id : null,
    laundromatName: laundromat ? laundromat.businessName : 'To be assigned',
    laundromatAddress: laundromat ? laundromat.address : '',
    quantity: q.quantity,
    unit: q.unit,
    estimatedWeight: describeLoad(q),
    detergent: str(b.detergent, { field: 'Detergent', max: 60 }) || 'Hypoallergenic (Eco)',
    folding: str(b.folding, { field: 'Folding', max: 60 }),
    specialInstructions: str(b.specialInstructions || b.instructions, { field: 'Special instructions', max: 500, multiline: true }) || 'Standard handling',
    pickupTime: str(b.pickupTime || [b.pickupDate, b.timeSlot].filter(Boolean).join(' '), { field: 'Pickup time', max: 80 }) || 'Scheduled pickup window',
    deliveryPin: newPin(),
    status: 'placed',
    statusStep: 1,
    totalSteps: ORDER_STEPS.length,
    estimatedDelivery: '24 hours from pickup',
    driver: null,
    items: [{ name: `${q.serviceName} (${describeLoad(q)})`, price: q.subtotal }],
    subtotal: q.beforeVat,
    tax: q.vat,
    deliveryFee: q.deliveryFee,
    discount: q.discount,
    promoCode: q.promoCode,
    total: q.total,
    paymentMethod,
    // No payment gateway is integrated yet. TODO for owner: integrate
    // PayFast/Ozow/Yoco/Peach and only mark paid from a verified webhook.
    paymentStatus: 'unpaid',
    createdAt: new Date().toISOString(),
    history: [{ status: 'Order Confirmed', time: timeLabel(), description: `Order ${orderId} placed. Priced on the partner laundromat tariff.` }]
  };

  if (!user.address) user.address = pickupAddress;
  if (!Array.isArray(user.savedAddresses)) user.savedAddresses = [];
  if (user.savedAddresses.length < 20 && !user.savedAddresses.some((a) => String(a.address).toLowerCase() === pickupAddress.toLowerCase())) {
    user.savedAddresses.push({ id: newId('addr'), label: user.savedAddresses.length === 0 ? 'Home' : `Address ${user.savedAddresses.length + 1}`, address: pickupAddress });
  }

  db.orders.unshift(newOrder);
  saveDB();
  res.status(201).json({ success: true, order: newOrder });
});

// Status changes are an operator action: admin only.
app.post('/api/orders/:id/advance', requireAdmin, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status === 'cancelled' || order.status === 'delivered') throw new HttpError(409, `Order is already ${order.status}`);
  const idx = Math.max(0, ORDER_STEPS.findIndex((s) => s.key === order.status)) + 1;
  const next = ORDER_STEPS[idx];
  order.status = next.key;
  order.statusStep = idx + 1;
  if (req.body && req.body.driver && typeof req.body.driver === 'object') {
    order.driver = {
      name: str(req.body.driver.name, { field: 'Driver name', max: 80 }),
      phone: phone(req.body.driver.phone),
      vehicle: str(req.body.driver.vehicle, { field: 'Vehicle', max: 80 })
    };
  }
  order.history.push({ status: next.label, time: timeLabel(), description: next.desc });
  saveDB();
  res.json({ success: true, order });
});

app.post('/api/orders/:id/cancel', (req, res) => {
  const order = findOwnedOrder(req);
  if (['picked_up', 'washing', 'inspection', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status)) {
    throw new HttpError(409, 'This order can no longer be cancelled online. Please contact support.');
  }
  order.status = 'cancelled';
  order.history.push({ status: 'Cancelled', time: timeLabel(), description: 'Order cancelled by customer.' });
  saveDB();
  res.json({ success: true, order });
});

/* =========================================================================
   PARTNERS & BUSINESS
   ========================================================================= */
app.post('/api/partners/driver', formLimiter, (req, res) => {
  const b = req.body || {};
  const appItem = {
    id: newId('drv_app'),
    name: str(b.name, { field: 'Name', max: 100, required: true }),
    email: email(b.email),
    phone: phone(b.phone, true),
    city: str(b.city, { field: 'City', max: 100 }),
    vehicleType: str(b.vehicleType, { field: 'Vehicle type', max: 60 }),
    experience: str(b.experience, { field: 'Experience', max: 100 }),
    ...requireConsent(b),
    status: 'Under Review',
    submittedAt: new Date().toISOString()
  };
  db.driverApplications.push(appItem);
  saveDB();
  res.status(201).json({ success: true, message: 'Driver application received! Our onboarding team will contact you.' });
});

const PUBLIC_PARTNER_FIELDS = ['id', 'businessName', 'address', 'city', 'suburb', 'rating', 'turnaround', 'specialties', 'pricingPolicy', 'services'];
app.get('/api/laundromats', (req, res) => {
  const q = String(req.query.city || req.query.suburb || '').toLowerCase().trim().slice(0, 100);
  let list = db.laundromatPartners.filter((l) => l.status === 'Active');
  if (q) {
    list = list.filter((l) => [l.city, l.suburb, l.address, l.businessName].some((v) => v && v.toLowerCase().includes(q)));
  }
  const laundromats = list.map((l) => Object.fromEntries(PUBLIC_PARTNER_FIELDS.map((k) => [k, l[k]])));
  res.json({ success: true, laundromats, total: laundromats.length });
});

app.post('/api/partners/laundromat', formLimiter, (req, res) => {
  const b = req.body || {};
  const appItem = {
    id: newId('lnd_app'),
    businessName: str(b.businessName, { field: 'Business name', max: 120, required: true }),
    address: str(b.address, { field: 'Address', max: 300 }),
    contactName: str(b.contactName, { field: 'Contact name', max: 100 }),
    email: email(b.email),
    phone: phone(b.phone, true),
    machineCount: str(b.machineCount, { field: 'Machine count', max: 40 }),
    capacity: str(b.capacity, { field: 'Capacity', max: 40 }),
    ...requireConsent(b),
    status: 'In Review',
    submittedAt: new Date().toISOString()
  };
  // Applications are stored separately and never shown publicly until an admin
  // vets them and adds them to laundromatPartners.
  db.laundromatApplications.push(appItem);
  saveDB();
  res.status(201).json({ success: true, message: 'Laundromat partnership request received! Our operations team will be in touch.' });
});

app.post('/api/business/inquiry', formLimiter, (req, res) => {
  const b = req.body || {};
  const inquiry = {
    id: newId('biz'),
    companyName: str(b.companyName, { field: 'Company name', max: 120, required: true }),
    contactName: str(b.contactName, { field: 'Contact name', max: 100 }),
    email: email(b.email),
    phone: phone(b.phone),
    industry: str(b.industry, { field: 'Industry', max: 80 }),
    location: str(b.location, { field: 'Location', max: 120 }),
    estimatedVolume: str(b.estimatedVolume, { field: 'Estimated volume', max: 60 }),
    notes: str(b.notes, { field: 'Notes', max: 2000, multiline: true }),
    ...requireConsent(b),
    status: 'New',
    submittedAt: new Date().toISOString()
  };
  db.businessInquiries.push(inquiry);
  saveDB();
  res.status(201).json({ success: true, message: 'Commercial account inquiry received! Our team will be in touch with custom rates.' });
});

/* =========================================================================
   LOCATIONS & STATS (no other customers' data is ever exposed)
   ========================================================================= */
app.get('/api/locations/popular', (req, res) => {
  const user = getAuthenticatedUser(req);
  const counts = {};
  for (const p of db.laundromatPartners.filter((l) => l.status === 'Active')) {
    if (p.city) counts[p.city] = (counts[p.city] || 0) + 1;
    if (p.suburb) counts[p.suburb] = (counts[p.suburb] || 0) + 1;
  }
  const popularLocations = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([location, partnerCount]) => ({ location, partnerCount, isUserSaved: false }));
  const userAddresses = user && Array.isArray(user.savedAddresses)
    ? user.savedAddresses.map((sa) => ({ location: sa.address, label: sa.label || 'Saved Address', isUserSaved: true }))
    : [];
  res.json({ success: true, userAddresses, popularLocations });
});

app.get('/api/stats/operational', (req, res) => {
  res.json({ success: true, totalOrders: db.orders.length });
});

/* =========================================================================
   ADMIN (requires ADMIN_TOKEN via "X-Admin-Token" or "Authorization: Bearer")
   ========================================================================= */
app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  res.json({
    driverApplications: db.driverApplications,
    laundromatApplications: db.laundromatApplications,
    businessInquiries: db.businessInquiries,
    supportTickets: db.supportTickets.slice(-500)
  });
});
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json({
    totalOrders: db.orders.length,
    activeOrders: db.orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length,
    registeredUsers: db.users.length,
    pendingApplications: db.driverApplications.length + db.laundromatApplications.length
  });
});

/* =========================================================================
   FALLBACKS & ERRORS
   ========================================================================= */
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

app.get('*', (req, res) => {
  if (/\.[a-zA-Z0-9]+$/.test(req.path)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  const p = req.path.replace(/\/+$/, '') || '/';
  const known = SPA_ROUTES.has(p) || p.startsWith('/orders/');
  sendIndex(req, res, known ? 200 : 404);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  console.error(`[error] ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

/* =========================================================================
   START & GRACEFUL SHUTDOWN
   ========================================================================= */
const server = app.listen(PORT, HOST, () => {
  console.log(`M&M server listening on http://${HOST}:${PORT} (env: ${IS_PROD ? 'production' : 'development'})`);
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: closing server...`);
  const force = setTimeout(() => { console.error('Forced shutdown after timeout'); process.exit(1); }, 10_000);
  force.unref();
  server.close(async () => {
    await saveDB();
    await writeChain;
    console.log('Shutdown complete.');
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason); });
