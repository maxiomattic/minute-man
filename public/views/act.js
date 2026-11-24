// Act: events from people you follow, check-ins, and self-logged civic work.
import { $, $$, ACTIVITY_ICON, ago, api, confetti, esc, fmtWhen, guard, haptic, icon, refreshStats, sheet, state, toast, xpFly } from '../core.js';

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

function openLog(rerender) {
  const kinds = state.meta?.activityKinds || [];
  let pick = null;
  const { el, close } = sheet(`<div class="vb">
    <div class="row between" style="margin-bottom:8px"><h2 style="margin:0">Log something you did</h2>
      <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <p class="muted small">Logging on your own earns fewer points than checking in at an event with the host's code.</p>
    <form id="lg">
      <div class="tiles" role="radiogroup" aria-label="What did you do?">${kinds.map((k) => `<label class="tile">
        <input type="radio" name="kind" value="${esc(k.kind)}">${icon(ACTIVITY_ICON[k.kind] || 'star')}
        <span>${esc(k.label)}</span><span class="xp">${k.perUnit ? `+${k.perUnit}/${esc(k.unit)}` : `+${k.self}`}</span></label>`).join('')}</div>
      <div id="qty"></div>
      <label class="field" for="note">Note <span class="muted">(optional)</span></label>
      <input id="note" name="note" maxlength="280" placeholder="What happened?">
      <button class="btn go block" type="submit" style="margin-top:16px" disabled>Log it</button>
    </form></div>`);
  $('[data-close]', el).onclick = close;
  const form = $('#lg', el);
  const btn = $('button[type=submit]', form);
  const updateBtn = () => {
    if (!pick) return;
    const qty = Number(form.quantity?.value) || 1;
    btn.innerHTML = `Log it <span class="xp">+${selfPoints(pick, qty)}</span>`;
  };
  $$('input[name=kind]', form).forEach((r) => (r.onchange = () => {
    pick = kindOf(r.value);
    $('#qty', el).innerHTML = pick.perUnit ? `<label class="field">How many ${esc(pick.unit)}s?</label>${stepper('quantity', pick.unit)}` : '';
    wireSteppers(el);
    btn.disabled = false;
    updateBtn();
    haptic();
  }));
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

export async function render(el, arg) {
  api('/events', { method: 'POST', body: { kind: 'events_viewed' } }).then(refreshStats).catch(() => {});
  const [actions, activity, mine] = await Promise.all([
    api('/actions'),
    api('/activity').catch(() => []),
    api('/leaders/mine').catch(() => []),
  ]);
  const rerender = () => render(el);

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
      ${a.done ? '<span class="tag good">Done</span>' : `<span class="xp">${esc(xpText(k))}</span>`}
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
        <p class="muted">Meetings, doors and calls from people you follow. Check in with the host's code for full points.</p>
        <button class="btn go block" id="log" style="margin-top:12px">${icon('plus')}Log something you did</button>
      </div>
      ${actions.length ? order.filter((g) => groups[g]).map((g) => `<section>
        <div class="section-head"><h2>${g}</h2><span class="muted small">${groups[g].length}</span></div>
        <div class="panel flush"><ul class="list">${groups[g].map(row).join('')}</ul></div></section>`).join('')
        : `<div class="panel empty">${icon('calendar', 'empty-ico')}<h2>No events yet</h2><p>Follow local groups and people you trust. Their meetings and canvasses show up here.</p><a class="btn line" href="#/leaders">Find people to follow</a></div>`}
    </div>
    <aside class="side">
      <section>
        <div class="section-head"><h2>Your record</h2></div>
        <div class="panel flush">${rec ? `<ul class="list compact">${rec}</ul>` : '<div class="empty"><p>Nothing logged yet. Your first check-in shows up here.</p></div>'}</div>
      </section>
      ${mine.length ? `<p class="small"><a href="#/lead/${mine[0].id}">Host an event</a> <span class="muted">for ${esc(mine[0].name)}</span></p>` : ''}
      <p class="legal">Points are for fun. They can't be traded for anything.</p>
    </aside>
  </div>`;

  $('#log', el).onclick = () => openLog(rerender);
  $$('[data-a]', el).forEach((b) => (b.onclick = () => openEvent(actions.find((a) => a.id === Number(b.dataset.a)), rerender)));
  if (arg === 'log') openLog(rerender);
  else if (arg && /^\d+$/.test(arg)) {
    const a = actions.find((x) => x.id === Number(arg));
    if (a) openEvent(a, rerender); else toast("That event isn't on your list anymore.");
  }
}
