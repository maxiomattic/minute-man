// People: feed items and cheers (used by the Feed tab), friends and groups (under Leaderboard).
// Guardrails: never show how anyone voted; "Not yet" appears only in your own friend list and only
// for friends who chose to share their status (the API filters this). Points are honorific.
import { $, $$, api, esc, guard, haptic, icon, insignia, ACTIVITY_ICON, ago, initials, plural, refreshStats, sheet, state, store, toast } from '../core.js';
import { openRemind } from './remind.js';
import { PEN, editorHtml, mediaUrl, noteSheet, openImage, wireEditor } from './compose.js';

const first = (name) => String(name || '').split(' ')[0];

// ---------- feed items (shared with Today) ----------
// Items on screen by key, so a note, photo or delete can redraw one in place.
const ITEMS = new Map();
// onCheer callback for each item on screen, so an item redrawn later (a new reply) keeps it.
const ON_CHEER = new Map();
const BUBBLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a7.5 7.5 0 0 1-11.2 6.5L4 20l1.5-4.4A7.5 7.5 0 1 1 20 12z"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

/** The words and photo someone added to an item (escaped; the photo opens full size on tap). */
function postParts(it) {
  return {
    body: it.body ? `<p class="feed-body">${esc(it.body)}</p>` : '',
    photo: it.image ? `<button type="button" class="feed-photo" data-full="${esc(it.image)}" aria-label="View photo full size">
      <img src="${esc(mediaUrl(it.image))}" alt="Photo from ${esc(first(it.name))}" loading="lazy" decoding="async"${it.imageW && it.imageH ? ` width="${Number(it.imageW)}" height="${Number(it.imageH)}"` : ''}></button>` : '',
  };
}

/** A ready-made post someone shared: its words, under their own take. */
// The invite link isn't kept, so a closing "Get yours:" line is dropped.
const quoteHtml = (it) => (it.quote ? `<blockquote class="feed-quote">${esc(it.quote.replace(/\n[^\n]*:\s*$/, ''))}</blockquote>` : '');

const rankChip = (rank) => (rank ? ` <span class="feed-rank">${insignia(rank)}${esc(rank)}</span>` : '');

/** One reply. In the thread sheet (full) it gets a menu: delete yours, report others'. */
function replyHtml(r, full = false) {
  return `<div class="reply" data-reply="${r.id}">
    <span class="avatar" aria-hidden="true">${esc(initials(r.name))}</span>
    <div class="grow">
      <div class="reply-bubble">
        <div class="reply-head"><strong>${esc(r.name)}</strong>${rankChip(r.rank)}</div>
        ${r.body ? `<p class="reply-body">${esc(r.body)}</p>` : ''}
      </div>
      ${r.image ? `<button type="button" class="reply-photo" data-full="${esc(r.image)}" aria-label="View photo full size">
        <img src="${esc(mediaUrl(r.image))}" alt="Photo from ${esc(first(r.name))}" loading="lazy" decoding="async"${r.imageW && r.imageH ? ` width="${Number(r.imageW)}" height="${Number(r.imageH)}"` : ''}></button>` : ''}
      <div class="row tiny muted reply-meta"><span>${esc(ago(r.at))} ago${r.place && !r.mine ? `, ${esc(r.place.replace(/, [A-Z]{2}$/, ''))}` : ''}</span>
        ${full ? `<button type="button" class="feed-menu" data-rmenu="${r.id}" aria-label="${r.mine ? 'Delete reply' : 'Report reply'}">${DOTS}</button>` : ''}</div>
    </div>
  </div>`;
}

/** Under a feed item: the latest replies, and "View all" when there are more. */
function threadHtml(it) {
  const n = it.replyCount || 0;
  if (!n) return '';
  return `<div class="feed-thread">
    ${n > (it.replies?.length || 0) ? `<button type="button" class="link-btn thread-more" data-thread="${esc(it.key)}">View all ${n} replies</button>` : ''}
    ${(it.replies || []).map((r) => replyHtml(r)).join('')}
  </div>`;
}

