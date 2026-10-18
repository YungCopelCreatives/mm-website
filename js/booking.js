// Booking wizard: laundry -> pickup -> review & pay (Ozow).
import { $, $$, html, raw, render, money, toast, busy, uuid, store, validate } from './ui.js';
import {
  SERVICES, BASKET_SIZES, TIME_SLOTS, MAX_ITEMS, fetchPricing, DEFAULT_PRICING, estimate, quoteOrder, createOrder,
  returnUrlFor, isSafePaymentUrl, listLaundromats, listAddresses, addAddress,
} from './orders-api.js';
import { isConfigured, resendVerification, refreshVerification } from './backend.js';
import { attachAutocomplete } from './maps.js';

const KEY = 'mm.booking.v1';
const STEPS = ['Your laundry', 'Pickup', 'Review and pay'];
const DETERGENTS = [
  { id: '', label: 'Standard detergent' },
  { id: 'hypoallergenic', label: 'Hypoallergenic, fragrance-free' },
];

let ctx = null;          // { navigate, getSession }
let draft = null;
let pricing = DEFAULT_PRICING;
let laundromats = null;  // null = loading
let addresses = [];
let quote = null;
let quoteKey = '';
let root = null;

function defaults() {
  return {
    step: 0, service: 'wash_fold', basket_size: 'small', item_count: 1,
    address_mode: 'new', address_id: null, address: { address: '', unit: '', lat: null, lng: null },
    laundromat_id: '', pickup_date: '', pickup_slot: '', detergent: '', notes: '', promo_code: '',
    request_id: null, terms: false,
  };
}
const save = () => store.set(KEY, draft);

function days(n = 7) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-ZA', { weekday: 'long' });
    out.push({ id, label: `${label}, ${d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` });
  }
  return out;
}
function slotsFor(dateId) {
  const today = days(1)[0].id;
  if (dateId !== today) return TIME_SLOTS;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  // at least 60 minutes' notice for a same-day slot
  return TIME_SLOTS.filter((s) => { const [h, m] = s.start.split(':').map(Number); return h * 60 + m - nowMin >= 60; });
}

// ---------- render ----------
function progress() {
  return html`<ol class="progress" aria-label="Booking steps">${STEPS.map((s, i) => html`<li class="${i < draft.step ? 'is-done' : i === draft.step ? 'is-current' : ''}" ${raw(i === draft.step ? 'aria-current="step"' : '')}>${i + 1}. ${s}</li>`)}</ol>`;
}

function summary() {
  const est = quote && quoteKey === keyFor() ? quote : estimate(pricing, draft);
  if (!est) return html``;
  const l = laundromats?.find((x) => x.id === draft.laundromat_id);
  return html`
    <div class="card stack-4" aria-live="polite">
      <h2 class="t-h4">Summary</h2>
      <dl class="kv">
        ${(est.lines || []).map((line) => html`<div class="kv-row"><dt>${line.label || line.name || SERVICES[line.service]?.label || 'Item'}</dt><dd>${money(line.amount ?? line.total ?? 0)}</dd></div>`)}
        ${est.discount ? html`<div class="kv-row"><dt>Promo</dt><dd>−${money(est.discount)}</dd></div>` : ''}
        <div class="kv-row"><dt>Delivery</dt><dd>${est.delivery_fee ? money(est.delivery_fee) : 'Free'}</dd></div>
        ${est.service_fee ? html`<div class="kv-row"><dt>Service fee</dt><dd>${money(est.service_fee)}</dd></div>` : ''}
        ${est.protection_fee ? html`<div class="kv-row"><dt>Protection</dt><dd>${money(est.protection_fee)}</dd></div>` : ''}
        <div class="kv-row kv-total"><dt>${est.estimated ? 'Estimated total' : 'Total'}</dt><dd>${money(est.total_amount)}</dd></div>
      </dl>
      <p class="t-caption t-secondary">Includes VAT${est.tax_amount ? html` of ${money(est.tax_amount)}` : ''}. ${est.delivery_fee ? html`Free delivery from ${money(pricing.free_delivery_threshold)}.` : ''}</p>
      ${l ? html`<p class="t-small t-secondary">Laundromat: <span class="t-medium" style="color:var(--text)">${l.name}</span></p>` : ''}
    </div>`;
}

