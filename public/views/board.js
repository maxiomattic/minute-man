// Leaderboard: where you stand, the people near you, your numbers and your honors.
// Everyone is listed; strangers see first name, last initial and town. Points are honorific and can't be traded for anything.
import { $, $$, api, esc, guard, icon, insignia, initials, plural, state, store } from '../core.js';
import { renderFriends, renderGroups } from './crew.js';

// Every badge the server can award (see scorecard() in src/engine/recognition.js).
export const BADGES = [
  ['registered', 'Registered', 'check', 'Confirm your voter registration'],
  ['voted', 'I Voted', 'ballot', 'Vote in an election'],
  ['primary', 'Primary Voter', 'ballot', 'Vote in a primary'],
  ['local', 'Local Voter', 'hall', 'Vote in a local or special election'],
  ['streak3', 'Habit', 'flame', 'Vote in 3 elections'],
  ['streak10', 'Fixture', 'trophy', 'Vote in 10 elections'],
  ['reminder', 'Reminder', 'chat', 'Remind 5 people to vote'],
  ['council', 'In the Room', 'hall', 'Go to a city council meeting'],
  ['party', 'Party Regular', 'hand', 'Go to a local party meeting'],
  ['doors100', 'Shoe Leather', 'door', 'Knock 100 doors'],
  ['doors1000', 'Ground Game', 'door', 'Knock 1,000 doors'],
  ['calls100', 'Dialer', 'phone', 'Make 100 calls'],
  ['shifts5', 'Reliable', 'hand', 'Work 5 volunteer or GOTV shifts'],
  ['win', 'Victory', 'star', 'A candidate on your ballot wins'],
];
const PERIODS = [['week', 'This week'], ['month', '30 days'], ['all', 'All time']];
const n = (x) => Number(x || 0).toLocaleString('en-US');
const ord = (x) => { const s = ['th', 'st', 'nd', 'rd'], v = x % 100; return `${x}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const first = (name) => String(name || '').split(' ')[0];

export async function render(el, sub) {
  if (sub === 'friends' || sub === 'groups') {
    el.innerHTML = `<div class="crew"><a class="back" href="#/board">${icon('chevron')}Leaderboard</a>
      <h1>${sub === 'friends' ? 'Friends' : 'Groups'}</h1><div id="crewBody"><div class="skeleton"></div></div></div>`;
    await (sub === 'friends' ? renderFriends : renderGroups)($('#crewBody', el));
    return;
  }
  const [st, areas, groups] = await Promise.all([api('/standing'), api('/areas'), api('/groups').catch(() => [])]);
  const scopes = [...areas.map((a) => [a.scope, a.label]), ['friends', 'Friends'], ...groups.map((g) => [`group:${g.id}`, g.name])];
  let scope = store.get('lbscope', areas[0]?.scope || 'area:all');
  if (!scopes.some(([s]) => s === scope)) scope = areas[0]?.scope || 'area:all';
  let period = store.get('lbperiod', 'month');
  if (!PERIODS.some(([p]) => p === period)) period = 'month';
  const t = state.today;
  const rank = t?.rank;
  const earned = new Set(st.badges);
  const best = st.places.filter((p) => p.place && p.of > 1).sort((a, b) => a.place / a.of - b.place / b.of)[0];
  const maxWeek = Math.max(st.streak.goal, ...st.weeks.map((w) => w.points));

  el.innerHTML = `<div class="vb page two board-page">
    <div class="main">
      <h1>Leaderboard</h1>
      <section class="stand" aria-label="Where you stand">
        <div class="standing-top">
          <div><span class="standing-place num">${best ? ord(best.place) : '—'}</span>
            <span class="standing-of">${best ? `of ${n(best.of)} in ${esc(best.label.replace(/^Your /, 'your '))}, last 30 days` : 'Your place appears once you earn points'}</span></div>
          ${rank ? `<a class="commission" href="#/path">${insignia(rank.level)}<span class="commission-lvl">Level ${rank.level}</span><b>${esc(rank.name)}</b></a>` : ''}
        </div>
        <ul class="places">${st.places.map((p) => `<li><button data-scope="${esc(p.scope)}"><span>${esc(p.label)}</span><b class="num">${p.place ? ord(p.place) : '—'}</b></button></li>`).join('')}</ul>
      </section>

      <section aria-label="Rankings">
        <div class="board-controls">
          <label class="sr-only" for="lbScope">Who to compare with</label>
          <select id="lbScope">${scopes.map(([s, l]) => `<option value="${esc(s)}" ${s === scope ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <div class="seg" role="tablist" aria-label="Time period">${PERIODS.map(([p, l]) => `<button role="tab" data-p="${p}">${l}</button>`).join('')}</div>
        </div>
        <div id="boardOut"><div class="skeleton"></div></div>
      </section>
    </div>

    <aside class="side">
      <section aria-label="Your numbers">
        <div class="section-head"><h2>Your numbers</h2></div>
        <div class="panel">
          <div class="tally">
            ${[['door', st.totals.doors, 'doors'], ['phone', st.totals.calls, 'calls'], ['chat', st.totals.posts, 'posts'], ['hall', st.totals.meetings, 'meetings'], ['hand', st.totals.shifts, 'shifts'], ['crew', st.totals.recruits, 'recruits']]
              .map(([ic, v, l]) => `<div class="${v ? '' : 'zero'}">${icon(ic)}<b class="num">${n(v)}</b><span>${l}</span></div>`).join('')}
          </div>
          <div class="weeks" role="img" aria-label="Points per week, last 8 weeks: ${st.weeks.map((w) => w.points).join(', ')}">
            ${st.weeks.map((w, i) => `<div class="wk ${w.points >= st.streak.goal ? 'met' : ''} ${i === st.weeks.length - 1 ? 'now' : ''}"><i style="height:${Math.max(3, Math.round((w.points / maxWeek) * 100))}%"></i></div>`).join('')}
            <span class="goal" style="bottom:${Math.round((st.streak.goal / maxWeek) * 100)}%"></span>
          </div>
          <p class="small muted weeks-cap">Points each week. Weeks at ${st.streak.goal} or more keep your streak: ${plural(st.streak.weeks, 'week')} now.</p>
          <div class="pts-row"><div><b class="num">${n(st.points.week)}</b><span>this week</span></div><div><b class="num">${n(st.points.month)}</b><span>30 days</span></div><div><b class="num">${n(st.points.all)}</b><span>all time</span></div></div>
        </div>
      </section>
      <section aria-label="Honors">
        <div class="section-head"><h2>Honors</h2><span class="muted small">${BADGES.filter(([id]) => earned.has(id)).length} of ${BADGES.length}</span></div>
        <div class="panel"><div class="badges">${BADGES.map(([id, label, ic, how]) => `<button class="badge ${earned.has(id) ? '' : 'locked'}" data-badge="${id}" title="${esc(how)}">
          <span class="seal">${icon(earned.has(id) ? ic : 'lock')}</span>${esc(label)}</button>`).join('')}</div>
          <p class="small muted" id="badgeHow" aria-live="polite" style="margin:10px 0 0"></p></div>
      </section>
      <div class="panel flush"><ul class="list">
        <li><a class="rowbtn" href="#/board/friends"><span class="ico">${icon('crew')}</span><span class="grow"><span class="title">Friends</span><span class="sub">See how your friends are doing, or invite someone</span></span><span class="chev">${icon('chevron')}</span></a></li>
        <li><a class="rowbtn" href="#/board/groups"><span class="ico">${icon('hand')}</span><span class="grow"><span class="title">Groups</span><span class="sub">${groups.length ? plural(groups.length, 'group') : 'Join or start one'}</span></span><span class="chev">${icon('chevron')}</span></a></li>
      </ul></div>
      <p class="legal">Points and honors are for recognition only. They can't be traded for anything.</p>
    </aside>
  </div>`;

  const out = $('#boardOut', el);
  const paint = guard(async () => {
    $$('[data-p]', el).forEach((b) => { b.classList.toggle('on', b.dataset.p === period); b.setAttribute('aria-selected', b.dataset.p === period); });
    $('#lbScope', el).value = scope;
    const lb = await api(`/leaderboard?scope=${encodeURIComponent(scope)}&period=${period}`);
    const rows = lb.rows;
    const me = lb.you;
    let nudge = '';
    if (me && rows.length > 1) {
      const above = rows.find((r) => r.place === me.place - 1) || null;
      if (me.place === 1) nudge = `You lead ${esc(lb.title)}${period === 'all' ? '' : period === 'week' ? ' this week' : ' over 30 days'}.`;
      else if (above) nudge = above.points === me.points ? `Tied with ${esc(first(above.name))}. One more action puts you ahead.` : `${plural(above.points - me.points, 'point')} behind ${esc(first(above.name))}.`;
    }
    if (rows.length <= 1) {
      out.innerHTML = `<div class="panel empty"><h2>Just you so far</h2>
        <p>${scope === 'friends' ? 'Add friends to see how you compare.' : 'Invite people to join you here.'}</p>
        <a class="btn go" href="#/board/${scope === 'friends' ? 'friends' : 'groups'}">${scope === 'friends' ? 'Add a friend' : 'Invite people'}</a></div>`;
      return;
    }
    const row = (r) => `<li class="${r.me ? 'me' : ''} ${r.place <= 3 ? `top${r.place}` : ''}">
        <span class="place num">${r.place}</span>
        <span class="avatar" aria-hidden="true">${esc(initials(r.name))}</span>
        <div class="grow"><div class="title">${esc(r.name)}${r.me ? ' <span class="tiny muted">(you)</span>' : ''}</div><div class="sub">${esc([r.rank, r.where?.replace(/, [A-Z]{2}$/, '')].filter(Boolean).join(', '))}</div></div>
        <div class="board-pts"><span class="pts num">${n(r.points)}</span><span class="tiny muted">pts</span></div>
      </li>`;
    const meOutside = me && !rows.some((r) => r.me);
    out.innerHTML = `${nudge ? `<p class="board-nudge">${nudge}</p>` : ''}
      <ul class="list board panel flush">${rows.map(row).join('')}${meOutside ? `<li class="gap" aria-hidden="true">⋯</li>${row(me)}` : ''}</ul>
      <p class="tiny muted" style="margin-top:10px">${n(lb.count)} ${lb.count === 1 ? 'person' : 'people'} in ${esc(lb.title.replace(/^Your /, 'your '))}.</p>`;
  });
  $$('[data-p]', el).forEach((b) => (b.onclick = () => { period = b.dataset.p; store.set('lbperiod', period); paint(); }));
  $('#lbScope', el).onchange = (e) => { scope = e.target.value; store.set('lbscope', scope); paint(); };
  $$('[data-scope]', el).forEach((b) => (b.onclick = () => {
    scope = b.dataset.scope; store.set('lbscope', scope); period = 'month'; store.set('lbperiod', period); paint();
    $('#lbScope', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $$('[data-badge]', el).forEach((b) => (b.onclick = () => {
    const [id, label, , how] = BADGES.find((x) => x[0] === b.dataset.badge);
    $('#badgeHow', el).textContent = earned.has(id) ? `${label}: earned.` : `${label}: ${how.toLowerCase()}.`;
  }));
  await paint();
}
