// Live support chat on the website, answered by M&M admins from the app's dashboard (Chats tab).
// Same conversations as the app: one chat per account, stored in the shared Supabase database
// (app repo: supabase/migrations/20261109000000_live_support_chat.sql).
//
//   Signed in   rpc support_my_chat / support_send / support_mark_read; messages read under RLS;
//               new messages through Realtime postgres_changes on support_messages.
//   Visitor     rpc support_guest_start / support_guest_send / support_guest_messages with a random
//               token kept in this browser (localStorage), new messages through the public
//               Realtime broadcast channel 'support-guest-<topic>'. Visitors never load Firebase.
//
// Loaded only when someone opens the chat (or has a chat in progress), so marketing pages stay light.
import { $, esc, setStatus, toast } from './ui.js';

const cfg = window.__MM_CONFIG__ || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
const GUEST_KEY = 'mm.support.guest';
const MAX = 2000;

const panel = $('#chatPanel');
const launcher = $('#chatLauncher');
const dot = launcher ? $('.chat-dot', launcher) : null;

let mode = null;            // 'member' | 'guest' | 'start' | 'off'
let backend = null;         // ./backend.js, members only
let rtClient = null;        // supabase-js client used for Realtime
let channel = null;
let chatId = null;
let guest = null;           // { chat_id, token, topic, name }
let messages = [];
let status = 'open';
let isOpen = false;
let started = null;
let lastFocus = null;

// ---------------------------------------------------------------- storage
function readGuest() {
  try { const g = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); return g && g.chat_id && g.token && g.topic ? g : null; } catch { return null; }
}
function saveGuest(g) { try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch { /* private mode: chat lasts for this page */ } }
function clearGuest() { try { localStorage.removeItem(GUEST_KEY); } catch { /* ignore */ } }
const wasSignedIn = () => { try { return localStorage.getItem('mm.auth') === '1'; } catch { return false; } };

// ---------------------------------------------------------------- REST (visitors)
function headers() {
  const h = { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' };
  if (String(cfg.supabaseAnonKey || '').startsWith('eyJ')) h.Authorization = `Bearer ${cfg.supabaseAnonKey}`;
  return h;
}
async function guestRpc(fn, body) {
  let res;
  try {
    res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  } catch { throw new Error('We could not reach M&M. Check your connection and try again.'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error('Chat is not available right now. Please use the contact form.');
  if (data?.success === false) { const e = new Error(data.error || 'Something went wrong.'); e.server = true; throw e; }
  return data;
}

// ---------------------------------------------------------------- start
function start() {
  if (started) return started;
  started = (async () => {
    if (!configured) { mode = 'off'; return; }
    // Signed in (now or last visit): use the account's chat, shared with the app
    if (wasSignedIn()) {
      try {
        backend = await import('./backend.js');
        const s = await new Promise((resolve) => {
          let done = false;
          const off = backend.onSession((sess) => { if (sess.ready && !done) { done = true; resolve(sess); } });
          if (done) off(); else setTimeout(() => { off(); if (!done) { done = true; resolve({ user: null }); } }, 10000);
        });
        if (s.user) { await startMember(); return; }
      } catch (err) { console.warn('M&M chat: account chat unavailable', err?.message); }
    }
    guest = readGuest();
    if (guest) await startGuest();
    else mode = 'start';
  })().catch((err) => { console.error(err); mode = mode || 'start'; });
  return started;
}

async function startMember() {
  const { sb } = backend;
  const { data, error } = await sb.rpc('support_my_chat', { p_source: 'website' });
  if (error || data?.success === false) throw new Error(data?.error || 'Chat could not start');
  chatId = data.chat.id;
  status = data.chat.status;
  mode = 'member';
  rtClient = sb;
  await refreshMember();
  channel = sb.channel(`web-support-${chatId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `chat_id=eq.${chatId}` }, (p) => receive(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_chats', filter: `id=eq.${chatId}` }, (p) => { if (p.new?.status) { status = p.new.status; draw(); } })
    .subscribe((st) => { if (st === 'SUBSCRIBED') refreshMember(); });
}

async function refreshMember() {
  const { data, error } = await backend.sb.from('support_messages')
    .select('id, chat_id, message, sender_role, is_admin_reply, created_at')
    .eq('chat_id', chatId).order('created_at', { ascending: true }).limit(300);
  if (!error) { merge(data || []); draw(); }
  if (isOpen) markRead();
}

async function startGuest() {
  mode = 'guest';
  chatId = guest.chat_id;
  try {
    await refreshGuest();
  } catch (err) {
    if (err.server) { clearGuest(); guest = null; chatId = null; mode = 'start'; return; } // chat no longer exists
    throw err;
  }
  try {
    const { createClient } = await import('/vendor/supabase.js');
    rtClient = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'mm-support-guest' },
    });
    channel = rtClient.channel(`support-guest-${guest.topic}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'message' }, ({ payload }) => receive(payload))
      .subscribe((st) => { if (st === 'SUBSCRIBED') refreshGuest().catch(() => {}); });
  } catch (err) {
    console.warn('M&M chat: live updates unavailable', err?.message);
  }
}

async function refreshGuest() {
  const data = await guestRpc('support_guest_messages', { p_chat_id: guest.chat_id, p_token: guest.token });
  status = data.status;
  merge(data.messages || []);
  draw();
}

// Catch up after the tab was hidden or the network came back (Realtime may have missed messages)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (mode === 'member') refreshMember();
  else if (mode === 'guest') refreshGuest().catch(() => {});
});
window.addEventListener('online', () => {
  if (mode === 'member') refreshMember();
  else if (mode === 'guest') refreshGuest().catch(() => {});
});

