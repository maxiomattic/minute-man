// Today: one loud next action, then quiet supporting panels (quests, streak, standing, crew).
// Every number shown comes from the API. Nothing here reveals how anyone voted.
import { $, $$, api, checkLevelUp, confetti, esc, guard, icon, plural, refreshStats, state, toast, xpFly, fmtDate, fmtWhen } from '../core.js';
import { bindCheers, feedItemHtml } from './crew.js';
import { pathCard } from './path.js';

const QUEST_HREF = {
  ballot: '#/ballot', remind: '#/crew/friends', cheer: '#/crew/feed', post: '#/act/log',
  events: '#/act', doors: '#/act/log', calls: '#/act/log', follow: '#/leaders',
};
const BADGE_ICON = {
  registered: 'check', voted: 'ballot', primary: 'ballot', local: 'hall', streak3: 'star', streak10: 'star',
  reminder: 'megaphone', council: 'hall', party: 'hand', doors100: 'door', doors1000: 'door', calls100: 'phone',
  shifts5: 'hand', endorser: 'megaphone', win: 'trophy',
};
const DAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function kickerFor(n, t) {
  let urgent = '';
  if (n.urgent) {
    if (n.kind === 'register') urgent = 'Deadline soon';
    else if (n.kind === 'vote' && t.election) urgent = t.election.daysLeft === 0 ? 'Today' : `${plural(t.election.daysLeft, 'day')} left`;
    else urgent = 'Time-sensitive';
  }
  const label = n.when ? fmtWhen(n.when) : 'Your next step';
  return `<div class="kicker">${urgent ? `<span class="urgent">${esc(urgent)}</span>` : ''}<span>${esc(label)}</span></div>`;
}

// Smooth a couple of server phrasings ("in the next 1 day") without changing meaning.
const heroTitle = (n) => n.title.replace(/^Register in the next 1 day$/, 'Register by tomorrow');

const actionAttrs = (a, i) => (a.action ? `data-act="${i}"` : `href="${esc(a.href || '#/today')}"`);

