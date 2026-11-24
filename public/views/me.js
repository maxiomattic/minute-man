// You: profile, recognition, who you follow, registration help, and the leader console.
import { $, $$, api, confetti, esc, fmtDate, fmtWhen, guard, haptic, icon, ACTIVITY_ICON, plural, refreshStats, sheet, state, store, toast, xpFly } from '../core.js';

// Every badge the server can award (see scorecard() in src/engine/recognition.js).
const BADGES = [
  ['registered', 'Registered', 'check', 'Confirm your voter registration'],
  ['voted', 'I Voted', 'ballot', 'Vote in an election'],
  ['primary', 'Primary Voter', 'ballot', 'Vote in a primary'],
  ['local', 'Local Voter', 'hall', 'Vote in a local or special election'],
  ['streak3', 'Habit', 'flame', 'Vote in 3 elections'],
  ['streak10', 'Fixture', 'trophy', 'Vote in 10 elections'],
  ['reminder', 'Reminder', 'chat', 'Remind 5 friends to vote'],
  ['council', 'In the Room', 'hall', 'Go to a city council meeting'],
  ['party', 'Party Regular', 'hand', 'Go to a local party meeting'],
  ['doors100', 'Shoe Leather', 'door', 'Knock 100 doors'],
  ['doors1000', 'Ground Game', 'door', 'Knock 1,000 doors'],
  ['calls100', 'Dialer', 'phone', 'Make 100 calls'],
  ['shifts5', 'Reliable', 'hand', 'Work 5 volunteer or GOTV shifts'],
  ['endorser', 'On the Record', 'megaphone', 'Publicly endorse someone you follow'],
  ['win', 'Victory', 'star', 'A slate you follow wins a contest'],
];
const REG_STATUS = { unknown: 'Not sure', not_registered: 'Not registered', submitted: 'Submitted, waiting', confirmed: 'Confirmed' };
const STRATEGY = {
  priority: ['Top priority wins', 'The first person on your list with a pick fills each contest.'],
  consensus: ['Consensus', 'Everyone you follow votes, weighted by priority.'],
};
const DEFAULT_RANKS = ['Newcomer', 'Voter', 'Regular', 'Organizer', 'Captain', 'Precinct Leader', 'Movement Builder'];
const RANK_AT = [0, 100, 300, 700, 1500, 3000, 6000];

