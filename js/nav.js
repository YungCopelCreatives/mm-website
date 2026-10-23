// Header dropdown menus (menu-button pattern) and the mobile drawer (modal dialog).
import { $, $$ } from './ui.js';

let openMenu = null;

function items(menu) { return $$('[role="menuitem"]', menu).filter((el) => !el.closest('[hidden]') || el.closest('[hidden]') === menu); }

function closeMenu({ focusTrigger = false } = {}) {
  if (!openMenu) return;
  const { trigger, menu } = openMenu;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  if (focusTrigger) trigger.focus();
  openMenu = null;
}

function openMenuFor(trigger, focus = 'none') {
  const menu = document.getElementById(trigger.getAttribute('aria-controls'));
  if (!menu) return;
  if (openMenu && openMenu.trigger !== trigger) closeMenu();
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  openMenu = { trigger, menu };
  const list = items(menu);
  if (focus === 'first') list[0]?.focus();
  if (focus === 'last') list[list.length - 1]?.focus();
}

function initMenus() {
  for (const wrap of $$('[data-menu]')) {
    const trigger = $('.nav-trigger', wrap);
    const menu = document.getElementById(trigger.getAttribute('aria-controls'));
    trigger.setAttribute('aria-haspopup', 'true');

    trigger.addEventListener('click', () => {
      if (openMenu?.trigger === trigger) closeMenu();
      else openMenuFor(trigger);
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenuFor(trigger, 'first'); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); openMenuFor(trigger, 'last'); }
      else if (e.key === 'Escape') closeMenu({ focusTrigger: true });
    });
    menu.addEventListener('keydown', (e) => {
      const list = items(menu);
      const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu({ focusTrigger: true }); }
      else if (e.key === 'Tab') closeMenu();
      else if (e.key === ' ' && document.activeElement?.tagName === 'A') { e.preventDefault(); document.activeElement.click(); }
    });
    menu.addEventListener('click', (e) => { if (e.target.closest('[role="menuitem"]')) closeMenu(); });
  }
  document.addEventListener('pointerdown', (e) => {
    if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.trigger.contains(e.target)) closeMenu();
  });
  document.addEventListener('focusin', (e) => {
    if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.trigger.contains(e.target)) closeMenu();
  });
}

// ---- drawer ----
const drawer = () => $('#drawer');
let lastFocus = null;

function focusables(root) {
  return $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', root)
    .filter((el) => !el.closest('[hidden]') && el.offsetParent !== null);
}

export function openDrawer() {
  const d = drawer();
  if (!d || !d.hidden) return;
  lastFocus = document.activeElement;
  closeMenu();
  d.hidden = false;
  $('#drawerBackdrop').hidden = false;
  $('#drawerToggle').setAttribute('aria-expanded', 'true');
  document.body.classList.add('no-scroll');
  $('#main').setAttribute('inert', '');
  $('.site-header').setAttribute('inert', '');
  $('#drawerClose').focus();
}

export function closeDrawer({ restoreFocus = true } = {}) {
  const d = drawer();
  if (!d || d.hidden) return;
  d.hidden = true;
  $('#drawerBackdrop').hidden = true;
  $('#drawerToggle').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('no-scroll');
  $('#main').removeAttribute('inert');
  $('.site-header').removeAttribute('inert');
  if (restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function initDrawer() {
  $('#drawerToggle').addEventListener('click', openDrawer);
  $('#drawerClose').addEventListener('click', () => closeDrawer());
  $('#drawerBackdrop').addEventListener('click', () => closeDrawer());
  drawer().addEventListener('click', (e) => { if (e.target.closest('a[href]')) closeDrawer({ restoreFocus: false }); });
  drawer().addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    const list = focusables(drawer());
    if (!list.length) return;
    const first = list[0]; const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // The drawer is for small screens only; close it if the window grows past the breakpoint.
  matchMedia('(min-width: 1024px)').addEventListener('change', (m) => { if (m.matches) closeDrawer({ restoreFocus: false }); });
}

export function onRouteChange(path) {
  closeMenu();
  closeDrawer({ restoreFocus: false });
  for (const a of $$('.nav-link[href], .drawer-link[href]')) {
    const href = a.getAttribute('href');
    if (href === path || (href !== '/' && path.startsWith(href + '/'))) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

export function initNav() { initMenus(); initDrawer(); }
