// Your path: the ranked ladder of political engagement, a coach for the next step, and invites.
import { $, $$, api, confetti, esc, guard, icon, isNative, plural, refreshStats, toast } from '../core.js';

const PUBLIC_URL = 'https://cvas.careride.workers.dev';
export const inviteUrl = (code) => `${isNative ? PUBLIC_URL : location.origin}/#/join/${code}`;

/** Bonus each rank a recruit reaches pays you (index = their level - 1). Mirrors src/engine/ladder.js. */
const RECRUIT_BONUS = [25, 50, 75, 50, 50, 75, 100, 150];

function stepCta(s, cls = 'btn go') {
  if (s.opensLabel) return `<span class="pill-wait">${esc(s.opensLabel)}</span>`;
  if (s.action) return `<button class="${cls}" data-claim="${esc(s.action)}">${esc(s.actionLabel)}</button>`;
  if (s.href) return `<a class="${cls}" href="${esc(s.href)}">${esc(s.cta || 'Open')}</a>`;
  return '';
}

const count = (s) => (s.goal > 1 ? `<span class="num small muted">${Math.min(s.have, s.goal)} / ${s.goal}</span>` : '');

export async function render(el, arg) {
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
          ${state === 'done' && r.level !== L.level ? '' : steps}
        </div></li>`;
  };

  const R = L.recruits;
  const invite = `<section id="invite">
      <div class="section-head"><h2>Bring people in</h2>${R.length ? `<span class="muted small">${plural(R.length, 'recruit')}</span>` : ''}</div>
      <div class="panel">
        <p>Send your link to friends and family. When they join, they're added to your crew, and you earn a bonus each time one of them reaches a new rank.</p>
        <ul class="bonus-list small">
          <li><span>They join</span><b class="num">+${RECRUIT_BONUS[0]}</b></li>
          <li><span>They reach Registered</span><b class="num">+${RECRUIT_BONUS[1]}</b></li>
          <li><span>They vote</span><b class="num">+${RECRUIT_BONUS[2]}</b></li>
          <li><span>Each rank after that</span><b class="num">+${Math.min(...RECRUIT_BONUS.slice(3))} to +${Math.max(...RECRUIT_BONUS.slice(3))}</b></li>
        </ul>
        <div class="invite-row"><code class="code">${esc(inviteUrl(L.invite.code).replace(/^https?:\/\//, ''))}</code></div>
        <button class="btn go block" id="share">Share my invite link</button>
        <p class="tiny muted" style="margin:10px 0 0">You see a recruit's rank only if they let friends see their voting status. Nobody sees how anyone voted.</p>
      </div>
      ${R.length ? `<div class="panel flush" style="margin-top:12px"><ul class="list">${R.map((x) => `<li class="recruit">
          <span class="avatar" aria-hidden="true">${esc(x.name[0] || '?')}</span>
          <span class="grow"><span class="title">${esc(x.name)}</span><span class="sub">${x.rank ? `Level ${x.level}: ${esc(x.rank)}` : 'Joined'}</span></span>
          <span class="tiny muted num">+${x.earned} XP</span></li>`).join('')}</ul></div>` : ''}
    </section>`;

  el.innerHTML = `<div class="page two path">
      <div class="main">
        <h1>Your path</h1>
        <p class="muted">Level ${L.level} of ${L.rungs.length}: <strong>${esc(L.name)}</strong>. Each rank is a step up in political engagement. Finish every step to move up.</p>
        ${coach}
        <section><div class="section-head"><h2>The ladder</h2></div>
          <ol class="ladder panel">${L.rungs.slice(1).map(rung).join('')}</ol></section>
      </div>
      <div class="side">${invite}</div>
    </div>`;

  $('#share', el).onclick = guard(async () => {
    const url = inviteUrl(L.invite.code);
    const text = 'I\'m using CVAS to vote America First in every race and get our neighborhood to the polls. Join me:';
    if (navigator.share) {
      try { await navigator.share({ title: 'Join me on CVAS', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Invite link copied');
  });

  $$('[data-claim]', el).forEach((b) => (b.onclick = guard(async () => {
    if (!confirm('Mark yourself as a precinct chair candidate or appointee? You can undo this.')) return;
    await api('/ladder/claim', { method: 'POST', body: { id: b.dataset.claim.replace(/^claim:/, '') } });
    confetti(24);
    await refreshStats();
    await render(el, arg);
  })));

  if (arg === 'invite') $('#invite', el)?.scrollIntoView({ block: 'start' });
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