const chev = () => `<span class="chev">${icon('chevron')}</span>`;
const download = (name, data) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- on-device ID store (never uploaded) ----------
const idDb = () => new Promise((res, rej) => {
  const r = indexedDB.open('cvas-private', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function idGet() {
  try {
    const db = await idDb();
    return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(`id:${state.me.id}`); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
  } catch { return null; }
}
async function idPut(v) {
  const db = await idDb();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, `id:${state.me.id}`); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function idDel() {
  try {
    const db = await idDb();
    return await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(`id:${state.me.id}`); t.oncomplete = res; t.onerror = res; });
  } catch {}
}

// ---------- you ----------
export async function render(el, arg) {
  const [rec, jur, binds, mine, reg] = await Promise.all([
    api('/recognition'), api('/jurisdictions').catch(() => []), api('/bindings').catch(() => []),
    api('/leaders/mine').catch(() => []), api('/registration').catch(() => ({ status: 'unknown' })),
  ]);
  const me = state.me;
  const r = rec.rank;
  const floor = RANK_AT[r.level - 1] ?? 0;
  const pct = r.nextAt ? Math.round(((rec.points - floor) / (r.nextAt - floor)) * 100) : 100;
  const earned = new Set(rec.badges.map((b) => b.id));
  const home = jur.find((j) => j.id === me.jurisdictionId);

  // One next step for this screen, most basic first.
  const next = !me.jurisdictionId ? ['Set your home area', null, 'profile']
    : !binds.length ? ['Find people to follow', '#/leaders']
      : reg.status !== 'confirmed' ? ['Check your registration', '#/register']
        : null;

  el.innerHTML = `<div class="vb page two">
    <div class="main">
      <div class="me-head">
        <span class="avatar xl" aria-hidden="true">${esc((me.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</span>
        <div class="grow"><h1>${esc(me.name)}</h1>
          <p class="muted" style="margin:0">Level ${r.level}: ${esc(r.name)}. <span class="num">${rec.points}</span> XP.</p></div>
      </div>
      <div class="panel">
        <div class="row between"><b>${r.nextAt ? `${r.nextAt - rec.points} XP to ${esc(r.nextName)}` : 'Top rank. Thank you.'}</b>${r.nextAt ? `<span class="muted small num">${rec.points} of ${r.nextAt} XP</span>` : ''}</div>
        <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${Math.max(3, pct)}%"></div></div>
        ${next ? (next[1] ? `<a class="btn go block" style="margin-top:14px" href="${next[1]}">${next[0]}</a>` : `<button class="btn go block" style="margin-top:14px" data-open="profile">${next[0]}</button>`) : ''}
      </div>
      <section>
        <div class="section-head"><h2>Badges</h2><span class="muted small">${earned.size} of ${BADGES.length}</span></div>
        <div class="panel"><div class="badges">${BADGES.map(([id, label, ic, how]) => `<button class="badge ${earned.has(id) ? '' : 'locked'}" data-badge="${id}" title="${esc(how)}">
          <span class="seal">${icon(earned.has(id) ? ic : 'lock')}</span>${esc(label)}</button>`).join('')}</div></div>
      </section>
    </div>
    <aside class="side">
      <div class="panel flush"><ul class="list">
        <li><a class="rowbtn" href="#/leaders"><span class="ico">${icon('crew')}</span><span class="grow"><span class="title">Who you follow</span><span class="sub">${binds.length ? `${binds.length} filling your ballot` : 'No one yet'}</span></span>${chev()}</a></li>
        <li><a class="rowbtn" href="#/register"><span class="ico">${icon('check')}</span><span class="grow"><span class="title">Registration</span><span class="sub">${esc(REG_STATUS[reg.status] || 'Not sure')}</span></span>${chev()}</a></li>
        <li><button class="rowbtn" data-open="profile"><span class="ico">${icon('settings')}</span><span class="grow"><span class="title">Profile</span><span class="sub">${esc(home?.name || 'Home area not set')}</span></span>${chev()}</button></li>
      </ul></div>
      <div class="panel">
        <h3>Privacy</h3>
        <label class="check"><input type="checkbox" id="share" ${me.shareStatus ? 'checked' : ''}>Friends can see whether I voted</label>
        <label class="check"><input type="checkbox" id="lbs" ${me.onLeaderboards ? 'checked' : ''}>Show me on leaderboards</label>
        <p class="tiny muted" style="margin:4px 0 0">Nobody ever sees how you voted. CVAS doesn't know.</p>
      </div>
      <div class="panel">
        <h3>Ballot rule</h3>
        <p class="small muted">When people you follow disagree:</p>
        <div class="seg" role="radiogroup">${(state.meta?.strategies || Object.keys(STRATEGY)).map((s) => `<button role="radio" aria-checked="${(me.strategy || 'priority') === s}" class="${(me.strategy || 'priority') === s ? 'on' : ''}" data-strategy="${esc(s)}">${esc(STRATEGY[s]?.[0] || s)}</button>`).join('')}</div>
        <p class="small muted" id="stratDesc" style="margin:8px 0 0">${esc(STRATEGY[me.strategy || 'priority']?.[1] || '')}</p>
      </div>
      <div class="panel flush"><ul class="list">
        ${mine.map((l) => `<li><a class="rowbtn" href="#/lead/${l.id}"><span class="dot-color" style="background:${esc(l.brandColor || 'var(--brand)')}"></span><span class="grow"><span class="title">${esc(l.name)}</span><span class="sub">${l.followers} following. Manage picks and events.</span></span>${chev()}</a></li>`).join('')}
        <li><button class="rowbtn" data-open="newLeader"><span class="ico">${icon('plus')}</span><span class="grow"><span class="title">Create a leadership source</span><span class="sub">Run a group or slate? Publish picks and events.</span></span>${chev()}</button></li>
      </ul></div>
      <div class="panel flush"><ul class="list">
        <li><button class="rowbtn" id="export"><span class="grow"><span class="title">Download my data</span></span></button></li>
        <li><button class="rowbtn" id="ovlog"><span class="grow"><span class="title">Ballot changes on this device</span></span></button></li>
        <li><button class="rowbtn" id="out"><span class="grow"><span class="title">Sign out</span></span></button></li>
        <li><button class="rowbtn danger-text" id="del"><span class="grow"><span class="title">Delete account</span></span></button></li>
      </ul></div>
      <p class="legal">Points, ranks and badges are for fun. They have no cash value and can't be traded for anything.</p>
    </aside>
  </div>`;

  $$('[data-badge]', el).forEach((b) => (b.onclick = () => {
    const [id, label, , how] = BADGES.find((x) => x[0] === b.dataset.badge);
    const got = rec.badges.find((x) => x.id === id);
    toast(got ? `${label}: ${got.desc}` : `To earn ${label}: ${how.toLowerCase()}`);
  }));
  $('#share', el).onchange = guard(async (e) => { state.me = await api('/me', { method: 'PATCH', body: { shareStatus: e.target.checked } }); toast('Saved privacy setting'); });
  $('#lbs', el).onchange = guard(async (e) => { state.me = await api('/me', { method: 'PATCH', body: { onLeaderboards: e.target.checked } }); toast('Saved privacy setting'); });
  $$('[data-strategy]', el).forEach((b) => (b.onclick = guard(async () => {
    state.me = await api('/me', { method: 'PATCH', body: { strategy: b.dataset.strategy } });
    $$('[data-strategy]', el).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    $('#stratDesc', el).textContent = STRATEGY[b.dataset.strategy]?.[1] || '';
    toast('Saved ballot rule');
  })));
  $$('[data-open=profile]', el).forEach((b) => (b.onclick = () => profileSheet(jur, binds)));
  // #/me/profile deep link (from "Set home area" buttons) opens the form directly.
  if (arg === 'profile') { history.replaceState(null, '', '#/me'); profileSheet(jur, binds); }
  $('[data-open=newLeader]', el).onclick = newLeaderSheet;
  $('#export', el).onclick = guard(async () => {
    const data = await api('/me/export');
    data.onThisDevice = { ballotChanges: store.get(`ovrlog:${me.id}`, []) };
    download('cvas-my-data.json', data);
    toast('Downloaded your data');
  });
  $('#ovlog', el).onclick = () => {
    const log = store.get(`ovrlog:${me.id}`, []);
    const { el: s, close } = sheet(`<div class="vb"><h2>Ballot changes</h2>
      <p class="small muted">Stored only on this device. CVAS never sees it.</p>
      ${log.length ? `<ul class="list compact">${log.slice(0, 50).map((l) => `<li><span class="grow"><span class="title">${esc(l.contest)}: ${esc(l.picks.join(', ') || 'no pick')}</span><span class="sub">${esc(new Date(l.at).toLocaleString())}</span></span></li>`).join('')}</ul>` : '<p>No changes yet.</p>'}
      <div class="row" style="margin-top:16px">${log.length ? '<button class="btn line sm" id="clr">Clear the log</button>' : ''}<button class="btn quiet sm" data-close>Close</button></div></div>`);
    $('[data-close]', s).onclick = close;
    $('#clr', s)?.addEventListener('click', () => { store.del(`ovrlog:${me.id}`); close(); toast('Cleared the log'); });
  };
  $('#out', el).onclick = () => window.cvasSignOut();
  $('#del', el).onclick = () => {
    const { el: s, close } = sheet(`<div class="vb"><h2>Delete your account?</h2>
      <p>This removes your account and everything CVAS stores about you. It also clears your ballot picks and ID details from this device. It can't be undone.</p>
      <p class="small muted">Want a copy first? Use Download my data.</p>
      <div class="row wrap" style="margin-top:16px"><button class="btn danger" id="yes">Delete my account</button><button class="btn quiet" data-close>Keep it</button></div></div>`);
    $('[data-close]', s).onclick = close;
    $('#yes', s).onclick = guard(async () => {
      await api('/me', { method: 'DELETE' });
      await idDel();
      try { localStorage.clear(); } catch {}
      close();
      toast('Deleted your account');
      window.cvasSignOut(true);
    });
  };
}

function profileSheet(jur, binds) {
  const me = state.me;
  const { el, close } = sheet(`<div class="vb"><div class="row between"><h2 style="margin:0">Profile</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <form id="prof">
      <label class="field" for="pn">Name</label><input id="pn" name="name" value="${esc(me.name)}" autocomplete="name" required>
      <label class="field" for="pj">Home area</label><select id="pj" name="jurisdictionId"><option value="">Choose where you live</option>${jur.map((j) => `<option value="${esc(j.id)}" ${me.jurisdictionId === j.id ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}</select>
      <div class="grid2">
        <div><label class="field" for="pp">Precinct</label><input id="pp" name="precinct" value="${esc(me.precinct || '')}" inputmode="numeric"></div>
        <div><label class="field" for="pb">Birth date</label><input id="pb" name="birthDate" type="date" value="${esc(me.birthDate || '')}"></div>
      </div>
      <label class="field" for="pt">Look</label><select id="pt" name="theme"><option value="neutral">CVAS green</option>${binds.map((b) => `<option value="leader:${b.leaderId}" ${me.theme === `leader:${b.leaderId}` ? 'selected' : ''}>${esc(b.name)} colors</option>`).join('')}</select>
      <p class="tiny muted" style="margin-top:6px">Your precinct and birth date help us find your polling place and check eligibility.</p>
      <button class="btn go block" style="margin-top:16px">Save profile</button>
    </form></div>`);
  $('[data-close]', el).onclick = close;
  $('#prof', el).onsubmit = guard(async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const themeChanged = fd.theme !== (me.theme || 'neutral');
    const body = { ...fd, jurisdictionId: fd.jurisdictionId || null, birthDate: fd.birthDate || null, precinct: fd.precinct || null };
    state.me = await api('/me', { method: 'PATCH', body });
    toast('Saved profile');
    close();
    if (themeChanged || fd.jurisdictionId !== (me.jurisdictionId || '')) location.reload();
    else window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

function newLeaderSheet() {
  const { el, close } = sheet(`<div class="vb"><div class="row between"><h2 style="margin:0">Create a leadership source</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <p class="small muted">An organization, a person, or a curated list. People who follow you get your picks on their ballot.</p>
    <form id="nl">
      <label class="field" for="ln">Name</label><input id="ln" name="name" required>
      <label class="field" for="lk">Type</label><select id="lk" name="kind"><option value="organization">Organization</option><option value="individual">Person</option><option value="list">Curated list</option></select>
      <label class="field" for="lb">One-line description</label><input id="lb" name="blurb" maxlength="160">
      <label class="field" for="lc">Brand color</label><input id="lc" name="brandColor" type="color" value="#2f6f4f" class="color">
      <button class="btn go block" style="margin-top:16px">Create leadership source</button>
    </form></div>`);
  $('[data-close]', el).onclick = close;
  $('#nl', el).onsubmit = guard(async (e) => {
    e.preventDefault();
    const l = await api('/leaders', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    state.leaders = await api('/leaders');
    close();
    toast('Created leadership source');
    location.hash = `#/lead/${l.id}`;
  });
}

