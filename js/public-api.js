// Public, anonymous reads that marketing pages need, with plain fetch (no Firebase/Supabase SDK),
// so pages like /services and /partners stay light. Same endpoints and rules as the app:
//
//   GET {SUPABASE_URL}/functions/v1/get-pricing                    "from" prices across laundromats
//   GET {SUPABASE_URL}/functions/v1/get-pricing?laundromat_id=<id> one laundromat's own prices
//   GET {SUPABASE_URL}/rest/v1/laundromats                         verified partners (RLS: anon sees verified only)
//
// Prices are set by each laundromat. M&M sets only the delivery fee, VAT and promo codes.
// Nothing here has a fallback price: if a value is not published it is simply not shown.
const cfg = window.__MM_CONFIG__ || {};
export const publicConfigured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

function headers() {
  const h = { apikey: cfg.supabaseAnonKey };
  // Legacy anon keys are JWTs and may also be sent as a Bearer; new publishable keys may not.
  if (String(cfg.supabaseAnonKey || '').startsWith('eyJ')) h.Authorization = `Bearer ${cfg.supabaseAnonKey}`;
  return h;
}

export class PublicApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

async function getJson(url) {
  if (!publicConfigured) throw new PublicApiError('Not configured', 0);
  let res;
  try { res = await fetch(url, { headers: headers() }); } catch { throw new PublicApiError('Network error', 0); }
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) throw new PublicApiError(data?.error || data?.message || `Request failed (${res.status})`, res.status);
  return data;
}

const pos = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Normalises a get-pricing response; only published (positive) prices are kept. */
export function normalizePricing(r, laundromatId = null) {
  const pick = (src) => {
    const out = {};
    for (const [k, v] of Object.entries(src || {})) { const n = pos(v); if (n !== null) out[k] = n; }
    return out;
  };
  return {
    currency: r?.currency || 'ZAR',
    laundromat_id: laundromatId,
    basket_pricing: pick(r?.basket_pricing),
    item_pricing: pick(r?.item_pricing),
    laundromat_from: pick(r?.laundromat_from),
    delivery_fee: num(r?.delivery_fee),
    free_delivery_threshold: num(r?.free_delivery_threshold),
    service_fee: num(r?.service_fee) ?? 0,
    protection_fee: num(r?.protection_fee) ?? 0,
    vat_rate: num(r?.vat_rate),
    prices_include_vat: r?.prices_include_vat !== false,
    live: Boolean(r),
  };
}

const pricingCache = new Map();
/**
 * getPricing()            "from" prices (lowest across partner laundromats) for marketing pages
 * getPricing(laundromatId) that laundromat's prices; `unpublished: true` when it has none (404),
 *                          `unavailable: true` when they could not be loaded.
 */
export function getPricing(laundromatId = null) {
  const key = laundromatId || '';
  if (!pricingCache.has(key)) {
    const qs = laundromatId ? `?laundromat_id=${encodeURIComponent(laundromatId)}` : '';
    const p = getJson(`${cfg.supabaseUrl}/functions/v1/get-pricing${qs}`)
      .then((r) => normalizePricing(r, laundromatId))
      .catch((err) => {
        pricingCache.delete(key); // try again next time
        if (laundromatId && err.status === 404) return { ...normalizePricing(null, laundromatId), unpublished: true };
        return { ...normalizePricing(null, laundromatId), unavailable: true };
      });
    pricingCache.set(key, p);
  }
  return pricingCache.get(key);
}

export const LAUNDROMAT_COLUMNS = 'id,name,address,rating,reviews_count,image_url,description';

/** Verified partner laundromats (RLS hides unverified ones from customers and visitors). */
export async function listLaundromatsPublic() {
  const rows = await getJson(`${cfg.supabaseUrl}/rest/v1/laundromats?select=${LAUNDROMAT_COLUMNS}&order=name.asc`);
  return Array.isArray(rows) ? rows : [];
}