function stepLaundry() {
  const svc = SERVICES[draft.service];
  return html`
    <fieldset class="fieldset">
      <legend class="t-h3">What needs washing?</legend>
      <div class="tiles tiles-2">
        ${Object.entries(SERVICES).map(([id, s]) => html`
          <label class="tile"><input type="radio" name="service" value="${id}" ${raw(draft.service === id ? 'checked' : '')}>
            <span class="tile-body"><span><span class="tile-title">${s.label}</span><br><span class="tile-meta">${s.kind === 'basket' ? 'Priced by basket' : `Priced per ${s.unit}`}</span></span>
            <span class="tile-price">${s.kind === 'basket' ? `from ${money(pricing.basket_pricing.small)}` : money(pricing.item_pricing[id])}</span></span>
          </label>`)}
      </div>
    </fieldset>
    ${svc.kind === 'basket' ? html`
      <fieldset class="fieldset mt-8">
        <legend class="t-h3">Basket size</legend>
        <div class="tiles tiles-2">
          ${Object.entries(BASKET_SIZES).map(([id, b]) => html`
            <label class="tile"><input type="radio" name="basket_size" value="${id}" ${raw(draft.basket_size === id ? 'checked' : '')}>
              <span class="tile-body"><span><span class="tile-title">${b.label}</span><br><span class="tile-meta">${b.hint}</span></span><span class="tile-price">${money(pricing.basket_pricing[id])}</span></span>
            </label>`)}
        </div>
      </fieldset>` : html`
      <div class="mt-8 stack-3">
        <h3 class="t-h3" id="qtyLabel">How many ${svc.unit}s?</h3>
        <div class="row">
          <div class="stepper" role="group" aria-labelledby="qtyLabel">
            <button type="button" data-qty="-1" aria-label="Fewer">−</button>
            <output aria-live="polite" id="qtyOut">${draft.item_count}</output>
            <button type="button" data-qty="1" aria-label="More">+</button>
          </div>
          <span class="t-secondary">${money(pricing.item_pricing[draft.service])} per ${svc.unit}</span>
        </div>
      </div>`}
    <div class="field mt-8" style="max-width:420px">
      <label class="label" for="bkDetergent">Detergent</label>
      <select class="select" id="bkDetergent" name="detergent">${DETERGENTS.map((d) => html`<option value="${d.id}" ${raw(draft.detergent === d.id ? 'selected' : '')}>${d.label}</option>`)}</select>
    </div>`;
}

