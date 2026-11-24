// Ballot: the sample ballot (render) and the voting flow (renderVote).
// Guardrail: picks and overrides live only in localStorage on this device. Nothing about how
// anyone votes is sent to the server; the server only hears "planned" and "voted".
import { $, $$, api, celebrate, daysTo, esc, fmtDate, guard, haptic, icon, refreshStats, state, store, toast, todayIso, xpFly } from '../core.js';

const uid = () => state.me?.id;
const kBallot = (eid) => `ballot:${uid()}:${eid}`;
const kOvr = (eid) => `ovr:${uid()}:${eid}`;
const kLog = () => `ovrlog:${uid()}`;
const kPlan = (eid) => `plan:${uid()}:${eid}`;
const kPlaces = () => `places:${uid()}`;
const kElections = () => `elections:${uid()}`;

const HOW = {
  early: { label: 'In person, early', sub: 'Skip the election-day line', icon: 'calendar' },
  mail: { label: 'By mail', sub: 'Fill it in at home, drop it off', icon: 'ballot' },
  day: { label: 'On election day', sub: 'At your polling place', icon: 'pin' },
};
const PLACE_KIND = { polling: 'Polling place', dropbox: 'Drop box', early: 'Early voting' };
const HOW_PLACES = { early: ['early', 'polling'], mail: ['dropbox'], day: ['polling'] };

async function loadElections() {
  try {
    const els = await api('/elections');
    store.set(kElections(), els);
    return els;
  } catch (e) {
    const cached = store.get(kElections());
    if (cached) return cached;
    throw e;
  }
}

export async function loadBallot(eid) {
  try {
    const b = await api(`/elections/${encodeURIComponent(eid)}/ballot`);
    store.set(kBallot(eid), b);
    return { b, offline: false };
  } catch (e) {
    const cached = store.get(kBallot(eid));
    if (cached) return { b: cached, offline: true };
    throw e;
  }
}

const leaderName = (id) => state.leaders.find((l) => l.id === id)?.name || 'Your leaders';

/** Current picks for a contest: your override if you made one, else the recommendation. */
function picksFor(c, ov) {
  const valid = new Set(c.choices.map((x) => x.id));
  const mine = ov[c.id];
  return (Array.isArray(mine) ? mine : c.recommendation.choiceIds).filter((id) => valid.has(id));
}
const labelOf = (c, id) => c.choices.find((x) => x.id === id)?.label || '';
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function daysLine(e) {
  const d = daysTo(e.date);
  const left = d > 1 ? `${d} days left` : d === 1 ? 'Election day is tomorrow' : d === 0 ? 'Election day is today' : 'This election is over';
  return `${fmtDate(e.date)}. ${left}.`;
}

function cheatSheet(b, ov) {
  return `<ol class="cheat">${b.contests.map((c) => {
    const p = picksFor(c, ov);
    return `<li><span class="ct">${esc(c.title)}</span><span class="cp">${p.length ? esc(p.map((id) => labelOf(c, id)).join(', ')) : '<span class="muted">Your call</span>'}</span></li>`;
  }).join('')}</ol>`;
}

