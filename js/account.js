// My orders, order tracking and account (profile + saved addresses), all through Supabase RLS.
import { $, html, raw, render, money, formatDate, toast, busy, validate, store } from './ui.js';
import {
  ORDER_STATUSES, listMyOrders, getOrder, getOrderPin, getDriver, cancelOrder, listAddresses, addAddress, deleteAddress, SERVICES, BASKET_SIZES,
} from './orders-api.js';
import { sb, resendVerification, refreshVerification } from './backend.js';
import { attachAutocomplete, showMap, mapsEnabled } from './maps.js';

const STEP_LABELS = {
  'Awaiting Payment': 'Waiting for payment',
  Pending: 'Paid, waiting for the laundromat',
  Accepted: 'Accepted, driver on the way',
  'Picked Up': 'Picked up',
  'In Progress': 'Being washed',
  'Ready for Delivery': 'Ready for delivery',
  'Out for Delivery': 'Out for delivery',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
};
// Timeline wording (past-tense friendly) differs from the badge wording for the first two steps.
const TIMELINE_LABELS = { ...STEP_LABELS, 'Awaiting Payment': 'Booked', Pending: 'Payment received' };
const ACTIVE = new Set(['Awaiting Payment', 'Pending', 'Accepted', 'Picked Up', 'In Progress', 'Ready for Delivery', 'Out for Delivery']);

export function statusBadge(status) {
  const cls = status === 'Delivered' ? 'badge-positive' : status === 'Cancelled' ? 'badge-negative' : status === 'Awaiting Payment' ? 'badge-warning' : 'badge-accent';
  return html`<span class="badge ${cls}">${STEP_LABELS[status] || status}</span>`;
}

function describeItems(items) {
  if (!items || typeof items !== 'object') return '';
  const lines = Array.isArray(items.lines) ? items.lines : Array.isArray(items) ? items : null;
  const one = (l) => {
    const s = SERVICES[l.service]?.label || l.name || l.service || 'Laundry';
    if (l.basket_size || l.size) return `${s} · ${BASKET_SIZES[l.basket_size || l.size]?.label || l.basket_size || l.size}`;
    if (l.quantity || l.qty || l.item_count) return `${s} · ${l.quantity || l.qty || l.item_count}`;
    return s;
  };
  if (lines) return lines.map(one).join(', ');
  if (items.service) return one({ ...items, basket_size: items.basket_size || items.basket?.size });
  if (items.basket?.size) return `Laundry · ${BASKET_SIZES[items.basket.size]?.label || items.basket.size}`;
  return '';
}

// ---------- orders list ----------
export async function showOrders({ session }) {
  const root = document.getElementById('ordersApp');
  if (!session.ready || !session.user) { render(root, html`<div class="skeleton" style="height:120px"></div>`); return; }
  render(root, html`<div class="stack-3"><div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:96px"></div></div>`);
  try {
    const orders = await listMyOrders(session.user.uid);
    if (!orders.length) {
      render(root, html`<div class="empty stack-3"><h2 class="t-h3">No orders yet</h2><p class="t-secondary">When you book a pickup, you can follow it here.</p><a class="btn btn-primary" href="/book" data-link>Book a pickup</a></div>`);
      return;
    }
    const active = orders.filter((o) => ACTIVE.has(o.status));
    const past = orders.filter((o) => !ACTIVE.has(o.status));
    const card = (o) => html`
      <a class="card card-link order-card" href="/orders/${o.id}" data-link>
        <div class="order-card-head"><div class="stack-1"><span class="t-h4">${o.laundromat?.name || 'Laundry order'}</span><span class="t-small t-secondary">#${o.order_number} · ${formatDate(o.created_at)}</span></div><span class="t-medium t-num">${money(o.total_amount)}</span></div>
        <div class="row-between"><span class="t-small t-secondary">${describeItems(o.items)}</span>${statusBadge(o.status)}</div>
      </a>`;
    render(root, html`
      ${active.length ? html`<h2 class="t-h3 mb-4">Active</h2><div class="stack-3">${active.map(card)}</div>` : ''}
      ${past.length ? html`<h2 class="t-h3 mb-4 ${active.length ? 'mt-8' : ''}">Past orders</h2><div class="stack-3">${past.map(card)}</div>` : ''}`);
  } catch (err) {
    console.warn(err);
    render(root, html`<div class="notice notice-negative">We could not load your orders. Check your connection and refresh the page.</div>`);
  }
}

