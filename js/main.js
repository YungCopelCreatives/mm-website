// Entry point: client-side router, header state and lazy loading of the backend-powered pages.
// Marketing pages work even if the backend bundle cannot load.
import { $, $$ } from './ui.js';
import { initNav, onRouteChange } from './nav.js';

const pages = $$('[data-route]');
const hooks = new Map();
let currentSession = { user: null, profile: null, ready: false };
let pagesModule = null;
let firstRender = true;
let previousRoute = null;
let previousPath = null;

export function registerPage(route, fn) { hooks.set(route, fn); }
export function getSession() { return currentSession; }

function match(path) {
  for (const el of pages) {
    const route = el.dataset.route;
    if (route === path) return { el, route, params: {} };
    if (route.includes(':')) {
      const re = new RegExp('^' + route.replace(/:[a-z]+/g, '([^/]+)') + '$');
      const m = path.match(re);
      if (m) {
        const names = [...route.matchAll(/:([a-z]+)/g)].map((x) => x[1]);
        return { el, route, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
      }
    }
  }
  return { el: pages.find((p) => p.dataset.route === '404'), route: '404', params: {} };
}

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) { location.assign(url.href); return; }
  const target = url.pathname + url.search + url.hash;
  if (replace) history.replaceState({}, '', target); else history.pushState({}, '', target);
  route({ focus: true });
}

function scrollToHash(hash) {
  if (!hash) return false;
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!el) return false;
  el.scrollIntoView({ block: 'start' });
  return true;
}

export function route({ focus = false } = {}) {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const m = match(path);

  if (m.el.hasAttribute('data-auth-required') && currentSession.ready && !currentSession.user) {
    navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    return;
  }
  if ((path === '/login' || path === '/signup') && currentSession.user) {
    navigate(safeNext() || '/orders', { replace: true });
    return;
  }

  for (const p of pages) p.hidden = p !== m.el;
  document.title = m.el.dataset.title || 'M&M Laundry';
  onRouteChange(path);

  const hook = hooks.get(m.route);
  if (hook) {
    try { hook({ params: m.params, query: new URLSearchParams(location.search), session: currentSession }); } catch (err) { console.error(err); }
  }

  const samePage = previousRoute === m.route && previousPath === location.pathname;
  previousRoute = m.route; previousPath = location.pathname;
  if (!samePage && !scrollToHash(location.hash)) window.scrollTo(0, 0);
  else if (samePage && location.hash) scrollToHash(location.hash);
  if (focus && !firstRender && !samePage) {
    const h1 = $('h1', m.el);
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }
  firstRender = false;
}

export function safeNext() {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

function applySession(s) {
  const changed = s.user?.uid !== currentSession.user?.uid || s.ready !== currentSession.ready;
  currentSession = s;
  const signedIn = Boolean(s.user);
  for (const el of $$('[data-auth="guest"]')) el.hidden = signedIn;
  for (const el of $$('[data-auth="user"]')) el.hidden = !signedIn;
  const name = s.profile?.full_name || s.user?.displayName || s.user?.email || 'Account';
  for (const el of $$('[data-user-name]')) el.textContent = name.split(' ')[0];
  for (const el of $$('[data-user-email]')) el.textContent = s.user?.email || '';
  for (const el of $$('[data-user-initials]')) el.textContent = (name.trim()[0] || 'M').toUpperCase();
  if (changed) route();
}

function initLinks() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.origin);
    if (url.origin !== location.origin || /\.[a-z0-9]+$/i.test(url.pathname)) return;
    e.preventDefault();
    if (url.pathname === location.pathname && url.search === location.search && url.hash) {
      history.pushState({}, '', url.hash);
      scrollToHash(url.hash);
      return;
    }
    navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener('popstate', () => route({ focus: true }));

  // Home quick-book form: keep it a plain GET form for no-JS, route client-side otherwise.
  $('#quickBook')?.addEventListener('submit', (e) => {
    e.preventDefault();
    navigate(`/book?service=${encodeURIComponent($('#qbService').value)}`);
  });
}

function initServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

initNav();
initLinks();
for (const el of $$('[data-year]')) el.textContent = String(new Date().getFullYear());
route();
initServiceWorker();

import('./pages.js')
  .then((mod) => { pagesModule = mod; mod.init({ registerPage, onSession: applySession, navigate, route, getSession, safeNext }); })
  .catch((err) => {
    console.error('M&M: the booking and account features could not load.', err);
    currentSession = { user: null, profile: null, ready: true };
    for (const id of ['bookApp', 'ordersApp', 'trackApp', 'accountApp']) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="notice notice-negative">This part of the site could not load. Refresh the page or try again later.</div>';
    }
  });

export const _debug = () => ({ pagesModule, currentSession });
