// Ballot: the sample ballot (render) and the voting flow (renderVote).
// The picks are fixed: they come from the sources, in order, and can't be edited here. People vote however
// they choose in the booth, and nothing about how anyone votes is ever sent to the server. The server only
// hears "planned", "voted", and which races were reviewed (never a pick).
import { $, $$, api, daysTo, esc, fmtDate, guard, haptic, icon, more, refreshStats, state, store, toast, todayIso, xpFly, celebrate } from '../core.js';
import { openRemind } from './remind.js';

const uid = () => state.me?.id;
const kBallot = (eid) => `ballot:${uid()}:${eid}`;
const kPlan = (eid) => `plan:${uid()}:${eid}`;
const kPlaces = () => `places:${uid()}`;
const kElections = () => `elections:${uid()}`;
const kMode = 'ballotMode';

// Ballots used to be editable, with changes and a change log kept on the device. Clear any leftovers.
function dropOldOverrides() {
  try {
    const old = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^ovr(log)?:/.test(k)) old.push(k);
    }
    old.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

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

const labelOf = (c, id) => c.choices.find((x) => x.id === id)?.label || '';
const partyOf = (c, id) => c.choices.find((x) => x.id === id)?.party || '';

/** Minute Man's picks for a race. Every pick is Minute Man's, whichever rule filled it in. */
function recOf(c) {
  const valid = new Set(c.choices.map((x) => x.id));
  return { ids: c.recommendation.choiceIds.filter((id) => valid.has(id)) };
}

function daysLine(e) {
  const d = daysTo(e.date);
  const left = d > 1 ? `${d} days left` : d === 1 ? 'Election day is tomorrow' : d === 0 ? 'Election day is today' : 'This election is over';
  return `${fmtDate(e.date)}. ${left}.`;
}

/** The compact list for the side panel on the voting page. */
function cheatSheet(b) {
  return `<ol class="cheat">${b.contests.map((c) => {
    const { ids } = recOf(c);
    return `<li><span class="ct">${esc(c.title)}</span><span class="cp">${ids.length ? esc(ids.map((id) => labelOf(c, id)).join(', ')) : '<span class="muted">No pick</span>'}</span></li>`;
  }).join('')}</ol>`;
}

/** View mode: one row per race and Minute Man's pick. Made to read in the booth. */
function slateHtml(b) {
  if (!b.contests.length) return '<div class="panel empty"><p>No contests on your ballot for this election.</p></div>';
  return `<ol class="slate">${b.contests.map((c) => {
    const { ids } = recOf(c);
    return `<li>
      <span class="race">${esc(c.title)}${c.voteFor > 1 ? ` <span class="tiny muted">(vote for up to ${c.voteFor})</span>` : ''}</span>
      ${ids.length
        ? `<b class="name">${esc(ids.map((id) => labelOf(c, id)).join(', '))}</b>`
        : '<span class="muted none">No pick</span>'}
    </li>`;
  }).join('')}</ol>`;
}

