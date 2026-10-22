// Marketing pages: live "from" prices, the partner list and the public forms.
// Light on purpose: no Firebase/Supabase SDK. The SDK (needed for App Check on form submits)
// is only fetched when someone starts filling in a form.
import { $, $$, html, render, money, busy, validate, setStatus } from './ui.js';
import { getPricing, listLaundromatsPublic, publicConfigured } from './public-api.js';
import { renderAppCtas } from './site.js';

// ---------- "from" prices ----------
// Each laundromat sets its own prices; marketing pages show the lowest published price across
// partner laundromats. Anything not published stays hidden (no made-up fallback numbers).
function priceValue(p, key) {
  const [group, sub] = key.split('.');
  if (!sub) return p[group];
  return group === 'basket' ? p.basket_pricing[sub] : group === 'item' ? p.item_pricing[sub] : null;
}

export function fillPrices(p) {
  for (const el of $$('[data-price]')) {
    const v = Number(priceValue(p, el.dataset.price));
    // Only published, positive amounts are shown (the copy around a delivery fee of 0 would not read well).
    const ok = Number.isFinite(v) && v > 0;
    el.textContent = ok ? money(v) : '';
    el.dataset.priceOk = ok ? '1' : '';
  }
  // Show a phrase only when every price inside it is known. Innermost first.
  const groups = $$('[data-needs-price]').reverse();
  for (const g of groups) {
    const prices = $$('[data-price]', g);
    const nested = $$('[data-needs-price]', g);
    const ok = nested.length ? nested.some((n) => !n.hidden) : prices.length > 0 && prices.every((x) => x.dataset.priceOk === '1');
    g.hidden = !ok;
  }
  for (const list of $$('[data-price-list]')) {
    const any = $$('.price-row[data-needs-price]', list).some((r) => !r.hidden);
    const pending = $('[data-price-pending]', list);
    if (pending) {
      pending.hidden = any;
      pending.textContent = p.unavailable ? 'Prices could not be loaded. Refresh the page to try again.' : 'Our partner laundromats have not published prices for these yet. You see exact prices when you book.';
    }
  }
}

let pricesLoaded = false;
export function loadPrices() {
  if (pricesLoaded || !publicConfigured) {
    if (!publicConfigured) fillPrices({ basket_pricing: {}, item_pricing: {}, unavailable: true });
    return;
  }
  pricesLoaded = true;
  getPricing().then((p) => { if (p.unavailable) pricesLoaded = false; fillPrices(p); });
}

// ---------- partners ----------
let partnersLoaded = false;
export async function showPartners() {
  if (partnersLoaded) return;
  const list = $('#laundromatList');
  if (!list) return;
  if (!publicConfigured) {
    list.removeAttribute('aria-busy');
    render(list, html`<div class="notice notice-warning">Our partner list is not available right now. Please try again later.</div>`);
    return;
  }
  try {
    const [rows, from] = await Promise.all([listLaundromatsPublic(), getPricing()]);
    partnersLoaded = true;
    list.removeAttribute('aria-busy');
    $('#laundromatCount').textContent = rows.length ? `${rows.length} laundromat${rows.length === 1 ? '' : 's'}` : '';
    if (!rows.length) { render(list, html`<div class="empty"><p class="t-secondary">No partner laundromats are listed yet. Check back soon, or <a class="text-link" href="#become-partner">list your laundromat</a>.</p></div>`); return; }
    render(list, html`${rows.map((l) => html`
      <article class="card stack-2">
        <h3 class="t-h4">${l.name}</h3>
        ${l.address ? html`<p class="t-small t-secondary">${l.address}</p>` : ''}
        ${from?.laundromat_from?.[l.id] ? html`<p class="t-small">Baskets from <span class="t-medium">${money(from.laundromat_from[l.id])}</span></p>` : ''}
        ${Number(l.rating) > 0 && Number(l.reviews_count) > 0 ? html`<p class="t-small">${Number(l.rating).toFixed(1)} out of 5 <span class="t-secondary">· ${l.reviews_count} review${Number(l.reviews_count) === 1 ? '' : 's'}</span></p>` : ''}
        ${l.description ? html`<p class="t-small t-secondary">${String(l.description).slice(0, 180)}</p>` : ''}
        <a class="btn btn-secondary btn-sm mt-3" href="/book" data-link data-laundromat="${l.id}">Book with this laundromat</a>
      </article>`)}`);
  } catch (err) {
    console.warn('laundromats', err?.message);
    list.removeAttribute('aria-busy');
    render(list, html`<div class="notice notice-negative">We could not load our partner list. Please refresh the page.</div>`);
  }
}

// ---------- public forms -> submit-form edge function ----------
const FORM_FIELDS = {
  contact: ['name', 'email', 'phone', 'topic', 'order_number', 'message'],
  business_inquiry: ['company_name', 'contact_name', 'email', 'phone', 'industry', 'weekly_volume', 'notes'],
  driver_application: ['full_name', 'email', 'phone', 'city', 'vehicle_type'],
  laundromat_application: ['business_name', 'contact_name', 'email', 'phone', 'address', 'machines'],
};
const SUCCESS = {
  contact: 'Thanks, your message has been sent. We will reply by email.',
  business_inquiry: 'Thanks. Our business team will contact you about a quote.',
  driver_application: 'Thanks for applying. Your next step is verification in the M&M app.',
  laundromat_application: 'Thanks for applying. Your next step is verification in the M&M app.',
};

// The backend module brings Firebase App Check, which submit-form verifies.
const backend = () => import('./backend.js');

function bindForms() {
  for (const form of $$('form[data-form]')) {
    form.addEventListener('focusin', () => { backend().catch(() => {}); }, { once: true });
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
        const { callFunction } = await backend();
        await callFunction('submit-form', { body });
        form.reset();
        setStatus(form, SUCCESS[kind], 'ok');
        const next = $('[data-after-submit]', form);
        if (next) { next.hidden = false; renderAppCtas(next); next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      } catch (err) {
        setStatus(form, err.status === 429 ? 'Too many submissions. Please try again later.' : err.message || 'We could not send this. Please try again.', 'error');
      } finally { restore(); }
    });
  }
}

export function initMarketing({ registerPage }) {
  bindForms();
  registerPage('/partners', () => showPartners());
  // "Book with this laundromat" pre-selects it in the booking draft.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-laundromat]');
    if (!a) return;
    try {
      const d = JSON.parse(sessionStorage.getItem('mm.booking.v1') || '{}');
      sessionStorage.setItem('mm.booking.v1', JSON.stringify({ ...d, laundromat_id: a.dataset.laundromat }));
    } catch { /* storage unavailable */ }
  }, true);
  loadPrices();
}