// ---------------------------------------------------------------- messages
const isStaff = (m) => m.sender_role === 'admin' || m.sender_role === 'system';
function merge(rows) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const r of rows) if (r && r.id) byId.set(r.id, r);
  messages = [...byId.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
function receive(m) {
  if (!m || !m.id) return;
  const known = messages.some((x) => x.id === m.id);
  merge([m]);
  if (isStaff(m) && m.sender_role === 'admin') status = 'open';
  draw();
  if (!known && isStaff(m)) {
    if (isOpen && document.visibilityState === 'visible') markRead();
    else if (dot) dot.hidden = false;
  }
}
function markRead() {
  if (mode === 'member') backend.sb.rpc('support_mark_read', { p_chat_id: chatId }).then(() => {}, () => {});
}

async function send(body) {
  if (mode === 'member') {
    const { data, error } = await backend.sb.rpc('support_send', {
      p_chat_id: chatId, p_body: body, p_context: { platform: 'website', page: location.pathname },
    });
    if (error) throw new Error('Your message was not sent. Try again.');
    if (data?.success === false) throw new Error(data.error);
    merge([data.message]);
  } else {
    const data = await guestRpc('support_guest_send', { p_chat_id: guest.chat_id, p_token: guest.token, p_body: body });
    merge([data.message]);
  }
  status = 'open';
  draw();
  // the automatic acknowledgement (first message) is not in the reply; fetch it
  setTimeout(() => (mode === 'member' ? refreshMember() : refreshGuest().catch(() => {})), 600);
}

// ---------------------------------------------------------------- UI
const time = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }); };
const day = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }); };

function shell() {
  panel.innerHTML = `
    <div class="chat-head">
      <div class="chat-head-text">
        <h2 class="chat-title" id="chatTitle">M&amp;M support</h2>
        <p class="chat-sub">A person from our team replies here</p>
      </div>
      <button class="icon-btn" type="button" data-chat-close aria-label="Close chat">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="chat-body" data-chat-body role="log" aria-live="polite" aria-label="Conversation"></div>
    <div class="chat-foot" data-chat-foot></div>`;
  $('[data-chat-close]', panel).addEventListener('click', close);
}