function stepPickup() {
  const { user } = ctx.getSession();
  const dayList = days();
  if (!draft.pickup_date || !dayList.some((d) => d.id === draft.pickup_date)) draft.pickup_date = dayList[0].id;
  let slots = slotsFor(draft.pickup_date);
  if (!slots.length) { draft.pickup_date = dayList[1].id; slots = slotsFor(draft.pickup_date); }
  if (!slots.some((s) => s.id === draft.pickup_slot)) draft.pickup_slot = slots[0]?.id || '';
  const useSaved = user && addresses.length && draft.address_mode === 'saved';
  return html`
    <div class="stack-6">
      <fieldset class="fieldset">
        <legend class="t-h3">Pickup address</legend>
        ${user && addresses.length ? html`
          <div class="tiles">
            ${addresses.map((a) => html`<label class="tile"><input type="radio" name="address_pick" value="${a.id}" ${raw(useSaved && draft.address_id === a.id ? 'checked' : '')}>
              <span class="tile-body"><span><span class="tile-title">${a.label || 'Saved address'}</span><br><span class="tile-meta break">${a.address}</span></span></span></label>`)}
            <label class="tile"><input type="radio" name="address_pick" value="new" ${raw(!useSaved ? 'checked' : '')}><span class="tile-body"><span class="tile-title">Use a different address</span></span></label>
          </div>` : ''}
        <div ${raw(useSaved ? 'hidden' : '')} class="mt-4" id="newAddress">
          <div class="field"><label class="label" for="bkAddress">Street address</label>
            <input class="input" id="bkAddress" name="address" autocomplete="street-address" maxlength="300" value="${draft.address.address}" ${raw(useSaved ? '' : 'required')} placeholder="Street, suburb and city"></div>
          <div class="field"><label class="label" for="bkUnit">Unit, complex or gate code <span class="t-tertiary">(optional)</span></label>
            <input class="input" id="bkUnit" name="unit" maxlength="120" value="${draft.address.unit}"></div>
        </div>
      </fieldset>
      <div class="field">
        <label class="label" for="bkLaundromat">Partner laundromat</label>
        ${laundromats === null ? html`<div class="skeleton" style="height:48px"></div>` : laundromats.length ? html`
          <select class="select" id="bkLaundromat" name="laundromat_id" required>
            <option value="">Choose a laundromat</option>
            ${laundromats.map((l) => html`<option value="${l.id}" ${raw(draft.laundromat_id === l.id ? 'selected' : '')}>${l.name}${l.address ? ` — ${l.address}` : ''}</option>`)}
          </select>
          <span class="hint">See all <a class="text-link" href="/partners" data-link>partner laundromats</a>.</span>` : html`
          <div class="notice notice-warning">No partner laundromats are available right now. Please try again later.</div>`}
      </div>
      <div class="form-grid form-grid-2">
        <div class="field"><label class="label" for="bkDate">Pickup day</label>
          <select class="select" id="bkDate" name="pickup_date" required>${dayList.map((d) => html`<option value="${d.id}" ${raw(draft.pickup_date === d.id ? 'selected' : '')}>${d.label}</option>`)}</select></div>
        <div class="field"><label class="label" for="bkSlot">Pickup time</label>
          <select class="select" id="bkSlot" name="pickup_slot" required>${slots.map((s) => html`<option value="${s.id}" ${raw(draft.pickup_slot === s.id ? 'selected' : '')}>${s.label}</option>`)}</select></div>
      </div>
      <div class="field"><label class="label" for="bkNotes">Notes for the driver and laundromat <span class="t-tertiary">(optional)</span></label>
        <textarea class="textarea" id="bkNotes" name="notes" maxlength="300" placeholder="For example: intercom 12, wash darks cold">${draft.notes}</textarea></div>
    </div>`;
}

