// App shell + router. Views live in ./views/*.js and export render functions:
//   export async function render(el, arg, sub) { ... }   (el = the <main> content node)
import { installClock } from './clock.js';
import { $, $$, api, esc, guard, icon, initials, isNative, refreshStats, state, store, toast } from './core.js';

// Three tabs: what you're doing (Today), what everyone is getting done (Feed), and where you
// stand (Leaderboard). The ballot, events and your path all open from Today.
const TABS = [
  ['today', 'today', 'Today'],
  ['feed', 'feed', 'Feed'],
  ['board', 'laurel', 'Leaderboard'],
];
// route name -> [module, tab]
const ROUTES = {
  today: ['today', 'today'],
  ballot: ['ballot', 'today'],
  vote: ['ballot', 'today'],       // module exports renderVote
  endorsements: ['ballot', 'today'], // renderEndorsements
  act: ['today', 'today'],         // renderAct: Today, scrolled to events
  path: ['path', 'today'],
  register: ['me', 'today'],       // renderRegister
  feed: ['feed', 'feed'],
  board: ['board', 'board'],       // #/board, #/board/friends, #/board/groups
  me: ['me', null],
};
const RENDER = { act: 'renderAct', endorsements: 'renderEndorsements', vote: 'renderVote', register: 'renderRegister' };
// Old links from before the three tabs.
const MOVED = { '#/crew': '#/feed', '#/crew/feed': '#/feed', '#/crew/board': '#/board', '#/crew/friends': '#/board/friends', '#/crew/groups': '#/board/groups', '#/leaders': '#/ballot' };

const root = document.getElementById('app');

function shell(active) {
  root.className = 'shell';
  const t = state.today;
  const streak = t?.streak;
  const navLinks = TABS.map(([id, ic, label]) =>
    `<a href="#/${id}" class="${active === id ? 'on' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${id === 'today' && streak?.atRisk ? '<i class="dot" aria-label="Streak at risk"></i>' : ''}</a>`).join('');
  root.innerHTML = `
    <aside class="sidebar">
      <a class="wordmark" href="#/today">${icon('tricorn', 'mark')}Minute Man</a>
      <nav>${navLinks}<a href="#/me" class="${active === null ? 'on' : ''}">${icon('settings')}<span>You</span></a></nav>
      <div class="foot">Your vote is secret. Points can't be traded for anything.</div>
    </aside>
    <div class="col">
      <header class="topbar">
        <a class="wordmark" href="#/today">${icon('tricorn', 'mark')}Minute Man</a>
        <span id="stats"></span>
        <a class="avatar" href="#/me" aria-label="Your profile">${esc(initials(state.me?.name))}</a>
      </header>
      <main id="view" class="content" tabindex="-1"></main>
    </div>
    <nav class="tabbar" aria-label="Main">${navLinks}</nav>`;
  renderStats();
}

function renderStats() {
  const el = $('#stats');
  const t = state.today;
  if (!el || !t) return;
  const s = t.streak;
  el.className = 'row';
  el.innerHTML = `
    <a class="chip-stat flame ${s.activeThisWeek ? '' : 'cold'}" href="#/today" title="${s.weeks}-week streak" aria-label="${s.weeks}-week streak">${icon('flame')}${s.weeks}</a>
    <a class="chip-stat xp" href="#/board" title="Your points" aria-label="${t.points} points">${icon('bolt')}${t.points}</a>`;
}
window.addEventListener('cvas:stats', () => {
  renderStats();
  if (!state.today?.streak?.atRisk) $$('.tabbar .dot, .sidebar .dot').forEach((d) => d.remove());
});
window.addEventListener('cvas:signedout', () => signOut(true));

export function signOut(silent) {
  if (state.token && !silent) api('/logout', { method: 'POST' }).catch(() => {});
  state.token = null; state.me = null; state.today = null;
  store.del('token');
  navigator.serviceWorker?.controller?.postMessage('clear-api');
  root.dataset.tab = '';
  location.hash = '#/welcome';
  route();
}
window.cvasSignOut = signOut;

