// You: profile, privacy, your data, and registration help.
import { $, $$, api, confetti, esc, fmtDate, guard, icon, initials, more, refreshStats, sheet, state, toast, xpFly } from '../core.js';

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

// Home street address, same on-device store. The server keeps only the city and districts; the street
// is sent once to the Census lookup and otherwise stays here, ready for the registration form.
const addrKey = () => `addr:${state.me.id}`;
async function addrGet() {
  try {
    const db = await idDb();
    return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(addrKey()); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
  } catch { return null; }
}
async function addrPut(v) {
  try {
    const db = await idDb();
    await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, addrKey()); t.oncomplete = res; t.onerror = () => rej(t.error); });
  } catch {}
}
async function addrDel() {
  try {
    const db = await idDb();
    await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(addrKey()); t.oncomplete = res; t.onerror = res; });
  } catch {}
}
// "401 S ROGERS ST, WAXAHACHIE, TX, 75165" -> { street: '401 S Rogers St', city: 'Waxahachie', state: 'TX', zip: '75165' }
const KEEP_UPPER = /^(N|S|E|W|NE|NW|SE|SW|FM|CR|RR|US|SH|PO|HC|II|III|IV)$/;
const titleCase = (s) => String(s || '').toLowerCase().split(/\s+/).map((w) => (KEEP_UPPER.test(w.toUpperCase()) ? w.toUpperCase() : w.replace(/^[a-z]/, (c) => c.toUpperCase()))).join(' ');
function parseMatched(line) {
  const [street, city, st, zip] = String(line || '').split(/\s*,\s*/);
  return { street: titleCase(street), city: titleCase(city), state: (st || '').toUpperCase(), zip: zip || '' };
}
/** Save what the Census lookup matched, for the registration step to reuse. */
async function addrRemember(typed, res) {
  const m = parseMatched(res.matchedAddress);
  await addrPut({ ...typed, matched: res.matchedAddress ? { ...m, county: res.districts?.county || null, districts: res.districts || null } : null, confirmed: false, at: Date.now() });
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
      <p class="tiny muted" style="margin:0 0 8px">Others see your activity and rank, and friends see whether you voted. Strangers see your first name, last initial and town. Nobody sees how you vote.</p>
      <div class="panel flush"><ul class="list">
        <li><button class="rowbtn" id="export"><span class="grow"><span class="title">Download my data</span></span></button></li>
        <li><button class="rowbtn" id="out"><span class="grow"><span class="title">Sign out</span></span></button></li>
        <li><button class="rowbtn danger-text" id="del"><span class="grow"><span class="title">Delete account</span></span></button></li>
      </ul></div>
      <div class="panel about">
        <h3>About Minute Man</h3>
        <p class="small">Free, open-source software under the MIT License. Anyone can use, change and share the code.</p>
        <p class="small muted">Minute Man's picks draw on America First Insight's and President Trump's public endorsements. Minute Man isn't run by or affiliated with them, or with any party, campaign or candidate.</p>
      </div>
      <p class="legal">Points, ranks and honors are for recognition only. They have no cash value and can't be traded for anything.</p>
    </aside>
  </div>`;

  $$('[data-open=profile]', el).forEach((b) => (b.onclick = () => profileSheet(jur)));
  // #/me/profile deep link (from "Add your address" buttons) opens the form directly.
  if (arg === 'profile') { history.replaceState(null, '', '#/me'); profileSheet(jur); }
  $('#export', el).onclick = guard(async () => {
    const data = await api('/me/export');
    download('minute-man-my-data.json', data);
    toast('Downloaded your data');
  });
  $('#out', el).onclick = () => window.cvasSignOut();
  $('#del', el).onclick = () => {
    const { el: s, close } = sheet(`<div class="vb"><h2>Delete your account?</h2>
      <p>This removes your account and everything Minute Man stores about you. It also clears your ID details and saved ballot from this device. It can't be undone.</p>
      <p class="small muted">Want a copy first? Use Download my data.</p>
      <div class="row wrap" style="margin-top:16px"><button class="btn danger" id="yes">Delete my account</button><button class="btn quiet" data-close>Keep it</button></div></div>`);
    $('[data-close]', s).onclick = close;
    $('#yes', s).onclick = guard(async () => {
      await api('/me', { method: 'DELETE' });
      await idDel();
      await addrDel();
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
    if (moved) await addrRemember({ street: address.trim().split(',')[0] }, moved);
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

// Registration-address step state, kept across re-renders of the step (not saved anywhere).
const regAddr = { editing: false, error: null, mailing: false };
const oneLine = (a) => [[a.street, a.unit].filter(Boolean).join(' '), a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const resAddr = (a) => (a.matched ? { ...a.matched, unit: a.unit } : a);
function copyText(text, what) {
  const ok = () => toast(`Copied ${what}`);
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(ok, () => toast("Couldn't copy"));
  const t = Object.assign(document.createElement('textarea'), { value: text });
  document.body.append(t); t.select();
  try { document.execCommand('copy'); ok(); } catch { toast("Couldn't copy"); }
  t.remove();
}

/** Step 1 of registering: type your home address, check it against the Census lookup, confirm it. */
function addressStep(addr, states) {
  const me = state.me;
  const a = addr || {};
  const m = a.matched;
  if (m && !regAddr.editing) {
    const d = m.districts || {};
    const bits = [d.congress && `Congress ${d.congress}`, d.stateSenate && `State Senate ${d.stateSenate}`, d.stateHouse && `State House ${d.stateHouse}`].filter(Boolean);
    return `<p class="step-of">Step 1 of 2</p>
      <h2>Is this where you live?</h2>
      <div class="addr-card"><div>${esc([m.street, a.unit].filter(Boolean).join(' '))}</div><div>${esc(m.city)}, ${esc(m.state)} ${esc(m.zip)}</div></div>
      <p class="small muted">${m.county ? `${esc(m.county)}. ` : ''}${bits.length ? `Your ballot is set for ${esc(bits.join(', '))}.` : 'Your ballot is set for this address.'}</p>
      ${a.mailing ? `<p class="small"><b>Mail goes to:</b> ${esc(a.mailing)}</p>` : ''}
      <button class="btn go block" id="addr-yes">Yes, that's my address</button>
      <button class="btn quiet block" id="addr-edit" style="margin-top:10px">Change it</button>`;
  }
  const homeCity = !a.city && me.homeLabel ? me.homeLabel.split(', ')[0] : '';
  const st = a.state || (me.homeLabel?.split(', ').pop()) || (me.jurisdictionId || 'tx').slice(0, 2).toUpperCase();
  const stCodes = states.length ? states : [{ id: 'tx', name: 'Texas' }];
  const err = regAddr.error;
  return `<p class="step-of">Step 1 of 2</p>
    <h2>Your home address</h2>
    <p class="muted">Where you live now. It goes on your application, and it sets the races on your ballot.</p>
    <form id="addr-form" novalidate>
      <label class="field" for="ra-street">Street address</label>
      <input id="ra-street" name="street" autocomplete="address-line1" enterkeyhint="next" autocapitalize="words" placeholder="401 S Rogers St" value="${esc(a.street || '')}" required>
      <label class="field" for="ra-unit">Apt, suite or unit <span class="muted">(optional)</span></label>
      <input id="ra-unit" name="unit" autocomplete="address-line2" enterkeyhint="next" autocapitalize="characters" value="${esc(a.unit || '')}">
      <label class="field" for="ra-city">City</label>
      <input id="ra-city" name="city" autocomplete="address-level2" enterkeyhint="next" autocapitalize="words" value="${esc(a.city || homeCity)}" required>
      <div class="addr-row">
        <div><label class="field" for="ra-state">State</label>
          <select id="ra-state" name="state" autocomplete="address-level1">${stCodes.map((j) => `<option value="${esc(j.id.toUpperCase())}"${j.id.toUpperCase() === st ? ' selected' : ''}>${esc(j.id.toUpperCase())}</option>`).join('')}</select></div>
        <div><label class="field" for="ra-zip">ZIP code</label>
          <input id="ra-zip" name="zip" autocomplete="postal-code" inputmode="numeric" pattern="[0-9]{5}" maxlength="10" enterkeyhint="done" value="${esc(a.zip || '')}" required></div>
      </div>
      <label class="check" style="margin-top:8px"><input type="checkbox" id="ra-mail-on"${a.mailing || regAddr.mailing ? ' checked' : ''}>My mail goes to a different address</label>
      <div id="ra-mail-box"${a.mailing || regAddr.mailing ? '' : ' hidden'}>
        <label class="field" for="ra-mail" style="margin-top:0">Mailing address</label>
        <textarea id="ra-mail" name="mailing" rows="2" autocomplete="section-mailing street-address" placeholder="PO Box 123, Waxahachie, TX 75168">${esc(a.mailing || '')}</textarea>
      </div>
      ${err ? `<div class="form-err" role="alert"><p>${esc(err)}</p><button type="button" class="link-btn" id="addr-skip">Continue with this address anyway</button></div>` : ''}
      <button class="btn go block" style="margin-top:16px">Check address</button>
      <p class="tiny muted" style="margin:10px 0 0">Your street address stays on this phone. We send it once to the U.S. Census address lookup to find your districts, and keep only your city.</p>
    </form>`;
}

/** The details the state form asks for, ready to copy. */
function detailsBox(addr) {
  const r = resAddr(addr);
  const res = oneLine(r);
  const row = (label, value, what) => `<li><div class="grow"><span class="tiny muted">${label}</span><span class="val">${esc(value)}</span></div>
    <button type="button" class="btn line sm" data-copy="${esc(value)}" data-what="${esc(what)}" aria-label="Copy ${esc(what)}">Copy</button></li>`;
  return `<div class="reg-details">
    <div class="row between"><h3 style="margin:0">For the form</h3><button type="button" class="link-btn small" id="addr-change">Change address</button></div>
    <ul>${row('Residence address', res, 'residence address')}
    ${addr.mailing ? row('Mailing address', addr.mailing, 'mailing address') : '<li><div class="grow"><span class="tiny muted">Mailing address</span><span class="val">Same as residence</span></div></li>'}
    ${r.county ? row('County', r.county.replace(/ County$/, ''), 'county') : ''}</ul>
    ${addr.matched ? '' : '<p class="tiny muted" style="margin:8px 0 0">The Census lookup couldn\'t match this address. Check it carefully on the form.</p>'}
  </div>`;
}

export async function renderRegister(el) {
  const [reg, elig, addr, jur] = await Promise.all([api('/registration'), api('/eligibility'), addrGet(), api('/jurisdictions').catch(() => [])]);
  idDel().catch(() => {}); // older versions kept an ID photo on the device; clear it
  const states = jur.filter((j) => /^[a-z]{2}$/.test(j.id)).sort((x, y) => x.id.localeCompare(y.id));
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
  } else if (status === 'not_registered' && (!addr?.confirmed || regAddr.editing)) {
    step = addressStep(addr, states);
  } else if (status === 'not_registered') {
    const g = guide.apply;
    step = g ? `<p class="step-of">Step 2 of 2</p><h2>Register to vote</h2>
      <p class="muted">${esc(g.intro)}</p>
      ${detailsBox(addr)}
      <a class="btn go block" href="${esc(g.url)}" target="_blank" rel="noopener">Start the application</a>
      ${more(`How it works (${g.steps.length} steps)`, `<ol class="steps">${g.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>${leaveNote(g)}`)}
      ${g.mobile === 'print' ? more('No printer?', `<p class="small">${esc(g.noPrinter || '')}</p><button class="btn line sm" id="later">Send the steps to myself</button>`) : ''}
      ${g.update ? more('Already registered and just moved?', `<p class="small">${esc(g.update.text)} <a href="${esc(g.update.url)}" target="_blank" rel="noopener">Update it on Texas.gov</a>.</p>`) : ''}
      <div class="after"><p class="small"><b>Mailed it?</b></p>${answer([['submitted', 'I mailed my application']])}</div>`
      : `<p class="step-of">Step 2 of 2</p><h2>Register to vote</h2>${detailsBox(addr)}${rules.onlineRegistrationUrl ? `<a class="btn go block" href="${esc(rules.onlineRegistrationUrl)}" target="_blank" rel="noopener">Open your state's registration site</a>` : '<p>Contact your county elections office.</p>'}
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
    // Starting an application: confirm the saved address again (people move).
    if (to === 'not_registered' && addr?.confirmed) await addrPut({ ...addr, confirmed: false });
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

  // ---- address step ----
  const again = () => { renderRegister(el); window.scrollTo(0, 0); };
  $('#addr-yes', el)?.addEventListener('click', guard(async () => {
    await addrPut({ ...addr, confirmed: true, at: Date.now() });
    regAddr.editing = false;
    again();
  }));
  $('#addr-edit', el)?.addEventListener('click', () => {
    regAddr.editing = true;
    regAddr.error = null;
    // Start the form from the matched address, keeping the unit and mailing address they typed.
    if (addr?.matched) Object.assign(addr, { street: addr.matched.street, city: addr.matched.city, state: addr.matched.state, zip: addr.matched.zip });
    addrPut({ ...addr }).then(again);
  });
  $('#addr-change', el)?.addEventListener('click', () => { regAddr.editing = true; regAddr.error = null; again(); });
  $$('[data-copy]', el).forEach((b) => (b.onclick = () => copyText(b.dataset.copy, b.dataset.what)));
  const form = $('#addr-form', el);
  if (form) {
    const mailOn = $('#ra-mail-on', form);
    mailOn.onchange = () => { regAddr.mailing = mailOn.checked; $('#ra-mail-box', form).hidden = !mailOn.checked; if (mailOn.checked) $('#ra-mail', form).focus(); };
    const read = () => {
      const f = Object.fromEntries(new FormData(form));
      const typed = { street: f.street.trim(), unit: f.unit.trim(), city: f.city.trim(), state: f.state, zip: f.zip.trim(), mailing: mailOn.checked ? (f.mailing || '').trim() : '' };
      return typed;
    };
    const missing = (t) => (!t.street ? ['ra-street', 'Enter your street address.'] : !t.city ? ['ra-city', 'Enter your city.'] : !/^\d{5}(-?\d{4})?$/.test(t.zip) ? ['ra-zip', 'Enter a 5-digit ZIP code.'] : null);
    $('#addr-skip', form)?.addEventListener('click', guard(async () => {
      const t = read();
      const miss = missing(t);
      if (miss) { toast(miss[1]); $('#' + miss[0], form).focus(); return; }
      await addrPut({ ...t, matched: null, confirmed: true, at: Date.now() });
      regAddr.editing = false; regAddr.error = null;
      again();
    }));
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const t = read();
      const miss = missing(t);
      if (miss) { toast(miss[1]); $('#' + miss[0], form).focus(); return; }
      const btn = form.querySelector('button.go');
      btn.disabled = true; btn.textContent = 'Checking…';
      let res;
      try {
        res = await api('/me/address', { method: 'POST', body: { address: `${t.street}, ${t.city}, ${t.state} ${t.zip}` } });
      } catch (e) {
        // Keep what they typed; show why and let them go on without a match.
        await addrPut({ ...t, matched: null, confirmed: false, at: Date.now() });
        regAddr.error = /couldn't find/i.test(e.message)
          ? "We couldn't match that address. Check the street number, spelling and ZIP code. If it's right (new homes and rural routes can be missing), you can go on with it."
          : `${e.message.replace(/\.+$/, '.')} You can try again, or go on without the check.`;
        again();
        return;
      }
      const { districts, matchedAddress, ...me } = res;
      state.me = { ...state.me, ...me };
      await addrRemember(t, { districts, matchedAddress });
      regAddr.editing = false; regAddr.error = null;
      refreshStats().catch(() => {});
      again();
    };
  }
}

