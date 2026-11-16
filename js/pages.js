// Account pages (sign-in, booking, orders, tracking, account). Loaded lazily by main.js only when
// a page needs them or the visitor is signed in, so marketing pages never download the SDKs.
import { $, $$, toast, busy, validate, setStatus } from './ui.js';
import {
  onSession, signIn, signUp, googleSignIn, resetPassword, signOut, isConfigured, startPhoneSignIn, confirmPhoneCode,
} from './backend.js';
import { normaliseSAPhone, normaliseProfilePhone, formatSAPhone } from './phone.js';
import { showBooking } from './booking.js';
import { showOrders, showTracking, showAccount } from './account.js';

let ctx;

// ---------- auth pages ----------
// The router may already have moved off the auth page when Firebase reported the new user,
// so remember where to go before signing in and only navigate if we are still on an auth page.
function afterAuth(next) {
  if (['/login', '/signup'].includes(location.pathname)) ctx.navigate(next || '/orders', { replace: true });
}

function bindAuth() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!validate(form)) return;
    const f = new FormData(form);
    const restore = busy(form.querySelector('[type=submit]'), 'Logging in');
    const next = ctx.safeNext();
    setStatus(form, '');
    try { await signIn(String(f.get('email')).trim(), String(f.get('password'))); form.reset(); afterAuth(next); } catch (err) { setStatus(form, err.message, 'error'); } finally { restore(); }
  });
  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!validate(form)) return;
    const f = new FormData(form);
    const restore = busy(form.querySelector('[type=submit]'), 'Creating account');
    const next = ctx.safeNext();
    setStatus(form, '');
    const phone = normaliseProfilePhone(f.get('phone'));
    if (!phone) { restore(); setStatus(form, 'Enter a valid mobile number, for example 082 555 0175.', 'error'); $('#suPhone').focus(); return; }
    try {
      await signUp({ full_name: String(f.get('full_name')).trim(), email: String(f.get('email')).trim(), phone, password: String(f.get('password')) });
      form.reset();
      toast('Account created. Check your email to verify your address.', 'positive');
      afterAuth(next);
    } catch (err) { setStatus(form, err.message, 'error'); } finally { restore(); }
  });
  bindPhoneLogin();
  $('#resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!validate(form)) return;
    const restore = busy(form.querySelector('[type=submit]'), 'Sending');
    try { await resetPassword(String(new FormData(form).get('email')).trim()); setStatus(form, 'If an account exists for that email, a reset link is on its way.', 'ok'); } catch (err) { setStatus(form, err.message, 'error'); } finally { restore(); }
  });
  document.addEventListener('click', async (e) => {
    const g = e.target.closest('[data-action="google-sign-in"]');
    if (g) {
      const consentForm = g.dataset.requiresConsent && document.getElementById(g.dataset.requiresConsent);
      const consent = consentForm?.querySelector('[name="consent"]');
      if (consent && !consent.checked) { consent.focus(); setStatus(consentForm, 'Please accept the terms and privacy policy first.', 'error'); return; }
      const restore = busy(g, 'Connecting to Google');
      const next = ctx.safeNext();
      try { const u = await googleSignIn(); if (u) afterAuth(next); } catch (err) { toast(err.message, 'negative'); } finally { restore(); }
      return;
    }
    const so = e.target.closest('[data-action="sign-out"]');
    if (so) {
      await signOut().catch(() => {});
      toast('Signed out');
      ctx.navigate('/');
    }
  });
}

// ---------- phone (SMS code) sign-in ----------
function bindPhoneLogin() {
  const form = $('#phoneForm');
  const tabs = $$('[data-login-tab]');
  const select = (which) => {
    for (const t of tabs) {
      const on = t.dataset.loginTab === which;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    form.hidden = which !== 'phone';
    $('#loginForm').hidden = which === 'phone';
  };
  for (const t of tabs) {
    t.addEventListener('click', () => select(t.dataset.loginTab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(tabs.indexOf(t) + 1) % tabs.length];
      select(next.dataset.loginTab); next.focus();
    });
  }
  const numberStep = $('[data-phone-step="number"]', form);
  const codeStep = $('[data-phone-step="code"]', form);
  const submit = $('[data-phone-submit]', form);
  const restart = $('[data-action="phone-restart"]', form);
  const reset = () => {
    numberStep.hidden = false; codeStep.hidden = true; restart.hidden = true;
    $('#liPhone').required = true; $('#liCode').required = false; $('#liCode').value = '';
    submit.textContent = 'Send code';
    setStatus(form, '');
  };
  restart.addEventListener('click', () => { reset(); $('#liPhone').focus(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate(form)) return;
    setStatus(form, '');
    const next = ctx.safeNext();
    if (codeStep.hidden) {
      const e164 = normaliseSAPhone($('#liPhone').value);
      if (!e164) { setStatus(form, 'Enter a valid South African mobile number, for example 082 555 0175.', 'error'); $('#liPhone').focus(); return; }
      const restore = busy(submit, 'Sending code');
      try {
        await startPhoneSignIn(e164, 'phoneRecaptcha');
        restore();
        numberStep.hidden = true; codeStep.hidden = false; restart.hidden = false;
        $('#liPhone').required = false; $('#liCode').required = true;
        $('[data-phone-sent]', form).textContent = `We sent a code to ${formatSAPhone(e164)}.`;
        submit.textContent = 'Log in';
        $('#liCode').focus();
      } catch (err) { restore(); setStatus(form, err.message, 'error'); }
      return;
    }
    const restore = busy(submit, 'Checking code');
    try { await confirmPhoneCode($('#liCode').value.trim()); restore(); reset(); afterAuth(next); } catch (err) { restore(); setStatus(form, err.message, 'error'); }
  });
}

export function init(context) {
  ctx = context;
  const pageCtx = { navigate: ctx.navigate, getSession: ctx.getSession };
  ctx.registerPage('/book', (a) => showBooking(a, pageCtx));
  ctx.registerPage('/orders', (a) => showOrders(a, pageCtx));
  ctx.registerPage('/orders/:id', (a) => showTracking(a, pageCtx));
  ctx.registerPage('/account', (a) => showAccount(a, pageCtx));
  bindAuth();
  onSession(ctx.onSession);
  if (!isConfigured) ctx.onSession({ user: null, profile: null, ready: true });
  ctx.route();
}
