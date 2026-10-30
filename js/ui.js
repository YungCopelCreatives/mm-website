// Small DOM helpers shared by every module. No framework.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Tagged template that HTML-escapes every interpolated value unless wrapped with raw(). */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v && v.__raw) out += v.value;
      else if (Array.isArray(v)) out += v.map((x) => (x && x.__raw ? x.value : esc(x))).join('');
      else out += esc(v);
    }
  });
  return { __raw: true, value: out };
}
export const raw = (value) => ({ __raw: true, value: String(value) });
export function render(el, tpl) { el.innerHTML = tpl && tpl.__raw ? tpl.value : esc(tpl); }

export function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const cents = Math.round(v * 100) % 100 !== 0;
  return 'R' + v.toLocaleString('en-ZA', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 }).replace(/ /g, ' ');
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function toast(message, kind = '') {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast${kind ? ` toast-${kind}` : ''}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Puts a submit button into a busy state; returns a function that restores it. */
export function busy(button, label = 'Please wait') {
  if (!button) return () => {};
  const prev = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
  return () => { button.disabled = false; button.removeAttribute('aria-busy'); button.innerHTML = prev; };
}

export function setStatus(form, message, kind = '') {
  const el = form.querySelector('.form-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = kind === 'error' ? 'var(--negative)' : kind === 'ok' ? 'var(--positive)' : '';
}

/** Native constraint validation with visible messages; returns true when valid. */
export function validate(form) {
  let first = null;
  for (const el of form.querySelectorAll('input, select, textarea')) {
    if (el.closest('.honeypot')) continue;
    const ok = el.checkValidity();
    el.setAttribute('aria-invalid', ok ? 'false' : 'true');
    let msg = el.parentElement.querySelector(':scope > .field-error');
    if (!ok) {
      if (!msg && el.type !== 'checkbox') {
        msg = document.createElement('span');
        msg.className = 'field-error';
        msg.id = `${el.id || el.name}-error`;
        el.parentElement.appendChild(msg);
        el.setAttribute('aria-describedby', msg.id);
      }
      if (msg) msg.textContent = el.validationMessage;
      first = first || el;
    } else if (msg) msg.textContent = '';
  }
  if (first) first.focus();
  return !first;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const store = {
  get(key, fallback = null) {
    try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  remove(key) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
};
