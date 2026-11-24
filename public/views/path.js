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

/**
 * Skill tree, drawn from each step's `needs`. One row per step, grouped by rank; a gutter on the
 * left carries the lines from each step down to the steps it unlocks (lanes laid out from the data).
 */
function treeModel(L) {
  const raw = L.rungs.flatMap((r) => r.steps.map((s) => ({ ...s, rung: r.name, level: r.level })));
  const byId = new Map(raw.map((s) => [s.id, s]));
  // Stable order: by rank as given, but never before a step it needs.
  const rows = [], placed = new Set();
  const place = (s) => {
    if (placed.has(s.id)) return;
    placed.add(s.id);
    s.needs.forEach((n) => byId.has(n) && place(byId.get(n)));
    rows.push(s);
  };
  raw.forEach(place);
  const row = new Map(rows.map((s, i) => [s.id, i]));
  const kids = new Map(rows.map((s) => [s.id, []]));
  for (const s of rows) for (const n of s.needs) kids.get(n)?.push(s.id);
  for (const k of kids.values()) k.sort((a, b) => row.get(a) - row.get(b));
  // Lanes: an edge from row a to row b holds its lane over (a, b]. The nearest child keeps its
  // parent's lane when it can, so a chain reads as one straight line.
  const busy = [];
  const free = (l, a, b) => !(busy[l] || []).some(([x, y]) => x < b && a < y);
  const take = (l, a, b) => (busy[l] ||= []).push([a, b]);
  const pick = (a, b) => { let l = 0; while (!free(l, a, b)) l++; return l; };
  const lane = new Map(), edges = [];
  rows.forEach((s, i) => {
    if (!lane.has(s.id)) { const l = pick(i - 0.5, i); take(l, i - 0.5, i); lane.set(s.id, l); }
    let kept = false;
    for (const c of kids.get(s.id)) {
      const j = row.get(c);
      const l = !kept && free(lane.get(s.id), i, j) ? (kept = true, lane.get(s.id)) : pick(i, j);
      take(l, i, j);
      if (!lane.has(c)) lane.set(c, l);
      edges.push({ from: s.id, to: c, lane: l });
    }
  });
  return { rows, byId, kids, lane, edges, lanes: Math.max(1, ...lane.values(), ...edges.map((e) => e.lane)) + 1 };
}

const stateOf = (s) => (s.done ? 'done' : s.locked ? 'locked' : 'open');
const names = (ids, T) => ids.map((id) => T.byId.get(id)?.label).filter(Boolean);

function treeHtml(L, T) {
  const dot = (st) => `<span class="skt-dot ${st}" aria-hidden="true">${st === 'done' ? icon('check') : st === 'locked' ? icon('lock') : ''}</span>`;
  const node = (s) => {
    const st = stateOf(s);
    const sub = s.done ? 'Done'
      : s.locked ? `Needs: ${s.lockedBy.join(', ')}`
      : s.opensLabel ? `Available. ${s.opensLabel}`
      : ['Ready now', s.goal > 1 ? `${s.have} of ${s.goal}` : '', s.xp ? `${s.xp} XP`.replace(/^(\+\d+) (per|each)(.*) XP$/, '$1 XP $2$3') : ''].filter(Boolean).join(' · ');
    return `<button class="skt-node ${st}" data-node="${esc(s.id)}" style="--lane:${T.lane.get(s.id)}"
        aria-label="${esc(s.label)}. ${esc(sub)}">${dot(st)}<span class="skt-card">
        <span class="skt-rel" aria-hidden="true"></span>
        <span class="skt-label">${s.lesson ? `<span class="skt-kind">Training</span>` : ''}${esc(s.label)}</span>
        <span class="skt-sub">${st === 'locked' ? icon('lock', 'inline-ic') : ''}${esc(sub)}</span></span></button>`;
  };
  let lastLevel = 0, html = '';
  for (const s of T.rows) {
    if (s.level !== lastLevel) {
      lastLevel = s.level;
      const r = L.rungs[s.level - 1];
      const tag = r.level <= L.level ? `<span class="skt-rtag got">${icon('check', 'inline-ic')}Reached</span>`
        : r.level === L.level + 1 ? '<span class="skt-rtag next">Next rank</span>' : '';
      html += `<div class="skt-rank"><span class="skt-rnum num">Rank ${r.level}</span><span class="skt-rname">${esc(r.name)}</span>${tag}</div>`;
    }
    html += node(s);
  }
  const done = T.rows.filter((s) => s.done).length;
  const open = T.rows.filter((s) => !s.done && !s.locked).length;
  return `<div class="skt" style="--lanes:${T.lanes}">
      <p class="small muted" style="margin:0 0 10px">${done} of ${T.rows.length} done. ${plural(open, 'step')} ready now.
        Each line runs from a step down to the steps it unlocks. Tap a step to trace it.</p>
      <ul class="skt-key small" aria-label="Key">
        <li>${dot('done')}Done</li><li>${dot('open')}Ready now</li><li>${dot('locked')}Locked</li>
      </ul>
      <div class="skt-body"><svg class="skt-lines" aria-hidden="true"></svg>${html}</div></div>`;
}