// ---------- tracking ----------
let poll = null;
function stopPoll() { if (poll) { clearTimeout(poll); poll = null; } }

export async function showTracking({ params, query, session }, context) {
  stopPoll();
  const root = document.getElementById('trackApp');
  if (!session.ready || !session.user) { render(root, html`<div class="skeleton" style="height:200px"></div>`); return; }
  const id = params.id;
  const payment = query.get('payment');
  let started = Date.now();
  let paymentWaitShown = payment === 'success';

  async function load(first = false) {
    if (location.pathname !== `/orders/${id}`) { stopPoll(); return; }
    let order;
    try { order = await getOrder(id); } catch (err) {
      console.warn(err);
      if (first) render(root, html`<div class="notice notice-negative">We could not load this order. Check your connection and refresh the page.</div>`);
      poll = setTimeout(load, 15000);
      return;
    }
    if (!order) {
      // Right after Ozow returns, the order exists but our token may be fresh; retry briefly.
      if (Date.now() - started < 10000) { poll = setTimeout(load, 2000); return; }
      render(root, html`<div class="empty stack-3"><h1 class="t-h2">Order not found</h1><p class="t-secondary">This order does not exist or belongs to another account.</p><a class="btn btn-primary" href="/orders" data-link>My orders</a></div>`);
      return;
    }
    const [pin, driver] = await Promise.all([
      ACTIVE.has(order.status) && order.status !== 'Awaiting Payment' ? getOrderPin(order.id).catch(() => null) : null,
      order.driver_id && ACTIVE.has(order.status) ? getDriver(order.driver_id).catch(() => null) : null,
    ]);
    draw(order, pin, driver);
    if (order.status === 'Awaiting Payment' && paymentWaitShown && Date.now() - started > 120000) paymentWaitShown = false;
    if (ACTIVE.has(order.status)) poll = setTimeout(load, order.status === 'Awaiting Payment' && payment === 'success' ? 3000 : 15000);
  }

  function paymentNotice(order) {
    if (order.status === 'Awaiting Payment') {
      if (payment === 'success' && paymentWaitShown) return html`<div class="notice notice-accent"><span class="spinner" aria-hidden="true"></span><p>Thanks. We are confirming your payment with Ozow, this usually takes a few seconds.</p></div>`;
      if (payment === 'cancelled') return html`<div class="notice notice-warning"><p>Payment was cancelled. Nothing was charged. You can book again whenever you are ready; this booking is cancelled automatically after an hour.</p></div>`;
      if (payment === 'error') return html`<div class="notice notice-negative"><p>The payment did not go through. Nothing was charged. Please try booking again.</p></div>`;
      return html`<div class="notice notice-warning"><p>This booking has not been paid yet. Unpaid bookings are cancelled after an hour.</p></div>`;
    }
    if (payment === 'success' && order.status === 'Pending') return html`<div class="notice notice-positive"><p>Payment received. Your pickup is booked.</p></div>`;
    return '';
  }

  function draw(order, pin, driver) {
    const flow = ORDER_STATUSES;
    const idx = flow.indexOf(order.status);
    const cancelled = order.status === 'Cancelled';
    const coords = driver && Number.isFinite(driver.current_lat) && Number.isFinite(driver.current_lng) ? { lat: driver.current_lat, lng: driver.current_lng } : null;
    render(root, html`
      <div class="stack-6">
        <div class="row-between">
          <div class="stack-1"><h1 class="t-h1">Order #${order.order_number}</h1><p class="t-secondary">Booked ${formatDate(order.created_at)}${order.pickup_time ? html` · pickup ${order.pickup_time}` : ''}</p></div>
          ${statusBadge(order.status)}
        </div>
        ${paymentNotice(order)}
        ${pin ? html`<div class="card stack-2"><h2 class="t-h4">Handover PIN</h2><p class="pin">${pin}</p><p class="t-small t-secondary">Give this PIN to the driver only when your clean laundry is delivered.</p></div>` : ''}
        ${driver ? html`<div class="card stack-3">
            <h2 class="t-h4">Your driver</h2>
            <div class="row"><span class="avatar">${(driver.full_name || 'D')[0]}</span><div class="stack-1"><span class="t-medium">${driver.full_name || 'Driver'}</span><span class="t-small t-secondary">${[driver.vehicle_model || driver.vehicle_type, driver.vehicle_plate].filter(Boolean).join(' · ')}</span></div>
            ${driver.phone ? html`<a class="btn btn-secondary btn-sm" style="margin-left:auto" href="tel:${driver.phone}">Call</a>` : ''}</div>
            ${coords && mapsEnabled ? html`<div class="map" id="trackMap" role="img" aria-label="Map with the driver's location"></div>` : ''}
          </div>` : ''}
        <div class="card">
          <h2 class="t-h4 mb-4">Progress</h2>
          ${cancelled ? html`<p class="t-secondary">This order was cancelled${order.cancellation_reason ? html`: ${order.cancellation_reason}` : ''}. Any payment is refunded automatically.</p>` : html`
          <ol class="timeline">${flow.map((s, i) => html`<li class="${i < idx ? 'is-done' : i === idx ? 'is-current' : ''}"><span class="dot" aria-hidden="true"></span><div><div class="tl-title">${TIMELINE_LABELS[s]}</div>${i === idx ? html`<div class="t-small t-secondary">Current status</div>` : ''}</div></li>`)}</ol>`}
        </div>
        <div class="card stack-3">
          <h2 class="t-h4">Details</h2>
          <dl class="kv">
            <div class="kv-row"><dt>Laundry</dt><dd>${describeItems(order.items) || '—'}</dd></div>
            <div class="kv-row"><dt>Laundromat</dt><dd>${order.laundromat?.name || '—'}</dd></div>
            <div class="kv-row"><dt>Address</dt><dd class="break">${order.pickup_address || '—'}</dd></div>
            ${order.delivery_fee != null ? html`<div class="kv-row"><dt>Delivery</dt><dd>${Number(order.delivery_fee) ? money(order.delivery_fee) : 'Free'}</dd></div>` : ''}
            ${Number(order.discount_amount) ? html`<div class="kv-row"><dt>Discount</dt><dd>−${money(order.discount_amount)}</dd></div>` : ''}
            <div class="kv-row kv-total"><dt>Total</dt><dd>${money(order.total_amount)}</dd></div>
          </dl>
          ${order.tax_amount ? html`<p class="t-caption t-secondary">Includes VAT of ${money(order.tax_amount)}.</p>` : ''}
        </div>
        <div class="row">
          ${order.status === 'Pending' ? html`<button type="button" class="btn btn-danger" data-action="cancel-order">Cancel order</button>` : ''}
          <a class="btn btn-secondary" href="/contact" data-link>Get help with this order</a>
        </div>
      </div>`);
    const btn = $('[data-action="cancel-order"]', root);
    btn?.addEventListener('click', async () => {
      if (!confirm('Cancel this order? You will be refunded.')) return;
      const restore = busy(btn, 'Cancelling');
      try { await cancelOrder(order.id); toast('Order cancelled'); stopPoll(); load(); } catch (err) { restore(); toast('This order can no longer be cancelled here. Please contact us.', 'negative'); console.warn(err); }
    });
    if (coords && mapsEnabled) {
      const pickup = Number.isFinite(order.pickup_lat) ? { lat: order.pickup_lat, lng: order.pickup_lng } : null;
      showMap($('#trackMap', root), { driver: coords, destination: pickup });
    }
  }

  render(root, html`<div class="skeleton" style="height:200px"></div>`);
  if (payment) store.remove('mm.lastOrder');
  await load(true);
  void context;
}