// ---------- who you follow ----------
export async function renderLeaders(el) {
  const [binds, ends, leaders] = await Promise.all([api('/bindings'), api('/endorse'), api('/leaders')]);
  state.leaders = leaders;
  const bound = new Set(binds.map((b) => b.leaderId));
  const endorsed = new Set(ends.map((e) => e.leaderId));
  const find = leaders.filter((l) => !bound.has(l.id));

  el.innerHTML = `<div class="vb page narrow">
    <div class="main">
      <div><h1>Who you follow</h1>
        <p class="muted">Their picks fill in your sample ballot. Whoever is first on your list goes first.</p>
        ${binds.length ? '<a class="btn go block" style="margin-top:12px" href="#/ballot">See your ballot</a>' : ''}</div>
      ${binds.length ? `<section>
        <div class="section-head"><h2>Your list</h2></div>
        <div class="panel flush">${binds.length ? `<ul class="list" id="binds">${binds.map((b, i) => `<li data-l="${b.leaderId}" class="${b.active ? '' : 'off'}">
          <span class="prio" style="background:${esc(b.brandColor || 'var(--brand)')}">${i + 1}</span>
          <span class="grow"><span class="title">${esc(b.name)}</span><span class="sub">${b.active ? (i === 0 ? 'Fills your ballot first' : 'Fills in what the ones above skip') : 'Paused. Not on your ballot.'}</span></span>
          <button class="icon-btn up" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(b.name)} up">${icon('chevron')}</button>
          <label class="switch" title="On your ballot"><input type="checkbox" data-act ${b.active ? 'checked' : ''} aria-label="${esc(b.name)} on your ballot"><span></span></label>
          <button class="icon-btn" data-rm aria-label="Unfollow ${esc(b.name)}">${icon('close')}</button>
        </li>`).join('')}</ul>` : ''}</div>
      </section>` : ''}
      <section>
        <div class="section-head"><h2>${!binds.length ? 'Pick someone to start' : find.length ? 'Find people to follow' : 'Endorse publicly'}</h2></div>
        <div class="panel flush"><ul class="list">${leaders.map((l) => `<li class="lead-row">
          <span class="prio" style="background:${esc(l.brandColor || 'var(--brand)')}">${esc(l.name[0])}</span>
          <span class="grow"><span class="title">${esc(l.name)}</span>
            ${l.blurb ? `<span class="sub">${esc(l.blurb)}</span>` : ''}
            <span class="sub">${l.followers} following</span>
            <label class="check small endorse"><input type="checkbox" data-endorse="${l.id}" ${endorsed.has(l.id) ? 'checked' : ''}>Endorse publicly <span class="xp">+20</span></label></span>
          ${bound.has(l.id) ? '<span class="tag good">Following</span>' : `<button class="btn sm" data-follow="${l.id}">Follow</button>`}
        </li>`).join('') || '<li class="empty">No one has published picks yet.</li>'}</ul></div>
        <p class="legal" style="margin-top:10px">An endorsement is a public statement of support, like a yard sign. It is never tied to your ballot.</p>
      </section>
    </div>
  </div>`;

  const order = () => $$('#binds [data-l]', el).map((r) => ({ leaderId: Number(r.dataset.l), active: $('[data-act]', r).checked }));
  $$('#binds [data-l]', el).forEach((r) => {
    $('[data-up]', r).onclick = guard(async () => {
      const o = order();
      const i = o.findIndex((x) => x.leaderId === Number(r.dataset.l));
      [o[i - 1], o[i]] = [o[i], o[i - 1]];
      await api('/bindings', { method: 'PUT', body: o });
      haptic();
      renderLeaders(el);
    });
    $('[data-act]', r).onchange = guard(async (e) => {
      await api('/bindings', { method: 'PUT', body: order() });
      toast(e.target.checked ? 'Back on your ballot' : 'Paused');
      renderLeaders(el);
    });
    $('[data-rm]', r).onclick = guard(async () => {
      const name = $('.title', r).textContent;
      await api(`/bindings/${r.dataset.l}`, { method: 'DELETE' });
      toast(`Unfollowed ${name}`);
      renderLeaders(el);
    });
  });
  $$('[data-follow]', el).forEach((b) => (b.onclick = guard(async () => {
    b.disabled = true;
    await api('/bindings', { method: 'POST', body: { leaderId: Number(b.dataset.follow) } });
    haptic('success');
    toast(`Following ${leaders.find((l) => l.id === Number(b.dataset.follow))?.name}`);
    refreshStats();
    renderLeaders(el);
  })));
  $$('[data-endorse]', el).forEach((c) => (c.onchange = guard(async () => {
    const on = c.checked;
    try {
      await api('/endorse', { method: 'POST', body: { leaderId: Number(c.dataset.endorse), remove: !on } });
    } catch (e) { c.checked = !on; throw e; }
    if (on) { xpFly(20, c.closest('label')); toast('Endorsed. +20 XP'); } else toast('Endorsement removed');
    refreshStats();
  })));
}

