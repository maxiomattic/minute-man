// Act: local volunteer events, check-ins, and self-logged civic work.
import { $, $$, ACTIVITY_ICON, ago, api, confetti, esc, fmtWhen, guard, haptic, icon, more, refreshStats, sheet, state, toast, xpFly } from '../core.js';

const kindOf = (k) => state.meta?.activityKinds?.find((x) => x.kind === k) || { kind: k, label: k, self: 0, verified: 0 };
const localDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const parseTs = (s) => new Date(s.replace(' ', 'T') + 'Z');

/** "+30" for flat kinds, "+1 per door" for per-unit kinds. */
function xpText(k, verified = true) {
  if (k.perUnit) return `+${k.perUnit} per ${k.unit}`;
  return `+${verified ? k.verified : k.self}`;
}
function selfPoints(k, qty) {
  return k.perUnit ? Math.min(k.dailyCap || Infinity, qty * k.perUnit) : k.self;
}

function bucket(a) {
  const d = Math.round((localDay(parseTs(a.starts_at)) - localDay(new Date())) / 86400000);
  if (d < 0) return 'Recent';
  if (d === 0) return 'Today';
  if (d < 7) return 'This week';
  return 'Later';
}

function stepper(name, unit, value = 1) {
  return `<div class="stepper" data-step>
    <button type="button" class="btn quiet sm" data-d="-1" aria-label="Fewer">&minus;</button>
    <input name="${name}" type="number" inputmode="numeric" min="1" max="1000" value="${value}" aria-label="Number of ${esc(unit)}s">
    <button type="button" class="btn quiet sm" data-d="1" aria-label="More">+</button>
    <span class="muted small">${esc(unit)}s</span></div>`;
}
function wireSteppers(root) {
  $$('[data-step]', root).forEach((s) => {
    const inp = $('input', s);
    $$('button', s).forEach((b) => (b.onclick = () => {
      inp.value = Math.max(1, Math.min(1000, (Number(inp.value) || 0) + Number(b.dataset.d)));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      haptic();
    }));
  });
}

/** Points land: fly the XP, celebrate a lucky bonus, refresh header chips. */
async function landPoints(points, lucky, fromEl) {
  xpFly(points + lucky, fromEl);
  if (lucky > 0) {
    setTimeout(() => {
      confetti(48);
      const m = document.createElement('div');
      m.className = 'lucky-pop';
      m.setAttribute('role', 'status');
      m.innerHTML = `${icon('star')}<span><b>Lucky bonus</b><br>+${lucky} XP</span>`;
      document.body.append(m);
      haptic('success');
      setTimeout(() => m.remove(), 2600);
    }, 500);
  }
  await refreshStats();
}

