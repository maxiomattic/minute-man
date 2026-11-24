// CVAS client. Vanilla JS, hash routing, no build step.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const view = $('#view');

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let token = store.get('token');
let me = null;
let meta = null;
let leaders = [];

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { logout(true); throw new Error('Please sign in again.'); }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}
const tryDo = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

const fmtDate = (d) => new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const daysTo = (d) => Math.round((new Date(d + 'T12:00:00') - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00')) / 86400000);
const KIND_ICON = { council_meeting: '🏛️', party_meeting: '🗳️', volunteer: '🙋', gotv: '📣', canvass: '🚪', phonebank: '📞', social: '💬' };
const BADGE_ICON = { registered: '✅', voted: '🗳️', primary: '🎯', local: '🏘️', streak3: '🔁', streak10: '🏅', reminder: '🔔', council: '🏛️', party: '🤝', doors100: '🚪', doors1000: '👟', calls100: '📞', shifts5: '⏱️', endorser: '📢', win: '🏆' };

// ---------- theme ----------
function applyTheme() {
  const root = document.documentElement;
  let color = '#1f5f8b';
  let sub = 'Neutral mode';
  if (me?.theme?.startsWith('leader:')) {
    const l = leaders.find((x) => x.id === Number(me.theme.slice(7)));
    if (l) { color = l.brandColor || color; sub = l.name; }
  }
  root.style.setProperty('--brand', color);
  $('meta[name=theme-color]').content = color;
  $('#top').innerHTML = `<div class="grow"><h1>CVAS</h1><div class="sub">${esc(sub)}</div></div>
    ${navigator.onLine ? '' : '<span class="offline">Offline</span>'}`;
}
addEventListener('online', applyTheme);
addEventListener('offline', applyTheme);

// ---------- nav ----------
const TABS = [
  ['home', '🏠', 'Home'], ['ballot', '🗳️', 'Ballot'], ['act', '✊', 'Act'], ['social', '👥', 'Social'], ['me', '⚙️', 'Me'],
];
function renderNav(active) {
  const nav = $('#nav');
  nav.hidden = !me;
  nav.innerHTML = TABS.map(([id, ic, label]) =>
    `<a href="#/${id}" class="${active === id ? 'on' : ''}"><span class="ic">${ic}</span>${label}</a>`).join('');
}

// ---------- auth ----------
function logout(silent) {
  if (token && !silent) api('/logout', { method: 'POST' }).catch(() => {});
  token = null; me = null;
  store.del('token');
  navigator.serviceWorker?.controller?.postMessage('clear-api');
  location.hash = '#/login';
  route();
}

function viewLogin() {
  view.innerHTML = `<div class="auth">
    <h2>Vote with confidence. Show up in between.</h2>
    <p class="muted">Follow the leaders you trust, get a sample ballot built from their picks, and track the civic work you do all year.</p>
    <div class="card">
      <div class="tabs"><button id="tLogin">Sign in</button><button class="ghost" id="tSignup">Create account</button></div>
      <form id="f" class="stack">
        <div id="nameWrap" hidden><label>Name</label><input name="name" autocomplete="name"></div>
        <label>Email</label><input name="email" type="email" autocomplete="email" required>
        <label>Password</label><input name="password" type="password" minlength="8" autocomplete="current-password" required>
        <button type="submit" style="width:100%;margin-top:14px">Sign in</button>
      </form>
      <p class="small muted">Demo account: demo@example.org / demo-password</p>
    </div></div>`;
  let mode = 'login';
  const set = (m) => {
    mode = m;
    $('#nameWrap').hidden = m === 'login';
    $('#tLogin').className = m === 'login' ? '' : 'ghost';
    $('#tSignup').className = m === 'signup' ? '' : 'ghost';
    $('#f button').textContent = m === 'login' ? 'Sign in' : 'Create account';
  };
  $('#tLogin').onclick = () => set('login');
  $('#tSignup').onclick = () => set('signup');
  $('#f').onsubmit = tryDo(async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const r = await api(mode === 'login' ? '/login' : '/signup', { method: 'POST', body: fd });
    token = r.token; store.set('token', token); me = r.user;
    location.hash = mode === 'signup' ? '#/me' : '#/home';
    if (mode === 'signup') toast('Welcome! Set your home area and pick who to follow.');
  });
}

// ---------- home ----------
async function viewHome() {
  const [notes, els, rec, parts] = await Promise.all([
    api('/notifications'), api('/elections'), api('/recognition'), api('/participation'),
  ]);
  const next = els[0];
  const r = rec.rank;
  const pct = r.nextAt ? Math.min(100, Math.round((rec.points / r.nextAt) * 100)) : 100;
  const voted = next && parts.some((p) => p.electionId === next.id && p.kind === 'voted');
  const dormant = !next || daysTo(next.date) > 30;
  view.innerHTML = `
    <div class="card hero">
      <div class="row between"><div><div class="small muted">Level ${r.level}</div><h2 style="margin:0">${esc(r.name)}</h2></div>
        <div style="text-align:right"><div style="font-size:28px;font-weight:800">${rec.points}</div><div class="small muted">points</div></div></div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="small muted" style="margin-top:6px">${r.nextAt ? `${r.nextAt - rec.points} to ${esc(r.nextName)}` : 'Top rank reached'}</div>
    </div>
    ${next ? `<div class="card">
      <div class="row between"><h3>${esc(next.name)}</h3><span class="chip ${daysTo(next.date) <= 3 ? 'warn' : 'brand'}">${daysTo(next.date) === 0 ? 'Today' : `${daysTo(next.date)} days`}</span></div>
      <div class="muted small">${fmtDate(next.date)} · ${esc(next.kind)}</div>
      <div class="row wrap" style="margin-top:10px">
        <a class="btn" href="#/ballot/${esc(next.id)}">Sample ballot</a>
        <a class="btn ghost" href="#/vote/${esc(next.id)}">${voted ? 'Voted ✓' : 'Voting guide'}</a>
      </div></div>` : `<div class="card"><h3>No upcoming elections</h3><p class="muted small">${me.jurisdictionId ? 'We will alert you when one is scheduled.' : 'Set your home area under Me to find your elections.'}</p></div>`}
    ${dormant ? '<p class="small muted">Quiet season. Keep showing up: council meetings and local party meetings count.</p>' : ''}
    ${notes.map((n) => `<div class="card notice ${n.urgent ? 'urgent' : ''}"><div class="row between"><span>${esc(n.text)}</span>
      ${n.kind === 'deadline' ? '<a class="small" href="#/register">Open</a>' : n.electionId ? `<a class="small" href="#/ballot/${esc(n.electionId)}">Open</a>` : n.kind === 'friend' || n.kind === 'nudge' ? '<a class="small" href="#/social/friends">Open</a>' : n.kind === 'actions' ? '<a class="small" href="#/act">Open</a>' : n.kind === 'registration' ? '<a class="small" href="#/register">Open</a>' : ''}
    </div></div>`).join('')}
    <div class="card"><h3>Badges</h3>${badgesHtml(rec.badges)}</div>`;
}

const badgesHtml = (badges) => badges.length
  ? `<div class="badges">${badges.map((b) => `<div class="badge" title="${esc(b.desc)}"><div class="medal">${BADGE_ICON[b.id] || '★'}</div>${esc(b.label)}</div>`).join('')}</div>`
  : '<p class="muted small">Register, vote, or show up to a meeting to earn your first badge.</p>';

// ---------- ballot ----------
const ovKey = (eid) => `ovr:${me.id}:${eid}`;
const logKey = () => `ovrlog:${me.id}`;
const ballotKey = (eid) => `ballot:${me.id}:${eid}`;

async function loadBallot(eid) {
  try {
    const b = await api(`/elections/${encodeURIComponent(eid)}/ballot`);
    store.set(ballotKey(eid), b);
    return b;
  } catch (e) {
    const cached = store.get(ballotKey(eid));
    if (cached) { toast('Offline: showing your saved ballot'); return cached; }
    throw e;
  }
}

async function viewBallot(eid) {
  if (!eid) {
    const els = await api('/elections');
    if (!els.length) { view.innerHTML = '<h2>Sample ballot</h2><p class="muted">No upcoming elections in your area.</p>'; return; }
    if (els.length === 1) return viewBallot(els[0].id);
    view.innerHTML = `<h2>Upcoming elections</h2>${els.map((e) => `<a class="card row between" style="text-decoration:none;color:inherit" href="#/ballot/${esc(e.id)}">
      <div><h3>${esc(e.name)}</h3><div class="small muted">${fmtDate(e.date)} · ${esc(e.kind)}</div></div><span>›</span></a>`).join('')}`;
    return;
  }
  const b = await loadBallot(eid);
  const ov = store.get(ovKey(eid), {});
  const leaderName = (id) => leaders.find((l) => l.id === id)?.name || 'your leaders';
  const selected = (c) => ov[c.id] ?? c.recommendation.choiceIds;
  const changed = Object.keys(ov).length;

  view.innerHTML = `
    <h2>${esc(b.election.name)}</h2>
    <p class="muted small">${fmtDate(b.election.date)} · built from your followed leaders (${esc(b.strategy)} rule). Your changes stay on this device only.</p>
    <div class="row wrap noprint" style="margin-bottom:12px">
      <a class="btn" href="#/vote/${esc(eid)}">Election-day guide</a>
      <button class="ghost" id="print">Print / save</button>
      ${changed ? `<button class="ghost" id="reset">Reset ${changed} change${changed > 1 ? 's' : ''}</button>` : ''}
    </div>
    ${b.contests.map((c) => {
      const sel = selected(c);
      const rec = c.recommendation;
      const isOv = c.id in ov;
      return `<div class="card" data-c="${esc(c.id)}" data-max="${c.voteFor}">
        <div class="row between"><h3>${esc(c.title)}</h3>
          ${isOv ? '<span class="chip warn">Your choice</span>' : rec.choiceIds.length ? `<span class="chip brand">${esc(leaderName(rec.sourceLeaderId))}</span>` : '<span class="chip">No recommendation</span>'}</div>
        ${c.description ? `<p class="small muted">${esc(c.description)}</p>` : ''}
        ${c.voteFor > 1 ? `<div class="small muted">Vote for up to ${c.voteFor}</div>` : ''}
        ${c.choices.map((ch) => `<label class="choice ${sel.includes(ch.id) ? 'on' : ''}">
          <input type="${c.voteFor > 1 ? 'checkbox' : 'radio'}" name="${esc(c.id)}" value="${esc(ch.id)}" ${sel.includes(ch.id) ? 'checked' : ''}>
          <span>${esc(ch.label)}${ch.party ? ` <span class="muted small">(${esc(ch.party)})</span>` : ''}</span>
          ${rec.choiceIds.includes(ch.id) ? '<span class="tag chip">recommended</span>' : ''}
        </label>`).join('')}
        ${c.notes.map((n) => `<p class="small" style="margin:8px 0 0"><b>${esc(n.leaderName)}:</b> ${esc(n.note)}</p>`).join('')}
        ${rec.conflicts.length ? `<p class="small" style="margin:8px 0 0;color:var(--warn)">⚠ Your leaders disagree: ${rec.conflicts.map((x) => `${esc(x.leaderName)} picks ${esc(x.choiceIds.map((id) => c.choices.find((ch) => ch.id === id)?.label).join(', '))}`).join('; ')}</p>` : ''}
        ${isOv ? '<button class="ghost small noprint undo" style="margin-top:8px">Use recommendation</button>' : ''}
      </div>`;
    }).join('')}
    <p class="legal">Sample ballots are guidance only. Your vote is secret: CVAS never asks for, stores, or rewards how you voted.</p>`;

  $('#print').onclick = () => print();
  if ($('#reset')) $('#reset').onclick = () => { store.del(ovKey(eid)); viewBallot(eid); };
  $$('[data-c]').forEach((card) => {
    const cid = card.dataset.c;
    const max = Number(card.dataset.max);
    const contest = b.contests.find((c) => c.id === cid);
    card.addEventListener('change', (e) => {
      let picks = $$('input:checked', card).map((i) => i.value);
      if (picks.length > max) { e.target.checked = false; toast(`Vote for up to ${max}`); return; }
      const same = JSON.stringify([...picks].sort()) === JSON.stringify([...contest.recommendation.choiceIds].sort());
      const o = store.get(ovKey(eid), {});
      if (same) delete o[cid]; else o[cid] = picks;
      store.set(ovKey(eid), o);
      const log = store.get(logKey(), []);
      log.unshift({ at: new Date().toISOString(), election: b.election.name, contest: contest.title, picks: picks.map((id) => contest.choices.find((c) => c.id === id)?.label) });
      store.set(logKey(), log.slice(0, 200));
      viewBallot(eid);
    });
    const u = $('.undo', card);
    if (u) u.onclick = () => { const o = store.get(ovKey(eid), {}); delete o[cid]; store.set(ovKey(eid), o); viewBallot(eid); };
  });
}

// ---------- election-day guide ----------
async function viewVote(eid) {
  const b = await loadBallot(eid);
  let places = store.get(`places:${me.id}`, []);
  try { places = await api('/polling'); store.set(`places:${me.id}`, places); } catch {}
  const parts = await api('/participation').catch(() => []);
  const voted = parts.some((p) => p.electionId === eid && p.kind === 'voted');
  const planned = parts.some((p) => p.electionId === eid && p.kind === 'planned');
  const ov = store.get(ovKey(eid), {});
  const rules = b.rules || {};
  const card = (c) => {
    const sel = ov[c.id] ?? c.recommendation.choiceIds;
    return `<li><b>${esc(c.title)}:</b> ${sel.length ? esc(sel.map((id) => c.choices.find((x) => x.id === id)?.label).join(', ')) : '<span class="muted">your call</span>'}</li>`;
  };
  view.innerHTML = `
    <h2>Voting guide</h2>
    <p class="muted small">${esc(b.election.name)} · ${fmtDate(b.election.date)}. This page works offline once loaded.</p>
    <div class="card"><h3>Your cheat sheet</h3><ul style="margin:0;padding-left:18px">${b.contests.map(card).join('')}</ul>
      <p class="small muted">Paper notes are allowed in the booth in most places. Phones may not be.</p></div>
    <div class="card"><h3>Steps</h3><ol class="steps">
      <li>Check your registration${rules.statusLookupUrl ? ` (<a href="${esc(rules.statusLookupUrl)}" target="_blank" rel="noopener">look it up</a>)` : ''}.</li>
      ${rules.idRequired && rules.idRequired !== 'none' ? `<li>${esc(rules.idNote || 'Bring an accepted ID.')}</li>` : ''}
      <li>Go to your polling place or drop box (below). Early voting opens ${b.election.early_voting_start ? fmtDate(b.election.early_voting_start) : 'per county schedule'}.</li>
      <li>Sign in with the poll worker and get your ballot.</li>
      <li>Fill it in using your cheat sheet. Ask a poll worker if anything doesn't match.</li>
      <li>Cast it in the scanner or drop box. Keep your receipt stub if offered.</li>
      ${rules.ballotPhotoAllowed === false ? '<li class="small">Don\'t photograph your marked ballot. It\'s not allowed here.</li>' : ''}
    </ol></div>
    <div class="card"><div class="row between"><h3>Where to vote</h3><button class="ghost small" id="near">Sort by distance</button></div>
      <div id="places">${placesHtml(places)}</div></div>
    <div class="card">
      ${voted ? '<h3>✓ You voted. Thank you!</h3><p class="small muted">Now help a friend get there.</p><a class="btn ghost" href="#/social/friends">Remind friends</a>'
        : `<div class="row wrap">${planned ? '<span class="chip good">Plan made</span>' : '<button class="ghost" id="plan">I have a plan to vote</button>'}
          <button id="voted">I voted</button></div>
          <p class="legal">Just tell us that you voted, not who you voted for. Points have no cash value and can't be exchanged for anything.</p>`}
    </div>`;
  $('#near').onclick = () => navigator.geolocation?.getCurrentPosition(
    tryDo(async (pos) => { const p = await api(`/polling?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`); $('#places').innerHTML = placesHtml(p); }),
    () => toast('Location unavailable'));
  if ($('#plan')) $('#plan').onclick = tryDo(async () => { await api('/participation', { method: 'POST', body: { electionId: eid, kind: 'planned' } }); toast('+10 points'); viewVote(eid); });
  if ($('#voted')) $('#voted').onclick = tryDo(async () => { await api('/participation', { method: 'POST', body: { electionId: eid, kind: 'voted' } }); toast('+100 points. Nice work!'); viewVote(eid); });
}

const placesHtml = (ps) => ps.length ? ps.map((p) => `<div style="padding:8px 0;border-top:1px solid var(--line)">
  <div class="row between"><b>${esc(p.name)}</b><span class="chip">${esc({ polling: 'Polling place', dropbox: 'Drop box', early: 'Early voting' }[p.kind] || p.kind)}</span></div>
  <div class="small">${esc(p.address)}${p.km != null ? ` · ${p.km} km` : ''}</div>
  <div class="small muted">${esc(p.hours || '')}</div>
  <a class="small" target="_blank" rel="noopener" href="https://www.openstreetmap.org/search?query=${encodeURIComponent(p.address)}">Directions</a>
</div>`).join('') : '<p class="muted small">No locations on file for your area yet.</p>';

// ---------- activism ----------
async function viewAct() {
  const [actions, activity, rec] = await Promise.all([api('/actions'), api('/activity'), api('/recognition')]);
  const kinds = meta.activityKinds;
  view.innerHTML = `
    <h2>Show up</h2>
    <p class="muted small">Events from leaders and groups you follow. Check in with the code given at the event for full points.</p>
    ${actions.length ? actions.map((a) => `<div class="card">
      <div class="row between"><h3>${KIND_ICON[a.kind] || '•'} ${esc(a.title)}</h3>${a.done ? '<span class="chip good">Done</span>' : ''}</div>
      <div class="small muted">${fmtTime(a.starts_at)}${a.location ? ' · ' + esc(a.location) : ''}</div>
      <div class="small muted">${esc(a.leaderName || a.groupName || 'Public')}</div>
      ${a.checkinCode ? `<div class="small" style="margin-top:6px">Your event: check-in code <b>${esc(a.checkinCode)}</b></div>` : ''}
      ${a.done ? '' : `<form class="row wrap" data-a="${a.id}" data-kind="${a.kind}" style="margin-top:8px">
        <input name="code" placeholder="Check-in code" style="flex:1;min-width:120px" autocapitalize="characters">
        ${kinds.find((k) => k.kind === a.kind)?.perUnit ? `<input name="quantity" type="number" min="1" max="1000" placeholder="# ${esc(kinds.find((k) => k.kind === a.kind).unit)}s" style="width:110px">` : ''}
        <button class="small">Check in</button></form>`}
    </div>`).join('') : '<div class="card muted">No events yet. Follow a leader or join a group to see theirs.</div>'}
    <div class="card"><h3>Log something you did</h3>
      <form id="log" class="stack">
        <select name="kind">${kinds.map((k) => `<option value="${k.kind}">${KIND_ICON[k.kind]} ${esc(k.label)}</option>`).join('')}</select>
        <input name="quantity" type="number" min="1" max="1000" value="1">
        <input name="note" maxlength="280" placeholder="Note (optional)">
        <button>Log it</button>
      </form>
      <p class="legal">Self-logged items earn half points; check-ins earn full points. Daily caps keep it fair.</p>
    </div>
    <div class="card"><h3>Your record</h3>
      <div class="grid2 small">
        <div>Turnout: <b>${rec.breakdown.turnout}</b></div><div>Activism: <b>${rec.breakdown.activism}</b></div>
        <div>Endorsements: <b>${rec.breakdown.endorsements}</b></div><div>Slate wins: <b>${rec.breakdown.groupWins}</b></div>
      </div><hr>
      ${activity.length ? activity.slice(0, 15).map((x) => `<div class="row between small" style="padding:4px 0"><span>${KIND_ICON[x.kind] || ''} ${esc(x.title || kinds.find((k) => k.kind === x.kind)?.label)}${x.quantity > 1 ? ` ×${x.quantity}` : ''} ${x.verified ? '<span class="chip good">verified</span>' : ''}</span><b>+${x.points}</b></div>`).join('') : '<p class="muted small">Nothing yet.</p>'}
    </div>`;
  $$('form[data-a]').forEach((f) => (f.onsubmit = tryDo(async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const r = await api(`/actions/${f.dataset.a}/checkin`, { method: 'POST', body: fd });
    toast(`+${r.points} points${r.verified ? ' (verified)' : ''}`);
    viewAct();
  })));
  $('#log').onsubmit = tryDo(async (e) => {
    e.preventDefault();
    const r = await api('/activity', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast(r.points ? `+${r.points} points` : 'Logged (daily cap reached)');
    viewAct();
  });
}

// ---------- social ----------
async function viewSocial(tab = 'boards') {
  const t = (id, label) => `<button class="${tab === id ? '' : 'ghost'} small" data-t="${id}">${label}</button>`;
  view.innerHTML = `<h2>Social</h2><div class="tabs">${t('boards', 'Leaderboards')}${t('groups', 'Groups')}${t('friends', 'Friends')}</div><div id="sub"></div>`;
  $$('[data-t]').forEach((b) => (b.onclick = () => (location.hash = `#/social/${b.dataset.t}`)));
  const sub = $('#sub');
  if (tab === 'boards') {
    const [groups, binds] = await Promise.all([api('/groups'), api('/bindings')]);
    const scopes = [['friends', 'Friends'], ...groups.map((g) => [`group:${g.id}`, g.name]), ...binds.filter((b) => b.active).map((b) => [`leader:${b.leaderId}`, b.name])];
    const cur = store.get('lbscope', 'friends');
    const scope = scopes.some(([s]) => s === cur) ? cur : 'friends';
    const lb = await api(`/leaderboard?scope=${encodeURIComponent(scope)}`);
    sub.innerHTML = `<select id="scope">${scopes.map(([s, n]) => `<option value="${esc(s)}" ${s === scope ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <div class="card" style="margin-top:10px"><table class="lb">${lb.rows.map((r) => `<tr class="${r.me ? 'me' : ''}"><td class="place">${r.place}</td><td>${esc(r.name)}<div class="small muted">${esc(r.rank)} · ${r.badges} badges</div></td><td style="text-align:right">${r.points}</td></tr>`).join('')}</table></div>
      ${me.onLeaderboards ? '' : '<p class="small muted">You are hidden from others\' leaderboards. Turn it on under Me → Privacy.</p>'}`;
    $('#scope').onchange = (e) => { store.set('lbscope', e.target.value); viewSocial('boards'); };
  } else if (tab === 'groups') {
    const groups = await api('/groups');
    sub.innerHTML = `${groups.map((g) => `<div class="card"><div class="row between"><h3>${esc(g.name)}</h3><span class="chip">${g.members} members</span></div>
      <div class="small muted">${esc(g.kind)}${g.inviteCode ? ` · invite code <b>${esc(g.inviteCode)}</b>` : ''}</div>
      <div class="row" style="margin-top:8px"><button class="ghost small" data-lb="${g.id}">Leaderboard</button><button class="ghost small" data-leave="${g.id}">Leave</button></div></div>`).join('') || '<p class="muted">No groups yet.</p>'}
      <div class="card"><h3>Join a group</h3><form id="join" class="row"><input name="code" placeholder="Invite code" autocapitalize="characters"><button>Join</button></form></div>
      <div class="card"><h3>Start a group</h3><form id="mk" class="stack"><input name="name" placeholder="Group name" required>
        <select name="kind"><option value="team">Team</option><option value="neighborhood">Neighborhood</option><option value="chapter">Chapter</option></select><button>Create</button></form></div>`;
    $$('[data-lb]').forEach((b) => (b.onclick = () => { store.set('lbscope', `group:${b.dataset.lb}`); location.hash = '#/social/boards'; }));
    $$('[data-leave]').forEach((b) => (b.onclick = tryDo(async () => { if (!confirm('Leave this group?')) return; await api(`/groups/${b.dataset.leave}/membership`, { method: 'DELETE' }); viewSocial('groups'); })));
    $('#join').onsubmit = tryDo(async (e) => { e.preventDefault(); const r = await api('/groups/join', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast(`Joined ${r.name}`); viewSocial('groups'); });
    $('#mk').onsubmit = tryDo(async (e) => { e.preventDefault(); const g = await api('/groups', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast(`Created. Invite code ${g.inviteCode}`); viewSocial('groups'); });
  } else {
    const fr = await api('/friends');
    const st = { voted: ['good', 'Voted'], planned: ['brand', 'Has a plan'], not_yet: ['warn', 'Not yet'] };
    sub.innerHTML = `${fr.map((f) => `<div class="card row between"><div class="grow"><b>${esc(f.name)}</b>
      <div class="small">${f.state === 'friends' ? (f.status ? `<span class="chip ${st[f.status][0]}">${st[f.status][1]}</span>` : '<span class="muted">status private</span>') : f.state === 'incoming' ? 'wants to connect' : 'request sent'}</div></div>
      ${f.state === 'incoming' ? `<button class="small" data-acc="${f.userId}">Accept</button>` : ''}
      ${f.state === 'friends' && f.status !== 'voted' && f.electionId ? `<button class="small ghost" data-nudge="${f.userId}" data-e="${esc(f.electionId)}">Remind</button>` : ''}
    </div>`).join('') || '<p class="muted">No friends yet.</p>'}
    <div class="card"><h3>Add a friend</h3><form id="add" class="row"><input name="email" type="email" placeholder="Their email"><button>Add</button></form></div>
    <p class="small muted">Friends only see whether you voted (never how), and only if you turn on sharing under Me → Privacy.</p>`;
    $$('[data-acc]').forEach((b) => (b.onclick = tryDo(async () => { await api(`/friends/${b.dataset.acc}/accept`, { method: 'POST' }); viewSocial('friends'); })));
    $$('[data-nudge]').forEach((b) => (b.onclick = tryDo(async () => { await api(`/friends/${b.dataset.nudge}/nudge`, { method: 'POST', body: { electionId: b.dataset.e } }); toast('Reminder sent · +5 points'); b.disabled = true; })));
    $('#add').onsubmit = tryDo(async (e) => { e.preventDefault(); await api('/friends', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Request sent'); viewSocial('friends'); });
  }
}

// ---------- me ----------
async function viewMe() {
  const [jur, binds, ends, mine] = await Promise.all([api('/jurisdictions'), api('/bindings'), api('/endorse'), api('/leaders/mine')]);
  leaders = await api('/leaders');
  const bound = new Set(binds.map((b) => b.leaderId));
  const endorsed = new Set(ends.map((e) => e.leaderId));
  view.innerHTML = `
    <h2>${esc(me.name)}</h2>
    <div class="card"><h3>Following (in priority order)</h3>
      <p class="small muted">Your top leader fills your sample ballot first. You can unfollow anytime.</p>
      <div id="binds">${binds.map((b, i) => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line)" data-l="${b.leaderId}">
        <span class="chip" style="background:${esc(b.brandColor || 'var(--chip)')};color:#fff">${i + 1}</span>
        <span class="grow">${esc(b.name)}</span>
        <button class="ghost small" data-up ${i === 0 ? 'disabled' : ''}>↑</button>
        <label class="check small" style="margin:0"><input type="checkbox" data-act ${b.active ? 'checked' : ''}>on</label>
        <button class="ghost small" data-rm>✕</button></div>`).join('') || '<p class="muted small">Not following anyone yet.</p>'}</div>
      <label>Combine recommendations by</label>
      <select id="strategy">${meta.strategies.map((s) => `<option ${me.strategy === s ? 'selected' : ''} value="${s}">${s === 'priority' ? 'Priority (top leader wins)' : s === 'consensus' ? 'Consensus (weighted by priority)' : s}</option>`).join('')}</select>
    </div>
    <div class="card"><h3>Find leaders</h3>
      ${leaders.map((l) => `<div style="padding:8px 0;border-top:1px solid var(--line)"><div class="row between"><b>${esc(l.name)}</b><span class="chip">${l.followers} following</span></div>
        <div class="small muted">${esc(l.blurb || '')}</div>
        <div class="row" style="margin-top:6px">
          ${bound.has(l.id) ? '<span class="chip good">Following</span>' : `<button class="small" data-follow="${l.id}">Follow</button>`}
          <button class="small ghost" data-endorse="${l.id}">${endorsed.has(l.id) ? 'Endorsed ✓' : 'Endorse publicly'}</button>
        </div></div>`).join('')}
      <p class="legal">An endorsement is a public statement of support, like a yard sign. It is never tied to your ballot.</p>
    </div>
    <div class="card"><h3>Profile</h3><form id="prof">
      <label>Name</label><input name="name" value="${esc(me.name)}">
      <label>Home area</label><select name="jurisdictionId"><option value="">Choose…</option>${jur.map((j) => `<option value="${esc(j.id)}" ${me.jurisdictionId === j.id ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}</select>
      <div class="grid2"><div><label>Precinct</label><input name="precinct" value="${esc(me.precinct || '')}"></div>
      <div><label>Birth date</label><input name="birthDate" type="date" value="${esc(me.birthDate || '')}"></div></div>
      <label>Look</label><select name="theme"><option value="neutral">Neutral</option>${binds.map((b) => `<option value="leader:${b.leaderId}" ${me.theme === `leader:${b.leaderId}` ? 'selected' : ''}>${esc(b.name)} branding</option>`).join('')}</select>
      <button style="margin-top:12px">Save</button></form></div>
    <div class="card"><h3>Registration</h3><p class="small muted">Status, party changes, eligibility and a pre-filled form.</p><a class="btn ghost" href="#/register">Open registration help</a></div>
    <div class="card"><h3>Privacy</h3>
      <label class="check"><input type="checkbox" id="share" ${me.shareStatus ? 'checked' : ''}>Friends can see whether I voted</label>
      <label class="check"><input type="checkbox" id="lbs" ${me.onLeaderboards ? 'checked' : ''}>Show me on leaderboards</label>
      <div class="row wrap" style="margin-top:10px"><button class="ghost small" id="export">Download my data</button>
        <button class="ghost small" id="ovlog">My ballot change log</button>
        <button class="danger small" id="del">Delete account</button></div>
      <div id="ovlogbox"></div></div>
    <div class="card"><h3>Leader tools</h3>
      ${mine.length ? mine.map((l) => `<div class="row between"><span>${esc(l.name)} · ${l.followers} following</span><a class="btn small" href="#/lead/${l.id}">Manage</a></div>`).join('') : '<p class="small muted">Run an organization or slate? Publish recommendations and events.</p>'}
      <details style="margin-top:8px"><summary>Create a leadership source</summary><form id="newl" class="stack">
        <input name="name" placeholder="Name" required>
        <select name="kind"><option value="organization">Organization</option><option value="individual">Individual</option><option value="list">Curated list</option></select>
        <input name="blurb" placeholder="One-line description">
        <label>Brand color</label><input name="brandColor" type="color" value="#2f6f4f">
        <button>Create</button></form></details></div>
    <button class="ghost" id="out" style="width:100%">Sign out</button>
    <p class="legal" style="margin-top:16px">Points, ranks and badges are honorific. They have no cash value and can't be exchanged for anything. CVAS never asks for, stores, or rewards how you voted.</p>`;

  const order = () => $$('#binds [data-l]').map((r) => ({ leaderId: Number(r.dataset.l), active: $('[data-act]', r).checked }));
  $$('#binds [data-l]').forEach((r) => {
    $('[data-up]', r).onclick = tryDo(async () => { const o = order(); const i = o.findIndex((x) => x.leaderId === Number(r.dataset.l)); [o[i - 1], o[i]] = [o[i], o[i - 1]]; await api('/bindings', { method: 'PUT', body: o }); viewMe(); });
    $('[data-act]', r).onchange = tryDo(async () => { await api('/bindings', { method: 'PUT', body: order() }); toast('Saved'); });
    $('[data-rm]', r).onclick = tryDo(async () => { await api(`/bindings/${r.dataset.l}`, { method: 'DELETE' }); viewMe(); });
  });
  $('#strategy').onchange = tryDo(async (e) => { me = await api('/me', { method: 'PATCH', body: { strategy: e.target.value } }); toast('Saved'); });
  $$('[data-follow]').forEach((b) => (b.onclick = tryDo(async () => { await api('/bindings', { method: 'POST', body: { leaderId: Number(b.dataset.follow) } }); viewMe(); })));
  $$('[data-endorse]').forEach((b) => (b.onclick = tryDo(async () => { const on = endorsed.has(Number(b.dataset.endorse)); await api('/endorse', { method: 'POST', body: { leaderId: Number(b.dataset.endorse), remove: on } }); toast(on ? 'Endorsement removed' : 'Endorsed · +20 points'); viewMe(); })));
  $('#prof').onsubmit = tryDo(async (e) => { e.preventDefault(); me = await api('/me', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); applyTheme(); toast('Saved'); });
  $('#share').onchange = tryDo(async (e) => { me = await api('/me', { method: 'PATCH', body: { shareStatus: e.target.checked } }); });
  $('#lbs').onchange = tryDo(async (e) => { me = await api('/me', { method: 'PATCH', body: { onLeaderboards: e.target.checked } }); });
  $('#export').onclick = tryDo(async () => {
    const data = await api('/me/export');
    data.localBallotChanges = store.get(logKey(), []);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'cvas-my-data.json'; a.click();
  });
  $('#ovlog').onclick = () => {
    const log = store.get(logKey(), []);
    $('#ovlogbox').innerHTML = `<p class="small muted">Stored only on this device.</p>${log.map((l) => `<div class="small">${new Date(l.at).toLocaleString()} · ${esc(l.contest)} → ${esc(l.picks.join(', ') || 'none')}</div>`).join('') || '<p class="small">No changes.</p>'}
      ${log.length ? '<button class="ghost small" id="clrlog">Clear log</button>' : ''}`;
    if ($('#clrlog')) $('#clrlog').onclick = () => { store.del(logKey()); $('#ovlogbox').innerHTML = ''; };
  };
  $('#del').onclick = tryDo(async () => {
    if (!confirm('Delete your account and all data on the server? This cannot be undone.')) return;
    await api('/me', { method: 'DELETE' });
    await idDel();
    localStorage.clear();
    logout(true);
  });
  $('#newl').onsubmit = tryDo(async (e) => { e.preventDefault(); const l = await api('/leaders', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); location.hash = `#/lead/${l.id}`; });
  $('#out').onclick = () => logout();
}

// ---------- registration help (ID stays on device) ----------
const idDb = () => new Promise((res, rej) => {
  const r = indexedDB.open('cvas-private', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function idGet() { try { const db = await idDb(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(`id:${me.id}`); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } }
async function idPut(v) { const db = await idDb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, `id:${me.id}`); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idDel() { try { const db = await idDb(); return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(`id:${me.id}`); t.oncomplete = res; t.onerror = res; }); } catch {} }

async function viewRegister() {
  const [reg, el] = await Promise.all([api('/registration'), api('/eligibility')]);
  const id = (await idGet()) || { fields: {} };
  const f = id.fields;
  const rules = el.rules;
  const items = el.elections?.length ? el.elections : [{ election: null, ...el.general }];
  const sts = { unknown: 'Not sure', not_registered: 'Not registered', submitted: 'Submitted, waiting', confirmed: 'Confirmed' };
  view.innerHTML = `
    <h2>Registration</h2>
    ${items.map((x) => `<div class="card"><div class="row between"><h3>${esc(x.election?.name || 'Eligibility')}</h3>
      ${x.eligible === true ? '<span class="chip good">On track</span>' : x.eligible === false ? '<span class="chip bad">Blocked</span>' : '<span class="chip warn">Need info</span>'}</div>
      ${x.issues.map((i) => `<p class="small" style="color:var(--bad);margin:4px 0">${esc(i)}</p>`).join('')}
      ${x.actions.map((a) => `<p class="small" style="margin:4px 0">• ${esc(a.text)}${a.daysLeft != null ? ` <span class="chip ${a.daysLeft <= 7 ? 'warn' : ''}">${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} left</span>` : ''}${a.url ? ` <a href="${esc(a.url)}" target="_blank" rel="noopener">Go</a>` : ''}</p>`).join('')}
    </div>`).join('')}
    <div class="card"><h3>My status</h3><form id="rs">
      <label>Registration</label><select name="status">${Object.entries(sts).map(([k, v]) => `<option value="${k}" ${reg.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <div class="grid2"><div><label>Current party</label><input name="party" value="${esc(reg.party || '')}" placeholder="e.g. Unaffiliated"></div>
      <div><label>Party I want</label><input name="desiredParty" value="${esc(reg.desiredParty || '')}" placeholder="for closed primaries"></div></div>
      <button style="margin-top:12px">Save</button></form>
      ${rules.closedPrimaries ? `<p class="small muted">Primaries here are closed. Party changes must be made ${rules.partyChangeDeadlineDays ?? '?'} days before the primary.</p>` : ''}</div>
    <div class="card"><h3>Fill my form</h3>
      <p class="small muted">Your ID photo and these details stay <b>on this device only</b> and are never uploaded. They're used to fill in the form below.</p>
      <form id="idf">
        <label>Driver's license or state ID photo</label><input type="file" name="img" accept="image/*" capture="environment">
        ${id.img ? `<img class="idprev" src="${id.img}" alt="ID preview" style="margin-top:8px">` : ''}
        <div class="grid2">
          <div><label>Legal name</label><input name="legalName" value="${esc(f.legalName || me.name)}"></div>
          <div><label>Date of birth</label><input name="dob" type="date" value="${esc(f.dob || me.birthDate || '')}"></div>
          <div><label>License / ID number</label><input name="idNumber" value="${esc(f.idNumber || '')}"></div>
          <div><label>Last 4 of SSN (if no ID)</label><input name="ssn4" maxlength="4" inputmode="numeric" value="${esc(f.ssn4 || '')}"></div>
        </div>
        <label>Residential address</label><input name="address" value="${esc(f.address || '')}">
        <label class="check"><input type="checkbox" name="citizen" ${f.citizen ? 'checked' : ''}>I am a U.S. citizen</label>
        <div class="row wrap" style="margin-top:10px"><button>Save on device</button><button type="button" class="ghost" id="wipe">Erase from device</button></div>
      </form></div>
    <div class="card" id="packet"><h3>Pre-filled registration summary</h3>
      <table class="small" style="width:100%">${[['Name', f.legalName || me.name], ['Date of birth', f.dob || me.birthDate], ['ID number', f.idNumber ? '••••' + String(f.idNumber).slice(-4) : ''], ['Address', f.address], ['Party', reg.desiredParty || reg.party || 'Unaffiliated'], ['Citizen', f.citizen ? 'Yes' : '—']].map(([k, v]) => `<tr><td class="muted" style="width:40%">${k}</td><td>${esc(v || '—')}</td></tr>`).join('')}</table>
      <div class="row wrap noprint" style="margin-top:10px">${rules.onlineRegistrationUrl ? `<a class="btn" href="${esc(rules.onlineRegistrationUrl)}" target="_blank" rel="noopener">Official registration site</a>` : ''}
        <button class="ghost" id="copy">Copy details</button><button class="ghost" onclick="print()">Print</button></div>
      <p class="legal">CVAS doesn't submit registrations for you. Copy these details into the official form, or print them to take along.</p></div>`;
  $('#rs').onsubmit = tryDo(async (e) => { e.preventDefault(); await api('/registration', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Saved'); viewRegister(); });
  $('#idf').onsubmit = tryDo(async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get('img');
    let img = id.img;
    if (file && file.size) {
      if (file.size > 8e6) throw new Error('Image too large');
      img = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    }
    const fields = Object.fromEntries([...fd].filter(([k]) => k !== 'img'));
    fields.citizen = fd.has('citizen');
    await idPut({ img, fields, savedAt: Date.now() });
    if (fields.dob && fields.dob !== me.birthDate) me = await api('/me', { method: 'PATCH', body: { birthDate: fields.dob } });
    toast('Saved on this device');
    viewRegister();
  });
  $('#wipe').onclick = tryDo(async () => { await idDel(); toast('Erased'); viewRegister(); });
  $('#copy').onclick = () => navigator.clipboard?.writeText($('#packet table').innerText).then(() => toast('Copied'));
}

// ---------- leader console ----------
async function viewLead(lid) {
  const mine = await api('/leaders/mine');
  const l = mine.find((x) => x.id === Number(lid));
  if (!l) { view.innerHTML = '<p>Not found.</p>'; return; }
  const [recs, els, actions] = await Promise.all([api(`/leaders/${lid}/recommendations`), api('/elections'), api('/actions')]);
  const recMap = Object.fromEntries(recs.map((r) => [r.contestId, r]));
  const ballots = await Promise.all(els.map((e) => api(`/elections/${encodeURIComponent(e.id)}/ballot`)));
  view.innerHTML = `
    <h2>${esc(l.name)}</h2>
    <p class="muted small">${l.followers} people follow you. You see totals only: never who followed, and never how anyone voted.</p>
    <div class="card"><h3>Publish recommendations</h3>
      <p class="small muted">Showing contests in your home area. Leave blank to make no recommendation.</p>
      ${ballots.map((b) => `<h3 style="margin-top:12px">${esc(b.election.name)}</h3>${b.contests.map((c) => `<form class="rec" data-c="${esc(c.id)}" data-max="${c.voteFor}" style="border-top:1px solid var(--line);padding:8px 0">
        <b class="small">${esc(c.title)}</b>${c.voteFor > 1 ? ` <span class="small muted">(up to ${c.voteFor})</span>` : ''}
        ${c.choices.map((ch) => `<label class="check small"><input type="checkbox" value="${esc(ch.id)}" ${recMap[c.id]?.choiceIds.includes(ch.id) ? 'checked' : ''}>${esc(ch.label)}</label>`).join('')}
        <input name="note" placeholder="Why (optional)" value="${esc(recMap[c.id]?.note || '')}" style="margin-top:6px">
      </form>`).join('')}`).join('')}
      <button id="pub" style="margin-top:12px">Publish all</button></div>
    <div class="card"><h3>Create an event</h3><form id="ev" class="stack">
      <select name="kind">${meta.activityKinds.map((k) => `<option value="${k.kind}">${KIND_ICON[k.kind]} ${esc(k.label)}</option>`).join('')}</select>
      <input name="title" placeholder="Title" required>
      <input name="location" placeholder="Where">
      <input name="startsAt" type="datetime-local" required>
      <textarea name="description" placeholder="Details" rows="2"></textarea>
      <button>Create</button></form></div>
    <div class="card"><h3>Your events</h3>${actions.filter((a) => a.leader_id === l.id).map((a) => `<div class="small" style="padding:4px 0">${KIND_ICON[a.kind]} ${esc(a.title)} · ${fmtTime(a.starts_at)} · code <b>${esc(a.checkinCode || '')}</b></div>`).join('') || '<p class="muted small">None.</p>'}
      <p class="small muted">Show the check-in code at the event so attendees get verified points.</p></div>
    <div class="card"><h3>Branding</h3><form id="brand">
      <label>Color</label><input type="color" name="brandColor" value="${esc(l.brandColor || '#1f5f8b')}">
      <label>Custom rank names (7, comma-separated)</label><input name="rankNames" value="${esc((l.rankNames || []).join(', '))}" placeholder="Newcomer, Voter, Regular, Organizer, Captain, Precinct Leader, Movement Builder">
      <button style="margin-top:10px">Save</button></form></div>`;
  $$('form.rec').forEach((f) => f.addEventListener('change', (e) => {
    if ($$('input[type=checkbox]:checked', f).length > Number(f.dataset.max)) { e.target.checked = false; toast(`Up to ${f.dataset.max}`); }
  }));
  $('#pub').onclick = tryDo(async () => {
    const body = $$('form.rec').map((f) => ({ contestId: f.dataset.c, choiceIds: $$('input[type=checkbox]:checked', f).map((i) => i.value), note: f.note.value }));
    await api(`/leaders/${lid}/recommendations`, { method: 'PUT', body });
    toast('Published');
  });
  $('#ev').onsubmit = tryDo(async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.startsAt = new Date(fd.startsAt).toISOString().replace('T', ' ').slice(0, 19);
    const a = await api('/actions', { method: 'POST', body: { ...fd, leaderId: l.id } });
    toast(`Created. Check-in code ${a.checkin_code}`);
    viewLead(lid);
  });
  $('#brand').onsubmit = tryDo(async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const names = fd.rankNames.split(',').map((s) => s.trim()).filter(Boolean);
    await api(`/leaders/${lid}`, { method: 'PATCH', body: { brandColor: fd.brandColor, rankNames: names.length ? names : undefined } });
    leaders = await api('/leaders'); applyTheme(); toast('Saved');
  });
}

// ---------- router ----------
async function route() {
  const [, name = 'home', arg] = location.hash.split('/');
  if (!token) { renderNav(); applyTheme(); return viewLogin(); }
  try {
    if (!me) me = await api('/me');
    if (!meta) meta = await api('/meta');
    if (!leaders.length) leaders = await api('/leaders');
  } catch (e) {
    if (!token) return;
    view.innerHTML = `<div class="card"><p>${esc(e.message)}</p><button onclick="location.reload()">Retry</button></div>`;
    return;
  }
  applyTheme();
  const tab = { ballot: 'ballot', vote: 'ballot', act: 'act', social: 'social', me: 'me', register: 'me', lead: 'me' }[name] || 'home';
  renderNav(tab);
  window.scrollTo(0, 0);
  try {
    switch (name) {
      case 'ballot': return await viewBallot(arg);
      case 'vote': return await viewVote(arg);
      case 'act': return await viewAct();
      case 'social': return await viewSocial(arg);
      case 'me': return await viewMe();
      case 'register': return await viewRegister();
      case 'lead': return await viewLead(arg);
      default: return await viewHome();
    }
  } catch (e) {
    view.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`;
  }
}
addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