/** Your own activity: add a note or photo. Items with someone's words or photo: a menu (yours: edit/delete; others': report). */
function postActions(it, mine) {
  if (!it.postId) return mine && it.activityId ? `<button type="button" class="link-btn feed-add" data-note="${esc(it.key)}">Add a note or photo</button>` : '';
  return `<button type="button" class="feed-menu" data-menu="${esc(it.key)}" aria-label="${mine ? 'Edit or delete' : 'More options'}">${DOTS}</button>`;
}

/** An official elected on Minute Man's picks did something. Not a person's post: no cheers or replies. */
function deliveredHtml(it) {
  ITEMS.set(it.key, it);
  return `<div class="feed-item delivered" data-key="${esc(it.key)}">
    <span class="avatar seal-av" aria-hidden="true">${icon('hall')}</span>
    <div class="grow">
      <div class="delivered-kicker tiny">Delivered</div>
      <div><strong>${esc(it.name)}</strong> <span class="muted">${esc(it.office)}</span></div>
      <p class="delivered-body">${esc(it.text)}</p>
      <div class="row tiny muted feed-meta">
        <span class="feed-kind">${icon('check')}</span>
        <span>${esc(ago(it.at))} ago. Elected with Minute Man's pick</span>
        ${it.source ? `<a class="feed-source" href="${esc(it.source.url)}" target="_blank" rel="noopener">${esc(it.source.label || 'Source')}</a>` : ''}
      </div>
    </div>
  </div>`;
}

export function feedItemHtml(it) {
  if (it.delivered) return deliveredHtml(it);
  const mine = it.userId === state.me?.id;
  ITEMS.set(it.key, it);
  const { body, photo } = postParts(it);
  return `<div class="feed-item${it.post ? ' is-post' : ''}${photo ? ' has-photo' : ''}${it.replyCount ? ' has-thread' : ''}" data-key="${esc(it.key)}">
    <span class="avatar" aria-hidden="true">${esc(initials(it.name))}</span>
    <div class="grow">
      <div><strong>${esc(it.name)}</strong>${it.rank && it.icon !== 'rank' ? ` <span class="feed-rank">${insignia(it.rank)}${esc(it.rank)}</span>` : ''} ${esc(it.text)}</div>
      ${body}
      ${quoteHtml(it)}
      <div class="row tiny muted feed-meta">
        <span class="feed-kind">${it.icon === 'post' ? PEN : icon(ACTIVITY_ICON[it.icon] || 'star')}</span>
        <span>${esc(ago(it.at))} ago${it.place && !mine ? `, ${esc(it.place.replace(/, [A-Z]{2}$/, ''))}` : ''}</span>
        ${it.verified ? '<span class="tag good">Verified</span>' : ''}
        <span class="feed-acts"><button type="button" class="feed-reply" data-thread="${esc(it.key)}" aria-label="${it.replyCount ? `${it.replyCount} ${it.replyCount === 1 ? 'reply' : 'replies'}. Reply` : 'Reply'}">${BUBBLE}<span>${it.replyCount ? it.replyCount : 'Reply'}</span></button>${postActions(it, mine)}</span>
      </div>
    </div>
    ${mine ? (it.cheers ? `<span class="tiny muted">${plural(it.cheers, 'cheer')}</span>` : '')
      : `<button class="cheer ${it.cheered ? 'on' : ''} ${it.cheers ? '' : 'zero'}" data-item="${esc(it.key)}" data-owner="${it.userId}" aria-pressed="${it.cheered}" aria-label="Cheer ${esc(first(it.name))}">${icon('clap')}<span>${it.cheers || 'Cheer'}</span></button>`}
    ${photo}
    ${threadHtml(it)}
  </div>`;
}

/** Redraw one item in place (after a note, photo or edit), keeping its handlers. */
function redraw(el, it, onCheer = ON_CHEER.get(it.key)) {
  const box = document.createElement('div');
  box.innerHTML = feedItemHtml(it);
  bindCheers(box, onCheer);
  el.replaceWith(box.firstElementChild);
}

