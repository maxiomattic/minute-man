// People: feed items and cheers (used by the Feed tab), friends and groups (under Leaderboard).
// Guardrails: never show how anyone voted; "Not yet" appears only in your own friend list and only
// for friends who chose to share their status (the API filters this). Points are honorific.
import { $, $$, api, esc, guard, haptic, icon, ACTIVITY_ICON, ago, initials, plural, refreshStats, sheet, state, store, toast, xpFly } from '../core.js';

const first = (name) => String(name || '').split(' ')[0];

// ---------- feed items (shared with Today) ----------
export function feedItemHtml(it) {
  const mine = it.userId === state.me?.id;
  return `<div class="feed-item">
    <span class="avatar" aria-hidden="true">${esc(initials(it.name))}</span>
    <div class="grow">
      <div><strong>${esc(it.name)}</strong>${it.rank && it.icon !== 'rank' ? ` <span class="feed-rank">${esc(it.rank)}</span>` : ''} ${esc(it.text)}</div>
      <div class="row tiny muted feed-meta">
        <span class="feed-kind">${icon(ACTIVITY_ICON[it.icon] || 'star')}</span>
        <span>${esc(ago(it.at))} ago${it.place && !mine ? `, ${esc(it.place.replace(/, [A-Z]{2}$/, ''))}` : ''}</span>
        ${it.verified ? '<span class="tag good">Verified</span>' : ''}
      </div>
    </div>
    ${mine ? (it.cheers ? `<span class="tiny muted">${plural(it.cheers, 'cheer')}</span>` : '')
      : `<button class="cheer ${it.cheered ? 'on' : ''} ${it.cheers ? '' : 'zero'}" data-item="${esc(it.key)}" data-owner="${it.userId}" aria-pressed="${it.cheered}" aria-label="Cheer ${esc(first(it.name))}">${icon('clap')}<span>${it.cheers || 'Cheer'}</span></button>`}
  </div>`;
}

/** Wire cheer toggles inside root. onCheer runs after a successful cheer (e.g. refresh quests). */
export function bindCheers(root, onCheer) {
  $$('.cheer[data-item]', root).forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.busy) return;
      b.dataset.busy = '1';
      const on = !b.classList.contains('on');
      const label = $('span', b);
      const before = label.textContent;
      const n = (Number(before) || 0) + (on ? 1 : -1);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      label.textContent = n > 0 ? n : 'Cheer';
      b.classList.toggle('zero', n <= 0);
      haptic(on ? 'success' : 'light');
      try {
        const r = await api('/cheers', { method: 'POST', body: { item: b.dataset.item, ownerId: Number(b.dataset.owner), remove: !on } });
        label.textContent = r.cheers > 0 ? r.cheers : 'Cheer';
        b.classList.toggle('zero', r.cheers <= 0);
        onCheer?.(on);
      } catch (e) {
        b.classList.toggle('on', !on);
        b.setAttribute('aria-pressed', !on);
        label.textContent = before;
        b.classList.toggle('zero', !(Number(before) > 0));
        toast(e.message);
      } finally {
        delete b.dataset.busy;
      }
    };
  });
}

// ---------- friends ----------
const STATUS = { voted: ['good', 'Voted'], planned: ['brand', 'Has a plan'], not_yet: ['', 'Not yet'] };

export async function renderFriends(body) {
  const fr = await api('/friends');
  const order = { incoming: 0, friends: 1, requested: 2 };
  fr.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  const row = (f) => {
    let meta;
    let actions = '';
    if (f.state === 'incoming') {
      meta = '<span class="sub">Wants to be friends</span>';
      actions = `<button class="btn sm" data-acc="${f.userId}">Accept</button><button class="btn sm line" data-del="${f.userId}" data-verb="Decline">Decline</button>`;
    } else if (f.state === 'requested') {
      meta = '<span class="sub">Request sent</span>';
      actions = `<button class="link-btn" data-del="${f.userId}" data-verb="Cancel">Cancel</button>`;
    } else {
      const s = STATUS[f.status];
      meta = s ? `<span class="tag ${s[0]}">${s[1]}</span>` : '<span class="sub">Keeps voting status private</span>';
      if (f.status !== 'voted' && f.electionId && f.remindedToday)
        actions = `<button class="btn sm quiet" disabled>${icon('check')}Reminded</button>`;
      else if (f.status !== 'voted' && f.electionId)
        actions = `<button class="btn sm quiet" data-nudge="${f.userId}" data-e="${esc(f.electionId)}" data-name="${esc(first(f.name))}">Remind <span class="xp">+5</span></button>`;
    }
    return `<li><span class="avatar" aria-hidden="true">${esc(initials(f.name))}</span>
      <div class="grow"><div class="title">${esc(f.name)}</div>${meta}</div>
      <div class="row friend-actions">${actions}</div></li>`;
  };
  body.innerHTML = `
    ${fr.length ? `<ul class="list panel flush">${fr.map(row).join('')}</ul>`
      : `<div class="panel empty"><h2>Bring your people</h2><p>Friends can cheer each other on and send a reminder before election day.</p></div>`}
    <form id="addFriend" class="panel crew-form">
      <h3>Add a friend</h3>
      <p class="small muted">They need a Minute Man account. We'll send a request they can accept.</p>
      <div class="row inline-form">
        <label class="sr-only" for="fEmail">Friend's email</label>
        <input id="fEmail" name="email" type="email" placeholder="friend@example.org" autocomplete="off" required>
        <button class="btn ${fr.length ? '' : 'go'}" type="submit">Send request</button>
      </div>
    </form>`;

  $$('[data-acc]', body).forEach((b) => (b.onclick = guard(async () => {
    await api(`/friends/${b.dataset.acc}/accept`, { method: 'POST' });
    haptic('success');
    toast('Friend request accepted');
    refreshStats();
    renderFriends(body);
  })));
  $$('[data-del]', body).forEach((b) => (b.onclick = guard(async () => {
    await api(`/friends/${b.dataset.del}`, { method: 'DELETE' });
    toast(b.dataset.verb === 'Decline' ? 'Request declined' : 'Request canceled');
    renderFriends(body);
  })));
  $$('[data-nudge]', body).forEach((b) => (b.onclick = guard(async () => {
    b.disabled = true;
    try {
      await api(`/friends/${b.dataset.nudge}/nudge`, { method: 'POST', body: { electionId: b.dataset.e } });
    } catch (e) {
      if (!/already/i.test(e.message)) b.disabled = false;
      throw e;
    }
    xpFly(5, b);
    b.innerHTML = `${icon('check')}Reminded`;
    toast(`Reminder sent to ${b.dataset.name}`);
    refreshStats();
  })));
  $('#addFriend', body).onsubmit = guard(async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    await api('/friends', { method: 'POST', body: { email } });
    toast(`Request sent to ${email}`);
    renderFriends(body);
  });
}