// ---------- account ----------
export async function showAccount({ session }, context) {
  const root = document.getElementById('accountApp');
  if (!session.ready || !session.user) { render(root, html`<div class="skeleton" style="height:200px"></div>`); return; }
  const { user, profile } = session;
  const verified = user.emailVerified || profile?.is_verified;
  let addresses = [];
  try { addresses = await listAddresses(user.uid); } catch (err) { console.warn(err); }

  render(root, html`
    <div class="stack-6">
      ${!verified ? html`<div class="notice notice-warning"><div class="stack-2"><p>Verify your email address to place orders. We sent a link to <strong>${user.email}</strong>.</p>
        <div class="row"><button type="button" class="btn btn-secondary btn-sm" data-action="resend-verification">Resend email</button><button type="button" class="btn btn-tertiary btn-sm" data-action="check-verification">I have verified</button></div></div></div>` : ''}
      <form class="card" id="profileForm" novalidate>
        <h2 class="t-h3 mb-4">Profile</h2>
        <div class="form-grid form-grid-2">
          <div class="field"><label class="label" for="pfName">Full name</label><input class="input" id="pfName" name="full_name" required maxlength="100" autocomplete="name" value="${profile?.full_name || user.displayName || ''}"></div>
          <div class="field"><label class="label" for="pfPhone">Mobile number</label><input class="input" id="pfPhone" name="phone" type="tel" maxlength="20" autocomplete="tel" value="${profile?.phone || ''}"></div>
          <div class="field span-2"><label class="label" for="pfEmail">Email</label><input class="input" id="pfEmail" value="${user.email || ''}" disabled><span class="hint">To change your email, use the M&amp;M app.</span></div>
        </div>
        <button class="btn btn-primary mt-6" type="submit">Save</button>
        <p class="form-status mt-3" role="status" aria-live="polite"></p>
      </form>
      <div class="card" id="addresses">
        <h2 class="t-h3 mb-4">Saved addresses</h2>
        ${addresses.length ? html`<ul class="list-plain stack-3">${addresses.map((a) => html`<li class="row-between"><div class="stack-1"><span class="t-medium">${a.label || 'Address'}</span><span class="t-small t-secondary break">${a.address}</span></div><button type="button" class="btn btn-tertiary btn-sm" data-delete-address="${a.id}">Remove</button></li>`)}</ul>` : html`<p class="t-secondary">No saved addresses yet.</p>`}
        <form id="addressForm" class="mt-6" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field"><label class="label" for="adLabel">Label</label><input class="input" id="adLabel" name="label" maxlength="40" placeholder="Home" required></div>
            <div class="field"><label class="label" for="adAddress">Address</label><input class="input" id="adAddress" name="address" maxlength="300" required autocomplete="street-address"></div>
          </div>
          <button class="btn btn-secondary mt-4" type="submit">Add address</button>
        </form>
      </div>
      <div class="card row-between">
        <div class="stack-1"><h2 class="t-h4">Delete account or download your data</h2><p class="t-small t-secondary">Use Privacy settings in the M&amp;M app, or contact our Information Officer.</p></div>
        <a class="btn btn-secondary" href="mailto:privacy@mm-laundry.co.za">Email us</a>
      </div>
      <button type="button" class="btn btn-outline" data-action="sign-out">Sign out</button>
    </div>`);

  let place = null;
  const adInput = $('#adAddress', root);
  attachAutocomplete(adInput, (p) => { place = p; adInput.value = p.address; });

  $('#profileForm', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!validate(form)) return;
    const f = new FormData(form);
    const restore = busy(form.querySelector('[type=submit]'), 'Saving');
    const { error } = await sb.from('profiles').update({ full_name: String(f.get('full_name')).trim(), phone: String(f.get('phone') || '').trim() || null }).eq('id', user.uid);
    restore();
    if (error) toast('Could not save your profile', 'negative'); else toast('Profile saved', 'positive');
  });
  $('#addressForm', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!validate(form)) return;
    const f = new FormData(form);
    const restore = busy(form.querySelector('[type=submit]'), 'Adding');
    try {
      const address = String(f.get('address')).trim();
      await addAddress(user.uid, { label: String(f.get('label')).trim(), address, latitude: place?.address === address ? place.lat : null, longitude: place?.address === address ? place.lng : null });
      toast('Address added', 'positive');
      showAccount({ session }, context);
    } catch (err) { restore(); toast('Could not add the address', 'negative'); console.warn(err); }
  });
  root.onclick = async (e) => {
    const del = e.target.closest('[data-delete-address]');
    if (del) {
      const restore = busy(del, 'Removing');
      try { await deleteAddress(del.dataset.deleteAddress); showAccount({ session }, context); } catch (err) { restore(); toast('Could not remove the address', 'negative'); console.warn(err); }
      return;
    }
    const b = e.target.closest('[data-action]');
    if (b?.dataset.action === 'resend-verification') {
      const restore = busy(b, 'Sending');
      try { await resendVerification(); toast('Verification email sent'); } catch (err) { toast(err.message, 'negative'); }
      restore();
    } else if (b?.dataset.action === 'check-verification') {
      const restore = busy(b, 'Checking');
      const s = await refreshVerification().catch(() => null);
      restore();
      if (s?.user?.emailVerified) toast('Email verified', 'positive'); else toast('Not verified yet. Open the link in the email we sent.', 'negative');
    }
  };
}