/** Draw the connector lines from the rows' measured positions. Redraws when the layout changes. */
function drawTree(root, T) {
  const body = $('.skt-body', root);
  if (!body) return;
  const svg = $('.skt-lines', body);
  const draw = () => {
    const box = body.getBoundingClientRect();
    const at = new Map($$('.skt-node', body).map((b) => {
      const d = $('.skt-dot', b).getBoundingClientRect();
      const card = $('.skt-card', b).getBoundingClientRect().left - box.left;
      return [b.dataset.node, { x: d.left + d.width / 2 - box.left, y: d.top + d.height / 2 - box.top, r: d.height / 2, card }];
    }));
    const lw = parseFloat(getComputedStyle(body).getPropertyValue('--lw')) || 24;
    const x0 = at.size ? [...at.values()][0].x - T.lane.get(T.rows[0].id) * lw : 0;
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    // A short rule ties each dot to its card, so a dot in a far lane still reads as that step's.
    const ties = [...at].map(([, p]) => `<path d="M${p.x + p.r} ${p.y} L${p.card} ${p.y}" class="tie"/>`).join('');
    svg.innerHTML = ties + T.edges.map((e) => {
      const p = at.get(e.from), c = at.get(e.to);
      if (!p || !c) return '';
      const xl = x0 + e.lane * lw, y0 = p.y + p.r, y1 = c.y - c.r;
      const h = Math.min(22, (y1 - y0) / 2);
      let d = `M${p.x} ${y0}`;
      if (xl !== p.x) d += ` C${p.x} ${y0 + h / 2} ${xl} ${y0 + h / 2} ${xl} ${y0 + h}`;
      d += ` L${xl} ${y1 - (xl !== c.x ? h : 0)}`;
      if (xl !== c.x) d += ` C${xl} ${y1 - h / 2} ${c.x} ${y1 - h / 2} ${c.x} ${y1}`;
      const done = T.byId.get(e.from).done;
      return `<path d="${d}" class="${done ? 'go' : 'wait'}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"/>`;
    }).join('');
    mark();
  };
  // Highlight: everything a step needs (all the way up) and the steps it unlocks next.
  let sel = null;
  const mark = () => {
    body.classList.toggle('focus', !!sel);
    const pre = new Set(), stack = sel ? [...T.byId.get(sel).needs] : [];
    while (stack.length) { const n = stack.pop(); if (!pre.has(n)) { pre.add(n); stack.push(...(T.byId.get(n)?.needs || [])); } }
    const post = new Set(sel ? T.kids.get(sel) : []);
    $$('.skt-node', body).forEach((b) => {
      const id = b.dataset.node;
      const rel = id === sel ? 'sel' : pre.has(id) ? 'pre' : post.has(id) ? 'post' : '';
      b.dataset.rel = rel;
      $('.skt-rel', b).textContent = rel === 'pre' ? 'Needed first' : rel === 'post' ? 'Unlocks next' : rel === 'sel' ? 'Selected' : '';
    });
    $$('path[data-from]', svg).forEach((p) => {
      const on = sel && ((pre.has(p.dataset.from) && (pre.has(p.dataset.to) || p.dataset.to === sel)) || p.dataset.from === sel);
      p.classList.toggle('hi', !!on);
    });
  };
  body.addEventListener('click', (e) => { if (!e.target.closest('.skt-node')) { sel = null; mark(); } });
  draw();
  new ResizeObserver(draw).observe(body);
  return { select: (id) => { sel = id; mark(); } };
}