/** Photos open full size; your items get "Add a note or photo" and edit/delete; others' get Report. */
function bindPostActions(root, onCheer) {
  $$('.feed-photo[data-full], .reply-photo[data-full]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openImage(b.dataset.full, $('img', b)?.alt || ''); }));
  $$('[data-thread]', root).forEach((b) => (b.onclick = () => openThread(b.dataset.thread)));
  // Tapping a reply under an item opens the whole conversation.
  $$('.feed-thread .reply', root).forEach((r) => (r.onclick = () => openThread(r.closest('.feed-item')?.dataset.key)));
  const itemOf = (b) => [b.closest('.feed-item'), ITEMS.get(b.dataset.note || b.dataset.menu)];
  const edit = (el, it) => noteSheet({
    activityId: it.activityId,
    post: it.postId ? { body: it.body, image: it.image } : null,
    title: it.postId ? 'Edit your note or photo' : 'Add a note or photo',
    onSaved: (p) => redraw(el, { ...it, postId: p?.id || null, body: p?.body || null, image: p?.image || null, imageW: p?.imageW, imageH: p?.imageH }, onCheer),
  });
  $$('[data-note]', root).forEach((b) => (b.onclick = () => { const [el, it] = itemOf(b); if (it) edit(el, it); }));
  $$('[data-menu]', root).forEach((b) => (b.onclick = () => {
    const [el, it] = itemOf(b);
    if (!it) return;
    const mine = it.userId === state.me?.id;
    const s = sheet(mine
      ? `<h2>${it.post ? 'Your post' : 'Your note and photo'}</h2>
        <div class="sheet-actions">
          ${it.activityId ? '<button class="btn line block" data-do="edit">Edit note or photo</button>' : ''}
          <button class="btn danger block" data-do="delete">${it.post ? 'Delete post' : 'Remove note and photo'}</button>
          <button class="btn quiet block" data-do="close">Cancel</button>
        </div>`
      : `<h2>Report this post?</h2>
        <p class="muted">It disappears from your feed, and we'll take a look. ${esc(first(it.name))} isn't told who reported it.</p>
        <div class="sheet-actions">
          <button class="btn danger block" data-do="report">Report and hide</button>
          <button class="btn quiet block" data-do="close">Cancel</button>
        </div>`);
    const on = (k, fn) => { const x = $(`[data-do="${k}"]`, s.el); if (x) x.onclick = fn; };
    on('close', s.close);
    on('edit', () => { s.close(); edit(el, it); });
    on('delete', guard(async () => {
      await api(`/feed/posts/${it.postId}`, { method: 'DELETE' });
      s.close();
      toast(it.post ? 'Post deleted' : 'Note and photo removed');
      if (it.post) { ITEMS.delete(it.key); el.remove(); }
      else redraw(el, { ...it, postId: null, body: null, image: null }, onCheer);
    }));
    on('report', guard(async () => {
      await api('/feed/report', { method: 'POST', body: { item: it.key } });
      s.close();
      toast('Reported. You won\'t see it again.');
      ITEMS.delete(it.key);
      el.remove();
    }));
  }));
}

/** Wire cheer toggles inside root. onCheer runs after a successful cheer (e.g. refresh quests). */
export function bindCheers(root, onCheer) {
  if (onCheer) $$('.feed-item[data-key]', root).forEach((x) => ON_CHEER.set(x.dataset.key, onCheer));
  bindPostActions(root, onCheer);
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

// ---------- replies ----------
/** The whole conversation on one feed item, with a box to reply (words and one photo). */
export function openThread(key) {
  if (!key) return;
  const it = ITEMS.get(key);
  let replies = [];
  const about = it && (it.post || !it.text ? (it.body || it.quote || 'posted a photo').slice(0, 120) : it.text);
  const s = sheet(`<div class="vb"><div class="row between" style="margin-bottom:6px"><h2 style="margin:0">Replies</h2>
      <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    ${it ? `<p class="muted small thread-about"><strong>${esc(it.name)}</strong> ${esc(about)}</p>` : ''}
    <div class="thread-list" aria-live="polite"><div class="skeleton"></div></div>
    ${editorHtml({ id: 'replyForm', placeholder: it ? `Reply to ${first(it.name)}…` : 'Write a reply…', submit: 'Reply', cls: 'reply-composer' })}
    <p class="tiny muted composer-note">Everyone who can see this post can see your reply. No points for replies.</p></div>`);
  $('[data-close]', s.el).onclick = s.close;
  const list = $('.thread-list', s.el);
  // Keep the item on the feed in step: count and the latest two.
  const sync = () => {
    const el = document.querySelector(`.feed-item[data-key="${CSS.escape(key)}"]`);
    const cur = ITEMS.get(key);
    if (el && cur) redraw(el, { ...cur, replyCount: replies.length, replies: replies.slice(-2) });
  };
  const paint = () => {
    list.innerHTML = replies.length ? replies.map((r) => replyHtml(r, true)).join('')
      : '<p class="muted small thread-empty">No replies yet. Start the conversation.</p>';
    $$('.reply-photo[data-full]', list).forEach((b) => (b.onclick = () => openImage(b.dataset.full, $('img', b)?.alt || '')));
    $$('[data-rmenu]', list).forEach((b) => (b.onclick = () => {
      const r = replies.find((x) => x.id === Number(b.dataset.rmenu));
      if (!r) return;
      const m = sheet(r.mine
        ? `<h2>Delete your reply?</h2><div class="sheet-actions">
            <button class="btn danger block" data-do="go">Delete reply</button>
            <button class="btn quiet block" data-do="close">Cancel</button></div>`
        : `<h2>Report this reply?</h2>
          <p class="muted">It disappears for you, and we'll take a look. ${esc(first(r.name))} isn't told who reported it.</p>
          <div class="sheet-actions"><button class="btn danger block" data-do="go">Report and hide</button>
            <button class="btn quiet block" data-do="close">Cancel</button></div>`);
      $('[data-do="close"]', m.el).onclick = m.close;
      $('[data-do="go"]', m.el).onclick = guard(async () => {
        if (r.mine) await api(`/feed/replies/${r.id}`, { method: 'DELETE' });
        else await api('/feed/report', { method: 'POST', body: { item: r.key } });
        m.close();
        toast(r.mine ? 'Reply deleted' : "Reported. You won't see it again.");
        replies = replies.filter((x) => x.id !== r.id);
        paint();
        sync();
      });
    }));
  };
  api(`/feed/replies?item=${encodeURIComponent(key)}`).then((d) => {
    replies = d.replies;
    paint();
    list.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }).catch((e) => { list.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; });
  wireEditor($('#replyForm', s.el), {
    onSubmit: async (v) => {
      const r = await api('/feed/replies', { method: 'POST', body: { item: key, body: v.body, image: v.image } });
      replies.push(r.reply);
      paint();
      sync();
      haptic('success');
      list.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  });
  return s;
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
      // Friends are on Minute Man, so the app reminds them itself. Show their rank and, if they share it, whether they voted.
      const s = STATUS[f.status];
      meta = `<span class="row friend-meta">${f.rank ? `<span class="feed-rank">${insignia(f.rank)}${esc(f.rank)}</span>` : ''}${s ? `<span class="tag ${s[0]}">${s[1]}</span>` : '<span class="sub">Keeps voting status private</span>'}</span>`;
    }
    return `<li><span class="avatar" aria-hidden="true">${esc(initials(f.name))}</span>
      <div class="grow"><div class="title">${esc(f.name)}</div>${meta}</div>
      <div class="row friend-actions">${actions}</div></li>`;
  };
  body.innerHTML = `
    ${fr.length ? `<ul class="list panel flush">${fr.map(row).join('')}</ul>`
      : `<div class="panel empty"><h2>Bring your people</h2><p>Friends on Minute Man can cheer each other on and see each other's rank.</p></div>`}
    <div class="panel crew-form">
      <h3>Know someone who isn't on Minute Man?</h3>
      <p class="small muted">Text them a reminder to vote with your sample ballot link, or invite them to join.</p>
      <div class="row inline-form">
        <button class="btn go" type="button" id="remindSomeone">Remind someone to vote</button>
        <a class="btn line" href="#/path/invite">Invite a friend</a>
      </div>
    </div>
    <form id="addFriend" class="panel crew-form">
      <h3>Add a friend who's on Minute Man</h3>
      <p class="small muted">We'll send a request they can accept.</p>
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
  $('#remindSomeone', body).onclick = guard(() => openRemind());
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
