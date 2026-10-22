// ONE place for the order/pricing contract with the shared Supabase backend.
// If the edge-function field names change, only this file needs to follow.
//
//   GET  {SUPABASE_URL}/functions/v1/get-pricing                    (public) "from" prices across laundromats
//   GET  {SUPABASE_URL}/functions/v1/get-pricing?laundromat_id=<id> (public) that laundromat's own prices
//        Base prices belong to each laundromat; M&M sets only the delivery fee, VAT and promo codes.
//   POST {SUPABASE_URL}/functions/v1/create-order       (Bearer Firebase ID token + X-Firebase-AppCheck)
//
// Orders are read back through Supabase under RLS (customers can read their own rows).
import { callFunction, sb } from './backend.js';
import { getPricing, normalizePricing, listLaundromatsPublic } from './public-api.js';

export const SERVICES = {
  wash_fold: { label: 'Wash & fold', kind: 'basket', unit: 'basket' },
  iron_press: { label: 'Wash & iron', kind: 'basket', unit: 'basket' },
  sneakers: { label: 'Sneakers', kind: 'item', unit: 'pair' },
  blankets: { label: 'Blankets and duvets', kind: 'item', unit: 'item' },
  carpets: { label: 'Carpets and rugs', kind: 'item', unit: 'item' },
  dry_clean: { label: 'Dry cleaning', kind: 'item', unit: 'garment' },
};

export const BASKET_SIZES = {
  small: { label: 'Small basket', hint: 'About 1 hamper' },
  medium: { label: 'Medium basket', hint: 'About 2 hampers' },
  large: { label: 'Large basket', hint: 'About 3 hampers' },
  family: { label: 'Family basket', hint: 'About 4 hampers' },
};

export const MAX_ITEMS = 20;

// Same labels as the app (src/lib/scheduling.ts) so pickup_time reads the same everywhere.
export const TIME_SLOTS = [
  { id: 'morning_1', label: '08:00 AM - 10:00 AM', start: '08:00' },
  { id: 'morning_2', label: '10:00 AM - 12:00 PM', start: '10:00' },
  { id: 'afternoon_1', label: '12:00 PM - 02:00 PM', start: '12:00' },
  { id: 'afternoon_2', label: '02:00 PM - 04:00 PM', start: '14:00' },
  { id: 'evening_1', label: '04:00 PM - 06:00 PM', start: '16:00' },
  { id: 'evening_2', label: '06:00 PM - 08:00 PM', start: '18:00' },
];

const num = (v, d) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

// Prices come only from get-pricing (each laundromat's own published prices); see public-api.js.
export { normalizePricing } from './public-api.js';
/** No prices known yet (before a laundromat is chosen or while its prices load). */
export const EMPTY_PRICING = Object.freeze(normalizePricing(null));

/**
 * fetchPricing()            "from" prices (lowest across partner laundromats)
 * fetchPricing(laundromatId) that laundromat's prices; `unpublished` / `unavailable` flags when missing
 */
export const fetchPricing = (laundromatId = null) => getPricing(laundromatId);

/** True when the laundromat behind `pricing` offers this service (and basket size). */
export function offers(pricing, service, basketSize) {
  const svc = SERVICES[service];
  if (!svc) return false;
  if (svc.kind === 'basket') return basketSize ? num(pricing.basket_pricing[basketSize], 0) > 0 : Object.keys(pricing.basket_pricing).length > 0;
  return num(pricing.item_pricing[service], 0) > 0;
}

/** Lowest basket price for a service tile ("from R…"), or null when no basket is offered. */
export function fromBasketPrice(pricing) {
  const v = Object.values(pricing.basket_pricing).map(Number).filter((n) => n > 0);
  return v.length ? Math.min(...v) : null;
}

export function unitPrice(pricing, draft) {
  const svc = SERVICES[draft.service];
  if (!svc) return 0;
  return svc.kind === 'basket' ? num(pricing.basket_pricing[draft.basket_size], 0) : num(pricing.item_pricing[draft.service], 0);
}

/** Client-side estimate for display only; create-order recomputes everything on the server. */
export function estimate(pricing, draft) {
  const svc = SERVICES[draft.service];
  if (!svc || !offers(pricing, draft.service, svc.kind === 'basket' ? draft.basket_size : null)) return null;
  const qty = svc.kind === 'basket' ? 1 : Math.max(1, Math.min(MAX_ITEMS, Math.trunc(num(draft.item_count, 1))));
  const price = unitPrice(pricing, draft);
  const subtotal = price * qty;
  const threshold = num(pricing.free_delivery_threshold, null);
  const delivery_fee = threshold !== null && subtotal >= threshold ? 0 : num(pricing.delivery_fee, 0);
  const service_fee = pricing.service_fee || 0;
  const total_amount = Math.round((subtotal + delivery_fee + service_fee) * 100) / 100;
  const vat = num(pricing.vat_rate, 0);
  const tax_amount = vat > 0 ? Math.round((total_amount - total_amount / (1 + vat)) * 100) / 100 : 0;
  const label = svc.kind === 'basket'
    ? `${svc.label} · ${BASKET_SIZES[draft.basket_size]?.label || ''}`
    : `${svc.label} · ${qty} ${svc.unit}${qty === 1 ? '' : 's'}`;
  return { lines: [{ label, amount: subtotal }], subtotal, discount: 0, delivery_fee, service_fee, tax_amount, total_amount, estimated: true };
}