export async function render(el) {
  const [t, feed] = await Promise.all([api('/today'), api('/feed').catch(() => [])]);
  state.today = t;
  window.dispatchEvent(new CustomEvent('cvas:stats'));

  const actions = [t.next, ...(t.upNext || [])].filter(Boolean);
  const n = t.next;
  const e = t.election;
  const q = t.quests;
  const claimed = q.quests.filter((x) => x.claimed).length;
  const s = t.streak;

  // ----- main column -----
  const electionLine = e ? `<a class="election-line" href="#/ballot/${esc(e.id)}">
      ${icon('calendar')}
      <span class="grow"><strong>${esc(e.name)}</strong> ${e.daysLeft === 0 ? 'is today' : `in ${plural(e.daysLeft, 'day')}`}</span>
      <span class="small muted">${esc(fmtDate(e.date))}</span></a>` : '';

  const hero = n ? `<section class="hero" aria-labelledby="heroTitle">
      ${kickerFor(n, t)}
      <h1 id="heroTitle">${esc(heroTitle(n))}</h1>
      <p>${esc(String(n.body || '').replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => fmtDate(d)))}</p>
      ${n.action ? `<button class="btn go" data-act="0">${esc(n.cta)}${n.xp > 0 ? ` <span class="xp">+${n.xp} XP</span>` : ''}</button>`
        : `<a class="btn go" href="${esc(n.href)}">${esc(n.cta)}${n.xp > 0 ? ` <span class="xp">+${n.xp} XP</span>` : ''}</a>`}
    </section>` : '';

  const upNext = t.upNext?.length ? `<section>
      <div class="section-head"><h2 class="h3">After that</h2></div>
      <ul class="list links panel flush">${t.upNext.map((a, i) => `<li>
        <${a.action ? 'button' : 'a'} class="rowlink" ${actionAttrs(a, i + 1)}>
          <span class="grow"><span class="title">${esc(a.title)}</span>${a.xp > 0 ? ` <span class="tiny muted">+${a.xp} XP</span>` : ''}</span>
          ${icon('chevron', 'chev')}
        </${a.action ? 'button' : 'a'}></li>`).join('')}</ul>
    </section>` : '';

  const questRow = (x) => {
    const right = x.claimed ? `<span class="tiny muted">Claimed</span>`
      : x.done ? `<button class="btn go sm" data-claim="${esc(x.id)}">Claim ${x.xp} XP</button>`
      : `<span class="tiny muted q-xp">+${x.xp} XP</span>`;
    const inner = `<span class="oval ${x.done ? 'done' : ''}" aria-hidden="true"></span>
      <span class="grow title ${x.claimed ? 'q-done' : ''}">${esc(x.title)}</span>${right}`;
    return x.done || !QUEST_HREF[x.id]
      ? `<li class="quest" aria-label="${esc(x.title)}${x.done ? ', done' : ''}">${inner}</li>`
      : `<li class="quest linked"><a class="rowlink" href="${QUEST_HREF[x.id]}">${inner}${icon('chevron', 'chev')}</a></li>`;
  };
  const chest = q.chest.claimed
    ? `<div class="chest">${icon('gift', 'chest-ic')}<span class="grow small">Bonus opened. New quests tomorrow.</span></div>`
    : `<div class="chest">${icon('gift', 'chest-ic')}
        <div class="grow"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${claimed}" aria-label="Quests claimed"><div style="width:${(claimed / 3) * 100}%"></div></div>
        <div class="tiny muted" style="margin-top:4px">${q.chest.ready ? 'All three done' : `${claimed} of 3 claimed. Claim all three for a ${q.chest.xp} XP bonus.`}</div></div>
        ${q.chest.ready ? `<button class="btn go sm" data-claim="chest">Open bonus <span class="xp">+${q.chest.xp}</span></button>` : ''}
      </div>`;
  const quests = `<section>
      <div class="section-head"><h2 class="h3">Daily quests</h2><span class="tiny muted">Resets at midnight</span></div>
      <div class="panel flush"><ul class="list links">${q.quests.map(questRow).join('')}</ul>${chest}</div>
    </section>`;

  // ----- side column -----
  const today = new Date();
  const strip = s.lastSeven.map((on, i) => {
    const d = new Date(today); d.setDate(today.getDate() - 6 + i);
    return `<div><span aria-hidden="true">${DAY_INITIAL[d.getDay()]}</span><i class="${on ? 'on' : ''} ${i === 6 ? 'today' : ''}" title="${DAY_NAME[d.getDay()]}${on ? ': active' : ''}"></i></div>`;
  }).join('');
  const streakLine = s.activeThisWeek ? 'This week counts. See you next week.'
    : s.atRisk ? 'Do one thing by Sunday to keep your streak.' : 'Do one civic thing this week to start a streak.';
  const streak = `<section class="panel streak ${s.activeThisWeek ? '' : 'cold'}">
      <div class="row streak-top">${icon('flame', 'streak-flame')}<span class="num streak-n">${s.weeks}</span>
        <span class="grow"><strong>week streak</strong><br><span class="small muted">${s.weeks ? 'Weeks in a row with a civic action' : 'One action a week builds it'}</span></span></div>
      <div class="week" aria-label="Last seven days">${strip}</div>
      <p class="small streak-line ${s.atRisk ? 'risk' : ''}">${streakLine}</p>
    </section>`;

  const w = t.week;
  const standing = w.of > 1 ? `<a class="panel standing" href="#/crew/board">
      <span class="num standing-n">#${w.place}</span>
      <span class="grow"><strong>of ${w.of} in your crew this week</strong><br><span class="small muted">${plural(w.points, 'point')} so far</span></span>
      ${icon('chevron', 'chev')}</a>`
    : `<a class="panel standing" href="#/crew/friends">${icon('trophy', 'standing-ic')}
      <span class="grow"><strong>${plural(w.points, 'point')} this week</strong><br><span class="small muted">Add friends to see how you stack up</span></span>${icon('chevron', 'chev')}</a>`;

  const proof = t.proof ? `<p class="proof small">${icon('check')}<span>${t.proof.voted === 1 ? '1 person' : `${t.proof.voted} people`} in your crew already voted</span></p>` : '';

  const feedPrev = `<section>
      <div class="section-head"><h2 class="h3">Your crew</h2>${feed.length ? '<a href="#/crew/feed">See all</a>' : ''}</div>
      ${feed.length ? `<div class="panel flush feed-mini">${feed.slice(0, 3).map(feedItemHtml).join('')}</div>`
        : `<div class="panel small muted">Nothing from your crew yet. <a href="#/crew/friends">Add a friend</a> to cheer each other on.</div>`}
    </section>`;

  const badges = `<section>
      <div class="section-head"><h2 class="h3">Badges</h2><a href="#/me">See all</a></div>
      ${t.badges.length ? `<div class="panel"><div class="badges">${t.badges.slice(0, 6).map((b) =>
        `<div class="badge" title="${esc(b.desc)}"><div class="seal">${icon(BADGE_ICON[b.id] || 'star')}</div>${esc(b.label)}</div>`).join('')}</div></div>`
        : '<div class="panel small muted">Vote, show up to a meeting or knock doors to earn your first badge.</div>'}
    </section>`;

  el.innerHTML = `<div class="page two today">
      <div class="main">${electionLine}${hero}${pathCard(t.rank)}${upNext}${quests}</div>
      <div class="side">${streak}${standing}${proof}${feedPrev}${badges}</div>
    </div>`;

  // ----- wiring -----
  $$('[data-act]', el).forEach((b) => (b.onclick = guard(async () => {
    const a = actions[Number(b.dataset.act)];
    if (a?.action?.type !== 'nudge') return;
    b.disabled = true;
    try {
      await api(`/friends/${a.action.userId}/nudge`, { method: 'POST', body: { electionId: a.action.electionId } });
    } catch (err) { b.disabled = false; throw err; }
    xpFly(a.xp, b);
    toast(`Reminder sent to ${a.title.replace(/^Remind (\S+).*/, '$1')}`);
    await render(el);
  })));

  $$('[data-claim]', el).forEach((b) => (b.onclick = guard(async () => {
    b.disabled = true;
    let r;
    try { r = await api(`/quests/${b.dataset.claim}/claim`, { method: 'POST' }); } catch (err) { b.disabled = false; throw err; }
    xpFly(r.xp, b);
    if (b.dataset.claim === 'chest') { confetti(24); toast(`Bonus opened. +${r.xp} XP`); }
    else toast(`Claimed ${r.xp} XP`);
    await refreshStats();
    await render(el);
  })));

  bindCheers(el, () => render(el).catch(() => {}));
  await checkLevelUp(t.rank);
}
