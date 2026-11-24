// Community: the ranked feed, area leaderboards and your standing.
//
// Ground rules (see README "Legal design"):
//   - Everyone appears on the feed and leaderboards, with their rank. It isn't a setting.
//   - Nobody ever sees how anyone voted. Strangers never see whether you voted either; only
//     friends and group-mates do.
//   - People outside your friends and groups see a first name and last initial.
//   - Points are honorific and can't be redeemed.
import { ACTIVITY, scorecard } from './recognition.js';
import { LADDER } from './ladder.js';
import { jurisdictionChain } from '../rules.js';
import { localDay, utcAt } from '../time.js';
import { crewIds, pointsSince, streak, weekStart, WEEKLY_MIN } from './engage.js';
import { addThreads } from './replies.js';

const DAY = 86400000;
const PAGE = 15;
const WINDOW_DAYS = 30;
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const short = (name) => {
  const p = String(name || '').trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
};
const LEARNED = {
  learn_local: 'learned how local government works',
  learn_party: 'learned how the county party works',
  learn_canvass: 'learned how a block walk works',
  learn_election: 'finished poll watcher training',
  learn_chair: 'learned what a precinct chair does',
};

// ---------- where people are, relative to you ----------
function chains(db) {
  const memo = new Map();
  return (jid) => {
    if (!jid) return [];
    if (!memo.has(jid)) memo.set(jid, jurisdictionChain(db, jid));
    return memo.get(jid);
  };
}

/** How close someone is: weight for the feed and a level name. */
function closeness(me, myChain, them, theirChain) {
  if (me.jurisdiction_id && me.jurisdiction_id === them.jurisdiction_id && me.precinct && me.precinct === them.precinct)
    return { w: 3, level: 'precinct' };
  const i = myChain.findIndex((j) => theirChain.includes(j));
  if (i < 0) return { w: 1, level: 'nation' };
  return { w: [2.2, 1.6, 1.25, 1.1][Math.min(i, 3)], level: i === 0 ? 'district' : myChain[i] };
}

/** Areas you can rank within, from smallest to largest. */
export function areasFor(db, user) {
  const out = [];
  if (user.jurisdiction_id && user.precinct) out.push({ scope: 'area:precinct', label: `Precinct ${user.precinct}` });
  for (const id of user.jurisdiction_id ? jurisdictionChain(db, user.jurisdiction_id) : []) {
    const j = db.prepare('SELECT name FROM jurisdictions WHERE id=?').get(id);
    // Leaf districts are named "Texas: Congress 6, Senate 2, House 10"; drop the state prefix.
    out.push({ scope: `area:${id}`, label: j.name.includes(':') ? 'Your districts' : j.name.replace(/, [A-Z][a-z]+( [A-Z][a-z]+)?$/, '') });
  }
  out.push({ scope: 'area:all', label: 'Nationwide' });
  return out;
}

// ---------- feed ----------
/**
 * Everything people are getting done, ranked by impact x closeness x freshness.
 *   impact     log of the points it earned, more if checked in at an event, more with cheers and people replying
 *   closeness  your precinct 3x, your districts 2.2x, county 1.6x, state 1.25x; friends and groups 1.5x
 *   freshness  halves every 3 days
 * Pages are offsets into the ranked list (cursor = next offset).
 */
