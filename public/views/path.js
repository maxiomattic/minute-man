// Your path: the ranked ladder of political engagement, a coach for the next step, and invites.
import { $, $$, api, confetti, esc, guard, icon, isNative, more, plural, refreshStats, sheet, store, toast, xpFly } from '../core.js';

const PUBLIC_URL = 'https://cvas.careride.workers.dev';
export const inviteUrl = (code) => `${isNative ? PUBLIC_URL : location.origin}/#/join/${code}`;

/** Bonus each rank a recruit reaches pays you (index = their level - 1). Mirrors src/engine/ladder.js. */
const RECRUIT_BONUS = [25, 50, 75, 50, 50, 75, 100, 150];

function stepCta(s, cls = 'btn go') {
  if (s.lesson) return `<button class="${cls}" data-node="${esc(s.id)}">${esc(s.cta)}</button>`;
  if (s.opensLabel) return `<span class="pill-wait">${esc(s.opensLabel)}</span>`;
  if (s.action) return `<button class="${cls}" data-claim="${esc(s.action)}">${esc(s.actionLabel)}</button>`;
  if (s.href) return `<a class="${cls}" href="${esc(s.href)}">${esc(s.cta || 'Open')}</a>`;
  return '';
}

/** Skill tree: every action is a node; a node unlocks when the nodes it needs are done. */
function treeHtml(L) {
  const all = L.rungs.flatMap((r) => r.steps.map((s) => ({ ...s, rung: r.name })));
  const byId = new Map(all.map((s) => [s.id, s]));
  const depth = new Map();
  const d = (s) => depth.get(s.id) ?? (depth.set(s.id, s.needs.length ? 1 + Math.max(...s.needs.map((n) => d(byId.get(n)))) : 0), depth.get(s.id));
  const tiers = [];
  for (const s of all) (tiers[d(s)] ||= []).push(s);
  const node = (s) => {
    const st = s.done ? 'done' : s.locked ? 'locked' : 'open';
    const mark = s.done ? icon('check') : s.locked ? icon('lock') : s.lesson ? icon('star') : '';
    const sub = s.done ? 'Done' : s.locked ? `After: ${s.lockedBy[0]}` : s.opensLabel ? s.opensLabel : s.goal > 1 ? `${s.have} of ${s.goal}` : s.xp ? `${s.xp} XP` : 'Ready';
    return `<button class="node ${st}" data-node="${esc(s.id)}" aria-label="${esc(s.label)}: ${esc(sub)}">
        <span class="node-mark" aria-hidden="true">${mark}</span>
        <span class="node-text"><span class="node-label">${esc(s.label)}</span><span class="node-sub">${esc(sub)}</span></span></button>`;
  };
  const open = all.filter((s) => !s.done && !s.locked).length;
  // Show through the first tier that's entirely locked; fold the rest away.
  let cut = tiers.findIndex((t) => t.every((s) => s.locked));
  cut = cut < 0 ? tiers.length : cut + 1;
  const tierHtml = (t) => `<li class="tier"><div class="tier-nodes">${t.map(node).join('')}</div></li>`;
  const rest = tiers.slice(cut).flat().length;
  return `<p class="small muted" style="margin:0 0 12px">${all.filter((s) => s.done).length} of ${all.length} done. ${plural(open, 'action')} open now. Each one you finish unlocks more.</p>
    <ol class="tree">${tiers.slice(0, cut).map(tierHtml).join('')}</ol>
    ${rest ? more(`Show ${plural(rest, 'more action')}`, `<ol class="tree" style="margin-top:12px">${tiers.slice(cut).map(tierHtml).join('')}</ol>`) : ''}`;
}

/** Sheet for one node: how to do it, the training itself, or what unlocks it. */
function openNode(s, rerender, claim) {
  const L = s.lesson;
  const body = s.locked
    ? `<p>${esc(s.how)}</p><p class="small muted">${icon('lock', 'inline-ic')} Unlocks after: <b>${esc(s.lockedBy.join(', '))}</b></p>`
    : L ? `<ul class="lesson">${L.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        ${L.source ? `<p class="small"><a href="${esc(L.source.url)}" target="_blank" rel="noopener">${esc(L.source.label)}</a></p>` : ''}
        ${s.done ? '<p class="tag good">Finished</p>' : `<button class="btn go block" id="learned">I finished it <span class="xp">${esc(s.xp)}</span></button>`}`
    : `<p>${esc(s.how)}</p>${s.goal > 1 ? `<p class="small muted num">${s.have} of ${s.goal}</p>` : ''}${s.done ? '<p class="tag good">Done</p>' : stepCta(s, 'btn go block')}
      ${!s.done && s.log ? `<a class="btn quiet block" style="margin-top:10px" href="#/act/log/${esc(s.log)}">Did it without an event? Log it</a>` : ''}`;
  const { el, close } = sheet(`<div class="vb"><div class="row between"><h2 style="margin:0">${esc(L && !s.locked ? L.title : s.label)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <p class="tiny muted" style="margin:4px 0 12px">Part of ${esc(s.rung)}${s.xp ? `. ${esc(/per|each/.test(s.xp) ? s.xp.replace(/^\+(\d+)/, '+$1 XP') : `${s.xp} XP`)}` : ''}</p>${body}</div>`);
  $('[data-close]', el).onclick = close;
  $$('a[href^="#"]', el).forEach((a) => a.addEventListener('click', close));
  $('#learned', el)?.addEventListener('click', guard(async (e) => {
    e.target.disabled = true;
    await api('/ladder/learn', { method: 'POST', body: { id: s.id } });
    xpFly(15, e.target);
    toast('Training done. Something new unlocked.');
    close();
    await refreshStats();
    await rerender();
  }));
  $('[data-claim]', el)?.addEventListener('click', () => { close(); claim(); });
}