function renderWelcome() {
  root.dataset.tab = '';
  root.className = 'welcome';
  root.innerHTML = `<main class="content">
    <div class="wordmark">${icon('tricorn', 'mark')}Minute Man</div>
    <h1>Ready at a minute's notice.</h1>
    <p class="muted lede">Your sample ballot, filled in with Minute Man's picks for every race. Then the doors, calls and meetings that win your town, with your neighbors cheering you on.</p>
    <p class="invited" id="invited" hidden></p>
    <div class="seg" role="tablist" style="margin-bottom:12px"><button class="on" data-m="signup" role="tab">Create account</button><button data-m="login" role="tab">Sign in</button></div>
    <form id="auth">
      <div id="nameRow"><label class="field" for="n">Name</label><input id="n" name="name" autocomplete="name" required></div>
      <label class="field" for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" required>
      <label class="field" for="p">Password</label><input id="p" name="password" type="password" minlength="8" autocomplete="new-password" required>
      <button class="btn go block" style="margin-top:20px" type="submit">Create account</button>
    </form>
    <p class="tiny muted" style="margin-top:16px">Want to look around first? Sign in as demo@example.org with the password demo-password.</p>
    <p class="tiny muted">Minute Man is free, open-source software. It isn't run by or affiliated with any party, campaign or candidate.</p>
  </main>`;
  let mode = 'signup';
  // Arrived from someone's invite link (#/join/CODE): remember the code until they sign up.
  const join = location.hash.match(/^#\/join\/([A-Za-z0-9]{4,12})/);
  if (join) store.set('ref', join[1].toUpperCase());
  const ref = store.get('ref');
  if (ref) api(`/invite/${ref}`).then((r) => {
    $('#invited').textContent = `${r.name} invited you. Create an account to join their crew.`;
    $('#invited').hidden = false;
  }).catch(() => store.set('ref', null));
  $$('.seg button').forEach((b) => (b.onclick = () => {
    mode = b.dataset.m;
    $$('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    $('#nameRow').hidden = mode === 'login';
    $('#n').required = mode === 'signup';
    $('#p').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth button').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  }));
  $('#auth').onsubmit = guard(async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (mode === 'signup' && store.get('ref')) fd.ref = store.get('ref');
    const r = await api(mode === 'login' ? '/login' : '/signup', { method: 'POST', body: fd });
    store.set('ref', null);
    state.token = r.token; state.me = r.user;
    store.set('token', r.token);
    location.hash = '#/today';
    route();
  });
}

const modules = {};
async function load(name) {
  return (modules[name] ||= await import(`./views/${name}.js`));
}

let routing = 0;
async function route() {
  const ticket = ++routing;
  const [, name = 'today', arg, sub] = location.hash.split('/');
  if (MOVED[location.hash]) { location.replace(MOVED[location.hash]); return; }
  if (!state.token) return renderWelcome();
  try {
    if (!state.me) [state.me, state.meta, state.leaders] = await Promise.all([api('/me'), api('/meta'), api('/sources')]);
  } catch (e) {
    if (!state.token) return;
    root.className = 'welcome';
    root.innerHTML = `<main class="content"><div class="empty"><h2>Can't reach Minute Man</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></main>`;
    return;
  }
  const [mod, tab] = ROUTES[name] || ROUTES.today;
  if (!$('#view') || root.dataset.tab !== String(tab)) { shell(tab); root.dataset.tab = String(tab); }
  if (!state.today) refreshStats();
  const view = $('#view');
  view.innerHTML = '<div class="skeleton"></div>';
  window.scrollTo(0, 0);
  try {
    const m = await load(mod);
    if (ticket !== routing) return;
    await m[RENDER[name] || 'render'](view, arg && decodeURIComponent(arg), sub && decodeURIComponent(sub));
  } catch (e) {
    console.error(e);
    if (ticket === routing) view.innerHTML = `<div class="empty"><h2>That didn't load</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
}

// Match the server's clock (the showcase runs as if today were Oct 1, 2026).
async function boot() {
  try { installClock({ date: (await api('/clock')).date }); } catch { installClock({ date: '2026-10-01' }); }
  addEventListener('hashchange', route);
  route();
}
boot();
// Android back: close whatever is on top (a sheet or celebration), then go to the previous
// screen, then Today. Only leave the app from Today, and then just send it to the background.
const NativeApp = window.Capacitor?.Plugins?.App;
NativeApp?.addListener?.('backButton', ({ canGoBack }) => {
  const overlays = $$('.celebrate, .sheet-backdrop');
  const top = overlays[overlays.length - 1];
  if (top) {
    if (top.classList.contains('celebrate')) $('button', top)?.click();
    else top.click();
    return;
  }
  const here = location.hash.replace(/^#\/?/, '');
  const home = !here || here === 'today' || here === 'welcome';
  if (!home && canGoBack) history.back();
  else if (!home) location.hash = '#/today';
  else NativeApp.minimizeApp();
});
if ('serviceWorker' in navigator && !isNative) navigator.serviceWorker.register('/sw.js').catch(() => {});
export { route, toast };
