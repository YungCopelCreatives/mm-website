// Optional Google Maps (address autocomplete when booking, driver map when tracking).
// Everything degrades to plain inputs/text when GOOGLE_MAPS_API_KEY is not configured.
const key = window.__MM_CONFIG__?.googleMapsApiKey || '';
let loading = null;

export const mapsEnabled = Boolean(key);

export function loadMaps() {
  if (!key) return Promise.resolve(null);
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!loading) {
    loading = new Promise((resolve) => {
      window.__mmMapsReady = () => resolve(window.google?.maps || null);
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async&region=ZA&callback=__mmMapsReady`;
      s.async = true;
      s.onerror = () => { console.warn('Google Maps could not load'); resolve(null); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Attaches South African address autocomplete; onPlace({address, lat, lng}) fires on selection. */
export async function attachAutocomplete(input, onPlace) {
  const maps = await loadMaps();
  if (!maps?.places?.Autocomplete || input.dataset.autocomplete) return;
  try {
    const ac = new maps.places.Autocomplete(input, { componentRestrictions: { country: 'za' }, fields: ['formatted_address', 'geometry'] });
    input.dataset.autocomplete = '1';
    ac.addListener('place_changed', () => {
      const p = ac.getPlace();
      if (!p?.geometry?.location) return;
      onPlace({ address: p.formatted_address || input.value, lat: p.geometry.location.lat(), lng: p.geometry.location.lng() });
    });
  } catch (err) {
    console.warn('Address autocomplete unavailable', err?.message);
  }
}

/**
 * Renders a small map with optional driver and destination markers.
 * Returns a handle { setDriver(pos|null) } that moves the driver marker without redrawing, or null.
 */
export async function showMap(el, { driver, destination }) {
  const maps = await loadMaps();
  if (!maps || !el) return null;
  const center = driver || destination;
  if (!center) return null;
  const map = new maps.Map(el, { center, zoom: 13, disableDefaultUI: true, zoomControl: true, clickableIcons: false });
  let driverMarker = driver ? new maps.Marker({ position: driver, map, title: 'Driver' }) : null;
  if (destination) new maps.Marker({ position: destination, map, title: 'Your address' });
  const fit = (pos) => {
    if (pos && destination) {
      const bounds = new maps.LatLngBounds();
      bounds.extend(pos); bounds.extend(destination);
      map.fitBounds(bounds, 48);
    } else if (pos) map.panTo(pos);
  };
  fit(driver);
  let fitted = Boolean(driver);
  return {
    setDriver(pos) {
      if (!pos) { driverMarker?.setMap(null); driverMarker = null; return; }
      const p = { lat: pos.lat, lng: pos.lng };
      if (!driverMarker) driverMarker = new maps.Marker({ position: p, map, title: 'Driver' });
      else driverMarker.setPosition(p);
      // Keep the driver in view without fighting the customer's own panning/zooming.
      if (!fitted) { fit(p); fitted = true; } else if (!map.getBounds()?.contains(p)) map.panTo(p);
    },
  };
}