const count = (s) => (s.goal > 1 ? `<span class="num small muted">${Math.min(s.have, s.goal)} / ${s.goal}</span>` : '');

export async function render(el, arg, sub) {
  const L = await api('/ladder');
  const next = L.rungs[L.level] || null;
  const c = L.coach;

  const coach = c ? `<section class="coach panel">
      <div class="kicker">Next rank: <strong>${esc(c.rung)}</strong>${L.progress ? ` <span class="muted">${L.progress.done} of ${L.progress.of} done</span>` : ''}</div>
      <h2>${esc(c.step.label)}</h2>
      <p>${esc(c.step.how)}</p>
      ${c.step.goal > 1 ? `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${c.step.goal}" aria-valuenow="${c.step.have}"><div style="width:${Math.max(3, (c.step.have / c.step.goal) * 100)}%"></div></div>
        <p class="small muted num" style="margin:6px 0 14px">${c.step.have} of ${c.step.goal}</p>` : ''}
      ${c.step.link ? `<p class="small"><a href="${esc(c.step.link)}" target="_blank" rel="noopener">How it works (Texas Secretary of State)</a></p>` : ''}
      ${stepCta(c.step, 'btn go block')}
      ${c.meanwhile ? `<div class="meanwhile">
          <p class="small"><strong>While you wait:</strong> get a head start on ${esc(c.meanwhile.rung)}.</p>
          <a class="rowlink" href="${esc(c.meanwhile.step.href || '#/path')}"><span class="grow"><span class="title">${esc(c.meanwhile.step.label)}</span>
            <span class="sub">${esc(c.meanwhile.step.how)}</span></span>${icon('chevron', 'chev')}</a></div>` : ''}
    </section>` : `<section class="coach panel"><h2>Top rank</h2><p>You've done every step. Keep coaching your recruits up the ladder.</p></section>`;

  const rung = (r) => {
    const state = r.level <= L.level ? 'done' : r === next ? 'next' : 'later';
    const steps = r.steps.length ? `<ul class="rung-steps">${r.steps.map((s) => `<li class="${s.done ? 'done' : ''}">
        <span class="oval ${s.done ? 'done' : ''}" aria-hidden="true"></span>
        <span class="grow">${esc(s.label)}${s.opensLabel ? ` <span class="tiny muted">(${esc(s.opensLabel.toLowerCase())})</span>` : ''}</span>${count(s)}
        <span class="sr-only">${s.done ? 'done' : 'not done'}</span></li>`).join('')}</ul>` : '';
    return `<li class="rung ${state}">
        <div class="rung-mark num" aria-hidden="true">${state === 'done' ? icon('check') : r.level}</div>
        <div class="grow">
          <div class="rung-head"><h3>${esc(r.name)}</h3>${r.bonus ? `<span class="tiny muted">+${r.bonus} XP</span>` : ''}</div>
          <p class="small muted">${esc(r.blurb)}${state === 'done' && r.level === L.level ? ' <strong class="you">You are here</strong>' : ''}</p>
          ${state === 'done' && r.level !== L.level ? '' : state === 'later' && steps ? more('See steps', steps) : steps}
        </div></li>`;
  };

  const R = L.recruits;
  const invite = `<section id="invite">
      <div class="section-head"><h2>Bring people in</h2>${R.length ? `<span class="muted small">${plural(R.length, 'recruit')}</span>` : ''}</div>
      <div class="panel">
        <p>Friends who join with your link land in your crew. You earn points as they move up.</p>
        <div class="invite-row"><code class="code">${esc(inviteUrl(L.invite.code).replace(/^https?:\/\//, ''))}</code></div>
        <button class="btn go block" id="share">Share my invite link</button>
        ${more('How the bonuses work', `<ul class="bonus-list small">
          <li><span>They join</span><b class="num">+${RECRUIT_BONUS[0]}</b></li>
          <li><span>They reach Registered Voter</span><b class="num">+${RECRUIT_BONUS[1]}</b></li>
          <li><span>They vote</span><b class="num">+${RECRUIT_BONUS[2]}</b></li>
          <li><span>Each rank after that</span><b class="num">+${Math.min(...RECRUIT_BONUS.slice(3))} to +${Math.max(...RECRUIT_BONUS.slice(3))}</b></li>
        </ul>
        <p class="tiny muted" style="margin:10px 0 0">You see a recruit's rank only if they let friends see their voting status. Nobody sees how anyone voted.</p>`)}
      </div>
      ${R.length ? `<div class="panel flush" style="margin-top:12px"><ul class="list">${R.map((x) => `<li class="recruit">
          <span class="avatar" aria-hidden="true">${esc(x.name[0] || '?')}</span>
          <span class="grow"><span class="title">${esc(x.name)}</span><span class="sub">${x.rank ? `Level ${x.level}: ${esc(x.rank)}` : 'Joined'}</span></span>
          <span class="tiny muted num">+${x.earned} XP</span></li>`).join('')}</ul></div>` : ''}
    </section>`;

  const view = store.get('pathView', 'tree');
  el.innerHTML = `<div class="page two path">
      <div class="main">
        <a class="back" href="#/today">${icon('chevron')}Today</a>
        <h1>Your path</h1>
        <p class="muted">Level ${L.level} of ${L.rungs.length}: <strong>${esc(L.name)}</strong>. Finish every step to move up.</p>
        ${coach}
        <section>
          <nav class="seg" aria-label="Path view" style="margin-bottom:14px"><button data-view="tree" class="${view === 'tree' ? 'on' : ''}">Skill tree</button><button data-view="ranks" class="${view === 'ranks' ? 'on' : ''}">Ranks</button></nav>
          ${view === 'tree' ? `<div class="panel">${treeHtml(L)}</div>` : `<ol class="ladder panel">${L.rungs.slice(1).map(rung).join('')}</ol>`}
        </section>
      </div>
      <div class="side">${invite}</div>
    </div>`;

  $('#share', el).onclick = guard(async () => {
    const url = inviteUrl(L.invite.code);
    const text = 'I\'m using Minute Man to vote America First in every race and get our neighborhood to the polls. Join me:';
    if (navigator.share) {
      try { await navigator.share({ title: 'Join me on Minute Man', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Invite link copied');
  });

  const steps = new Map(L.rungs.flatMap((r) => r.steps.map((s) => [s.id, { ...s, rung: r.name }])));
  $$('[data-view]', el).forEach((b) => (b.onclick = () => { store.set('pathView', b.dataset.view); render(el, arg); }));
  const claim = guard(async () => {
    if (!confirm('Mark yourself as a precinct chair candidate or appointee? You can undo this.')) return;
    await api('/ladder/claim', { method: 'POST', body: { id: 'precinct_chair' } });
    confetti(24);
    await refreshStats();
    await render(el, arg);
  });
  $$('[data-node]', el).forEach((b) => (b.onclick = () => openNode(steps.get(b.dataset.node), () => render(el, arg), claim)));
  $$('[data-claim]', el).forEach((b) => (b.onclick = claim));

  if (arg === 'invite') $('#invite', el)?.scrollIntoView({ block: 'start' });
  if (arg === 'learn' && steps.has(sub)) { history.replaceState(null, '', '#/path'); openNode(steps.get(sub), () => render(el), claim); }
}

/** Small card for the Today screen: where you are, and the one next step. */
export function pathCard(rank) {
  if (!rank) return '';
  const c = rank.coach;
  const pct = rank.progress ? (rank.progress.done / rank.progress.of) * 100 : 100;
  return `<a class="panel path-card" href="#/path">
      <div class="row between"><strong>Level ${rank.level} of ${rank.of}: ${esc(rank.name)}</strong>${icon('chevron', 'chev')}</div>
      ${c ? `<div class="meter" role="progressbar" aria-label="Progress to ${esc(rank.nextName)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div style="width:${Math.max(4, pct)}%"></div></div>
        <p class="small" style="margin:8px 0 0">Next: <strong>${esc(c.step.label)}</strong>${c.step.opensLabel ? ` <span class="muted">(${esc(c.step.opensLabel.toLowerCase())})</span>` : ''}</p>
        ${c.meanwhile ? `<p class="small muted" style="margin:2px 0 0">Meanwhile: ${esc(c.meanwhile.step.label.toLowerCase())}</p>` : ''}` : '<p class="small muted" style="margin:6px 0 0">Top rank.</p>'}
    </a>`;
}
