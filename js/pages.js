// Backend-powered pages. Loaded lazily by main.js so the marketing pages never wait for it.
import { $, $$, html, render, money, toast, busy, validate, setStatus } from './ui.js';
import { onSession, signIn, signUp, googleSignIn, resetPassword, signOut, callFunction, isConfigured } from './backend.js';
import { fetchPricing, listLaundromats } from './orders-api.js';
import { showBooking } from './booking.js';
import { showOrders, showTracking, showAccount } from './account.js';

let ctx;

function fillPrices(p) {
  for (const el of $$('[data-price]')) {
    const [group, key] = el.dataset.price.split('.');
    const v = key ? (group === 'basket' ? p.basket_pricing[key] : p.item_pricing[key]) : p[group];
    if (Number.isFinite(Number(v))) el.textContent = money(v);
  }
}

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
    try {
      await signUp({ full_name: String(f.get('full_name')).trim(), email: String(f.get('email')).trim(), phone: String(f.get('phone')).trim(), password: String(f.get('password')) });
      form.reset();
      toast('Account created. Check your email to verify your address.', 'positive');
      afterAuth(next);
    } catch (err) { setStatus(form, err.message, 'error'); } finally { restore(); }
  });
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

// ---------- public forms -> submit-form edge function ----------
const FORM_FIELDS = {
  contact: ['name', 'email', 'phone', 'topic', 'order_number', 'message'],
  business_inquiry: ['company_name', 'contact_name', 'email', 'phone', 'industry', 'weekly_volume', 'notes'],
  driver_application: ['full_name', 'email', 'phone', 'city', 'vehicle_type'],
  laundromat_application: ['business_name', 'contact_name', 'email', 'phone', 'address', 'machines'],
};
const SUCCESS = {
  contact: 'Thanks, your message has been sent. We usually reply within a few hours.',
  business_inquiry: 'Thanks. Our business team will contact you within one working day.',
  driver_application: 'Thanks for applying. We will contact you about the next steps.',
  laundromat_application: 'Thanks. Our partner team will contact you about the next steps.',
};

function bindForms() {
  for (const form of $$('form[data-form]')) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate(form)) return;
      const kind = form.dataset.form;
      const f = new FormData(form);
      const fields = {};
      for (const k of FORM_FIELDS[kind]) { const v = String(f.get(k) ?? '').trim(); if (v) fields[k] = v; }
      const body = { form: kind, fields, consent: f.get('consent') === 'on', website: String(f.get('website') || ''), page: location.pathname };
      const restore = busy(form.querySelector('[type=submit]'), 'Sending');
      setStatus(form, '');
      try {
        await callFunction('submit-form', { body });
        form.reset();
        setStatus(form, SUCCESS[kind], 'ok');
      } catch (err) {
        setStatus(form, err.status === 429 ? 'Too many submissions. Please try again later.' : err.message || 'We could not send this. Please try again.', 'error');
      } finally { restore(); }
    });
  }
}

// ---------- partners ----------
let partnersLoaded = false;
async function showPartners() {
  if (partnersLoaded) return;
  const list = $('#laundromatList');
  try {
    const rows = await listLaundromats();
    partnersLoaded = true;
    list.removeAttribute('aria-busy');
    $('#laundromatCount').textContent = rows.length ? `${rows.length} laundromat${rows.length === 1 ? '' : 's'}` : '';
    if (!rows.length) { render(list, html`<div class="empty"><p class="t-secondary">Our partner list is being updated. Check back soon.</p></div>`); return; }
    render(list, html`${rows.map((l) => html`
      <article class="card stack-2">
        <h3 class="t-h4">${l.name}</h3>
        ${l.address ? html`<p class="t-small t-secondary">${l.address}</p>` : ''}
        ${Number(l.rating) > 0 ? html`<p class="t-small">${Number(l.rating).toFixed(1)} out of 5${l.reviews_count ? html` <span class="t-secondary">· ${l.reviews_count} reviews</span>` : ''}</p>` : ''}
        ${l.description ? html`<p class="t-small t-secondary">${String(l.description).slice(0, 180)}</p>` : ''}
        <a class="btn btn-secondary btn-sm mt-3" href="/book" data-link data-laundromat="${l.id}">Book with this laundromat</a>
      </article>`)}`);
  } catch (err) {
    console.warn('laundromats', err?.message);
    list.removeAttribute('aria-busy');
    render(list, html`<div class="notice notice-negative">We could not load our partner list. Please refresh the page.</div>`);
  }
}

export function init(context) {
  ctx = context;
  const pageCtx = { navigate: ctx.navigate, getSession: ctx.getSession };
  ctx.registerPage('/book', (a) => showBooking(a, pageCtx));
  ctx.registerPage('/orders', (a) => showOrders(a, pageCtx));
  ctx.registerPage('/orders/:id', (a) => showTracking(a, pageCtx));
  ctx.registerPage('/account', (a) => showAccount(a, pageCtx));
  ctx.registerPage('/partners', () => showPartners());
  bindAuth();
  bindForms();

  // "Book with this laundromat" pre-selects it in the booking draft.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-laundromat]');
    if (!a) return;
    try {
      const d = JSON.parse(sessionStorage.getItem('mm.booking.v1') || '{}');
      sessionStorage.setItem('mm.booking.v1', JSON.stringify({ ...d, laundromat_id: a.dataset.laundromat }));
    } catch { /* storage unavailable */ }
  }, true);

  fetchPricing().then(fillPrices);
  onSession(ctx.onSession);
  if (!isConfigured) ctx.onSession({ user: null, profile: null, ready: true });
  ctx.route();
}
