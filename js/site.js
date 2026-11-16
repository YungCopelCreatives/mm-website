// Owner-supplied business details and the website <-> app links.
// Values come from /config.js (rendered by server.js from env: CONTACT_*, APP_STORE_URL,
// PLAY_STORE_URL ...). Anything not configured is hidden, never replaced by a placeholder.
import { $$, esc } from './ui.js';

export const site = Object.freeze({
  supportPhone: '', supportEmail: '', privacyEmail: '', supportHours: '', serviceAreas: '',
  appStoreUrl: '', playStoreUrl: '', appScheme: 'com.laundromatmarketplace', androidPackage: 'com.laundromatmarketplace',
  ...((window.__MM_CONFIG__ || {}).site || {}),
});

const ua = navigator.userAgent || '';
// iPadOS reports itself as a Mac; touch support tells them apart.
export const platform = /android/i.test(ua) ? 'android'
  : /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ? 'ios' : 'desktop';

/**
 * "Open in app" link for a website path (e.g. /orders/<id>, /kyc), or null when there is no
 * released app for this device. The app maps the path to its own screen (src/lib/deepLinks.ts).
 *  - Android: an intent: URL; Chrome opens the app, or the Play Store listing if it is not installed.
 *  - iOS: the app's URL scheme; if nothing opens within a moment we send the visitor to the App Store.
 *    (A universal link to this same site would just reload the page in Safari.)
 */
export function appLink(path) {
  const p = String(path || '/').startsWith('/') ? path : `/${path}`;
  if (platform === 'android' && site.playStoreUrl) {
    return {
      href: `intent://open${p}#Intent;scheme=${site.appScheme};package=${site.androidPackage};S.browser_fallback_url=${encodeURIComponent(site.playStoreUrl)};end`,
      fallback: null,
    };
  }
  if (platform === 'ios' && site.appStoreUrl) return { href: `${site.appScheme}://open${p}`, fallback: site.appStoreUrl };
  return null;
}

export const hasApp = Boolean(site.appStoreUrl || site.playStoreUrl);

/** Fills every [data-app-cta="<path>"] with an "Open in app" button (or leaves it empty). */
export function renderAppCtas(root = document) {
  for (const el of $$('[data-app-cta]', root)) {
    const link = appLink(el.dataset.appCta);
    const existing = el.querySelector('[data-open-app]');
    if (!link) { existing?.remove(); continue; }
    if (existing) { existing.href = link.href; continue; }
    const small = el.dataset.appCtaSize === 'sm' || el.classList.contains('row');
    const a = document.createElement('a');
    a.className = `btn btn-primary${small ? ' btn-sm' : ''}`;
    a.dataset.openApp = '';
    a.href = link.href;
    if (link.fallback) a.dataset.fallback = link.fallback;
    a.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg><span>${esc('Open in the app')}</span>`;
    el.prepend(a);
  }
}

// iOS fallback: if the app did not take over (page still visible), go to the App Store.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-open-app][data-fallback]');
  if (!a) return;
  const fallback = a.dataset.fallback;
  const timer = setTimeout(() => { if (document.visibilityState === 'visible') location.assign(fallback); }, 1600);
  const cancel = () => { if (document.visibilityState === 'hidden') clearTimeout(timer); };
  document.addEventListener('visibilitychange', cancel, { once: true });
  window.addEventListener('pagehide', () => clearTimeout(timer), { once: true });
});