export function pickupTimeString(draft) {
  const slot = TIME_SLOTS.find((s) => s.id === draft.pickup_slot);
  return draft.pickup_date && slot ? `${draft.pickup_date} ${slot.label}` : '';
}

/**
 * Builds the create-order body from the booking draft.
 * Contract (create-order, Ozow version):
 *   request_id, laundromat_id, service, basket_size | item_count, address_id, pickup_time,
 *   payment_method: 'ozow', promo_code?, notes?, return_url?, dry_run?
 */
export function buildCreateOrderRequest(draft, { addressId, requestId, returnUrl, dryRun = false } = {}) {
  const svc = SERVICES[draft.service];
  const body = {
    request_id: requestId,
    laundromat_id: draft.laundromat_id,
    service: draft.service,
    pickup_time: pickupTimeString(draft),
    payment_method: 'ozow',
  };
  if (svc?.kind === 'basket') body.basket_size = draft.basket_size;
  else body.item_count = Math.max(1, Math.min(MAX_ITEMS, Math.trunc(num(draft.item_count, 1))));
  if (addressId) body.address_id = addressId;
  const notes = [draft.address?.unit ? `Unit/complex: ${draft.address.unit}` : '', draft.detergent ? `Detergent: ${draft.detergent}` : '', draft.notes || '']
    .filter(Boolean).join(' | ').slice(0, 500);
  if (notes) body.notes = notes;
  if (draft.promo_code) body.promo_code = String(draft.promo_code).trim().toUpperCase().slice(0, 32);
  if (returnUrl) body.return_url = returnUrl;
  if (dryRun) body.dry_run = true;
  return body;
}

/** Server quote (create-order with dry_run). Returns {lines, subtotal, discount, delivery_fee, service_fee, protection_fee, tax_amount, total_amount}. */
export async function quoteOrder(draft, opts = {}) {
  const data = await callFunction('create-order', { auth: true, body: buildCreateOrderRequest(draft, { ...opts, dryRun: true }) });
  return data.quote || null;
}

/** Creates the order and returns {order_id, order_number, total_amount, payment_url}. */
export async function createOrder(draft, opts) {
  const data = await callFunction('create-order', { auth: true, body: buildCreateOrderRequest(draft, opts) });
  return {
    order_id: data.order_id,
    order_number: data.order_number,
    total_amount: data.total_amount,
    payment_url: data.payment_url || null,
  };
}

/** Ozow returns the customer here: /orders/<id>?payment=success|cancelled|error */
export const returnUrlFor = (orderId) => `${location.origin}/orders/${orderId}`;

/** Accept only an https Ozow-hosted payment page (never redirect to an arbitrary URL). */
export function isSafePaymentUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (/(^|\.)ozow\.com$/i.test(u.hostname));
  } catch { return false; }
}

// ---- reads under RLS ----
export const ORDER_STATUSES = ['Awaiting Payment', 'Pending', 'Accepted', 'Picked Up', 'In Progress', 'Ready for Delivery', 'Out for Delivery', 'Delivered'];
const ORDER_COLUMNS = 'id, order_number, status, created_at, updated_at, pickup_time, pickup_address, delivery_address, total_amount, delivery_fee, service_fee, tax_amount, discount_amount, items, payment_method, driver_id, laundromat_id, delivered_at, cancellation_reason, pickup_lat, pickup_lng, laundromat:laundromats(id, name, address, phone)';

export async function listMyOrders(uid) {
  const { data, error } = await sb.from('orders').select(ORDER_COLUMNS).eq('customer_id', uid).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

export async function getOrder(id) {
  const { data, error } = await sb.from('orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOrderPin(orderId) {
  const { data } = await sb.from('order_pins').select('pin').eq('order_id', orderId).maybeSingle();
  return data?.pin || null;
}

/** Driver card (name, phone, vehicle), visible to the customer only while the order is active (RLS: is_counterparty). Live position: realtime-adapter.js. */
export async function getDriver(driverId) {
  if (!driverId) return null;
  const [{ data: profile }, { data: drv }] = await Promise.all([
    sb.from('profiles').select('full_name, phone').eq('id', driverId).maybeSingle(),
    sb.from('drivers').select('vehicle_model, vehicle_plate, vehicle_type').eq('profile_id', driverId).maybeSingle(),
  ]);
  if (!profile && !drv) return null;
  return { ...(profile || {}), ...(drv || {}) };
}

/** Customers may cancel while the order is still Pending (guard_orders trigger); the DB refunds automatically. */
export async function cancelOrder(id) {
  const { error } = await sb.from('orders').update({ status: 'Cancelled', cancellation_reason: 'Cancelled by customer on the website' }).eq('id', id);
  if (error) throw error;
}

// Partner list for booking: verified laundromats only (RLS hides unverified ones from visitors).
export const listLaundromats = () => listLaundromatsPublic();

export async function listAddresses(uid) {
  const { data, error } = await sb.from('addresses').select('id, label, address, latitude, longitude, is_default, created_at').eq('user_id', uid)
    .order('is_default', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addAddress(uid, { label, address, latitude = null, longitude = null, is_default = false }) {
  const { data, error } = await sb.from('addresses')
    .insert({ user_id: uid, label: (label || 'Home').slice(0, 40), address: address.slice(0, 300), latitude, longitude, is_default })
    .select('id, label, address, latitude, longitude, is_default').single();
  if (error) throw error;
  return data;
}

export async function deleteAddress(id) {
  const { error } = await sb.from('addresses').delete().eq('id', id);
  if (error) throw error;
}