/** Examine mode: each race with the reasons behind its pick, and a way to mark it reviewed. */
function examineHtml(c, seen) {
  const { ids } = recOf(c);
  const names = ids.map((id) => labelOf(c, id)).join(' and ');
  const why = [];
  // The reasoning: a published write-up where one backs this pick (credited to its author), otherwise
  // Minute Man's own short line about why this candidate was picked.
  const written = ids.length ? (c.sources || []).find((s) => s.note && ids.every((id) => s.choiceIds.includes(id))) : null;
  if (written) {
    why.push(`<blockquote>${esc(written.note)}</blockquote>
      <p class="credit tiny muted">Write-up: ${esc(written.name)}${written.url ? ` <a href="${esc(written.url)}" target="_blank" rel="noopener">Source</a>` : ''}</p>`);
  } else if (ids.length) {
    why.push(`<p>${esc(c.recommendation.why || (ids.length > 1 ? "Minute Man's picks for this race." : "Minute Man's pick for this race."))}</p>`);
  } else {
    why.push('<p>Minute Man doesn\'t make picks on ballot measures. It\'s your call.</p>');
  }
  const others = c.choices.filter((ch) => !ids.includes(ch.id));
  return `<section class="contest exam" data-c="${esc(c.id)}">
    <header><h3>${esc(c.title)}</h3><span class="rule">${c.voteFor > 1 ? `Vote for up to ${c.voteFor}` : 'Vote for 1'}</span></header>
    ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
    <div class="pickline">${ids.length
      ? `<div><span class="eyebrow tiny muted">Minute Man's pick${ids.length > 1 ? 's' : ''}</span><b class="name">${esc(names)}</b>${ids.length === 1 && partyOf(c, ids[0]) ? ` <span class="muted small">${esc(partyOf(c, ids[0]))}</span>` : ''}</div>`
      : '<div class="muted">No pick</div>'}</div>
    <div class="note">${why.join('')}
      ${others.length ? `<p class="small muted">Also on the ballot: ${others.map((ch) => `${esc(ch.label)}${ch.party ? ` (${esc(ch.party)})` : ''}`).join(', ')}.</p>` : ''}</div>
    <footer class="review noprint">${seen
      ? `<span class="reviewed">${icon('check')}Reviewed</span>`
      : '<button class="btn sm" data-review>Got it</button>'}</footer>
  </section>`;
}

// ---------- sample ballot ----------
export async function render(el, eid, sub) {
  dropOldOverrides();
  let els = [];
  if (!eid) {
    els = await loadElections();
    if (!els.length) {
      el.innerHTML = `<div class="vb"><h1>Ballot</h1><div class="panel empty">
        ${icon('ballot', 'empty-ico')}<h2>No elections coming up</h2>
        <p>${state.me?.jurisdictionId ? 'We don\'t have a ballot for where you live yet. You can still browse every endorsement in your state.' : 'Add your home address so we can find your ballot.'}</p>
        <a class="btn go" href="${state.me?.jurisdictionId ? '#/endorsements' : '#/me/profile'}">${state.me?.jurisdictionId ? 'See endorsements' : 'Add your address'}</a></div></div>`;
      return;
    }
    eid = els[0].id;
  } else {
    els = store.get(kElections()) || [];
    loadElections().catch(() => {});
  }
  // #/ballot/<id>/examine (the quest link) opens the detailed view.
  if (sub === 'examine' || sub === 'ballot') { store.set(kMode, sub); history.replaceState(null, '', `#/ballot/${encodeURIComponent(eid)}`); }
  let mode = store.get(kMode, 'ballot') === 'examine' ? 'examine' : 'ballot';
  const { b, offline } = await loadBallot(eid);
  // Races you've reviewed (the daily quest counts these). The server hears which race, never the pick.
  const seen = new Set(b.reviewed || []);
  const e = b.election;
  const others = els.filter((x) => x.id !== eid);

  const total = b.contests.length;
  const reviewBar = () => {
    if (!total) return '';
    const n = b.contests.filter((c) => seen.has(c.id)).length;
    return `<div class="panel review-bar noprint" role="status">
      <div class="row between"><strong>${n >= total ? `All ${total} races reviewed` : `Review all ${total} races`}</strong>
        <span class="small muted num">${n} of ${total}</span></div>
      <div class="bar" role="progressbar" aria-label="Races reviewed" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${n}"><div style="width:${(n / total) * 100}%"></div></div>
      ${n >= total ? '<p class="small" style="margin:8px 0 0">You\'ve read the reasons behind every pick. <a href="#/today">Claim your quest on Today</a>.</p>'
        : `<p class="small muted" style="margin:8px 0 0">Read why each pick was made and tap Got it. ${n ? '<button class="link-btn" id="nextRace">Go to the next race</button>' : ''}</p>`}
    </div>`;
  };
  const nextUnseen = () => b.contests.find((c) => !seen.has(c.id));
  const goTo = (c) => c && el.querySelector(`.contest[data-c="${CSS.escape(c.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const markReviewed = async (c, { advance = false } = {}) => {
    if (seen.has(c.id)) return;
    if (offline) { toast("You're offline. Reviews save when you're back online."); return; }
    await api(`/elections/${encodeURIComponent(eid)}/reviewed`, { method: 'POST', body: { contestId: c.id } });
    seen.add(c.id);
    b.reviewed = [...seen];
    store.set(kBallot(eid), b);
    const scroll = window.scrollY;
    draw();
    window.scrollTo(0, scroll);
    if (seen.size >= total && b.contests.every((x) => seen.has(x.id))) {
      haptic('success');
      toast('Ballot reviewed. Claim your quest on Today.');
      refreshStats();
    } else if (advance) goTo(nextUnseen());
  };

  const draw = () => {
    const cta = `<a class="btn go block" href="#/vote/${esc(eid)}">Take it to the polls</a>`;
    const exam = mode === 'examine';
    el.innerHTML = `<div class="vb page two">
      <div class="main">
        <div>
          <a class="back noprint" href="#/today">${icon('chevron')}Today</a>
          ${others.length ? `<nav class="seg noprint" aria-label="Elections" style="margin-bottom:14px">${[e, ...others].map((x) => `<a href="#/ballot/${esc(x.id)}" class="${x.id === eid ? 'on' : ''}">${esc(x.name)}</a>`).join('')}</nav>` : ''}
          <h1>${esc(e.name)}</h1>
          <p class="muted">${esc(daysLine(e))}</p>
          ${offline ? '<p class="tag hot">Offline. Showing your saved ballot.</p>' : ''}
          <div class="narrow-only noprint" style="margin-top:14px">${cta}</div>
        </div>
        <div class="seg noprint" role="tablist" aria-label="Ballot view">
          <button role="tab" data-mode="ballot" aria-selected="${!exam}" class="${exam ? '' : 'on'}">Ballot</button>
          <button role="tab" data-mode="examine" aria-selected="${exam}" class="${exam ? 'on' : ''}">See why</button>
        </div>
        ${exam ? reviewBar() : ''}
        ${exam
          ? `<div class="sheets">${b.contests.map((c) => examineHtml(c, seen.has(c.id))).join('') || '<div class="panel empty"><p>No contests on your ballot for this election.</p></div>'}</div>`
          : `<div class="panel slate-panel"><h2 class="picks-head">Minute Man's picks</h2>${slateHtml(b)}
              <p class="small noprint" style="margin:12px 0 0"><button class="link-btn" id="seeWhy">See why each pick was made</button></p></div>`}
        <div class="ballot-info">
          ${more('How Minute Man picks', '<p class="small">Minute Man\'s picks draw on America First Insight\'s and President Trump\'s public endorsements. Every other race still gets a pick, by a fixed rule: the Republican running, or the only candidate, or with no Republican the closest right-of-center party, or in a nonpartisan race the incumbent or the first listed. Minute Man isn\'t run by or affiliated with them, or with any party, campaign or candidate.</p>')}
          ${state.me?.jurisdictionId && !state.me.jurisdictionId.includes('-') ? more('Some races are missing', `<p class="small">This shows statewide races only. Races for your congressional and legislative districts aren't loaded for your area yet. <a href="#/endorsements">See every endorsement in your state</a>.</p>`) : ''}
        </div>
        <p class="legal">You vote however you choose, and your ballot is secret. Minute Man never knows how you vote.</p>
      </div>
      <aside class="side">
        <div class="panel">
          <div class="section-head"><h2>Election day</h2><button class="link-btn noprint" id="print">Print</button></div>
          <p class="small">Paper notes are allowed in the booth in most places. Phones may not be.</p>
          <p class="small noprint" style="margin-top:12px"><a href="#/endorsements">See every endorsement in your state</a></p>
          <div class="wide-only noprint" style="margin-top:16px">${cta}</div>
        </div>
      </aside>
    </div>`;
    $('#print', el).onclick = () => print();
    const setMode = (m) => {
      mode = m;
      store.set(kMode, m);
      haptic();
      draw();
      window.scrollTo(0, 0);
    };
    $$('[data-mode]', el).forEach((btn) => (btn.onclick = () => btn.dataset.mode !== mode && setMode(btn.dataset.mode)));
    $('#seeWhy', el)?.addEventListener('click', () => setMode('examine'));
    $$('[data-review]', el).forEach((btn) => (btn.onclick = guard(async () => {
      btn.disabled = true;
      try { await markReviewed(b.contests.find((x) => x.id === btn.closest('.contest').dataset.c), { advance: true }); haptic(); } finally { btn.disabled = false; }
    })));
    $('#nextRace', el)?.addEventListener('click', () => goTo(nextUnseen()));
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
  const lookup = b.rules?.pollingLookupUrl;
  const noPlaces = `<p class="muted small">Your county posts early voting sites and election-day locations closer to the election.${lookup ? ` <a href="${esc(lookup)}" target="_blank" rel="noopener">Check your county's election page</a>.` : ' Check your county election office.'}</p>`;
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
        <button class="btn go block" id="remindBtn">Remind someone to vote</button></div>`;
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
          <div class="opts" id="places">${shown.length ? shown.map((p) => placeRow(p, where ? String(where.id ?? where.name) : '')).join('') : noPlaces}</div></div>
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
        <a class="btn go block" href="#/ballot/${esc(eid)}">See who to vote for</a></div>`;
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
          <div class="section-head"><h2>Cheat sheet</h2><a href="#/ballot/${esc(eid)}" class="noprint">See ballot</a></div>
          ${cheatSheet(b)}
          <p class="small noprint" style="margin-top:12px"><a href="#/endorsements">See every endorsement in your state</a></p>
          <p class="tiny muted" style="margin-top:12px">Paper notes are allowed in the booth in most places. Phones may not be. <button class="link-btn tiny noprint" id="print">Print it</button></p>
        </div>
      </aside>
    </div>`;

    $('#print', el).onclick = () => print();
    $('#remindBtn', el)?.addEventListener('click', guard(() => openRemind()));
    $('#editPlan', el)?.addEventListener('click', () => { editing = true; draw(); });
    $('#cancelEdit', el)?.addEventListener('click', () => { editing = false; draw(); });
    $('#already', el)?.addEventListener('click', () => { planned = true; editing = false; draw(); });
    const form = $('#planForm', el);
    if (form) {
      // Changing "how" narrows the place list; keep the form's other state.
      $$('input[name=how]', form).forEach((r) => (r.onchange = () => {
        const chosen = $('input[name=place]:checked', form)?.value || '';
        $('#places', el).innerHTML = placesFor(r.value).map((p) => placeRow(p, chosen)).join('') || noPlaces;
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
      await celebrate({ big: '+100', title: 'You voted', body: 'Thanks for showing up. Now bring someone with you.', cta: 'Remind someone to vote' });
      draw();
      openRemind();
    };
  };
  draw();
}

// ---------- endorsements browser ----------
const STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

const lastName = (n = '') => n.trim().split(/\s+/).pop().toLowerCase();

export async function renderEndorsements(el, st) {
  const d = await api(`/endorsements${st ? `?state=${encodeURIComponent(st)}` : ''}`);
  const sourceBlurb = (state.leaders || []).filter((l) => d.sources.includes(l.name));
  el.innerHTML = `<div class="vb page">
    <p class="noprint"><a href="#/ballot" class="link-btn">Back to your ballot</a></p>
    <div class="row between wrap" style="gap:12px;align-items:end">
      <div><h1>Endorsements</h1>
      <p class="muted">2026 general election. ${esc(d.sources.join(' first, then '))} where the first hasn't picked.</p></div>
      <label class="field" style="min-width:120px">State
        <select id="st">${STATES.map((x) => `<option ${x === d.state ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    ${d.races.length ? `<ol class="endorse-list">${d.races.map((r) => `<li class="panel">
      <div class="row between wrap"><h3>${esc(r.label)}</h3>${r.pick ? `<span class="tag">${esc(r.pick.sourceName)}</span>` : ''}</div>
      ${r.pick ? `<p><b>${esc(r.pick.candidate)}</b>${r.pick.party ? ` (${esc(r.pick.party)})` : ''}${r.pick.note ? `<br><span class="small muted">${esc(r.pick.note)}</span>` : ''}</p>` : ''}
      ${r.picks.filter((p) => p.source !== r.pick?.source).map((p) => `<p class="small muted">${lastName(p.candidate) === lastName(r.pick?.candidate) ? `Also endorsed by ${esc(p.sourceName)}.` : `${esc(p.sourceName)} endorses ${esc(p.candidate)} instead.`}</p>`).join('')}
      ${r.pick?.url ? `<p class="tiny"><a href="${esc(r.pick.url)}" target="_blank" rel="noopener">Source</a></p>` : ''}
    </li>`).join('')}</ol>`
    : `<div class="panel empty"><h2>No endorsements in ${esc(d.state)} yet</h2><p>Neither source has endorsed in a ${esc(d.state)} race for November 2026. Pick another state to look around.</p></div>`}
    <p class="legal">${sourceBlurb.map((l) => esc(l.blurb || l.description || '')).filter(Boolean).join(' ')} Endorsements are shown as each source published them.</p>
  </div>`;
  $('#st', el).onchange = (e) => { location.hash = `#/endorsements/${e.target.value}`; };
}