function stepReview() {
  const { user, profile } = ctx.getSession();
  const verified = Boolean(user?.emailVerified || profile?.is_verified);
  const svc = SERVICES[draft.service];
  const addr = draft.address_mode === 'saved' ? addresses.find((a) => a.id === draft.address_id)?.address : draft.address.address;
  const slot = TIME_SLOTS.find((s) => s.id === draft.pickup_slot);
  const day = days().find((d) => d.id === draft.pickup_date);
  return html`
    <div class="stack-6">
      <div class="card stack-3">
        <div class="row-between"><h2 class="t-h4">Your laundry</h2><button type="button" class="btn btn-tertiary btn-sm" data-goto="0">Change</button></div>
        <p class="t-secondary">${svc.label} · ${svc.kind === 'basket' ? BASKET_SIZES[draft.basket_size].label : `${draft.item_count} ${svc.unit}${draft.item_count === 1 ? '' : 's'}`}${draft.detergent ? ' · Hypoallergenic detergent' : ''}</p>
      </div>
      <div class="card stack-3">
        <div class="row-between"><h2 class="t-h4">Pickup</h2><button type="button" class="btn btn-tertiary btn-sm" data-goto="1">Change</button></div>
        <p class="t-secondary break">${addr || ''}${draft.address_mode === 'new' && draft.address.unit ? ` (${draft.address.unit})` : ''}</p>
        <p class="t-secondary">${day?.label || draft.pickup_date}, ${slot?.label || ''}</p>
      </div>
      <div class="field" style="max-width:360px"><label class="label" for="bkPromo">Promo code <span class="t-tertiary">(optional)</span></label>
        <div class="row"><input class="input" id="bkPromo" name="promo_code" maxlength="32" value="${draft.promo_code}" autocomplete="off" style="flex:1;min-width:0"><button type="button" class="btn btn-secondary" data-action="apply-promo">Apply</button></div></div>
      ${!isConfigured ? html`<div class="notice notice-warning">Online payment is not available right now. Please try again later or <a class="text-link" href="/contact" data-link>contact us</a>.</div>` : ''}
      ${isConfigured && !user ? html`
        <div class="card card-subtle stack-3">
          <h2 class="t-h4">Log in to pay</h2>
          <p class="t-small t-secondary">Your booking is saved. Use the same account as the M&amp;M app.</p>
          <div class="row"><a class="btn btn-primary" href="/login?next=/book" data-link>Log in</a><a class="btn btn-secondary" href="/signup?next=/book" data-link>Create account</a></div>
        </div>` : ''}
      ${isConfigured && user && !verified ? html`
        <div class="notice notice-warning"><div class="stack-2">
          <p>Please verify your email address before paying. We sent a link to <strong>${user.email}</strong>.</p>
          <div class="row"><button type="button" class="btn btn-secondary btn-sm" data-action="resend-verification">Resend email</button><button type="button" class="btn btn-tertiary btn-sm" data-action="check-verification">I have verified</button></div>
        </div></div>` : ''}
      ${isConfigured && user ? html`
        <label class="check"><input type="checkbox" name="terms" required ${raw(draft.terms ? 'checked' : '')}> <span>I agree to the <a class="text-link" href="/terms" data-link>terms of service</a> and the <a class="text-link" href="/privacy" data-link>privacy policy</a>, and I understand that my details are shared with the laundromat and driver for this order.</span></label>
        <p class="t-small t-secondary">You will be sent to Ozow to pay by instant EFT. If payment is not completed within an hour, the booking is cancelled and nothing is charged.</p>` : ''}
      <p class="form-status" role="status" aria-live="polite"></p>
    </div>`;
}

function draw() {
  if (!root) return;
  const body = [stepLaundry, stepPickup, stepReview][draft.step]();
  const { user, profile } = ctx.getSession();
  const canPay = isConfigured && user && (user.emailVerified || profile?.is_verified);
  render(root, html`
    <div class="wizard">
      <form id="bookForm" novalidate>
        ${progress()}
        <div class="mt-8">${body}</div>
        <div class="wizard-actions">
          ${draft.step > 0 ? html`<button type="button" class="btn btn-secondary" data-action="back">Back</button>` : html`<span></span>`}
          ${draft.step < 2 ? html`<button type="submit" class="btn btn-primary">Continue</button>`
            : html`<button type="submit" class="btn btn-primary" ${raw(canPay ? '' : 'disabled')}>Pay with Ozow</button>`}
        </div>
      </form>
      <aside class="wizard-aside" id="bookSummary">${summary()}</aside>
    </div>`);
  const addr = $('#bkAddress', root);
  if (addr) attachAutocomplete(addr, ({ address, lat, lng }) => { draft.address = { ...draft.address, address, lat, lng }; addr.value = address; save(); });
}

function redrawSummary() { const el = $('#bookSummary', root); if (el) render(el, summary()); }

const keyFor = () => JSON.stringify([draft.service, draft.basket_size, draft.item_count, draft.laundromat_id, draft.promo_code]);