/** Sheet for one node: how to do it, the training itself, or what unlocks it. */
function openNode(s, rerender, claim, T) {
  const L = s.lesson;
  const st = stateOf(s);
  const need = s.needs.map((id) => T?.byId.get(id)).filter(Boolean);
  const unlocks = T ? names(T.kids.get(s.id) || [], T) : [];
  const links = `<div class="skt-links small">
      <p class="skt-state ${st}">${st === 'done' ? `${icon('check', 'inline-ic')}Done` : st === 'locked' ? `${icon('lock', 'inline-ic')}Locked` : 'Ready now'}</p>
      <div><b>Needs</b>${need.length ? `<ul>${need.map((n) => `<li class="${n.done ? 'done' : ''}">${n.done ? icon('check', 'inline-ic') : icon('lock', 'inline-ic')}${esc(n.label)}${n.done ? '' : ' <span class="muted">(not yet)</span>'}</li>`).join('')}</ul>` : '<p class="muted">Nothing. Start here.</p>'}</div>
      <div><b>Unlocks</b>${unlocks.length ? `<ul>${unlocks.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="muted">Nothing more. It counts toward your rank.</p>'}</div>
    </div>`;
  const body = s.locked
    ? `<p>${esc(s.how)}</p>`
    : L ? `<ul class="lesson">${L.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        ${L.source ? `<p class="small"><a href="${esc(L.source.url)}" target="_blank" rel="noopener">${esc(L.source.label)}</a></p>` : ''}
        ${s.done ? '<p class="tag good">Finished</p>' : `<button class="btn go block" id="learned">I finished it <span class="xp">${esc(s.xp)}</span></button>`}`
    : `<p>${esc(s.how)}</p>${s.goal > 1 ? `<p class="small muted num">${s.have} of ${s.goal}</p>` : ''}${s.done ? '<p class="tag good">Done</p>' : stepCta(s, 'btn go block')}
      ${!s.done && s.log ? `<a class="btn quiet block" style="margin-top:10px" href="#/act/log/${esc(s.log)}">Did it without an event? Log it</a>` : ''}`;
  const { el, close } = sheet(`<div class="vb"><div class="row between"><h2 style="margin:0">${esc(L && !s.locked ? L.title : s.label)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <p class="tiny muted" style="margin:4px 0 12px">Part of ${esc(s.rung)}${s.xp ? `. ${esc(/per|each/.test(s.xp) ? s.xp.replace(/^\+(\d+)/, '+$1 XP') : `${s.xp} XP`)}` : ''}</p>${links}${body}</div>`);
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
  const T = treeModel(L);
  el.innerHTML = `<div class="page two path">
      <div class="main">
        <a class="back" href="#/today">${icon('chevron')}Today</a>
        <h1>Your path</h1>
        <p class="muted">Level ${L.level} of ${L.rungs.length}: <strong>${esc(L.name)}</strong>. Finish every step to move up.</p>
        ${coach}
        <section>
          <nav class="seg" aria-label="Path view" style="margin-bottom:14px"><button data-view="tree" class="${view === 'tree' ? 'on' : ''}">Skill tree</button><button data-view="ranks" class="${view === 'ranks' ? 'on' : ''}">Ranks</button></nav>
          ${view === 'tree' ? `<div class="panel">${treeHtml(L, T)}</div>` : `<ol class="ladder panel">${L.rungs.slice(1).map(rung).join('')}</ol>`}
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
  const tree = view === 'tree' ? drawTree(el, T) : null;
  $$('[data-node]', el).forEach((b) => (b.onclick = () => { tree?.select(b.dataset.node); openNode(steps.get(b.dataset.node), () => render(el, arg), claim, T); }));
  $$('[data-claim]', el).forEach((b) => (b.onclick = claim));

  if (arg === 'invite') $('#invite', el)?.scrollIntoView({ block: 'start' });
  if (arg === 'learn' && steps.has(sub)) { history.replaceState(null, '', '#/path'); openNode(steps.get(sub), () => render(el), claim, T); }
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
