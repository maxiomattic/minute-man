// You: profile, privacy, your data, and registration help.
import { $, $$, api, confetti, esc, fmtDate, guard, icon, initials, more, refreshStats, sheet, state, store, toast, xpFly } from '../core.js';

const REG_STATUS = { unknown: 'Not sure', not_registered: 'Not registered', submitted: 'Submitted, waiting', confirmed: 'Confirmed' };

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
  const [jur, reg] = await Promise.all([
    api('/jurisdictions').catch(() => []), api('/registration').catch(() => ({ status: 'unknown' })),
  ]);
  const me = state.me;
  const t = state.today;
  const home = jur.find((j) => j.id === me.jurisdictionId);

  el.innerHTML = `<div class="vb page two">
    <div class="main">
      <div class="me-head">
        <span class="avatar xl" aria-hidden="true">${esc(initials(me.name))}</span>
        <div class="grow"><h1>${esc(me.name)}</h1>
          ${t ? `<p class="muted" style="margin:0">Level ${t.rank.level}: ${esc(t.rank.name)}. <span class="num">${t.points.toLocaleString('en-US')}</span> points.</p>` : ''}</div>
      </div>
      <div class="panel flush"><ul class="list">
        <li><a class="rowbtn" href="#/board"><span class="ico">${icon('laurel')}</span><span class="grow"><span class="title">Your standing and honors</span><span class="sub">Rank, numbers and badges</span></span>${chev()}</a></li>
        <li><a class="rowbtn" href="#/path"><span class="ico">${icon('today')}</span><span class="grow"><span class="title">Your path</span><span class="sub">${t?.rank.nextName ? `Next rank: ${esc(t.rank.nextName)}` : 'Every step'}</span></span>${chev()}</a></li>
        <li><a class="rowbtn" href="#/register"><span class="ico">${icon('check')}</span><span class="grow"><span class="title">Registration</span><span class="sub">${esc(reg.answered ? REG_STATUS[reg.status] : 'Not checked yet')}</span></span>${chev()}</a></li>
        <li><button class="rowbtn" data-open="profile"><span class="ico">${icon('settings')}</span><span class="grow"><span class="title">Profile</span><span class="sub">${esc(me.homeLabel || home?.name || 'Add your address')}</span></span>${chev()}</button></li>
      </ul></div>
    </div>
    <aside class="side">
      <div class="panel">
        <h3>Privacy</h3>
        <label class="check"><input type="checkbox" id="lbs" ${me.onLeaderboards ? 'checked' : ''}>Show what I do on the feed and leaderboards</label>
        <label class="check"><input type="checkbox" id="share" ${me.shareStatus ? 'checked' : ''}>Friends can see whether I voted, and others can see my rank</label>
        <p class="tiny muted" style="margin:4px 0 0">Nobody ever sees how you voted. Minute Man doesn't know. People who aren't your friends see your first name, last initial and town.</p>
      </div>
      <div class="panel flush"><ul class="list">
        <li><button class="rowbtn" id="export"><span class="grow"><span class="title">Download my data</span></span></button></li>
        <li><button class="rowbtn" id="ovlog"><span class="grow"><span class="title">Ballot changes on this device</span></span></button></li>
        <li><button class="rowbtn" id="out"><span class="grow"><span class="title">Sign out</span></span></button></li>
        <li><button class="rowbtn danger-text" id="del"><span class="grow"><span class="title">Delete account</span></span></button></li>
      </ul></div>
      <div class="panel about">
        <h3>About Minute Man</h3>
        <p class="small">Free, open-source software under the MIT License. Anyone can use, change and share the code.</p>
        <p class="small muted">Picks come from America First Insight, then President Trump. Minute Man isn't run by or affiliated with them, or with any party, campaign or candidate.</p>
      </div>
      <p class="legal">Points, ranks and honors are for recognition only. They have no cash value and can't be traded for anything.</p>
    </aside>
  </div>`;

  $('#share', el).onchange = guard(async (e) => { state.me = await api('/me', { method: 'PATCH', body: { shareStatus: e.target.checked } }); toast('Saved privacy setting'); });
  $('#lbs', el).onchange = guard(async (e) => { state.me = await api('/me', { method: 'PATCH', body: { onLeaderboards: e.target.checked } }); toast('Saved privacy setting'); });
  $$('[data-open=profile]', el).forEach((b) => (b.onclick = () => profileSheet(jur)));
  // #/me/profile deep link (from "Add your address" buttons) opens the form directly.
  if (arg === 'profile') { history.replaceState(null, '', '#/me'); profileSheet(jur); }
  $('#export', el).onclick = guard(async () => {
    const data = await api('/me/export');
    data.onThisDevice = { ballotChanges: store.get(`ovrlog:${me.id}`, []) };
    download('minute-man-my-data.json', data);
    toast('Downloaded your data');
  });
  $('#ovlog', el).onclick = () => {
    const log = store.get(`ovrlog:${me.id}`, []);
    const { el: s, close } = sheet(`<div class="vb"><h2>Ballot changes</h2>
      <p class="small muted">Stored only on this device. Minute Man never sees it.</p>
      ${log.length ? `<ul class="list compact">${log.slice(0, 50).map((l) => `<li><span class="grow"><span class="title">${esc(l.contest)}: ${esc(l.picks.join(', ') || 'no pick')}</span><span class="sub">${esc(new Date(l.at).toLocaleString())}</span></span></li>`).join('')}</ul>` : '<p>No changes yet.</p>'}
      <div class="row" style="margin-top:16px">${log.length ? '<button class="btn line sm" id="clr">Clear the log</button>' : ''}<button class="btn quiet sm" data-close>Close</button></div></div>`);
    $('[data-close]', s).onclick = close;
    $('#clr', s)?.addEventListener('click', () => { store.del(`ovrlog:${me.id}`); close(); toast('Cleared the log'); });
  };
  $('#out', el).onclick = () => window.cvasSignOut();
  $('#del', el).onclick = () => {
    const { el: s, close } = sheet(`<div class="vb"><h2>Delete your account?</h2>
      <p>This removes your account and everything Minute Man stores about you. It also clears your ballot picks and ID details from this device. It can't be undone.</p>
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

function profileSheet(jur) {
  const me = state.me;
  const { el, close } = sheet(`<div class="vb"><div class="row between"><h2 style="margin:0">Profile</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <form id="prof">
      <label class="field" for="pn">Name</label><input id="pn" name="name" value="${esc(me.name)}" autocomplete="name" required>
      <label class="field" for="pa">Home address</label>
      <input id="pa" name="address" autocomplete="street-address" placeholder="123 Main St, Waxahachie, TX" ${me.jurisdictionId ? '' : 'required'}>
      <p class="tiny muted" style="margin-top:6px">${me.homeLabel ? `Now set to ${esc(me.homeLabel)}. Enter a new address only if you moved. ` : ''}We look up your districts from it once and keep only your city.</p>
      <label class="field" for="pb">Birth date</label><input id="pb" name="birthDate" type="date" value="${esc(me.birthDate || '')}">
      <p class="tiny muted" style="margin-top:6px">Your birth date lets us check you're old enough to register.</p>
      <button class="btn go block" style="margin-top:16px">Save profile</button>
    </form></div>`);
  $('[data-close]', el).onclick = close;
  $('#prof', el).onsubmit = guard(async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const { address, ...rest } = fd;
    const moved = address.trim() ? await api('/me/address', { method: 'POST', body: { address } }) : null;
    state.me = await api('/me', { method: 'PATCH', body: { ...rest, birthDate: rest.birthDate || null } });
    toast(moved ? `Home set to ${moved.homeLabel}` : 'Saved profile');
    close();
    if (moved) location.reload();
    else window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}


// ---------- registration ----------
// A guided flow: ask where they stand, then show exactly one next step. Every step that leaves
// the app says what the site is, what to have ready, and what to do when they come back.
const daysLeftText = (n) => n == null ? '' : n === 0 ? 'due today' : n === 1 ? '1 day left' : `${n} days left`;

function shareLink(title, text, url) {
  if (navigator.share) return navigator.share({ title, text, url }).catch(() => {});
  return navigator.clipboard?.writeText(`${text}\n${url}`).then(() => toast('Copied the link and steps'), () => toast("Couldn't copy"));
}

export async function renderRegister(el) {
  const [reg, elig] = await Promise.all([api('/registration'), api('/eligibility')]);
  idDel().catch(() => {}); // older versions kept an ID photo on the device; clear it
  const rules = elig.rules || {};
  const guide = rules.registration || {};
  const stateName = state.me.homeLabel?.split(', ').pop() === 'TX' ? 'Texas' : 'your state';
  const next = (elig.elections || []).find((x) => x.election?.registration_deadline) || null;
  const e = next?.election;
  const deadlineLine = e ? `Register by <b>${esc(fmtDate(e.registration_deadline))}</b> to vote on ${esc(fmtDate(e.date))}${(() => { const a = next.actions.find((x) => x.daysLeft != null); return a ? ` (${daysLeftText(a.daysLeft)})` : ''; })()}.` : '';
  const status = reg.answered ? reg.status : null;

  const leaveNote = (g) => `<p class="tiny muted">Opens ${esc(g.site)} in your browser. Minute Man doesn't see what you enter there.${g.mobile === 'ok' ? ' Works fine on a phone.' : ''}</p>`;
  const needsList = (items) => `<ul class="checklist">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  const answer = (choices) => `<div class="answers">${choices.map(([v, label]) => `<button class="btn line" data-status="${v}">${label}</button>`).join('')}</div>`;
  const home = '<a class="btn quiet block" href="#/today" style="margin-top:10px">Back to Today</a>';

  let step;
  if (!status) {
    step = `<h2>Are you registered at your current address?</h2>
      ${answer([['confirmed', 'Yes, I checked'], ['not_registered', 'No'], ['unknown', 'Not sure']])}`;
  } else if (status === 'unknown' || status === 'submitted') {
    const g = guide.lookup || { url: rules.statusLookupUrl, site: 'your state election site', needs: [] };
    step = `<h2>${status === 'submitted' ? 'See if it went through' : 'Check your registration'}</h2>
      <p class="muted">${status === 'submitted' ? 'Your county mails a certificate within about 30 days. Check the lookup in a week or two.' : 'Takes about 2 minutes on the state\'s lookup page.'}</p>
      ${g.url ? `<a class="btn go block" href="${esc(g.url)}" target="_blank" rel="noopener" id="go">Open the ${stateName === 'Texas' ? 'Texas' : 'state'} lookup</a>` : '<p>Ask your county elections office.</p>'}
      ${g.needs?.length ? more('What you\'ll need', `${needsList(g.needs)}${g.url ? leaveNote(g) : ''}`) : ''}
      <div class="after"><p class="small"><b>Back from the lookup?</b> What did it say?</p>
      ${answer([['confirmed', "I'm registered"], ['not_registered', "It couldn't find me"]])}</div>
      ${status === 'submitted' ? home : ''}`;
  } else if (status === 'not_registered') {
    const g = guide.apply;
    step = g ? `<h2>Register to vote</h2>
      <p class="muted">${esc(g.intro)}</p>
      <a class="btn go block" href="${esc(g.url)}" target="_blank" rel="noopener">Start the application</a>
      ${more(`How it works (${g.steps.length} steps)`, `<ol class="steps">${g.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>${leaveNote(g)}`)}
      ${g.mobile === 'print' ? more('No printer?', `<p class="small">${esc(g.noPrinter || '')}</p><button class="btn line sm" id="later">Send the steps to myself</button>`) : ''}
      ${g.update ? more('Already registered and just moved?', `<p class="small">${esc(g.update.text)} <a href="${esc(g.update.url)}" target="_blank" rel="noopener">Update it on Texas.gov</a>.</p>`) : ''}
      <div class="after"><p class="small"><b>Mailed it?</b></p>${answer([['submitted', 'I mailed my application']])}</div>`
      : `<h2>Register to vote</h2>${rules.onlineRegistrationUrl ? `<a class="btn go block" href="${esc(rules.onlineRegistrationUrl)}" target="_blank" rel="noopener">Open your state's registration site</a>` : '<p>Contact your county elections office.</p>'}
      <div class="after">${answer([['submitted', "I've applied"]])}</div>`;
  } else {
    step = `<h2>You're registered</h2>
      <p class="muted">Nothing else to do here unless you move.</p>
      ${e ? `<a class="btn go block" href="#/vote/${esc(e.id)}">Next: make your voting plan</a>` : ''}
      ${home}
      ${rules.idNote ? more('What ID to bring when you vote', `<p class="small">${esc(rules.idNote)}</p>`) : ''}
      <p style="margin:8px 0 0"><button class="link-btn small" data-status="unknown">I moved or want to check again</button></p>`;
  }

  const closed = rules.closedPrimaries;
  el.innerHTML = `<div class="vb page">
    <a class="back" href="#/today">${icon('chevron')}Today</a>
    <h1>Registration</h1>
    ${deadlineLine && status !== 'confirmed' ? `<p class="muted">${deadlineLine}</p>` : ''}
    <section class="panel reg-step">${step}</section>
    ${closed ? `<section><div class="section-head"><h2>Your party</h2></div>
      <form class="panel" id="rs">
        ${more('Why this matters', `<p class="small muted">Primaries here are closed: you can only vote in your own party's primary. Party changes are due ${rules.partyChangeDeadlineDays ?? 'some'} days before the primary.</p>`)}
        <div class="grid2">
          <div><label class="field" for="rp">Party now</label><input id="rp" name="party" value="${esc(reg.party || '')}" placeholder="Like Unaffiliated"></div>
          <div><label class="field" for="rdp">Party you want</label><input id="rdp" name="desiredParty" value="${esc(reg.desiredParty || '')}"></div>
        </div>
        <button class="btn block" style="margin-top:14px">Save party</button>
      </form></section>` : ''}
  </div>`;

  $$('[data-status]', el).forEach((b) => (b.onclick = guard(async () => {
    const to = b.dataset.status;
    await api('/registration', { method: 'PUT', body: { status: to } });
    if (to === 'confirmed' && reg.status !== 'confirmed') { xpFly(50, b); confetti(24); toast("You're registered. +50 XP"); }
    else if (to === 'submitted') toast('Saved. We\'ll remind you to check on it.');
    await refreshStats();
    renderRegister(el);
    window.scrollTo(0, 0);
  })));
  $('#later', el)?.addEventListener('click', () => {
    const g = guide.apply;
    shareLink('Register to vote', `Register to vote in ${stateName}${e ? ` by ${fmtDate(e.registration_deadline)}` : ''}:\n${g.steps.map((t, i) => `${i + 1}. ${t}`).join('\n')}`, g.url);
  });
  $('#rs', el)?.addEventListener('submit', guard(async (ev) => {
    ev.preventDefault();
    await api('/registration', { method: 'PUT', body: Object.fromEntries(new FormData(ev.target)) });
    toast('Saved party');
  }));
}