async function refreshQuote() {
  const { user } = ctx.getSession();
  if (!isConfigured || !user || draft.step !== 2 || !draft.laundromat_id) return;
  const k = keyFor();
  try {
    const q = await quoteOrder(draft, { addressId: draft.address_mode === 'saved' ? draft.address_id : null, requestId: draft.request_id || uuid() });
    if (q && k === keyFor()) {
      quote = { ...q, lines: (q.lines || []).map((l) => ({ label: l.label || l.name || `${SERVICES[l.service]?.label || 'Item'}${l.basket_size ? ` · ${BASKET_SIZES[l.basket_size]?.label || l.basket_size}` : l.quantity ? ` · ${l.quantity}` : ''}`, amount: l.amount ?? l.total ?? l.line_total ?? 0 })) };
      quoteKey = k;
      redrawSummary();
    }
  } catch (err) {
    quote = null;
    if (draft.promo_code && /promo/i.test(err.message)) toast(err.message, 'negative');
  }
}

// ---------- events ----------
function readStep(form) {
  const f = new FormData(form);
  if (draft.step === 0) {
    draft.detergent = f.get('detergent') || '';
  } else if (draft.step === 1) {
    const pick = f.get('address_pick');
    if (pick && pick !== 'new') { draft.address_mode = 'saved'; draft.address_id = pick; }
    else {
      const typed = String(f.get('address') || '').trim();
      if (typed !== draft.address.address) draft.address = { ...draft.address, address: typed, lat: null, lng: null };
      draft.address.unit = String(f.get('unit') || '').trim();
      draft.address_mode = 'new';
      if (draft.address_id && !addresses.some((a) => a.id === draft.address_id)) draft.address_id = null;
    }
    draft.laundromat_id = f.get('laundromat_id') || '';
    draft.pickup_date = f.get('pickup_date') || draft.pickup_date;
    draft.pickup_slot = f.get('pickup_slot') || draft.pickup_slot;
    draft.notes = String(f.get('notes') || '').trim();
  } else {
    draft.promo_code = String(f.get('promo_code') || '').trim();
    draft.terms = f.get('terms') === 'on';
  }
  save();
}

function go(step) {
  draft.step = Math.max(0, Math.min(2, step));
  save();
  draw();
  $('.progress', root)?.scrollIntoView({ block: 'nearest' });
  if (draft.step === 2) refreshQuote();
}

async function pay(form, button) {
  const { user } = ctx.getSession();
  if (!user) return;
  if (!validate(form)) return;
  const restore = busy(button, 'Preparing payment');
  const status = $('.form-status', form);
  status.textContent = '';
  try {
    let addressId = draft.address_mode === 'saved' ? draft.address_id : draft.address_id;
    if (draft.address_mode === 'new' && !addressId) {
      const saved = await addAddress(user.uid, {
        label: 'Pickup', address: [draft.address.address, draft.address.unit].filter(Boolean).join(', '),
        latitude: draft.address.lat, longitude: draft.address.lng,
      });
      addressId = saved.id;
      draft.address_id = saved.id;
      save();
    }
    if (!draft.request_id) { draft.request_id = uuid(); save(); }
    const result = await createOrder(draft, { addressId, requestId: draft.request_id, returnUrl: returnUrlFor(draft.request_id) });
    store.set('mm.lastOrder', { id: result.order_id, at: Date.now() });
    if (result.payment_url && isSafePaymentUrl(result.payment_url)) {
      store.remove(KEY);
      location.assign(result.payment_url);
      return;
    }
    if (result.payment_url) throw new Error('The payment link we received was not valid. Please contact us.');
    store.remove(KEY);
    ctx.navigate(`/orders/${result.order_id}`);
  } catch (err) {
    restore();
    status.style.color = 'var(--negative)';
    status.textContent = err.message || 'Something went wrong. Please try again.';
    // A different order body with the same request_id would be rejected; start fresh after a hard failure.
    if (err.status && err.status >= 400 && err.status < 500 && err.status !== 401) { draft.request_id = null; save(); }
  }
}