function contestHtml(c, ov) {
  const rec = c.recommendation;
  const sel = picksFor(c, ov);
  const isOv = Array.isArray(ov[c.id]) && !sameSet(ov[c.id], rec.choiceIds);
  const src = rec.choiceIds.length ? (rec.sourceLeaderId ? leaderName(rec.sourceLeaderId) : 'Your leaders') : null;
  const type = c.voteFor > 1 ? 'checkbox' : 'radio';
  const notes = [];
  for (const n of c.notes || []) notes.push(`<p><b>${esc(n.leaderName)}:</b> ${esc(n.note)}</p>`);
  if (rec.conflicts?.length)
    notes.push(`<p class="warn">Your leaders disagree here. ${rec.conflicts.map((x) => `${esc(x.leaderName)} picks ${esc(x.choiceIds.map((id) => labelOf(c, id)).join(' and ') || 'nobody')}.`).join(' ')}</p>`);
  if (!rec.choiceIds.length) notes.push('<p>No one you follow has a pick here. It\'s your call.</p>');
  if (isOv) notes.push(`<p class="row between wrap"><span>You changed this pick.</span><button class="link-btn noprint" data-undo>${rec.choiceIds.length ? 'Use their pick' : 'Clear my pick'}</button></p>`);
  return `<section class="contest" data-c="${esc(c.id)}">
    <header><h3>${esc(c.title)}</h3><span class="rule">${c.voteFor > 1 ? `Vote for up to ${c.voteFor}` : 'Vote for 1'}</span></header>
    ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
    ${c.choices.map((ch) => {
      const on = sel.includes(ch.id);
      const recd = rec.choiceIds.includes(ch.id);
      const tag = on && isOv ? '<span class="pick mine">Your pick</span>' : recd ? `<span class="pick${on ? '' : ' off'}">${esc(src)} ${src === 'Your leaders' ? 'pick' : 'picks'}</span>` : '';
      return `<label class="choice"><input class="oval" type="${type}" name="${esc(c.id)}" value="${esc(ch.id)}" ${on ? 'checked' : ''}>
        <span class="who">${esc(ch.label)}${ch.party ? ` <span class="muted small">${esc(ch.party)}</span>` : ''}</span>${tag}</label>`;
    }).join('')}
    ${notes.length ? `<div class="note">${notes.join('')}</div>` : ''}
  </section>`;
}

// ---------- sample ballot ----------
export async function render(el, eid) {
  let els = [];
  if (!eid) {
    els = await loadElections();
    if (!els.length) {
      el.innerHTML = `<div class="vb"><h1>Ballot</h1><div class="panel empty">
        ${icon('ballot', 'empty-ico')}<h2>No elections coming up</h2>
        <p>${state.me?.jurisdictionId ? 'Nothing is scheduled where you live yet. Follow people you trust now, so your ballot is ready when one is.' : 'Set your home area so we can find your elections.'}</p>
        <a class="btn go" href="${state.me?.jurisdictionId ? '#/leaders' : '#/me'}">${state.me?.jurisdictionId ? 'Find people to follow' : 'Set home area'}</a></div></div>`;
      return;
    }
    eid = els[0].id;
  } else {
    els = store.get(kElections()) || [];
    loadElections().catch(() => {});
  }
  const { b, offline } = await loadBallot(eid);
  if (!offline) api('/events', { method: 'POST', body: { kind: `ballot_viewed:${eid}` } }).then(refreshStats).catch(() => {});
  const e = b.election;
  const others = els.filter((x) => x.id !== eid);

  const draw = () => {
    const ov = store.get(kOvr(eid), {});
    const changed = b.contests.filter((c) => Array.isArray(ov[c.id]) && !sameSet(ov[c.id], c.recommendation.choiceIds)).length;
    const cta = `<a class="btn go block" href="#/vote/${esc(eid)}">Take it to the polls</a>`;
    el.innerHTML = `<div class="vb page two">
      <div class="main">
        <div>
          ${others.length ? `<nav class="seg noprint" aria-label="Elections" style="margin-bottom:14px">${[e, ...others].map((x) => `<a href="#/ballot/${esc(x.id)}" class="${x.id === eid ? 'on' : ''}">${esc(x.name)}</a>`).join('')}</nav>` : ''}
          <h1>${esc(e.name)}</h1>
          <p class="muted">${esc(daysLine(e))}</p>
          ${offline ? '<p class="tag hot">Offline. Showing your saved ballot.</p>' : ''}
          <div class="narrow-only noprint" style="margin-top:14px">${cta}</div>
        </div>
        <p class="small muted">Filled in from people you follow${b.strategy === 'consensus' ? ', weighted by priority' : ', top priority first'}. Tap an oval to change a pick.${changed ? ` <button class="link-btn" id="reset">${changed > 1 ? `Undo all ${changed} changes` : 'Undo your change'}</button>` : ''}</p>
        <div class="sheets">${b.contests.map((c) => contestHtml(c, ov)).join('') || '<div class="panel empty"><p>No contests on your ballot for this election.</p></div>'}</div>
        <p class="legal">Your picks stay on this device. CVAS never sees how you vote. Sample ballots are a guide only.</p>
      </div>
      <aside class="side">
        <div class="panel">
          <div class="section-head"><h2>Cheat sheet</h2><button class="link-btn noprint" id="print">Print</button></div>
          ${cheatSheet(b, ov)}
          <div class="wide-only noprint" style="margin-top:16px">${cta}</div>
        </div>
      </aside>
    </div>`;
    $('#print', el).onclick = () => print();
    $('#reset', el)?.addEventListener('click', () => { store.del(kOvr(eid)); toast(changed > 1 ? 'Undid all changes' : 'Undid your change'); draw(); });
    $$('.contest', el).forEach((sec) => {
      const c = b.contests.find((x) => x.id === sec.dataset.c);
      sec.addEventListener('change', (ev) => {
        let picks = $$('input:checked', sec).map((i) => i.value);
        if (picks.length > c.voteFor) { ev.target.checked = false; toast(`Pick up to ${c.voteFor}`); return; }
        const o = store.get(kOvr(eid), {});
        if (sameSet(picks, c.recommendation.choiceIds)) delete o[c.id]; else o[c.id] = picks;
        store.set(kOvr(eid), o);
        const log = store.get(kLog(), []);
        log.unshift({ at: new Date().toISOString(), election: e.name, contest: c.title, picks: picks.map((id) => labelOf(c, id)) });
        store.set(kLog(), log.slice(0, 200));
        haptic();
        redrawContest(c);
      });
    });
    const redrawContest = () => {
      const scroll = window.scrollY;
      draw();
      window.scrollTo(0, scroll);
    };
    $$('[data-undo]', el).forEach((btn) => (btn.onclick = (ev) => {
      ev.preventDefault();
      const cid = btn.closest('.contest').dataset.c;
      const o = store.get(kOvr(eid), {});
      delete o[cid];
      store.set(kOvr(eid), o);
      toast('Using their pick');
      const scroll = window.scrollY;
      draw();
      window.scrollTo(0, scroll);
    }));
  };
  draw();
}