export function rankedFeed(db, user, { cursor = 0, limit = PAGE } = {}) {
  const crew = new Set(crewIds(db, user.id));
  const chainOf = chains(db);
  const myChain = chainOf(user.jurisdiction_id);
  const since = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString().replace('T', ' ').slice(0, 19);
  const people = new Map();
  const who = (id) => {
    if (!people.has(id)) {
      const u = db.prepare('SELECT id, name, jurisdiction_id, precinct, home_label, rung FROM users WHERE id=?').get(id);
      const mine = u.id === user.id;
      const isCrew = crew.has(u.id);
      people.set(id, {
        u, mine, isCrew,
        // Everyone's activity, posts and rank-ups show to everyone (strangers get a short name).
        // Whether someone voted, planned or registered: only friends and group-mates. Never strangers.
        seesVote: mine || isCrew,
        near: closeness(user, myChain, u, chainOf(u.jurisdiction_id)),
      });
    }
    return people.get(id);
  };

  const items = [];
  // Things you reported stay hidden for you.
  const hidden = new Set(db.prepare('SELECT item FROM post_reports WHERE user_id=?').all(user.id).map((r) => r.item));
  // Words and a photo someone added (feed posts, src/engine/feedposts.js).
  const words = (r) => (r.pid ? { postId: r.pid, body: r.body || null, image: r.image ? `/api/media/${r.image}` : null, imageW: r.image_w, imageH: r.image_h } : {});
  // Their Ladder rank beside their name (the stored rung).
  const push = (p, it) => hidden.has(it.key) || items.push({
    ...it, userId: p.u.id, name: p.mine || p.isCrew ? p.u.name : short(p.u.name),
    rank: LADDER[(p.u.rung || 1) - 1]?.name || null,
    place: p.u.home_label || null, near: p.near.level, crew: p.isCrew,
  });

  for (const r of db.prepare(
    `SELECT a.id, a.user_id, a.kind, a.quantity, a.verified, a.points, a.at, a.quote, x.title,
       p.id pid, p.body, p.image, p.image_w, p.image_h FROM activity a
     LEFT JOIN actions x ON x.id=a.action_id LEFT JOIN posts p ON p.activity_id=a.id WHERE a.at > ? ORDER BY a.at DESC LIMIT 2000`,
  ).all(since)) {
    const p = who(r.user_id);
    const k = ACTIVITY[r.kind];
    const qty = k?.perUnit ? `${r.quantity.toLocaleString('en-US')} ${k.unit}${r.quantity === 1 ? '' : 's'}` : null;
    const verb = { canvass: 'knocked', phonebank: 'made', social: 'shared' }[r.kind];
    push(p, {
      key: `a:${r.id}`, at: r.at, icon: r.kind, points: r.points, verified: !!r.verified, activityId: r.id, ...words(r),
      // A ready-made post they shared: its words show under their take.
      ...(r.quote ? { quote: r.quote } : {}),
      text: r.quote ? 'shared a post' : r.kind === 'reminded' ? `reminded ${r.quantity === 1 ? 'someone' : `${r.quantity} people`} to vote`
        : verb ? `${verb} ${qty}${r.title ? ` at ${r.title}` : ''}` : r.title ? `went to ${r.title}` : `worked a ${k?.label.toLowerCase() || r.kind}`,
    });
  }
  for (const r of db.prepare(`SELECT user_id, source, points, at FROM bonuses WHERE at > ? AND (source LIKE 'rung:%' OR source LIKE 'learn:%')`).all(since)) {
    const p = who(r.user_id);
    if (r.source.startsWith('rung:')) {
      const name = LADDER[Number(r.source.slice(5)) - 1]?.name;
      if (name) push(p, { key: `b:${r.user_id}:${r.source}`, at: r.at, icon: 'rank', points: r.points, text: `became ${article(name)} ${name}`, milestone: true });
    } else {
      const text = LEARNED[r.source.slice(6)];
      if (text) push(p, { key: `b:${r.user_id}:${r.source}`, at: r.at, icon: 'learn', points: r.points, text });
    }
  }
  for (const r of db.prepare(
    `SELECT p.user_id, p.kind, p.at, p.election_id, e.name ename FROM participation p LEFT JOIN elections e ON e.id=p.election_id
     WHERE p.at > ? AND p.kind IN ('voted','planned','registered')`,
  ).all(since)) {
    const p = who(r.user_id);
    if (!p.seesVote) continue;
    const text = r.kind === 'voted' ? `voted in the ${r.ename}` : r.kind === 'planned' ? `made a plan to vote in the ${r.ename}` : 'registered to vote';
    push(p, { key: `p:${r.user_id}:${r.election_id}:${r.kind}`, at: r.at, icon: r.kind, points: { voted: 100, planned: 10, registered: 50 }[r.kind], text });
  }

  // Posts people wrote. Everyone sees them.
  for (const r of db.prepare(
    `SELECT id pid, user_id, body, image, image_w, image_h, quote, at FROM posts WHERE activity_id IS NULL AND at > ? ORDER BY at DESC LIMIT 1000`,
  ).all(since)) {
    const p = who(r.user_id);
    push(p, { key: `u:${r.pid}`, at: r.at, icon: 'post', points: 0, text: '', post: true, ...words(r), ...(r.quote ? { quote: r.quote } : {}) });
  }

  const cheers = db.prepare('SELECT COUNT(*) n FROM cheers WHERE item=?');
  const talk = db.prepare('SELECT COUNT(DISTINCT user_id) n FROM replies WHERE item=?');
  const now = Date.now();
  for (const it of items) {
    it.cheers = cheers.get(it.key).n;
    const talkers = talk.get(it.key).n;
    // A post earns no points; it counts like a small unverified action (impact 3, about 6 points' worth),
    // so it never outranks verified work of the same age and distance (at least 7). A photo adds a
    // little: more on real work (an activity) than on a free-form post.
    const photo = it.image ? (it.post ? 1.1 : 1.15) : 1;
    const impact = (it.post ? 3 : Math.log2(2 + it.points)) * (it.verified ? 1.4 : 1) * (it.milestone ? 1.3 : 1) * photo * (1 + 0.15 * Math.min(it.cheers, 10)) * (1 + 0.1 * Math.min(talkers, 10));
    const near = people.get(it.userId).near.w * (it.crew ? 1.5 : 1);
    // One clock reading for the whole list, and no clamp at age 0: items from the same second score
    // the same, and every item decays by the same factor between requests, so pages never shift.
    const fresh = 0.5 ** ((now - Date.parse(it.at.replace(' ', 'T') + 'Z')) / (3 * DAY));
    it.score = impact * near * fresh;
  }
  items.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  // Variety: each further item from the same person counts a little less, so one busy
  // neighbor doesn't fill the top of the feed.
  const seen = new Map();
  for (const it of items) {
    const k = seen.get(it.userId) || 0;
    it.score *= 0.6 ** k;
    seen.set(it.userId, k + 1);
  }
  items.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  const page = items.slice(cursor, cursor + limit);
  const mine = db.prepare('SELECT 1 FROM cheers WHERE item=? AND user_id=?');
  for (const it of page) {
    it.cheered = !!mine.get(it.key, user.id);
    delete it.score;
    delete it.crew;
  }
  addThreads(db, user, page, crew);
  return { items: page, next: cursor + limit < items.length ? cursor + limit : null };
}

