// ONE place that knows how live order tracking is stored in the shared backend.
// Same tables and RPC as the app (migration 20261022010000_realtime.sql in the app repo):
//
//   orders            realtime, filter id=eq.<order id>        status, driver_id, ...
//   driver_locations  realtime, filter driver_id=eq.<driver>    lat, lng, heading, speed_kmh, updated_at
//                     (RLS: the customer sees it only while their order with that driver is active;
//                      DELETE when the driver goes offline)
//   rpc get_order_driver_location(p_order_id) -> {driver_id, lat, lng, heading, speed_kmh, updated_at}
//
// If those names change, only LIVE below needs to follow. Before the realtime migration is
// applied, the initial position falls back to drivers.current_lat/current_lng.
import { sb } from './backend.js';

export const LIVE = Object.freeze({
  ordersTable: 'orders',
  locationTable: 'driver_locations',
  locationDriverColumn: 'driver_id',
  locationRpc: 'get_order_driver_location',
  legacyDriversTable: 'drivers',
});

const toPosition = (row) => {
  if (!row) return null;
  const lat = Number(row.lat ?? row.current_lat);
  const lng = Number(row.lng ?? row.current_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng, heading: Number.isFinite(Number(row.heading)) ? Number(row.heading) : null, updated_at: row.updated_at || null };
};

/** Current driver position for an order, or null (not assigned, not visible yet, or offline). */
export async function getDriverPosition(orderId, driverId) {
  const { data, error } = await sb.rpc(LIVE.locationRpc, { p_order_id: orderId });
  if (!error) return toPosition(Array.isArray(data) ? data[0] : data);
  // RPC not deployed yet (PGRST202 / 404): read the legacy columns the app still mirrors.
  if (!driverId) return null;
  const { data: legacy } = await sb.from(LIVE.legacyDriversTable).select('current_lat, current_lng, updated_at').eq('profile_id', driverId).maybeSingle();
  return toPosition(legacy);
}

/**
 * Subscribes to an order and, once a driver is assigned, to that driver's position.
 *   onOrder(row)          the order row changed (status, driver_id, ...); row has table columns only
 *   onPosition(pos|null)  the driver moved (null = went offline / no longer visible)
 *   onState('live'|'connecting'|'offline')
 * Returns { setDriver(driverId), stop() }.
 */
export function watchOrder(orderId, { onOrder, onPosition, onState } = {}) {
  let driverChannel = null;
  let driverId = null;
  let stopped = false;

  const orderChannel = sb.channel(`web-order-${orderId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: LIVE.ordersTable, filter: `id=eq.${orderId}` }, (payload) => {
      if (payload.new) onOrder?.(payload.new);
    })
    .subscribe((status) => {
      if (stopped) return;
      if (status === 'SUBSCRIBED') onState?.('live');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onState?.('offline');
    });
  onState?.('connecting');

  function setDriver(id) {
    if (stopped || id === driverId) return;
    driverId = id || null;
    if (driverChannel) { sb.removeChannel(driverChannel); driverChannel = null; }
    if (!driverId) return;
    driverChannel = sb.channel(`web-driver-${orderId}-${driverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: LIVE.locationTable, filter: `${LIVE.locationDriverColumn}=eq.${driverId}` }, (payload) => {
        onPosition?.(payload.eventType === 'DELETE' ? null : toPosition(payload.new));
      })
      .subscribe();
  }

  return {
    setDriver,
    stop() {
      stopped = true;
      sb.removeChannel(orderChannel);
      if (driverChannel) sb.removeChannel(driverChannel);
      driverChannel = null;
    },
  };
}