// ---------- voting flow ----------
function placeRow(p, chosen) {
  const id = String(p.id ?? p.name);
  return `<label class="opt place"><input type="radio" name="place" value="${esc(id)}" ${chosen === id ? 'checked' : ''}>
    <span class="grow"><span class="title">${esc(p.name)}</span>
    <span class="sub">${esc(p.address)}${p.km != null ? `, ${p.km} km away` : ''}</span>
    <span class="sub">${esc(PLACE_KIND[p.kind] || p.kind)}${p.hours ? `, ${esc(p.hours)}` : ''}</span></span></label>`;
}
const mapLink = (addr) => `https://www.openstreetmap.org/search?query=${encodeURIComponent(addr)}`;

export async function renderVote(el, eid) {
  if (!eid) { location.hash = '#/ballot'; return; }
  const [{ b, offline }, parts, placesLive] = await Promise.all([
    loadBallot(eid),
    api('/participation').catch(() => null),
    api('/polling').catch(() => null),
  ]);
  let places = placesLive || store.get(kPlaces(), []);
  if (placesLive) store.set(kPlaces(), placesLive);
  const e = b.election;
  const rules = b.rules || {};
  const mine = (parts || []).filter((p) => p.electionId === eid).map((p) => p.kind);
  let voted = mine.includes('voted');
  let planned = mine.includes('planned') || !!store.get(kPlan(eid));
  let editing = false;
  let serverMsg = '';
  const opens = e.early_voting_start || new Date(new Date(e.date + 'T12:00:00Z') - 45 * 86400000).toISOString().slice(0, 10);
  const today = todayIso();
  const late = daysTo(e.date) < -7;
  const open = today >= opens && !late;

  // Places that fit how you'll vote, best kind first (early voting sites before polling places).
  const placesFor = (how) => {
    const kinds = HOW_PLACES[how];
    if (!kinds) return places;
    const list = places.filter((p) => kinds.includes(p.kind));
    return list.length ? list.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind)) : places;
  };

  const draw = () => {
    const plan = store.get(kPlan(eid));
    const ov = store.get(kOvr(eid), {});
    const where = plan?.place;
    const steps = [
      `Check that you're registered. <a href="#/register">Check registration</a>${rules.statusLookupUrl ? ` or <a href="${esc(rules.statusLookupUrl)}" target="_blank" rel="noopener">look it up with the state</a>` : ''}.`,
      rules.idRequired && rules.idRequired !== 'none' ? esc(rules.idNote || 'Bring an accepted ID.') : null,
      where ? `Go to ${esc(where.name)}, ${esc(where.address)}. <a href="${mapLink(where.address)}" target="_blank" rel="noopener">Get directions</a>.` : plan?.how === 'mail' ? 'Mail your ballot back, or drop it in any official drop box.' : 'Go to your polling place or a drop box.',
      plan?.how === 'mail' ? 'Sign the return envelope where it asks.' : 'Sign in with a poll worker and get your ballot.',
      'Fill it in using your cheat sheet. Ask a poll worker if something looks different.',
      plan?.how === 'mail' ? 'Seal it and send it before the deadline.' : 'Cast it in the scanner or the drop box.',
      rules.ballotPhotoAllowed === false ? "Don't photograph your marked ballot. It isn't allowed here." : null,
    ].filter(Boolean);

    let head;
    if (voted) {
      head = `<div class="panel done-state">
        <div class="stamp">${icon('check')}</div>
        <h1>You voted</h1>
        <p class="muted">Thanks for showing up in the ${esc(e.name)}. The next best thing is bringing someone with you.</p>
        <a class="btn go block" href="#/crew/friends">Remind my crew</a></div>`;
    } else if (!planned || editing) {
      const how = plan?.how || '';
      const shown = placesFor(how);
      head = `<form id="planForm" class="stack">
        <div><p class="kick">${esc(e.name)}</p><h1>Make your plan</h1>
          <p class="muted">People who plan when and where are more likely to make it. It takes 30 seconds.</p></div>
        <div class="panel"><h3>How will you vote?</h3>
          <div class="opts">${Object.entries(HOW).map(([k, h]) => `<label class="opt big"><input type="radio" name="how" value="${k}" ${how === k ? 'checked' : ''} required>
            ${icon(h.icon)}<span class="grow"><span class="title">${h.label}</span><span class="sub">${h.sub}</span></span></label>`).join('')}</div></div>
        <div class="panel"><div class="section-head"><h3>Where?</h3>${shown.length ? '<button type="button" class="link-btn" id="near">Sort by distance</button>' : ''}</div>
          <div class="opts" id="places">${shown.length ? shown.map((p) => placeRow(p, where ? String(where.id ?? where.name) : '')).join('') : '<p class="muted small">No locations on file for your area yet. Check your county election office.</p>'}</div></div>
        <button class="btn go block" type="submit">Save my plan <span class="xp">+10</span></button>
        ${planned ? '<button type="button" class="btn quiet block" id="cancelEdit">Keep my old plan</button>' : open ? '<p class="center"><button type="button" class="link-btn" id="already">Already voted? Tell us</button></p>' : ''}
      </form>`;
    } else if (open) {
      head = `<div class="stack">
        <div><p class="kick">${esc(e.name)}</p><h1>${daysTo(e.date) === 0 ? 'Election day. Go vote.' : 'Voting is open'}</h1>
          <p class="muted">${esc(daysLine(e))} Come back and tap the button once your ballot is cast.</p></div>
        <button class="btn go block huge" id="voted">I voted <span class="xp">+100</span></button>
        ${serverMsg ? `<p class="tag hot">${esc(serverMsg)}</p>` : ''}
        <p class="legal">Just tell us that you voted, not who you voted for. Points are for fun. They can't be traded for anything.</p></div>`;
    } else {
      head = `<div class="stack">
        <div><p class="kick">${esc(e.name)}</p><h1>You have a plan</h1>
          <p class="muted">Voting opens ${esc(fmtDate(opens))}. Election day is ${esc(fmtDate(e.date))}. We'll have your cheat sheet ready.</p></div>
        <a class="btn go block" href="#/ballot/${esc(eid)}">Check your ballot</a></div>`;
    }

    const planSummary = planned && !editing && !voted ? `<div class="panel">
      <div class="section-head"><h3>Your plan</h3><button class="link-btn" id="editPlan">Change plan</button></div>
      ${plan ? `<p><b>${esc(HOW[plan.how]?.label || 'Planned')}</b></p>${plan.place ? `<p class="small">${esc(plan.place.name)}<br><span class="muted">${esc(plan.place.address)}${plan.place.hours ? `. ${esc(plan.place.hours)}` : ''}</span></p>
        <a class="small" href="${mapLink(plan.place.address)}" target="_blank" rel="noopener">Get directions</a>` : ''}` : '<p class="small muted">You made a plan on another device. Add details here if you like.</p>'}
    </div>` : '';

    el.innerHTML = `<div class="vb page two">
      <div class="main">
        ${offline ? '<p class="tag hot">Offline. Showing what was saved on this device.</p>' : ''}
        ${head}
        ${planSummary}
        ${voted ? '' : `<div class="panel"><h3>Steps</h3><ol class="steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>`}
      </div>
      <aside class="side">
        <div class="panel">
          <div class="section-head"><h2>Cheat sheet</h2><a href="#/ballot/${esc(eid)}" class="noprint">Edit picks</a></div>
          ${cheatSheet(b, ov)}
          <p class="tiny muted" style="margin-top:12px">Paper notes are allowed in the booth in most places. Phones may not be. <button class="link-btn tiny noprint" id="print">Print it</button></p>
        </div>
      </aside>
    </div>`;

    $('#print', el).onclick = () => print();
    $('#editPlan', el)?.addEventListener('click', () => { editing = true; draw(); });
    $('#cancelEdit', el)?.addEventListener('click', () => { editing = false; draw(); });
    $('#already', el)?.addEventListener('click', () => { planned = true; editing = false; draw(); });
    const form = $('#planForm', el);
    if (form) {
      // Changing "how" narrows the place list; keep the form's other state.
      $$('input[name=how]', form).forEach((r) => (r.onchange = () => {
        const chosen = $('input[name=place]:checked', form)?.value || '';
        $('#places', el).innerHTML = placesFor(r.value).map((p) => placeRow(p, chosen)).join('') || '<p class="muted small">No locations on file for your area yet.</p>';
        haptic();
      }));
      $('#near', el)?.addEventListener('click', () => {
        if (!navigator.geolocation) return toast("Location isn't available. Pick a place from the list.");
        navigator.geolocation.getCurrentPosition(guard(async (pos) => {
          places = await api(`/polling?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
          store.set(kPlaces(), places);
          const chosen = $('input[name=place]:checked', form)?.value || '';
          $('#places', el).innerHTML = placesFor($('input[name=how]:checked', form)?.value).map((p) => placeRow(p, chosen)).join('');
          toast('Sorted by distance');
        }), () => toast("Couldn't get your location. Allow location access or pick from the list."));
      });
      form.onsubmit = guard(async (ev) => {
        ev.preventDefault();
        const how = $('input[name=how]:checked', form)?.value;
        if (!how) return toast('Pick how you will vote.');
        const pid = $('input[name=place]:checked', form)?.value;
        const p = places.find((x) => String(x.id ?? x.name) === pid);
        store.set(kPlan(eid), { how, place: p ? { id: p.id, name: p.name, address: p.address, hours: p.hours, kind: p.kind } : null, savedAt: new Date().toISOString() });
        const btn = $('button[type=submit]', form);
        const first = !mine.includes('planned');
        if (first) {
          await api('/participation', { method: 'POST', body: { electionId: eid, kind: 'planned' } });
          mine.push('planned');
          xpFly(10, btn);
          refreshStats();
          toast('Saved my plan. +10 XP');
        } else toast('Saved my plan');
        planned = true;
        editing = false;
        draw();
        window.scrollTo(0, 0);
      });
    }
    const vb = $('#voted', el);
    if (vb) vb.onclick = async () => {
      vb.disabled = true;
      try {
        await api('/participation', { method: 'POST', body: { electionId: eid, kind: 'voted' } });
      } catch (err) {
        vb.disabled = false;
        serverMsg = err.message;
        toast(err.message);
        draw();
        return;
      }
      voted = true;
      haptic('heavy');
      refreshStats();
      await celebrate({ big: '+100', title: 'You voted', body: 'Thanks for showing up. Now bring someone with you.', cta: 'Remind my crew' });
      location.hash = '#/crew/friends';
    };
  };
  draw();
}