function bind() {
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'service') { draft.service = t.value; quote = null; save(); draw(); return; }
    if (t.name === 'basket_size') { draft.basket_size = t.value; quote = null; save(); redrawSummary(); return; }
    if (t.name === 'address_pick') {
      const isNew = t.value === 'new';
      $('#newAddress', root).hidden = !isNew;
      $('#bkAddress', root).required = isNew;
      draft.address_mode = isNew ? 'new' : 'saved';
      if (!isNew) draft.address_id = t.value; else draft.address_id = null;
      save();
      return;
    }
    if (t.name === 'pickup_date') {
      draft.pickup_date = t.value;
      const slots = slotsFor(t.value);
      $('#bkSlot', root).innerHTML = slots.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
      draft.pickup_slot = slots[0]?.id || '';
      save();
      return;
    }
    if (t.name === 'laundromat_id') { draft.laundromat_id = t.value; save(); redrawSummary(); return; }
    if (t.name === 'terms') { draft.terms = t.checked; save(); }
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.qty) {
      draft.item_count = Math.max(1, Math.min(MAX_ITEMS, draft.item_count + Number(b.dataset.qty)));
      $('#qtyOut', root).textContent = String(draft.item_count);
      quote = null; save(); redrawSummary();
    } else if (b.dataset.goto) { readStep($('#bookForm', root)); go(Number(b.dataset.goto)); }
    else if (b.dataset.action === 'back') { readStep($('#bookForm', root)); go(draft.step - 1); }
    else if (b.dataset.action === 'apply-promo') {
      readStep($('#bookForm', root));
      quote = null; redrawSummary();
      if (!ctx.getSession().user) toast('Promo codes are checked when you log in to pay.');
      else { await refreshQuote(); if (quote) toast(quote.discount ? 'Promo code applied' : 'Total updated'); }
    } else if (b.dataset.action === 'resend-verification') {
      const restore = busy(b, 'Sending');
      try { await resendVerification(); toast('Verification email sent'); } catch (err) { toast(err.message, 'negative'); }
      restore();
    } else if (b.dataset.action === 'check-verification') {
      const restore = busy(b, 'Checking');
      const s = await refreshVerification().catch(() => null);
      restore();
      if (s?.user?.emailVerified) { toast('Email verified', 'positive'); draw(); refreshQuote(); } else toast('Your email is not verified yet. Open the link in the email we sent.', 'negative');
    }
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    if (draft.step < 2) {
      if (!validate(form)) return;
      readStep(form);
      if (draft.step === 1 && !draft.laundromat_id) return;
      go(draft.step + 1);
    } else {
      readStep(form);
      pay(form, form.querySelector('button[type="submit"]'));
    }
  });
}

export async function showBooking({ query, session }, context) {
  ctx = context;
  root = document.getElementById('bookApp');
  if (!root.dataset.bound) { bind(); root.dataset.bound = '1'; }
  draft = { ...defaults(), ...(store.get(KEY) || {}) };
  draft.address = { ...defaults().address, ...(draft.address || {}) };
  const qs = query.get('service');
  if (qs && SERVICES[qs]) { draft = { ...draft, service: qs, step: 0 }; history.replaceState({}, '', '/book'); }
  const size = query.get('size');
  if (size && BASKET_SIZES[size]) draft.basket_size = size;
  if (draft.step === 2 && !draft.laundromat_id) draft.step = 1;
  save();
  draw();

  fetchPricing().then((p) => { pricing = p; draw(); });
  if (laundromats === null) {
    listLaundromats().then((l) => { laundromats = l; }).catch((err) => { console.warn('laundromats', err?.message); laundromats = []; }).finally(() => { if (draft.step === 1 || draft.step === 2) draw(); else redrawSummary(); });
  }
  if (session.user) {
    listAddresses(session.user.uid).then((a) => {
      addresses = a;
      if (a.length && !draft.address.address && !draft.address_id) { draft.address_mode = 'saved'; draft.address_id = a[0].id; save(); }
      if (draft.step >= 1) draw();
    }).catch(() => { addresses = []; });
    if (draft.step === 2) refreshQuote();
  } else addresses = [];
}
