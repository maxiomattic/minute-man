// App shell + router. Views live in ./views/*.js and export render functions:
//   export async function render(el, arg, sub) { ... }   (el = the <main> content node)
import { installClock } from './clock.js';
import { $, $$, api, esc, guard, icon, initials, isNative, refreshStats, state, store, toast } from './core.js';

const TABS = [
  ['today', 'today', 'Today'],
  ['ballot', 'ballot', 'Ballot'],
  ['act', 'act', 'Act'],
  ['crew', 'crew', 'Crew'],
];
// route name -> [module, tab]
const ROUTES = {
  today: ['today', 'today'],
  ballot: ['ballot', 'ballot'],
  vote: ['ballot', 'ballot'],      // module exports renderVote
  endorsements: ['ballot', 'ballot'], // renderEndorsements
  act: ['act', 'act'],
  crew: ['crew', 'crew'],
  me: ['me', null],
  leaders: ['me', null],           // renderLeaders
  register: ['me', null],          // renderRegister
  lead: ['me', null],              // renderLead
};
const RENDER = { endorsements: 'renderEndorsements', vote: 'renderVote', leaders: 'renderLeaders', register: 'renderRegister', lead: 'renderLead' };

const root = document.getElementById('app');

function applyTheme() {
  let color = null;
  if (state.me?.theme?.startsWith('leader:')) color = state.leaders.find((l) => l.id === Number(state.me.theme.slice(7)))?.brandColor;
  document.documentElement.style.setProperty('--brand', color || '#1c3f74');
  $('meta[name=theme-color]').content = color || '#1c3f74';
}

function shell(active) {
  root.className = 'shell';
  const t = state.today;
  const streak = t?.streak;
  const navLinks = TABS.map(([id, ic, label]) =>
    `<a href="#/${id}" class="${active === id ? 'on' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${id === 'today' && streak?.atRisk ? '<i class="dot" aria-label="Streak at risk"></i>' : ''}</a>`).join('');
  root.innerHTML = `
    <aside class="sidebar">
      <a class="wordmark" href="#/today"><span class="oval"></span>CVAS</a>
      <nav>${navLinks}<a href="#/me" class="${active === null ? 'on' : ''}">${icon('settings')}<span>You</span></a></nav>
      <div class="foot">Your vote is secret. Points can't be traded for anything.</div>
    </aside>
    <div class="col">
      <header class="topbar">
        <a class="wordmark" href="#/today"><span class="oval"></span>CVAS</a>
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
    <a class="chip-stat xp" href="#/crew/board" title="Your points" aria-label="${t.points} points">${icon('bolt')}${t.points}</a>`;
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
    <div class="wordmark"><span class="oval"></span>CVAS</div>
    <h1>Vote America First.<br>Every race.</h1>
    <p class="muted lede">Your sample ballot, filled in from America First Insight's endorsements, with President Trump's as the fallback where they haven't picked. Plus the doors, calls and rides that win Texas.</p>
    <div class="seg" role="tablist" style="margin-bottom:12px"><button class="on" data-m="signup" role="tab">Create account</button><button data-m="login" role="tab">Sign in</button></div>
    <form id="auth">
      <div id="nameRow"><label class="field" for="n">Name</label><input id="n" name="name" autocomplete="name" required></div>
      <label class="field" for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" required>
      <label class="field" for="p">Password</label><input id="p" name="password" type="password" minlength="8" autocomplete="new-password" required>
      <button class="btn go block" style="margin-top:20px" type="submit">Create account</button>
    </form>
    <p class="tiny muted" style="margin-top:16px">Want to look around first? Sign in as demo@example.org with the password demo-password.</p>
  </main>`;
  let mode = 'signup';
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
    const r = await api(mode === 'login' ? '/login' : '/signup', { method: 'POST', body: fd });
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
  if (!state.token) return renderWelcome();
  try {
    if (!state.me) [state.me, state.meta, state.leaders] = await Promise.all([api('/me'), api('/meta'), api('/leaders')]);
  } catch (e) {
    if (!state.token) return;
    root.className = 'welcome';
    root.innerHTML = `<main class="content"><div class="empty"><h2>Can't reach CVAS</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></main>`;
    return;
  }
  applyTheme();
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
if ('serviceWorker' in navigator && !isNative) navigator.serviceWorker.register('/sw.js').catch(() => {});
export { route, toast };