/** May this user cheer an item owned by owner? Only things they can see in their feed. */
export function canCheer(db, user, ownerId) {
  if (ownerId === user.id) return false;
  return !!db.prepare('SELECT 1 FROM users WHERE id=?').get(ownerId);
}

// ---------- leaderboards ----------
// "Month" is the last 30 days, so it never resets to empty on the 1st.
const monthStart = () => localDay(new Date(Date.now() - 29 * DAY));
const periodStart = (period) => (period === 'week' ? weekStart() : period === 'month' ? monthStart() : null);

/** Who belongs to a scope (ids), and its title. Throws a plain Error for bad scopes. */
function scopeMembers(db, user, scope) {
  if (scope === 'friends') {
    const ids = db.prepare(`SELECT CASE WHEN a=?1 THEN b ELSE a END AS id FROM friendships WHERE status='accepted' AND (a=?1 OR b=?1)`).all(user.id).map((r) => r.id);
    return { ids: [...ids, user.id], title: 'Friends', crew: true };
  }
  if (scope.startsWith('group:')) {
    const gid = Number(scope.slice(6));
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, user.id)) throw Object.assign(new Error('not in that group'), { status: 403 });
    return { ids: db.prepare('SELECT user_id AS id FROM group_members WHERE group_id=?').all(gid).map((r) => r.id), title: db.prepare('SELECT name FROM groups WHERE id=?').get(gid).name, crew: true };
  }
  const area = areasFor(db, user).find((a) => a.scope === scope);
  if (!area) throw Object.assign(new Error('bad scope'), { status: 400 });
  let ids;
  if (scope === 'area:all') ids = db.prepare('SELECT id FROM users').all().map((r) => r.id);
  else if (scope === 'area:precinct') ids = db.prepare('SELECT id FROM users WHERE jurisdiction_id=? AND precinct=?').all(user.jurisdiction_id, user.precinct).map((r) => r.id);
  else {
    const jid = scope.slice(5);
    const chainOf = chains(db);
    ids = db.prepare('SELECT id, jurisdiction_id FROM users WHERE jurisdiction_id IS NOT NULL').all()
      .filter((u) => chainOf(u.jurisdiction_id).includes(jid)).map((u) => u.id);
  }
  return { ids: [...ids, user.id], title: area.label, crew: false };
}

