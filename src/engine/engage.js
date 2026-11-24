// Engagement: next action, daily quests, weekly streak, weekly points, friend feed, cheers.
// Ground rules (see README "Legal design"): everything here is honorific; nothing touches vote
// choice; feed shows only positive actions by people who opted in; no fabricated urgency.
import { ACTIVITY, PARTICIPATION, scorecard, rankFor } from './recognition.js';

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const todayStr = () => iso(new Date());
const addDays = (s, n) => iso(new Date(new Date(s + 'T00:00:00Z').getTime() + n * DAY));
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY);
/** Monday of the week containing date string s. */
export const weekStart = (s = todayStr()) => {
  const d = new Date(s + 'T00:00:00Z');
  return addDays(s, -((d.getUTCDay() + 6) % 7));
};
const hash = (str) => {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

// ---------- variable reward (activism check-ins only, never voting) ----------
export function luckyBonus(db, userId, activityId) {
  const r = hash(`${userId}:${activityId}:${Date.now()}`) % 100;
  const pts = r < 55 ? 0 : r < 85 ? 5 : r < 97 ? 15 : 50;
  if (pts) db.prepare('INSERT OR IGNORE INTO bonuses (user_id, source, points) VALUES (?,?,?)').run(userId, `lucky:${activityId}`, pts);
  return pts;
}

// ---------- weekly points & streak ----------
export function pointsSince(db, uid, since) {
  const ts = since + ' 00:00:00';
  const act = db.prepare('SELECT COALESCE(SUM(points),0) p FROM activity WHERE user_id=? AND at>=?').get(uid, ts).p;
  const part = db.prepare(`SELECT kind FROM participation WHERE user_id=? AND at>=? AND kind!='reminded'`).all(uid, ts)
    .reduce((s, r) => s + (PARTICIPATION[r.kind] || 0), 0);
  const nudges = Math.min(10, db.prepare('SELECT COUNT(*) n FROM nudges WHERE from_id=? AND at>=?').get(uid, ts).n) * PARTICIPATION.reminded;
  const bonus = db.prepare('SELECT COALESCE(SUM(points),0) p FROM bonuses WHERE user_id=? AND at>=?').get(uid, ts).p;
  const ends = db.prepare('SELECT COUNT(*) n FROM endorsements WHERE user_id=? AND at>=?').get(uid, ts).n * 20;
  return act + part + nudges + bonus + ends;
}

function activeDays(db, uid, since) {
  const ts = since + ' 00:00:00';
  // Separate queries: Cloudflare's SQLite caps the number of terms in a compound SELECT.
  const sources = [['activity', 'user_id'], ['participation', 'user_id'], ['nudges', 'from_id'], ['bonuses', 'user_id'], ['endorsements', 'user_id'], ['cheers', 'user_id']];
  const rows = sources.flatMap(([t, col]) => db.prepare(`SELECT DISTINCT date(at) d FROM ${t} WHERE ${col}=? AND at>=?`).all(uid, ts));
  return new Set(rows.map((r) => r.d));
}

/** Consecutive weeks (Mon–Sun) with at least one civic action. */
export function streak(db, uid) {
  const now = todayStr();
  const days = activeDays(db, uid, addDays(now, -7 * 60));
  const weeks = new Set([...days].map((d) => weekStart(d)));
  const thisWeek = weekStart(now);
  let w = weeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let n = 0;
  while (weeks.has(w)) {
    n++;
    w = addDays(w, -7);
  }
  return {
    weeks: n,
    activeThisWeek: weeks.has(thisWeek),
    atRisk: n > 0 && !weeks.has(thisWeek),
    daysLeftInWeek: 7 - daysBetween(thisWeek, now),
    // last 7 days, oldest first, for the little week strip
    lastSeven: [...Array(7)].map((_, i) => days.has(addDays(now, i - 6))),
  };
}

// ---------- quests ----------
const QUESTS = {
  ballot: { title: 'Look over your sample ballot', xp: 15, when: (c) => c.election, check: (c) => c.ev(`ballot_viewed:${c.election.id}`) },
  remind: { title: 'Remind a friend to vote', xp: 20, when: (c) => c.election && c.friends > 0, check: (c) => c.count('SELECT COUNT(*) n FROM nudges WHERE from_id=? AND date(at)=?') > 0 },
  cheer: { title: 'Cheer someone in your crew', xp: 10, when: (c) => c.crew > 0, check: (c) => c.count('SELECT COUNT(*) n FROM cheers WHERE user_id=? AND date(at)=?') > 0 },
  post: { title: 'Share a post about a local issue', xp: 15, check: (c) => c.count(`SELECT COUNT(*) n FROM activity WHERE user_id=? AND kind='social' AND day=?`) > 0 },
  events: { title: "See what's happening this week", xp: 10, check: (c) => c.ev('events_viewed') },
  doors: { title: 'Knock on 10 doors', xp: 30, check: (c) => c.count(`SELECT COALESCE(SUM(quantity),0) n FROM activity WHERE user_id=? AND kind='canvass' AND day=?`) >= 10 },
  calls: { title: 'Make 10 calls', xp: 30, check: (c) => c.count(`SELECT COALESCE(SUM(quantity),0) n FROM activity WHERE user_id=? AND kind='phonebank' AND day=?`) >= 10 },
  follow: { title: 'Follow someone whose picks you trust', xp: 20, when: (c) => c.bindings === 0, check: (c) => c.bindings > 0 },
};
export const CHEST_XP = 30;

function questContext(db, user, election) {
  const day = todayStr();
  return {
    day,
    election,
    friends: db.prepare(`SELECT COUNT(*) n FROM friendships WHERE status='accepted' AND (a=?1 OR b=?1)`).get(user.id).n,
    crew: crewIds(db, user.id).length,
    bindings: db.prepare('SELECT COUNT(*) n FROM bindings WHERE user_id=? AND active=1').get(user.id).n,
    count: (q) => db.prepare(q).get(user.id, day).n,
    ev: (kind) => !!db.prepare('SELECT 1 FROM events WHERE user_id=? AND kind=? AND day=?').get(user.id, kind, day),
  };
}

export function dailyQuests(db, user, election) {
  const c = questContext(db, user, election);
  const pool = Object.entries(QUESTS).filter(([, q]) => !q.when || q.when(c));
  pool.sort((a, b) => hash(`${user.id}:${c.day}:${a[0]}`) - hash(`${user.id}:${c.day}:${b[0]}`));
  const picked = pool.slice(0, 3).map(([id, q]) => {
    const claimed = !!db.prepare('SELECT 1 FROM bonuses WHERE user_id=? AND source=?').get(user.id, `quest:${id}:${c.day}`);
    return { id, title: q.title, xp: q.xp, done: claimed || q.check(c), claimed };
  });
  const chestClaimed = !!db.prepare('SELECT 1 FROM bonuses WHERE user_id=? AND source=?').get(user.id, `chest:${c.day}`);
  return { day: c.day, quests: picked, chest: { xp: CHEST_XP, ready: picked.every((q) => q.claimed) && !chestClaimed, claimed: chestClaimed } };
}

// ---------- crew (friends + group-mates) ----------
export function crewIds(db, uid) {
  const f = db.prepare(`SELECT CASE WHEN a=?1 THEN b ELSE a END id FROM friendships WHERE status='accepted' AND (a=?1 OR b=?1)`).all(uid);
  const g = db.prepare(`SELECT DISTINCT m.user_id id FROM group_members m JOIN group_members me ON me.group_id=m.group_id AND me.user_id=? WHERE m.user_id!=?`).all(uid, uid);
  return [...new Set([...f, ...g].map((r) => r.id))];
}

// ---------- next action ----------
function nextActions(db, user, ctx) {
  const out = [];
  const add = (a) => out.push(a);
  const day = todayStr();
  if (!user.jurisdiction_id) add({ kind: 'profile', title: 'Set your home area', body: 'We use it to find your elections and polling places.', cta: 'Set home area', href: '#/me', xp: 0 });
  if (!ctx.bindings) add({ kind: 'follow', title: 'Pick who you trust', body: 'Follow people or groups. Their picks fill in your sample ballot.', cta: 'Find leaders', href: '#/leaders', xp: 20 });
  const e = ctx.election;
  if (e) {
    const d = daysBetween(day, e.date);
    const reg = db.prepare('SELECT status FROM registrations WHERE user_id=?').get(user.id)?.status || 'unknown';
    const parts = db.prepare('SELECT kind FROM participation WHERE user_id=? AND election_id=?').all(user.id, e.id).map((r) => r.kind);
    const opens = e.early_voting_start || addDays(e.date, -45);
    const open = day >= opens && day <= e.date;
    if (parts.includes('voted')) {
      // nothing for this election; fall through to crew actions
    } else if (reg !== 'confirmed' && e.registration_deadline && day <= e.registration_deadline) {
      const left = daysBetween(day, e.registration_deadline);
      add({ kind: 'register', title: left === 0 ? 'Registration closes today' : `Register in the next ${left} day${left === 1 ? '' : 's'}`, body: `Deadline for ${e.name} is ${e.registration_deadline}. Check your status in about 2 minutes.`, cta: 'Check registration', href: '#/register', xp: 50, urgent: left <= 7 });
    } else if (open) {
      add({ kind: 'vote', title: d === 0 ? 'Election day. Go vote.' : 'Voting is open', body: `${e.name}. Your cheat sheet and polling place are ready.`, cta: 'Start voting', href: `#/vote/${e.id}`, xp: 100, urgent: d <= 3 });
    }
    if (!parts.includes('voted') && !parts.includes('planned'))
      add({ kind: 'plan', title: 'Make your voting plan', body: `Pick when and where you'll vote in ${e.name}. It takes 30 seconds.`, cta: 'Make a plan', href: `#/vote/${e.id}`, xp: 10 });
    if (!parts.includes('voted') && !db.prepare('SELECT 1 FROM events WHERE user_id=? AND kind=?').get(user.id, `ballot_viewed:${e.id}`))
      add({ kind: 'ballot', title: 'Check your ballot', body: `${ctx.contests} contests. Your leaders' picks are already filled in.`, cta: 'Open ballot', href: `#/ballot/${e.id}`, xp: 15 });
    if (d <= 14) {
      const f = db.prepare(
        `SELECT u.id, u.name FROM friendships fr JOIN users u ON u.id = CASE WHEN fr.a=?1 THEN fr.b ELSE fr.a END
         WHERE fr.status='accepted' AND (fr.a=?1 OR fr.b=?1) AND u.share_status=1
           AND NOT EXISTS (SELECT 1 FROM participation p WHERE p.user_id=u.id AND p.election_id=?2 AND p.kind='voted')
           AND NOT EXISTS (SELECT 1 FROM nudges n WHERE n.from_id=?1 AND n.to_id=u.id AND n.at > datetime('now','-1 day'))
         LIMIT 1`,
      ).get(user.id, e.id);
      if (f) add({ kind: 'nudge', title: `Remind ${f.name.split(' ')[0]} to vote`, body: `${f.name} hasn't voted yet. A quick reminder helps.`, cta: 'Send reminder', action: { type: 'nudge', userId: f.id, electionId: e.id }, xp: 5 });
    }
  }
  const ev = db.prepare(
    `SELECT a.id, a.title, a.starts_at, a.kind FROM actions a
     WHERE a.starts_at BETWEEN datetime('now','-2 hours') AND datetime('now','+7 days')
       AND (a.leader_id IN (SELECT leader_id FROM bindings WHERE user_id=?1 AND active=1)
            OR a.group_id IN (SELECT group_id FROM group_members WHERE user_id=?1))
       AND NOT EXISTS (SELECT 1 FROM activity x WHERE x.action_id=a.id AND x.user_id=?1)
     ORDER BY a.starts_at LIMIT 1`,
  ).get(user.id);
  if (ev) add({ kind: 'event', title: ev.title, body: `${ACTIVITY[ev.kind]?.label || 'Event'}. Check in there for full points.`, cta: 'See event', href: `#/act/${ev.id}`, xp: ACTIVITY[ev.kind]?.verified || 20, when: ev.starts_at });
  add({ kind: 'log', title: 'Did something civic today?', body: 'Log a post, a call, or a conversation with a neighbor.', cta: 'Log it', href: '#/act/log', xp: 3 });
  return out;
}

// ---------- feed ----------
function feed(db, user, limit = 30) {
  const ids = crewIds(db, user.id);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const items = [];
  for (const r of db.prepare(
    `SELECT a.id, a.user_id, u.name, a.kind, a.quantity, a.verified, a.at, x.title FROM activity a JOIN users u ON u.id=a.user_id
     LEFT JOIN actions x ON x.id=a.action_id
     WHERE a.user_id IN (${ph}) AND (u.share_status=1 OR u.on_leaderboards=1) AND a.at > datetime('now','-14 days') ORDER BY a.at DESC LIMIT 50`,
  ).all(...ids)) {
    const k = ACTIVITY[r.kind];
    const what = k?.perUnit ? `${r.quantity} ${k.unit}${r.quantity === 1 ? '' : 's'}` : null;
    const verb = { canvass: 'knocked', phonebank: 'made', social: 'shared' }[r.kind];
    items.push({ key: `a:${r.id}`, userId: r.user_id, name: r.name, at: r.at, icon: r.kind,
      text: verb ? `${verb} ${what}` : r.title ? `went to ${r.title}` : `did a ${k?.label.toLowerCase() || r.kind}`, verified: !!r.verified });
  }
  for (const r of db.prepare(
    `SELECT p.user_id, u.name, p.kind, p.at, e.name ename, p.election_id FROM participation p JOIN users u ON u.id=p.user_id
     JOIN elections e ON e.id=p.election_id WHERE p.user_id IN (${ph}) AND u.share_status=1 AND p.kind IN ('voted','planned')
     AND p.at > datetime('now','-14 days')`,
  ).all(...ids))
    items.push({ key: `p:${r.user_id}:${r.election_id}:${r.kind}`, userId: r.user_id, name: r.name, at: r.at, icon: r.kind,
      text: r.kind === 'voted' ? `voted in the ${r.ename}` : `made a plan to vote in the ${r.ename}` });
  for (const r of db.prepare(
    `SELECT e.user_id, u.name, l.name lname, e.at, e.leader_id FROM endorsements e JOIN users u ON u.id=e.user_id JOIN leaders l ON l.id=e.leader_id
     WHERE e.user_id IN (${ph}) AND e.at > datetime('now','-14 days')`,
  ).all(...ids))
    items.push({ key: `e:${r.user_id}:${r.leader_id}`, userId: r.user_id, name: r.name, at: r.at, icon: 'endorse', text: `endorsed ${r.lname}` });
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  const top = items.slice(0, limit);
  for (const it of top) {
    it.cheers = db.prepare('SELECT COUNT(*) n FROM cheers WHERE item=?').get(it.key).n;
    it.cheered = !!db.prepare('SELECT 1 FROM cheers WHERE item=? AND user_id=?').get(it.key, user.id);
  }
  return top;
}

// ---------- routes ----------
export function engagementRoutes(route, { db, HttpError, bad, upcomingElections, today }) {
  const nextElection = (user) => upcomingElections(user).find((e) => daysBetween(today(), e.date) <= 60) || null;

  route('GET', '/api/today', ({ user }) => {
    const election = nextElection(user);
    const contests = election ? db.prepare('SELECT COUNT(*) n FROM contests WHERE election_id=?').get(election.id).n : 0;
    const bindings = db.prepare('SELECT COUNT(*) n FROM bindings WHERE user_id=? AND active=1').get(user.id).n;
    const actions = nextActions(db, user, { election, contests, bindings });
    const sc = scorecard(db, user.id);
    let names = null;
    if (user.theme?.startsWith('leader:')) {
      const l = db.prepare('SELECT rank_names FROM leaders WHERE id=?').get(Number(user.theme.slice(7)));
      names = l?.rank_names ? JSON.parse(l.rank_names) : null;
    }
    const crew = crewIds(db, user.id);
    let proof = null;
    if (election && crew.length) {
      const ph = crew.map(() => '?').join(',');
      const voted = db.prepare(`SELECT COUNT(*) n FROM participation p JOIN users u ON u.id=p.user_id WHERE p.election_id=? AND p.kind='voted' AND u.share_status=1 AND p.user_id IN (${ph})`).get(election.id, ...crew).n;
      if (voted) proof = { voted, crew: crew.length };
    }
    const week = pointsSince(db, user.id, weekStart());
    const weekBoard = [user.id, ...crew].map((id) => pointsSince(db, id, weekStart()));
    const place = weekBoard.filter((p) => p > week).length + 1;
    return {
      next: actions[0],
      upNext: actions.slice(1, 3),
      quests: dailyQuests(db, user, election),
      streak: streak(db, user.id),
      points: sc.points,
      rank: rankFor(sc.points, names),
      badges: sc.badges,
      week: { points: week, place, of: weekBoard.length },
      election: election && { ...election, daysLeft: daysBetween(today(), election.date), contests },
      proof,
    };
  });

  route('POST', '/api/quests/:id/claim', ({ user, params }) => {
    const election = nextElection(user);
    const dq = dailyQuests(db, user, election);
    if (params.id === 'chest') {
      if (!dq.chest.ready) throw bad('finish all three quests first');
      db.prepare('INSERT OR IGNORE INTO bonuses (user_id, source, points) VALUES (?,?,?)').run(user.id, `chest:${dq.day}`, CHEST_XP);
      return { ok: true, xp: CHEST_XP };
    }
    const q = dq.quests.find((x) => x.id === params.id);
    if (!q) throw new HttpError(404, 'not one of today\'s quests');
    if (!q.done) throw bad('not done yet');
    if (q.claimed) throw new HttpError(409, 'already claimed');
    db.prepare('INSERT OR IGNORE INTO bonuses (user_id, source, points) VALUES (?,?,?)').run(user.id, `quest:${q.id}:${dq.day}`, q.xp);
    return { ok: true, xp: q.xp };
  });

  route('POST', '/api/events', ({ user, body }) => {
    const k = String(body.kind || '');
    if (!/^(ballot_viewed:[\w-]+|events_viewed)$/.test(k)) throw bad('unknown event');
    db.prepare('INSERT OR IGNORE INTO events (user_id, kind) VALUES (?,?)').run(user.id, k);
    return { ok: true };
  });

  route('GET', '/api/feed', ({ user }) => feed(db, user));

  route('POST', '/api/cheers', ({ user, body }) => {
    const item = String(body.item || '');
    const owner = Number(body.ownerId);
    if (!item || owner === user.id) throw bad('cannot cheer that');
    if (!crewIds(db, user.id).includes(owner)) throw new HttpError(403, 'not in your crew');
    if (body.remove) db.prepare('DELETE FROM cheers WHERE user_id=? AND item=?').run(user.id, item);
    else db.prepare('INSERT OR IGNORE INTO cheers (user_id, item, owner_id) VALUES (?,?,?)').run(user.id, item, owner);
    return { cheers: db.prepare('SELECT COUNT(*) n FROM cheers WHERE item=?').get(item).n };
  });
}