function draw() {
  if (!panel || !isOpen) return;
  if (!$('[data-chat-body]', panel)) shell();
  const body = $('[data-chat-body]', panel);
  const foot = $('[data-chat-foot]', panel);

  if (mode === null) {
    body.innerHTML = '<div class="chat-empty"><span class="spinner" aria-hidden="true"></span><span>Connecting</span></div>';
    foot.innerHTML = '';
    return;
  }
  if (mode === 'off') {
    body.innerHTML = '<div class="chat-empty"><p>Live chat is not available right now.</p><a class="btn btn-secondary btn-sm" href="/contact" data-link>Send us a message</a></div>';
    foot.innerHTML = '';
    return;
  }
  if (mode === 'start') { drawStart(body, foot); return; }

  let lastDay = '';
  const rows = messages.map((m) => {
    const d = day(m.created_at);
    const divider = d !== lastDay ? `<p class="chat-day">${esc(d)}</p>` : '';
    lastDay = d;
    const mine = !isStaff(m);
    const who = m.sender_role === 'system' ? 'M&amp;M' : 'M&amp;M support';
    return `${divider}<div class="chat-msg${mine ? ' chat-msg-mine' : ''}">
      ${mine ? '' : `<span class="chat-who">${who}</span>`}
      <div class="chat-bubble"><p>${esc(m.message)}</p><span class="chat-time">${esc(time(m.created_at))}</span></div>
    </div>`;
  }).join('');
  const intro = '<p class="chat-day">Ask us anything about bookings, orders, payments or partnering with M&amp;M.</p>';
  const closedNote = status === 'closed' && messages.length ? '<p class="chat-day">This chat is resolved. Send a message to reopen it.</p>' : '';
  const guestNote = mode === 'guest' ? `<p class="chat-day">Chatting as ${esc(guest.name)}. <button class="chat-link" type="button" data-chat-reset>Start a new chat</button></p>` : '';
  const wasAtBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  body.innerHTML = intro + rows + closedNote + guestNote;
  if (wasAtBottom || !body.dataset.drawn) body.scrollTop = body.scrollHeight;
  body.dataset.drawn = '1';
  $('[data-chat-reset]', body)?.addEventListener('click', resetGuest);

  if (!$('[data-chat-compose]', foot)) {
    foot.innerHTML = `
      <form class="chat-compose" data-chat-compose novalidate>
        <label class="visually-hidden" for="chatInput">Message</label>
        <textarea class="chat-input" id="chatInput" rows="1" maxlength="${MAX}" placeholder="Type your message" autocomplete="off"></textarea>
        <button class="chat-send" type="submit" aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </form>`;
    const form = $('[data-chat-compose]', foot);
    const input = $('#chatInput', foot);
    const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 128)}px`; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      const btn = $('.chat-send', form);
      if (!text || btn.disabled) return;
      btn.disabled = true;
      try {
        await send(text);
        input.value = '';
        grow();
      } catch (err) {
        toast(err.message || 'Your message was not sent. Try again.', 'negative');
      } finally {
        btn.disabled = false;
        input.focus();
      }
    });
  }
}

function drawStart(body, foot) {
  foot.innerHTML = '';
  body.innerHTML = `
    <form class="chat-start" data-chat-start novalidate>
      <p class="t-small t-secondary">Ask us anything about bookings, orders, payments or partnering with M&amp;M. Have an account? <a class="text-link" href="/login?next=${esc(encodeURIComponent(location.pathname))}" data-link>Log in</a> to chat with your order history.</p>
      <div class="field"><label class="label" for="chatName">Name</label><input class="input" id="chatName" name="name" autocomplete="name" required maxlength="80"></div>
      <div class="field"><label class="label" for="chatEmail">Email</label><input class="input" id="chatEmail" name="email" type="email" autocomplete="email" required maxlength="254"><span class="hint">So we can reply if you leave the page.</span></div>
      <div class="field"><label class="label" for="chatFirst">Message</label><textarea class="textarea" id="chatFirst" name="message" required maxlength="${MAX}" rows="3"></textarea></div>
      <p class="hint">We use these details only to answer you, as set out in the <a class="text-link" href="/privacy" data-link>privacy policy</a>.</p>
      <button class="btn btn-primary btn-block" type="submit">Start chat</button>
      <p class="form-status" role="status" aria-live="polite"></p>
    </form>`;
  const form = $('[data-chat-start]', body);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const message = form.message.value.trim();
    for (const el of [form.name, form.email, form.message]) el.removeAttribute('aria-invalid');
    const bad = !name ? form.name : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? form.email : !message ? form.message : null;
    if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.focus(); setStatus(form, 'Fill in your name, a valid email and a message.', 'error'); return; }
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    setStatus(form, 'Starting chat');
    try {
      const r = await guestRpc('support_guest_start', { p_name: name, p_email: email, p_body: message, p_context: { platform: 'website', page: location.pathname } });
      guest = { chat_id: r.chat_id, token: r.token, topic: r.topic, name };
      saveGuest(guest);
      await startGuest();
      draw();
      $('#chatInput', panel)?.focus();
    } catch (err) {
      setStatus(form, err.message, 'error');
      btn.disabled = false;
    }
  });
}

function resetGuest() {
  if (!confirm('Start a new chat? You will not see this conversation here any more.')) return;
  if (channel && rtClient) rtClient.removeChannel(channel);
  channel = null; clearGuest(); guest = null; chatId = null; messages = []; mode = 'start';
  draw();
}

// ---------------------------------------------------------------- open / close
function onKey(e) { if (e.key === 'Escape' && isOpen) close(); }

export async function open() {
  if (!panel) return;
  isOpen = true;
  lastFocus = document.activeElement;
  panel.hidden = false;
  document.documentElement.classList.add('chat-open');
  launcher?.setAttribute('aria-expanded', 'true');
  if (dot) dot.hidden = true;
  document.addEventListener('keydown', onKey);
  // Logged in since the chat form was shown: switch to the account's chat
  if (mode === 'start' && wasSignedIn()) { started = null; mode = null; }
  draw();
  await start();
  draw();
  markRead();
  ($('#chatInput', panel) || $('#chatName', panel) || $('[data-chat-close]', panel))?.focus();
}

export function close() {
  isOpen = false;
  panel.hidden = true;
  document.documentElement.classList.remove('chat-open');
  launcher?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', onKey);
  (lastFocus && document.contains(lastFocus) ? lastFocus : launcher)?.focus();
}

export function toggle() { return isOpen ? close() : open(); }

/** Connects in the background (chat in progress from an earlier visit) so replies show a dot. */
export function resume() { return start(); }

// Links inside the panel (log in, privacy) close it before the router navigates
panel?.addEventListener('click', (e) => { if (e.target.closest('a[data-link]')) close(); });