export function leaderboard(db, user, { scope = 'area:all', period = 'week', top = 50 } = {}) {
  const { ids, title, crew } = scopeMembers(db, user, scope);
  const since = periodStart(period);
  const crewSet = new Set(crewIds(db, user.id));
  const rows = [...new Set(ids)]
    .map((id) => db.prepare('SELECT id, email, name, rung, home_label FROM users WHERE id=?').get(id))
    .filter((u) => u && !/@sources\./.test(u.email || ''))
    .map((u) => {
      const me = u.id === user.id;
      const points = since ? pointsSince(db, u.id, since) : scorecard(db, u.id).points;
      const known = me || crew || crewSet.has(u.id);
      return {
        userId: u.id, name: known ? u.name : short(u.name), points, me,
        rank: LADDER[(u.rung || 1) - 1].name,
        place: known ? null : u.home_label,
      };
    })
    .sort((a, b) => b.points - a.points || (a.me ? -1 : b.me ? 1 : 0));
  rows.forEach((r, i) => (r.place_n = i + 1));
  const meRow = rows.find((r) => r.me);
  const out = rows.slice(0, top).map(({ place_n, ...r }) => ({ ...r, place: place_n, where: r.place }));
  const you = meRow && { ...meRow, place: meRow.place_n, where: null };
  delete you?.place_n;
  return { title, scope, period, count: rows.length, rows: out, you };
}

/** What everyone in your county (or nearest area) got done in the last 30 days, together. Totals only. */
export function together(db, user) {
  const areas = areasFor(db, user);
  // The broadest local area that isn't nationwide: what everyone there did this month, together.
  const local = areas.filter((a) => a.scope !== 'area:all' && a.scope !== 'area:precinct').at(-2) || areas.find((a) => a.scope !== 'area:all');
  if (local) {
    const { ids } = scopeMembers(db, user, local.scope);
    const uniq = [...new Set(ids)];
    const ph = uniq.map(() => '?').join(',');
    const ts = utcAt(monthStart());
    const sum = (kinds) => db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM activity WHERE at>=? AND kind IN (${kinds.map(() => '?').join(',')}) AND user_id IN (${ph})`).get(ts, ...kinds, ...uniq).n;
    const active = db.prepare(`SELECT COUNT(DISTINCT user_id) n FROM activity WHERE at>=? AND user_id IN (${ph})`).get(ts, ...uniq).n;
    // Totals only, and only when enough people are active that nobody can be picked out.
    if (active >= 3)
      return { label: local.label, active, doors: sum(['canvass']), calls: sum(['phonebank']), events: sum(['council_meeting', 'party_meeting', 'volunteer', 'gotv', 'election_work']), posts: sum(['social']) };
  }
  return null;
}

// ---------- your standing ----------
export function standing(db, user) {
  const sc = scorecard(db, user.id);
  const act = (kinds) => kinds.reduce((s, k) => s + (sc.activity[k]?.qty || 0), 0);
  const weeks = [];
  let ws = weekStart();
  for (let i = 0; i < 8; i++) {
    const end = new Date(new Date(ws + 'T00:00:00Z').getTime() + 7 * DAY).toISOString().slice(0, 10);
    weeks.unshift({ week: ws, points: pointsSince(db, user.id, ws, i === 0 ? null : end) });
    ws = new Date(new Date(ws + 'T00:00:00Z').getTime() - 7 * DAY).toISOString().slice(0, 10);
  }
  const areas = areasFor(db, user);
  const places = areas.map((a) => {
    const lb = leaderboard(db, user, { scope: a.scope, period: 'month', top: 0 });
    return { scope: a.scope, label: a.label, place: lb.you?.place || null, of: lb.count };
  });
  const st = streak(db, user.id);
  return {
    points: { week: pointsSince(db, user.id, weekStart()), month: pointsSince(db, user.id, monthStart()), all: sc.points },
    streak: { weeks: st.weeks, goal: WEEKLY_MIN, thisWeek: st.pointsThisWeek },
    totals: {
      doors: act(['canvass']), calls: act(['phonebank']), posts: act(['social']),
      meetings: act(['council_meeting', 'party_meeting']), shifts: act(['volunteer', 'gotv', 'election_work']),
      reminded: act(['reminded']),
      recruits: db.prepare('SELECT COUNT(*) n FROM users WHERE referred_by=?').get(user.id).n,
      elections: sc.electionsVoted,
    },
    weeks,
    badges: sc.badges.map((b) => b.id),
    places,
    together: together(db, user),
  };
}