// ---------- groups ----------
const KIND = { team: 'Team', neighborhood: 'Neighborhood', chapter: 'Chapter' };

export async function renderGroups(body) {
  const groups = await api('/groups');
  body.innerHTML = `
    ${groups.length ? `<ul class="list panel flush">${groups.map((g) => `<li class="group-row">
        <div class="grow">
          <div class="title">${esc(g.name)}</div>
          <div class="row wrap group-meta"><span class="tag">${KIND[g.kind] || 'Group'}</span><span class="sub">${plural(g.members, 'member')}</span>
          ${g.inviteCode ? `<span class="sub">Invite code <strong class="code">${esc(g.inviteCode)}</strong></span>` : ''}</div>
        </div>
        <div class="row wrap group-actions">
          ${g.inviteCode ? `<button class="btn sm quiet" data-share="${g.id}">Share invite</button>` : ''}
          <button class="btn sm line" data-lb="${g.id}">Leaderboard</button>
          <button class="link-btn danger-link" data-leave="${g.id}">Leave</button>
        </div></li>`).join('')}</ul>`
      : `<div class="panel empty"><h2>Find your people</h2><p>Groups are for a block, a team or a chapter. Join one with an invite code, or start your own.</p></div>`}
    <div class="crew-forms">
      <form id="joinGroup" class="panel crew-form">
        <h3>Join a group</h3>
        <p class="small muted">Ask an organizer for the invite code.</p>
        <div class="row inline-form">
          <label class="sr-only" for="gCode">Invite code</label>
          <input id="gCode" name="code" placeholder="8-letter code" autocapitalize="characters" autocomplete="off" required>
          <button class="btn ${groups.length ? '' : 'go'}" type="submit">Join group</button>
        </div>
      </form>
      <form id="makeGroup" class="panel crew-form">
        <h3>Start a group</h3>
        <label class="field" for="gName">Name</label>
        <input id="gName" name="name" placeholder="Elm Street neighbors" required maxlength="80">
        <label class="field" for="gKind">Kind</label>
        <select id="gKind" name="kind"><option value="team">Team</option><option value="neighborhood">Neighborhood</option><option value="chapter">Chapter</option></select>
        <button class="btn line block" type="submit" style="margin-top:14px">Create group</button>
      </form>
    </div>`;

  const byId = (id) => groups.find((g) => String(g.id) === String(id));
  $$('[data-share]', body).forEach((b) => (b.onclick = guard(async () => {
    const g = byId(b.dataset.share);
    const text = `Join "${g.name}" on Minute Man with invite code ${g.inviteCode}.`;
    if (navigator.share) {
      try { await navigator.share({ title: g.name, text }); } catch { /* user closed the share sheet */ }
      return;
    }
    await navigator.clipboard.writeText(g.inviteCode);
    toast(`Invite code ${g.inviteCode} copied`);
  })));
  $$('[data-lb]', body).forEach((b) => (b.onclick = () => { store.set('lbscope', `group:${b.dataset.lb}`); location.hash = '#/board'; }));
  $$('[data-leave]', body).forEach((b) => (b.onclick = () => {
    const g = byId(b.dataset.leave);
    const s = sheet(`<h2>Leave ${esc(g.name)}?</h2>
      <p class="muted">You'll drop off its leaderboard and feed. ${g.owner ? "You own this group; it stays open for its members." : 'You can rejoin with an invite code.'}</p>
      <div class="row" style="margin-top:18px"><button class="btn quiet grow" data-x>Stay</button><button class="btn danger grow" data-ok>Leave group</button></div>`);
    $('[data-x]', s.el).onclick = s.close;
    $('[data-ok]', s.el).onclick = guard(async () => {
      await api(`/groups/${g.id}/membership`, { method: 'DELETE' });
      s.close();
      if (store.get('lbscope') === `group:${g.id}`) store.del('lbscope');
      toast(`You left ${g.name}`);
      renderGroups(body);
    });
  }));
  $('#joinGroup', body).onsubmit = guard(async (e) => {
    e.preventDefault();
    const r = await api('/groups/join', { method: 'POST', body: { code: e.target.code.value } });
    haptic('success');
    toast(`Joined ${r.name}`);
    refreshStats();
    renderGroups(body);
  });
  $('#makeGroup', body).onsubmit = guard(async (e) => {
    e.preventDefault();
    const g = await api('/groups', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    haptic('success');
    toast(`Created ${g.name}. Invite code ${g.inviteCode}`);
    renderGroups(body);
  });
}