function openEvent(a, rerender) {
  if (a.kind === 'social' && !a.done) return openShare(rerender, a.id);
  const k = kindOf(a.kind);
  const host = a.leaderName || a.groupName;
  const half = k.perUnit ? null : k.self;
  const { el, close } = sheet(`<div class="vb">
    <div class="row" style="align-items:flex-start;margin-bottom:8px"><span class="ico lg">${icon(ACTIVITY_ICON[a.kind] || 'star')}</span>
      <div class="grow"><p class="kick" style="margin:0">${esc(k.label)}</p><h2 style="margin:2px 0 0">${esc(a.title)}</h2></div>
      <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <ul class="facts">
      <li>${icon('calendar')}<span>${esc(fmtWhen(a.starts_at))}</span></li>
      ${a.location ? `<li>${icon('pin')}<span>${esc(a.location)}</span></li>` : ''}
      ${host ? `<li>${icon('crew')}<span>Hosted by ${esc(host)}</span></li>` : ''}
    </ul>
    ${a.description ? `<p>${esc(a.description)}</p>` : ''}
    ${!a.done && parseTs(a.starts_at) > Date.now() - 2 * 3600e3 ? `<div class="going-row" id="goingRow"></div>` : ''}
    ${a.checkinCode ? `<div class="code-card"><span class="small">Your event's check-in code</span><b class="num">${esc(a.checkinCode)}</b><span class="tiny muted">Show it at the event so people get full points.</span></div>` : ''}
    ${a.done ? '<p class="tag good" style="margin-top:12px">Checked in</p>' : `
    <form id="ci" class="stack" style="margin-top:14px">
      <div><label class="field" for="code">Check-in code</label>
        <input id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="From the host, like COUNCIL1" class="code-input"></div>
      ${k.perUnit ? `<div><label class="field">How many ${esc(k.unit)}s?</label>${stepper('quantity', k.unit)}</div>` : ''}
      <button class="btn go block" type="submit">Check in <span class="xp">${k.perUnit ? `+${k.verifiedBonus || 0} bonus` : `+${k.verified}`}</span></button>
      <p class="center small"><button type="button" class="link-btn" id="nocode">Check in without a code</button>
        <span class="muted">${half != null ? `+${half} XP, half points` : `+${k.perUnit} per ${esc(k.unit)}, no bonus`}</span></p>
    </form>`}
  </div>`);
  $('[data-close]', el).onclick = close;
  // "I'm going": an RSVP the host can count on. It's what the events quest asks for.
  const goingRow = $('#goingRow', el);
  const paintGoing = () => {
    if (!goingRow) return;
    const others = (a.goingCount || 0) - (a.going ? 1 : 0);
    goingRow.innerHTML = a.going
      ? `<span class="tag good">${icon('check')}You're going</span><span class="grow small muted">${others > 0 ? `${others} other${others === 1 ? '' : 's'} going` : ''}</span><button class="link-btn" id="notGoing">Can't make it</button>`
      : `<button class="btn" id="imGoing">I'm going</button><span class="grow small muted">${others > 0 ? `${others} going` : 'Let the host know to expect you.'}</span>`;
    const setGoing = (going) => guard(async () => {
      const r = await api(`/actions/${a.id}/rsvp`, { method: 'POST', body: { going } });
      a.going = r.going; a.goingCount = r.goingCount;
      haptic(going ? 'success' : undefined);
      toast(going ? "You're going. Check in there with the host's code for full points." : 'Got it. You\'re off the list.');
      paintGoing();
      refreshStats();
      rerender();
    });
    $('#imGoing', goingRow)?.addEventListener('click', setGoing(true));
    $('#notGoing', goingRow)?.addEventListener('click', setGoing(false));
  };
  paintGoing();
  wireSteppers(el);
  const form = $('#ci', el);
  if (!form) return;
  const go = async (withCode) => {
    const code = $('#code', el).value.trim().toUpperCase();
    if (withCode && !code) { toast('Enter the code from the host, or check in without one.'); $('#code', el).focus(); return; }
    const qty = Number(form.quantity?.value) || 1;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const r = await api(`/actions/${a.id}/checkin`, { method: 'POST', body: withCode ? { code, quantity: qty } : { quantity: qty } });
      close();
      toast(`Checked in. +${r.points + (r.lucky || 0)} XP`);
      await landPoints(r.points, r.lucky || 0, btn.isConnected ? btn : null);
      rerender();
    } catch (e) {
      btn.disabled = false;
      toast(/wrong/i.test(e.message) ? "That code doesn't match. Check it with the host and try again." : e.message);
    }
  };
  form.onsubmit = (e) => { e.preventDefault(); go(true); };
  $('#nocode', el).onclick = () => go(false);
}

/**
 * Share a ready-made post from your own account. The phone's share sheet sends it; finishing the share
 * (or copying it) is what records the post. Cancelling records nothing. Minute Man never posts for you.
 */
async function sendPost(text, url) {
  const NativeShare = window.Capacitor?.Plugins?.Share;
  try {
    if (NativeShare) { await NativeShare.share({ title: 'Minute Man', text, url, dialogTitle: 'Share this post' }); return true; }
    if (navigator.share) { await navigator.share({ text, url }); return true; }
  } catch (e) {
    if (e?.name === 'AbortError' || /cancel/i.test(e?.message || '')) return false;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    toast("Couldn't open sharing on this device.");
    return false;
  }
}

