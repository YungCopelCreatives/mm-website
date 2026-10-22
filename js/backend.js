// Shared backend with the M&M mobile app:
//   Firebase Auth (email/password, Google)  ->  Firebase ID token
//   Supabase Postgres under RLS (the ID token is accepted as a third-party JWT)
//   Supabase edge functions (Authorization: Bearer <ID token>, X-Firebase-AppCheck)
// Public configuration comes from /config.js, which the web server renders from env.
import {
  initializeApp, getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, sendEmailVerification, sendPasswordResetEmail,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut as fbSignOut,
  RecaptchaVerifier, signInWithPhoneNumber,
  initializeAppCheck, ReCaptchaEnterpriseProvider, getToken as getAppCheckTokenRaw,
} from '/vendor/firebase.js';
import { createClient } from '/vendor/supabase.js';
import { phoneAuthErrorMessage } from './phone.js';

const cfg = window.__MM_CONFIG__ || {};
const fb = cfg.firebase || {};

export const config = cfg;
export const isConfigured = Boolean(fb.apiKey && fb.projectId && cfg.supabaseUrl && cfg.supabaseAnonKey);
if (!isConfigured) console.warn('M&M: Firebase/Supabase public config is missing; sign-in and bookings are disabled.');

const app = initializeApp({
  apiKey: fb.apiKey || 'missing',
  authDomain: fb.authDomain || undefined,
  projectId: fb.projectId || 'missing',
  storageBucket: fb.storageBucket || undefined,
  messagingSenderId: fb.messagingSenderId || undefined,
  appId: fb.appId || undefined,
});
export const auth = getAuth(app);

// ---- App Check (reCAPTCHA Enterprise on the web) ----
let appCheck = null;
if (isConfigured && cfg.recaptchaEnterpriseSiteKey) {
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(cfg.recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('App Check could not start', err?.message);
  }
} else if (isConfigured) {
  console.warn('App Check is off: RECAPTCHA_ENTERPRISE_SITE_KEY is not set.');
}

export async function appCheckToken() {
  if (!appCheck) return null;
  try { return (await getAppCheckTokenRaw(appCheck, false)).token || null; } catch { return null; }
}

export async function idToken(force = false) {
  const u = auth.currentUser;
  return u ? u.getIdToken(force) : null;
}

// ---- Supabase (RLS as the Firebase user) ----
export const sb = createClient(cfg.supabaseUrl || 'http://localhost:54321', cfg.supabaseAnonKey || 'missing-anon-key', {
  accessToken: async () => (await idToken()) ?? null,
  global: {
    fetch: async (url, init = {}) => {
      // Edge functions behind supabase-js also get the App Check token.
      if (String(url).includes('/functions/v1/')) {
        const headers = new Headers(init.headers);
        const t = await appCheckToken();
        if (t) headers.set('X-Firebase-AppCheck', t);
        init = { ...init, headers };
      }
      return fetch(url, init);
    },
  },
});

export class ApiError extends Error {
  constructor(message, status = 0, body = null) { super(message); this.status = status; this.body = body; }
}

