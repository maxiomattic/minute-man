// Shared client core: API, state, helpers, icons, feedback (toast, XP fly, celebrations, haptics),
// bottom sheet. Every view module imports from here. No build step: plain ES modules.

export const isNative = !!window.Capacitor?.isNativePlatform?.();
export const API_BASE = isNative ? 'https://cvas.careride.workers.dev' : '';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/** Mutable app state shared by all views. */
export const state = { token: store.get('token'), me: null, meta: null, leaders: [], today: null };

export async function api(path, opts = {}) {
  let r;
  try {
    r = await fetch(API_BASE + '/api' + path, {
      method: opts.method || 'GET',
      headers: { 'content-type': 'application/json', ...(state.token ? { authorization: 'Bearer ' + state.token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error("You're offline. Showing what's saved on this device.");
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !['/login', '/signup'].includes(path)) {
    window.dispatchEvent(new CustomEvent('cvas:signedout'));
    throw new Error('Sign in again to continue.');
  }
  if (!r.ok) throw new Error(data.error ? data.error[0].toUpperCase() + data.error.slice(1) + '.' : 'Something went wrong. Try again.');
  return data;
}

/** Wrap an async handler so errors become a toast. */
export const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ---------- formatting ----------
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const fmtDate = (d) => new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtWhen = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const daysTo = (d) => Math.round((new Date(d + 'T12:00:00') - new Date(todayIso() + 'T12:00:00')) / 86400000);
export const ago = (ts) => {
  const s = (Date.now() - new Date(ts.replace(' ', 'T') + 'Z')) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};
export const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
/** Collapsed "tell me more" section, so screens lead with the action and keep detail one tap away. */
export const more = (label, html, cls = '') => `<details class="more ${cls}"><summary>${label}</summary><div class="more-body">${html}</div></details>`;
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- icons (24px stroke set) ----------
const P = {
  today: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5" fill="currentColor"/>',
  ballot: '<rect x="4" y="3" width="16" height="18" rx="2"/><ellipse cx="8.5" cy="8.5" rx="2" ry="1.3" fill="currentColor"/><ellipse cx="8.5" cy="14" rx="2" ry="1.3"/><path d="M12.5 8.5h4M12.5 14h4"/>',
  act: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  crew: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.8-3.3 3.2-5 6-5s5.2 1.7 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14c2.4.2 4 1.7 4.5 4.5"/>',
  flame: '<path d="M12 21c4 0 7-2.7 7-6.6 0-3.4-2.3-5.6-3.8-7.4-.4 1.8-1.4 3-2.7 3.4.4-3.4-1.2-6.4-4-8.4-.2 3.3-1.9 5.4-3.4 7.3C4 10.8 5 13 5 14.4 5 18.3 8 21 12 21z" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>',
  clap: '<path d="M8 13 5.5 10.5a1.5 1.5 0 0 1 2.1-2.1L11 11.8"/><path d="m9 9.5-2-2a1.5 1.5 0 0 1 2.1-2.1l4 4"/><path d="m12 7.5-.8-.8a1.5 1.5 0 0 1 2.1-2.1l4.4 4.4c2.3 2.3 2.3 6 0 8.3s-6 2.3-8.3 0L6 13.9a1.5 1.5 0 0 1 2.1-2.1"/><path d="M19 3.5 20 2M21.5 6l1.5-.5M17 2.5l.3-1.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  door: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16"/><circle cx="14.5" cy="12.5" r=".8" fill="currentColor"/>',
  phone: '<path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  hall: '<path d="M3 20h18M5 20v-9M9.5 20v-9M14.5 20v-9M19 20v-9M3 11h18L12 4z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6.5 7S5 18.5 4 15l-1-3a1.5 1.5 0 0 1 2.8-1L8 14"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor" stroke="none"/>',
  gift: '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M2.5 9h19v-1a1 1 0 0 0-1-1h-17a1 1 0 0 0-1 1zM12 7v13M12 7C10.5 3.5 7 3.5 7 5.5S10 7 12 7zm0 0c1.5-3.5 5-3.5 5-1.5S14 7 12 7z"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  // A broadside: the printed sheet nailed up in the town square.
  feed: '<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 10.5h6M9 14h6M9 17.5h3.5"/>',
  // Laurel and a star: honors.
  laurel: '<path d="M12 21c-4.5-1.5-7.5-5.5-7.5-10.5M12 21c4.5-1.5 7.5-5.5 7.5-10.5"/><path d="M5 14.5c1.8.2 3 1.2 3.5 2.6M4.3 10.8c1.7-.1 3 .7 3.8 2M19 14.5c-1.8.2-3 1.2-3.5 2.6M19.7 10.8c-1.7-.1-3 .7-3.8 2"/><path d="m12 4 1.4 2.9 3.1.4-2.3 2.2.6 3.1L12 11.1l-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z" fill="currentColor" stroke="none"/>',
  book: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
};
/** The Minute Man logo: a militiaman in a tricorn (with cockade) and a musket, on the navy tile.
 *  Same drawing as public/icon.svg (scripts/icons.sh builds the app icons from that file). */
export const logo = (cls = '') =>
  `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1a2848"/><g><path fill="#c8962f" stroke="#1a2848" stroke-width="1.4" stroke-linejoin="round" d="M57.7 8L58.4 8.2L58.1 16.1L59.8 16.5L51.5 57L47.3 56L55.8 15.6L57.1 15.8Z"/><path fill="#c8962f" d="M9.5 62.6C10 53 15 48.5 24 46.5L32 51.5L40 46.5C49 48.5 54 53 54.5 62.6A14 14 0 0 1 50 64H14A14 14 0 0 1 9.5 62.6Z"/><path fill="#1a2848" d="M24 46.5L32 59.5L40 46.5L37 45.5L32 53.5L27 45.5Z"/><path fill="#eee6d2" d="M28 41h8v5l-4 5.5-4-5.5z"/><path fill="#c8962f" d="M21.5 27.5C21 33.5 22 38 24.5 41L27 37L26 28.5ZM42.5 27.5C43 33.5 42 38 39.5 41L37 37L38 28.5Z"/><circle cx="32" cy="33.5" r="9.5" fill="#eee6d2"/><path fill="#c8962f" stroke="#1a2848" stroke-width="1.6" stroke-linejoin="round" d="M8 11C12.5 14 17 15.5 21 15.2C22.5 11 26.5 8.5 32 8.5C37.5 8.5 41.5 11 43 15.2C47 15.5 51.5 14 56 11C55.5 18.5 52 23.5 46 26.5C40.5 28.5 35.5 29.5 32 32C28.5 29.5 23.5 28.5 18 26.5C12 23.5 8.5 18.5 8 11Z"/><path fill="none" stroke="#1a2848" stroke-width="1.6" stroke-linecap="round" d="M21 15.6C24.5 17 28 17.6 32 17.6C36 17.6 39.5 17 43 15.6"/><circle cx="16" cy="19.8" r="2.6" fill="#eee6d2"/></g></svg>`;
export const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.star}</svg>`;
/** The Ladder's ranks in order (mirrors src/engine/ladder.js), for the insignia below. */
export const RANKS = ['Private', 'Corporal', 'Sergeant', 'Ensign', 'Lieutenant', 'Captain', 'Major', 'Colonel'];
const chev = (y) => `M5 ${y + 4.5}l7-4.5 7 4.5`;
const lozenge = (x, y, r) => `<path d="M${x} ${y - r}l${r} ${r}-${r} ${r}-${r}-${r}z" fill="currentColor" stroke-width="1.2"/>`;
const INSIGNIA = [
  `<path d="${chev(9.5)}"/>`,
  `<path d="${chev(6.5)}${chev(12.5)}"/>`,
  `<path d="${chev(4)}${chev(9.5)}${chev(15)}"/>`,
  lozenge(12, 12, 6.5),
  lozenge(6.5, 12, 5) + lozenge(17.5, 12, 5),
  lozenge(12, 6.5, 4.6) + lozenge(6.5, 16.5, 4.6) + lozenge(17.5, 16.5, 4.6),
  P.star,
  P.laurel,
];
/** Rank insignia: chevrons for enlisted ranks, lozenges for company officers, a star and laurel for field officers. */
export const insignia = (rank, cls = 'insignia') => {
  const i = typeof rank === 'number' ? rank - 1 : RANKS.indexOf(rank);
  return INSIGNIA[i] ? `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${INSIGNIA[i]}</svg>` : '';
};
export const ACTIVITY_ICON = { council_meeting: 'hall', party_meeting: 'hand', volunteer: 'hand', gotv: 'megaphone', canvass: 'door', phonebank: 'phone', social: 'chat', election_work: 'check', voted: 'ballot', planned: 'calendar', registered: 'check', rank: 'laurel', learn: 'book' };

// ---------- feedback ----------
export function haptic(kind = 'light') {
  const H = window.Capacitor?.Plugins?.Haptics;
  if (H) { (kind === 'success' ? H.notification({ type: 'SUCCESS' }) : H.impact({ style: kind === 'heavy' ? 'HEAVY' : 'LIGHT' })).catch?.(() => {}); }
  else navigator.vibrate?.(kind === 'success' ? [12, 40, 18] : 10);
}

export function toast(msg) {
  $$('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2800);
}

/** "+15 XP" that floats up from an element (or screen center). */
export function xpFly(amount, fromEl) {
  if (!amount) return;
  const r = fromEl?.getBoundingClientRect?.() || { left: innerWidth / 2 - 30, top: innerHeight / 2, width: 60 };
  const el = document.createElement('div');
  el.className = 'xp-fly';
  el.innerHTML = `<span class="xp" style="font-size:20px;height:32px;padding:0 12px">+${amount} XP</span>`;
  el.style.left = `${r.left + r.width / 2 - 40}px`;
  el.style.top = `${r.top - 10}px`;
  document.body.append(el);
  setTimeout(() => el.remove(), 1200);
  haptic('success');
}

export function confetti(n = 36) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['var(--marker)', 'var(--brand)', 'var(--flame)', '#ffffff'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.animationDuration = 1.2 + Math.random() * 0.9 + 's';
    box.append(c);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 2600);
}

/** Full-screen moment for big wins (level up, voted). Resolves when dismissed. */
export function celebrate({ big, title, body, cta = 'Keep going' }) {
  return new Promise((done) => {
    const el = document.createElement('div');
    el.className = 'celebrate';
    el.setAttribute('role', 'dialog');
    el.innerHTML = `<div style="max-width:420px">
      <div class="ring"><span class="big" style="font-size:${String(big).length > 4 ? 44 : 64}px">${esc(big)}</span></div>
      <h1 style="color:inherit">${esc(title)}</h1>
      <p style="opacity:.9;margin-bottom:28px">${esc(body || '')}</p>
      <button class="btn go block">${esc(cta)}</button></div>`;
    document.body.append(el);
    confetti();
    haptic('success');
    const b = $('button', el);
    b.focus();
    b.onclick = () => { el.remove(); done(); };
  });
}

/** Bottom sheet (centered dialog on desktop). Returns {el, close}. */
export function sheet(html, { onClose } = {}) {
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" tabindex="-1" style="outline:none"><div class="grab"></div>${html}</div>`;
  const close = () => { bd.remove(); removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
  addEventListener('keydown', onKey);
  document.body.append(bd);
  // Focus the dialog itself (not its close button) so keyboard users start inside it without a stray focus ring.
  $('.sheet', bd).focus({ preventScroll: true });
  return { el: $('.sheet', bd), close };
}

/**
 * Track level-ups across sessions: call with the latest rank from /api/today or /api/recognition.
 * Shows the celebration when the level went up since last seen.
 */
export async function checkLevelUp(rank) {
  if (!state.me || !rank) return;
  const key = `level:${state.me.id}`;
  const last = store.get(key);
  store.set(key, rank.level);
  if (last != null && rank.level > last) {
    await celebrate({ big: `Level ${rank.level}`, title: `You're ${/^[aeiou]/i.test(rank.name) ? 'an' : 'a'} ${rank.name} now`, body: `${rank.duty ? `${rank.duty}. ` : ''}${rank.nextName ? `Next up: ${rank.nextName}.` : 'Top rank. Thank you.'}` });
  }
}

/** Refresh the header chips (streak, XP) from /api/today. Views can call after earning points. */
export async function refreshStats() {
  try {
    state.today = await api('/today');
    window.dispatchEvent(new CustomEvent('cvas:stats'));
    await checkLevelUp(state.today.rank);
  } catch {}
  return state.today;
}