export async function openShare(rerender, actionId = null) {
  const d = await api('/posts');
  if (!d.posts.length) return toast('Nothing to share yet.');
  let i = 0;
  const { el, close } = sheet(`<div class="vb">
    <div class="row between" style="margin-bottom:4px"><h2 style="margin:0">Share a post</h2>
      <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <p class="muted small" id="pts"></p>
    <figure class="post-card"><p class="post-text" id="ptext"></p><figcaption class="post-link" id="plink"></figcaption></figure>
    <div class="row between" style="margin:6px 0 14px"><span class="tiny muted" id="pcount"></span>
      <button type="button" class="link-btn" id="pnext">Show another</button></div>
    <button class="btn go block" id="psend">Share this post</button>
    <p class="tiny muted center" style="margin-top:10px">Posts go out from your own account, only when you send them.</p>
  </div>`);
  $('[data-close]', el).onclick = close;
  const btn = $('#psend', el);
  const paint = () => {
    const p = d.posts[i];
    $('#ptext', el).textContent = p.text;
    $('#plink', el).textContent = d.url.replace(/^https?:\/\//, '');
    $('#pcount', el).textContent = `${i + 1} of ${d.posts.length}`;
    $('#pnext', el).hidden = d.posts.length < 2;
    const left = d.pointsLeftToday;
    $('#pts', el).textContent = left > 0 ? `+${d.perPost} XP per share, up to ${d.dailyCap} a day.`
      : "You've earned today's share points. Shares still count toward your goal.";
    btn.innerHTML = `Share this post${left > 0 ? ` <span class="xp">+${Math.min(d.perPost, left)}</span>` : ''}`;
  };
  paint();
  $('#pnext', el).onclick = () => { i = (i + 1) % d.posts.length; haptic(); paint(); };
  btn.onclick = guard(async () => {
    const p = d.posts[i];
    btn.disabled = true;
    try {
      const how = await sendPost(p.text, d.url);
      if (!how) return;
      const r = await api('/posts/share', { method: 'POST', body: { postId: p.id, actionId: actionId || undefined } });
      d.pointsLeftToday = Math.max(0, d.pointsLeftToday - r.points);
      haptic('success');
      const xp = r.points ? ` +${r.points} XP` : '';
      toast(how === 'copied' ? `Copied. Paste it into any app.${xp}` : r.points ? `Shared.${xp}` : 'Shared. Thanks for spreading the word.');
      if (r.points) xpFly(r.points, btn);
      refreshStats();
      // Offer the next post so sharing a few in a row is easy.
      if (d.posts.length > 1) i = (i + 1) % d.posts.length;
      paint();
      rerender?.();
    } finally { btn.disabled = false; }
  });
}

/** Log one specific kind of work (a task from your list or skill tree). No catch-all picker. */
function openLog(rerender, kind) {
  if (kind === 'social') return openShare(rerender);
  const pick = (state.meta?.activityKinds || []).find((k) => k.kind === kind);
  if (!pick) return toast('Pick a task from your list.');
  const title = { canvass: 'Log doors you knocked', phonebank: 'Log calls you made', election_work: 'Log your election shift',
    party_meeting: 'Log a party meeting', council_meeting: 'Log a council meeting', volunteer: 'Log a campaign shift', gotv: 'Log a GOTV shift' }[kind] || `Log: ${pick.label}`;
  const { el, close } = sheet(`<div class="vb">
    <div class="row between" style="margin-bottom:8px"><h2 style="margin:0">${esc(title)}</h2>
      <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    ${pick.perUnit ? '' : '<p class="muted small">Checking in at the event with the host\'s code earns more.</p>'}
    <form id="lg">
      ${pick.perUnit ? `<label class="field">How many ${esc(pick.unit)}s?</label>${stepper('quantity', pick.unit)}` : ''}
      <label class="field" for="note">Note <span class="muted">(optional)</span></label>
      <input id="note" name="note" maxlength="280" placeholder="What happened?">
      <button class="btn go block" type="submit" style="margin-top:16px">Log it</button>
    </form></div>`);
  $('[data-close]', el).onclick = close;
  const form = $('#lg', el);
  const btn = $('button[type=submit]', form);
  const updateBtn = () => {
    const qty = Number(form.quantity?.value) || 1;
    btn.innerHTML = `Log it <span class="xp">+${selfPoints(pick, qty)}</span>`;
  };
  wireSteppers(el);
  updateBtn();
  form.addEventListener('input', updateBtn);
  form.onsubmit = guard(async (e) => {
    e.preventDefault();
    if (!pick) return toast('Pick what you did.');
    btn.disabled = true;
    try {
      const r = await api('/activity', { method: 'POST', body: { kind: pick.kind, quantity: Number(form.quantity?.value) || 1, note: form.note.value.trim() || undefined } });
      close();
      toast(r.points ? `Logged. +${r.points} XP` : "Logged. You've hit today's points cap for this one.");
      await landPoints(r.points, 0, null);
      rerender();
    } finally { btn.disabled = false; }
  });
}

/**
 * Events near you, the log button and your record. Lives inside the Today tab (`embedded`), so
 * "what I'm doing" is one place. Just looking doesn't count for quests; an RSVP or check-in does.
 */
export async function render(el, arg, { embedded = false, sub = null, onChange = null } = {}) {
  const [actions, activity, myGroups] = await Promise.all([
    api('/actions'),
    api('/activity').catch(() => []),
    api('/groups').catch(() => []),
  ]);
  // Today passes onChange so an RSVP or check-in also refreshes its quests.
  const rerender = onChange || (() => render(el, null, { embedded }));

  const groups = {};
  for (const a of actions) (groups[bucket(a)] ||= []).push(a);
  const order = ['Today', 'This week', 'Later', 'Recent'];
  const row = (a) => {
    const k = kindOf(a.kind);
    const host = a.leaderName || a.groupName;
    return `<li><button class="rowbtn" data-a="${a.id}">
      <span class="ico">${icon(ACTIVITY_ICON[a.kind] || 'star')}</span>
      <span class="grow"><span class="title">${esc(a.title)}</span>
        <span class="sub">${esc(fmtWhen(a.starts_at))}${a.location ? `, ${esc(a.location)}` : ''}</span>
        ${host ? `<span class="sub">${esc(host)}</span>` : ''}</span>
      ${a.done ? '<span class="tag good">Done</span>' : a.going ? '<span class="tag good">Going</span>' : `<span class="xp">${esc(xpText(k))}</span>`}
    </button></li>`;
  };

  const rec = activity.slice(0, 8).map((x) => {
    const k = kindOf(x.kind);
    const qty = k.perUnit ? `${x.quantity} ${k.unit}${x.quantity === 1 ? '' : 's'}` : '';
    const what = x.title ? (qty ? `${x.title}: ${qty}` : x.title) : (qty ? `${k.label}: ${qty}` : k.label);
    return `<li><span class="ico sm">${icon(ACTIVITY_ICON[x.kind] || 'star')}</span>
      <span class="grow"><span class="title">${esc(what)}</span><span class="sub">${esc(ago(x.at))} ago${x.verified ? ', checked in' : ''}</span></span>
      <span class="num pts">+${x.points}</span></li>`;
  }).join('');

  el.innerHTML = `<div class="vb page two">
    <div class="main">
      <div>
        <h1>Act</h1>
        <p class="muted">Block walks, phone banks and meetups near you. Check in with the host's code for full points.</p>
      </div>
      ${actions.length ? order.filter((g) => groups[g]).map((g) => `<section>
        <div class="section-head"><h2>${g}</h2><span class="muted small">${groups[g].length}</span></div>
        <div class="panel flush"><ul class="list">${groups[g].map(row).join('')}</ul></div></section>`).join('')
        : `<div class="panel empty">${icon('calendar', 'empty-ico')}<h2>No events yet</h2><p>Join a local group with its invite code. Its block walks and meetups show up here.</p><a class="btn line" href="#/board/groups">Join a group</a></div>`}
    </div>
    <aside class="side">
      <section>
        <div class="section-head"><h2>Your record</h2></div>
        <div class="panel flush">${rec ? `<ul class="list compact">${rec}</ul>` : '<div class="empty"><p>Nothing logged yet. Your first check-in shows up here.</p></div>'}</div>
      </section>
      <p class="legal">Points are for fun. They can't be traded for anything.</p>
    </aside>
  </div>`;

  if (embedded) {
    const upcoming = order.filter((g) => g !== 'Recent' && groups[g]);
    el.innerHTML = `<section id="events">
        <div class="section-head"><h2 class="h3">Events near you</h2>${actions.length ? `<span class="muted small">${actions.filter((a) => bucket(a) !== 'Recent').length}</span>` : ''}</div>
        ${upcoming.length ? `<div class="panel flush"><ul class="list">${upcoming.flatMap((g) => groups[g]).map(row).join('')}</ul></div>`
          : `<div class="panel small muted">No events coming up. <a href="#/board/groups">Join a local group</a> and its block walks and meetups show up here.</div>`}
        ${rec ? more('Your record', `<div class="panel flush"><ul class="list compact">${rec}</ul></div>`) : ''}
        ${myGroups.length ? `<p class="small"><button class="link-btn" id="host">${icon('plus')}Host an event</button> <span class="muted">for ${esc(myGroups.length === 1 ? myGroups[0].name : 'one of your groups')}</span></p>` : ''}
      </section>`;
  }
  $('#host', el)?.addEventListener('click', () => hostEvent(myGroups, rerender));
  $$('[data-a]', el).forEach((b) => (b.onclick = () => openEvent(actions.find((a) => a.id === Number(b.dataset.a)), rerender)));
  // Deep links open a sheet once; drop the arg so a reload doesn't reopen it.
  if (arg) history.replaceState(null, '', embedded ? '#/today' : '#/act');
  if (arg === 'log') openLog(rerender, sub);
  else if (arg === 'share') openShare(rerender);
  else if (arg && /^\d+$/.test(arg)) {
    const a = actions.find((x) => x.id === Number(arg));
    if (a) openEvent(a, rerender); else toast("That event isn't on your list anymore.");
  }
}

/** Create an event for one of your groups. Shows its check-in code after. */
function hostEvent(groups, rerender) {
  const local = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; };
  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(18);
  const { el: s, close } = sheet(`<div class="vb"><div class="row between"><h2 style="margin:0">Host an event</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <form id="ev">
      ${groups.length > 1 ? `<label class="field" for="eg">For</label><select id="eg" name="groupId">${groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>` : `<input type="hidden" name="groupId" value="${groups[0].id}">`}
      <label class="field" for="ek">What kind?</label><select id="ek" name="kind">${(state.meta?.activityKinds || []).map((k) => `<option value="${esc(k.kind)}">${esc(k.label)}</option>`).join('')}</select>
      <label class="field" for="et">Title</label><input id="et" name="title" required placeholder="Saturday block walk: Precinct 101">
      <label class="field" for="eloc">Where</label><input id="eloc" name="location" placeholder="Address, or Online">
      <label class="field" for="es">Starts</label><input id="es" name="startsAt" type="datetime-local" required value="${local(tomorrow)}">
      <label class="field" for="ed">Details</label><textarea id="ed" name="description" rows="2"></textarea>
      <button class="btn go block" style="margin-top:16px">Create event</button>
    </form></div>`);
  $('[data-close]', s).onclick = close;
  $('#ev', s).onsubmit = guard(async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.startsAt = new Date(fd.startsAt).toISOString().replace('T', ' ').slice(0, 19);
    const a = await api('/actions', { method: 'POST', body: fd });
    close();
    haptic('success');
    const { el: done, close: c2 } = sheet(`<div class="vb center"><h2>Created your event</h2>
      <p class="muted">${esc(a.title)}</p>
      <div class="code-card big"><span class="small">Check-in code</span><b class="num">${esc(a.checkin_code)}</b><span class="tiny muted">Show it at the event. People who enter it get full points.</span></div>
      <button class="btn block" style="margin-top:16px" data-close>Done</button></div>`);
    $('[data-close]', done).onclick = () => { c2(); rerender(); };
  });
}