// ---------- registration ----------
export async function renderRegister(el) {
  const [reg, elig] = await Promise.all([api('/registration'), api('/eligibility')]);
  const id = (await idGet()) || { fields: {} };
  const f = id.fields || {};
  const me = state.me;
  const rules = elig.rules || {};
  const items = elig.elections?.length ? elig.elections : [{ election: null, ...elig.general }];
  const CTA = { register: 'Register to vote', check_status: 'Check your status', party_change: 'Change your party', preregister: 'Pre-register' };

  // Most urgent thing to do: soonest deadline among actions with a link.
  const acts = items.flatMap((x) => x.actions.filter((a) => CTA[a.kind]).map((a) => ({ ...a, election: x.election })));
  acts.sort((a, b) => (a.daysLeft ?? 1e6) - (b.daysLeft ?? 1e6));
  const top = acts[0];
  const needsInfo = items.some((x) => x.eligible === null);

  const status = (x) => x.eligible === true ? '<span class="tag good">On track</span>' : x.eligible === false ? '<span class="tag hot">Blocked</span>' : '<span class="tag">Need info</span>';
  const left = (n) => n == null ? '' : n === 0 ? 'Due today' : n === 1 ? '1 day left' : `${n} days left`;

  el.innerHTML = `<div class="vb page two">
    <div class="main">
      <div><h1>Registration</h1>
        <p class="muted">You told us: <b>${esc(REG_STATUS[reg.status] || 'Not sure')}</b>${reg.party ? `, ${esc(reg.party)}` : ''}.</p>
        ${top ? `<div class="panel next-step"><p class="kick">${top.daysLeft != null ? esc(left(top.daysLeft)) : 'Next step'}${top.election ? ` for the ${esc(top.election.name)}` : ''}</p>
          <p style="font-weight:600">${esc(top.text)}</p>
          ${top.url ? `<a class="btn go block" href="${esc(top.url)}" target="_blank" rel="noopener">${CTA[top.kind]}</a>` : `<a class="btn go block" href="#status">${CTA[top.kind]}</a>`}
          ${top.kind !== 'party_change' ? '<p class="tiny muted" style="margin:8px 0 0">Then update your status below. Confirming earns +50 XP once.</p>' : ''}</div>`
        : needsInfo ? '<button class="btn go block" style="margin-top:12px" id="toId">Add your birth date</button>' : '<p class="tag good">You\'re all set for upcoming elections.</p>'}
      </div>
      <section>
        <div class="section-head"><h2>Your elections</h2></div>
        <div class="panel flush"><ul class="list">${items.map((x) => `<li class="elig">
          <span class="grow"><span class="title">${esc(x.election?.name || 'Eligibility')}</span>
            ${x.election ? `<span class="sub">${esc(fmtDate(x.election.date))}</span>` : ''}
            ${x.issues.map((i) => `<span class="sub warn-text">${esc(i)}</span>`).join('')}
            ${x.actions.map((a) => `<span class="sub">${esc(a.text)}${a.daysLeft != null ? ` <b>${esc(left(a.daysLeft))}.</b>` : ''}${a.url ? ` <a href="${esc(a.url)}" target="_blank" rel="noopener">Open the state site</a>` : ''}</span>`).join('')}</span>
          ${status(x)}</li>`).join('')}</ul></div>
      </section>
      <section id="status">
        <div class="section-head"><h2>Your status</h2></div>
        <form class="panel" id="rs">
          <label class="field" for="rst">Are you registered?</label>
          <select id="rst" name="status">${Object.entries(REG_STATUS).map(([k, v]) => `<option value="${k}" ${reg.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <div class="grid2">
            <div><label class="field" for="rp">Party now</label><input id="rp" name="party" value="${esc(reg.party || '')}" placeholder="Like Unaffiliated"></div>
            ${rules.closedPrimaries ? `<div><label class="field" for="rdp">Party you want</label><input id="rdp" name="desiredParty" value="${esc(reg.desiredParty || '')}" placeholder="To vote in a primary"></div>` : ''}
          </div>
          ${rules.closedPrimaries ? `<p class="small muted" style="margin-top:8px">Primaries here are closed: you can only vote in your own party's primary. Party changes are due ${rules.partyChangeDeadlineDays ?? 'some'} days before the primary.</p>` : ''}
          <button class="btn block" style="margin-top:14px">Save status</button>
        </form>
      </section>
      <section id="idsec">
        <div class="section-head"><h2>Fill my form</h2></div>
        <form class="panel" id="idf">
          <p class="small"><b>Stays on this device.</b> <span class="muted">Your ID photo and these details are never uploaded. We use them to fill in the summary.</span></p>
          <label class="field" for="img">Driver's license or state ID photo</label>
          <input id="img" type="file" name="img" accept="image/*" capture="environment">
          ${id.img ? `<img class="idprev" src="${id.img}" alt="Your ID photo">` : ''}
          <div class="grid2">
            <div><label class="field" for="ilg">Legal name</label><input id="ilg" name="legalName" value="${esc(f.legalName || me.name)}"></div>
            <div><label class="field" for="idob">Date of birth</label><input id="idob" name="dob" type="date" value="${esc(f.dob || me.birthDate || '')}"></div>
            <div><label class="field" for="inum">License or ID number</label><input id="inum" name="idNumber" value="${esc(f.idNumber || '')}" autocomplete="off"></div>
            <div><label class="field" for="issn">Last 4 of SSN, if no ID</label><input id="issn" name="ssn4" maxlength="4" inputmode="numeric" value="${esc(f.ssn4 || '')}" autocomplete="off"></div>
          </div>
          <label class="field" for="iad">Home address</label><input id="iad" name="address" value="${esc(f.address || '')}" autocomplete="street-address">
          <label class="check"><input type="checkbox" name="citizen" ${f.citizen ? 'checked' : ''}>I am a U.S. citizen</label>
          <div class="row wrap" style="margin-top:8px"><button class="btn">Save on this device</button>${id.img || Object.keys(f).length ? '<button type="button" class="btn line" id="wipe">Erase from this device</button>' : ''}</div>
        </form>
      </section>
    </div>
    <aside class="side">
      <div class="panel" id="packet">
        <h2>Your summary</h2>
        <table class="kv">${[['Name', f.legalName || me.name], ['Date of birth', f.dob || me.birthDate], ['ID number', f.idNumber ? 'ending ' + String(f.idNumber).slice(-4) : ''], ['Address', f.address], ['Party', reg.desiredParty || reg.party || 'Unaffiliated'], ['U.S. citizen', f.citizen ? 'Yes' : '']].map(([k, v]) => `<tr><th>${k}</th><td>${esc(v || 'Not added')}</td></tr>`).join('')}</table>
        <div class="row wrap noprint" style="margin-top:14px">
          ${rules.onlineRegistrationUrl ? `<a class="btn sm" href="${esc(rules.onlineRegistrationUrl)}" target="_blank" rel="noopener">Official site</a>` : ''}
          <button class="btn line sm" id="copy">Copy</button><button class="btn line sm" id="print">Print</button></div>
        <p class="legal" style="margin-top:12px">CVAS doesn't submit registrations. Copy these into the official form, or print them to take along.</p>
      </div>
    </aside>
  </div>`;

  $('#toId', el)?.addEventListener('click', () => { $('#idob', el).focus(); $('#idsec', el).scrollIntoView({ behavior: 'smooth' }); });
  $('#print', el).onclick = () => print();
  $('#copy', el).onclick = () => {
    const txt = $$('#packet tr', el).map((r) => `${r.cells[0].textContent}: ${r.cells[1].textContent}`).join('\n');
    navigator.clipboard?.writeText(txt).then(() => toast('Copied'), () => toast("Couldn't copy. Select the text and copy it yourself."));
  };
  $('#rs', el).onsubmit = guard(async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const was = reg.status;
    await api('/registration', { method: 'PUT', body });
    if (body.status === 'confirmed' && was !== 'confirmed') {
      xpFly(50, $('button', e.target));
      confetti(24);
      toast('Saved status. +50 XP');
    } else toast('Saved status');
    await refreshStats();
    renderRegister(el);
  });
  $('#idf', el).onsubmit = guard(async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get('img');
    let img = id.img;
    if (file && file.size) {
      if (file.size > 8e6) throw new Error('That photo is over 8 MB. Pick a smaller one.');
      img = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    }
    const fields = Object.fromEntries([...fd].filter(([k]) => k !== 'img'));
    fields.citizen = fd.has('citizen');
    await idPut({ img, fields, savedAt: Date.now() });
    if (fields.dob && fields.dob !== me.birthDate) state.me = await api('/me', { method: 'PATCH', body: { birthDate: fields.dob } });
    toast('Saved on this device');
    renderRegister(el);
  });
  $('#wipe', el)?.addEventListener('click', guard(async () => { await idDel(); toast('Erased from this device'); renderRegister(el); }));
}

// ---------- leader console ----------
export async function renderLead(el, lid) {
  const mine = await api('/leaders/mine');
  const l = mine.find((x) => x.id === Number(lid));
  if (!l) {
    el.innerHTML = `<div class="vb"><div class="panel empty"><h2>That isn't yours to manage</h2><p>You can manage only leadership sources you created.</p><a class="btn" href="#/me">Back to you</a></div></div>`;
    return;
  }
  const [recs, els, actions] = await Promise.all([api(`/leaders/${lid}/recommendations`), api('/elections'), api('/actions')]);
  const recMap = Object.fromEntries(recs.map((r) => [r.contestId, r]));
  const ballots = await Promise.all(els.map((e) => api(`/elections/${encodeURIComponent(e.id)}/ballot`).catch(() => null)));
  const mineEvents = actions.filter((a) => a.leader_id === l.id);
  const ranks = l.rankNames || [];
  const local = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; };
  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(18);

  el.innerHTML = `<div class="vb page two">
    <div class="main">
      <div><p class="kick">Leader tools</p><h1>${esc(l.name)}</h1>
        <p class="muted">${l.followers} ${l.followers === 1 ? 'person follows' : 'people follow'} you. You see totals only, never who or how anyone voted.</p></div>
      <section>
        <div class="section-head"><h2>Your picks</h2></div>
        <p class="small muted">Fill an oval to recommend. Leave a contest blank to stay out of it.</p>
        ${ballots.filter(Boolean).map((b) => `<h3 class="el-name">${esc(b.election.name)}</h3><div class="sheets">${b.contests.map((c) => `<section class="contest rec" data-c="${esc(c.id)}" data-max="${c.voteFor}">
          <header><h3>${esc(c.title)}</h3><span class="rule">${c.voteFor > 1 ? `Up to ${c.voteFor}` : 'Pick 1'}</span></header>
          ${c.choices.map((ch) => `<label class="choice"><input class="oval" type="checkbox" value="${esc(ch.id)}" ${recMap[c.id]?.choiceIds.includes(ch.id) ? 'checked' : ''}><span class="who">${esc(ch.label)}</span></label>`).join('')}
          <div class="note"><input name="note" placeholder="Why, in a sentence (optional)" value="${esc(recMap[c.id]?.note || '')}" aria-label="Note for ${esc(c.title)}"></div>
        </section>`).join('')}</div>`).join('') || '<div class="panel empty"><p>No upcoming elections in your home area.</p></div>'}
        ${ballots.some(Boolean) ? '<div class="publish-bar"><button class="btn go block" id="pub">Publish picks</button></div>' : ''}
      </section>
    </div>
    <aside class="side">
      <section>
        <div class="section-head"><h2>Events</h2><button class="link-btn" id="newEv">${icon('plus')}New event</button></div>
        <div class="panel flush">${mineEvents.length ? `<ul class="list compact">${mineEvents.map((a) => `<li><span class="ico sm">${icon(ACTIVITY_ICON[a.kind] || 'star')}</span>
          <span class="grow"><span class="title">${esc(a.title)}</span><span class="sub">${esc(fmtWhen(a.starts_at))}</span></span>
          <span class="code-chip num" title="Check-in code">${esc(a.checkinCode || '')}</span></li>`).join('')}</ul>` : '<div class="empty"><p>No events yet. Create one and share its check-in code at the door.</p></div>'}</div>
      </section>
      <form class="panel" id="brand">
        <h3>Branding</h3>
        <p class="small muted">Followers can choose your colors and rank names.</p>
        <label class="field" for="bc">Color</label><input id="bc" type="color" name="brandColor" value="${esc(l.brandColor || '#1f5f8b')}" class="color">
        <details style="margin-top:12px"><summary class="small" style="font-weight:600;cursor:pointer">Rank names</summary>
          ${DEFAULT_RANKS.map((d, i) => `<input name="r${i}" value="${esc(ranks[i] || '')}" placeholder="${esc(d)}" aria-label="Rank ${i + 1}" style="margin-top:8px">`).join('')}</details>
        <button class="btn block" style="margin-top:14px">Save branding</button>
      </form>
    </aside>
  </div>`;

  $$('.contest.rec', el).forEach((f) => f.addEventListener('change', (e) => {
    if (e.target.name === 'note') return;
    if ($$('input.oval:checked', f).length > Number(f.dataset.max)) { e.target.checked = false; toast(`Pick up to ${f.dataset.max}`); return; }
    haptic();
  }));
  $('#pub', el)?.addEventListener('click', guard(async () => {
    const body = $$('.contest.rec', el).map((f) => ({ contestId: f.dataset.c, choiceIds: $$('input.oval:checked', f).map((i) => i.value), note: $('input[name=note]', f).value.trim() }));
    await api(`/leaders/${lid}/recommendations`, { method: 'PUT', body });
    haptic('success');
    toast(`Published picks to ${plural(l.followers, 'follower')}`);
  }));
  $('#newEv', el).onclick = () => {
    const { el: s, close } = sheet(`<div class="vb"><div class="row between"><h2 style="margin:0">New event</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
      <form id="ev">
        <label class="field" for="ek">What kind?</label><select id="ek" name="kind">${(state.meta?.activityKinds || []).map((k) => `<option value="${esc(k.kind)}">${esc(k.label)}</option>`).join('')}</select>
        <label class="field" for="et">Title</label><input id="et" name="title" required placeholder="Like Saturday canvass: Precinct 12">
        <label class="field" for="eloc">Where</label><input id="eloc" name="location" placeholder="Address or Online">
        <label class="field" for="es">Starts</label><input id="es" name="startsAt" type="datetime-local" required value="${local(tomorrow)}">
        <label class="field" for="ed">Details</label><textarea id="ed" name="description" rows="2"></textarea>
        <button class="btn go block" style="margin-top:16px">Create event</button>
      </form></div>`);
    $('[data-close]', s).onclick = close;
    $('#ev', s).onsubmit = guard(async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      fd.startsAt = new Date(fd.startsAt).toISOString().replace('T', ' ').slice(0, 19);
      const a = await api('/actions', { method: 'POST', body: { ...fd, leaderId: l.id } });
      close();
      haptic('success');
      const { el: done, close: c2 } = sheet(`<div class="vb center"><h2>Created your event</h2>
        <p class="muted">${esc(a.title)}</p>
        <div class="code-card big"><span class="small">Check-in code</span><b class="num">${esc(a.checkin_code)}</b><span class="tiny muted">Show it at the event. People who enter it get full points.</span></div>
        <button class="btn block" style="margin-top:16px" data-close>Done</button></div>`);
      $('[data-close]', done).onclick = () => { c2(); renderLead(el, lid); };
    });
  };
  $('#brand', el).onsubmit = guard(async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const names = DEFAULT_RANKS.map((d, i) => (fd[`r${i}`] || '').trim() || d);
    const custom = DEFAULT_RANKS.some((d, i) => (fd[`r${i}`] || '').trim());
    await api(`/leaders/${lid}`, { method: 'PATCH', body: { brandColor: fd.brandColor, rankNames: custom ? names : undefined } });
    state.leaders = await api('/leaders');
    toast('Saved branding');
    if (state.me.theme === `leader:${l.id}`) location.reload();
  });
}