/** Calls a Supabase edge function. `auth: true` requires a signed-in user. */
export async function callFunction(name, { method = 'POST', body, auth: needAuth = false } = {}) {
  if (!isConfigured) throw new ApiError('Online booking is not available right now. Please try again later.', 0);
  const headers = { apikey: cfg.supabaseAnonKey };
  const token = await idToken();
  if (needAuth && !token) throw new ApiError('Please sign in to continue.', 401);
  // New-style publishable keys (sb_publishable_…) must only go in `apikey`; legacy anon JWTs may be a Bearer.
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (String(cfg.supabaseAnonKey).startsWith('eyJ')) headers.Authorization = `Bearer ${cfg.supabaseAnonKey}`;
  const ac = await appCheckToken();
  if (ac) headers['X-Firebase-AppCheck'] = ac;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${cfg.supabaseUrl}/functions/v1/${name}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('We could not reach M&M. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

// ---- Auth ----
const listeners = new Set();
let current = { user: null, profile: null, ready: false };
export const session = () => current;
export function onSession(cb) { listeners.add(cb); if (current.ready) cb(current); return () => listeners.delete(cb); }
function emit() { for (const cb of listeners) { try { cb(current); } catch (e) { console.error(e); } } }

/**
 * Makes sure the shared `profiles` row exists, with the same fields the app writes:
 *  - website sign-up form  = the app's SignUp screen (customer, onboarding completed)
 *  - first Google or phone sign-in = the app's AuthContext (customer, onboarding pending, so the
 *    app asks the remaining questions the first time they open it)
 * Phone numbers are E.164 (+27...), like the app's phone sign-in. `is_verified` and `kyc_status`
 * are set by database triggers (email_verified / phone_number claims), never by the client.
 */
export async function ensureProfile(user, extra = {}) {
  const { data, error } = await sb.from('profiles')
    .select('id, full_name, email, phone, user_type, is_verified').eq('id', user.uid).maybeSingle();
  if (error) throw error;
  if (data) {
    // Firebase says the email is verified but the profile does not know yet: let RLS/guard accept it.
    if (user.emailVerified && !data.is_verified) {
      await user.getIdToken(true);
      const { error: upErr } = await sb.from('profiles').update({ is_verified: true }).eq('id', user.uid);
      if (!upErr) data.is_verified = true;
    }
    return data;
  }
  const row = {
    id: user.uid,
    full_name: (extra.full_name || user.displayName || user.email?.split('@')[0] || 'Member').slice(0, 100),
    email: user.email || null,
    phone: user.phoneNumber || extra.phone || null,
    user_type: 'customer',
    onboarding_status: extra.fromSignupForm ? 'completed' : 'pending',
    avatar_url: user.photoURL || null,
  };
  const { data: created, error: insErr } = await sb.from('profiles').insert(row)
    .select('id, full_name, email, phone, user_type, is_verified').single();
  if (insErr) throw insErr;
  return created;
}

let pendingProfileExtra = null;
onAuthStateChanged(auth, async (user) => {
  let profile = null;
  if (user && isConfigured) {
    try { profile = await ensureProfile(user, pendingProfileExtra || {}); } catch (err) { console.warn('Profile could not be loaded', err?.message); }
    pendingProfileExtra = null;
  }
  current = { user, profile, ready: true };
  // Hint for main.js: load the account UI early on the next visit (the SDK is otherwise lazy).
  try { if (user) localStorage.setItem('mm.auth', '1'); else localStorage.removeItem('mm.auth'); } catch { /* storage unavailable */ }
  emit();
});
getRedirectResult(auth).catch(() => { /* no redirect pending */ });

function friendlyAuthError(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-credential': 'That email and password do not match.',
    'auth/wrong-password': 'That email and password do not match.',
    'auth/user-not-found': 'That email and password do not match.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/email-already-in-use': 'An account with this email already exists. Log in instead.',
    'auth/weak-password': 'Choose a password of at least 8 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'We could not reach the sign-in service. Check your connection.',
    'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Sign-in is not available right now.',
  };
  return new Error(map[code] || 'Sign-in failed. Please try again.');
}
function guard() { if (!isConfigured) throw new Error('Sign-in is not available right now. Please try again later.'); }

export async function signIn(email, password) {
  guard();
  try { return (await signInWithEmailAndPassword(auth, email, password)).user; } catch (e) { throw friendlyAuthError(e); }
}
export async function signUp({ full_name, email, phone, password }) {
  guard();
  pendingProfileExtra = { full_name, phone, fromSignupForm: true };
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(user, { displayName: full_name }).catch(() => {});
    await sendEmailVerification(user, { url: `${location.origin}/account` }).catch(() => {});
    return user;
  } catch (e) { pendingProfileExtra = null; throw friendlyAuthError(e); }
}
export async function googleSignIn() {
  guard();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { return (await signInWithPopup(auth, provider)).user; } catch (e) {
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw friendlyAuthError(e);
  }
}
export async function resetPassword(email) {
  guard();
  try { await sendPasswordResetEmail(auth, email, { url: `${location.origin}/login` }); } catch (e) {
    if (e?.code === 'auth/user-not-found') return; // never reveal whether an account exists
    throw friendlyAuthError(e);
  }
}
export async function resendVerification() {
  guard();
  if (!auth.currentUser) throw new Error('Please sign in first.');
  await sendEmailVerification(auth.currentUser, { url: `${location.origin}/account` });
}
/** Re-reads the Firebase user (after they click the verification link) and syncs the profile. */
export async function refreshVerification() {
  const u = auth.currentUser;
  if (!u) return current;
  await u.reload();
  await u.getIdToken(true);
  current = { ...current, user: auth.currentUser, profile: await ensureProfile(auth.currentUser).catch(() => current.profile) };
  emit();
  return current;
}
export async function signOut() { await fbSignOut(auth); }

// ---- Phone (SMS code) sign-in, same Firebase accounts as the app's phone sign-in ----
let recaptcha = null;
let confirmation = null;
/** Sends the SMS code to an E.164 number. `containerId` hosts the invisible reCAPTCHA. */
export async function startPhoneSignIn(e164, containerId) {
  guard();
  try {
    if (!recaptcha) recaptcha = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
    confirmation = await signInWithPhoneNumber(auth, e164, recaptcha);
  } catch (e) {
    try { recaptcha?.clear(); } catch { /* ignore */ }
    recaptcha = null;
    throw new Error(phoneAuthErrorMessage(e));
  }
}
/** Confirms the 6-digit SMS code and signs in (the profile row is created on first sign-in). */
export async function confirmPhoneCode(code) {
  guard();
  if (!confirmation) throw new Error('Request a new code first.');
  try { return (await confirmation.confirm(code)).user; } catch (e) { throw new Error(phoneAuthErrorMessage(e)); }
}
