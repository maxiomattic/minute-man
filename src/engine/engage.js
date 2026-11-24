// Engagement: next action, daily quests, weekly streak, weekly points, cheers.
// Ground rules (see README "Legal design"): everything here is honorific; nothing touches vote
// choice; feed shows only positive actions by people who opted in; no fabricated urgency.
import { ACTIVITY, PARTICIPATION, scorecard } from './recognition.js';
import { ladderFor } from './ladder.js';
import { localDay, utcAt, sqlShift } from '../time.js';
import { canCheer, rankedFeed } from './community.js';

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const todayStr = () => localDay();
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
  if (pts) db.prepare(`INSERT OR IGNORE INTO bonuses (user_id, source, points, at) VALUES (?,?,?, datetime('now'))`).run(userId, `lucky:${activityId}`, pts);
  return pts;
}

// ---------- weekly points & streak ----------
export function pointsSince(db, uid, since, until = null) {
  const ts = utcAt(since);
  const te = until ? utcAt(until) : '9999-12-31';
  const W = 'user_id=? AND at>=? AND at<?';
  const act = db.prepare(`SELECT COALESCE(SUM(points),0) p FROM activity WHERE ${W}`).get(uid, ts, te).p;
  const part = db.prepare(`SELECT kind FROM participation WHERE ${W}`).all(uid, ts, te)
    .reduce((s, r) => s + (PARTICIPATION[r.kind] || 0), 0);
  const bonus = db.prepare(`SELECT COALESCE(SUM(points),0) p FROM bonuses WHERE ${W}`).get(uid, ts, te).p;
  const ends = db.prepare(`SELECT COUNT(*) n FROM endorsements WHERE ${W}`).get(uid, ts, te).n * 20;
  return act + part + bonus + ends;
}

function activeDays(db, uid, since) {
  const ts = utcAt(since);
  const shift = sqlShift();
  // Separate queries: Cloudflare's SQLite caps the number of terms in a compound SELECT.
  const sources = [['activity', 'user_id'], ['participation', 'user_id'], ['bonuses', 'user_id'], ['endorsements', 'user_id'], ['cheers', 'user_id']];
  const rows = sources.flatMap(([t, col]) => db.prepare(`SELECT DISTINCT date(at, ?) d FROM ${t} WHERE ${col}=? AND at>=?`).all(shift, uid, ts));
  return new Set(rows.map((r) => r.d));
}

/** Points you need in a week (Mon–Sun) to keep your streak alive. */
export const WEEKLY_MIN = 50;

/** Consecutive weeks (Mon–Sun) in which you earned at least WEEKLY_MIN points. */
export function streak(db, uid) {
  const now = todayStr();
  const days = activeDays(db, uid, addDays(now, -6));
  const thisWeek = weekStart(now);
  const weekPts = (w) => pointsSince(db, uid, w, addDays(w, 7));
  const pointsThisWeek = weekPts(thisWeek);
  const met = pointsThisWeek >= WEEKLY_MIN;
  // This week counts once it's met; until then the streak runs through last week.
  let w = met ? thisWeek : addDays(thisWeek, -7);
  let n = 0;
  while (n < 520 && weekPts(w) >= WEEKLY_MIN) {
    n++;
    w = addDays(w, -7);
  }
  return {
    weeks: n,
    goal: WEEKLY_MIN,
    pointsThisWeek,
    activeThisWeek: met,
    atRisk: n > 0 && !met,
    daysLeftInWeek: 7 - daysBetween(thisWeek, now),
    // last 7 days, oldest first, for the little week strip
    lastSeven: [...Array(7)].map((_, i) => days.has(addDays(now, i - 6))),
  };
}

// ---------- quests ----------
// Every quest completes from something the voter really did, recorded on the server: races reviewed
// on the ballot, an RSVP, a reminder sent, a cheer, a share, doors or calls logged. Opening a page
// never counts. `progress` returns { have, goal }; `need` says what's left; `href` is where to do it.
const QUESTS = {
  ballot: {
    title: 'Review your ballot', xp: 15,
    // Once you've reviewed every race on an earlier day, the quest stops coming back.
    when: (c) => c.election && c.ballot.total > 0 && !(c.ballot.have >= c.ballot.total && c.ballot.lastDay < c.day),
    progress: (c) => ({ have: c.ballot.have, goal: c.ballot.total }),
    need: (c) => `Review all ${c.ballot.total} races`,
    href: (c) => `#/ballot/${c.election.id}/examine`,
  },
  // A reminder sent from your phone to someone not on Minute Man (the 'reminded' share activity).
  remind: { title: 'Remind someone to vote', xp: 20, when: (c) => c.election, progress: (c) => ({ have: c.count(`SELECT COUNT(*) n FROM activity WHERE user_id=? AND kind='reminded' AND day=?`), goal: 1 }), need: () => "Text a reminder to someone who isn't on Minute Man", href: () => '#/act/remind' },
  cheer: { title: 'Cheer someone in your feed', xp: 10, when: () => true, progress: (c) => ({ have: c.count('SELECT COUNT(*) n FROM cheers WHERE user_id=? AND date(at, ?)=?'), goal: 1 }), href: () => '#/feed' },
  post: { title: 'Share a post', xp: 15, progress: (c) => ({ goal: 1, have: c.count(`SELECT COUNT(*) n FROM activity WHERE user_id=? AND kind='social' AND day=?`) }), href: () => '#/act/share' },
  events: {
    title: 'RSVP to an event this week', xp: 10,
    when: (c) => c.week.length > 0,
    progress: (c) => ({ have: c.week.filter((a) => a.rsvpDay === c.day).length, goal: 1 }),
    need: () => "Tap I'm going on an event near you",
    href: (c) => { const a = c.week.find((x) => !x.going) || c.week[0]; return `#/act/${a.id}`; },
  },
  doors: { title: 'Knock on 10 doors', xp: 30, progress: (c) => ({ have: c.count(`SELECT COALESCE(SUM(quantity),0) n FROM activity WHERE user_id=? AND kind='canvass' AND day=?`), goal: 10 }), href: () => '#/act/log/canvass' },
  calls: { title: 'Make 10 calls', xp: 30, progress: (c) => ({ have: c.count(`SELECT COALESCE(SUM(quantity),0) n FROM activity WHERE user_id=? AND kind='phonebank' AND day=?`), goal: 10 }), href: () => '#/act/log/phonebank' },
};
export const CHEST_XP = 30;

/** How far along the voter is on reviewing their ballot (races only, never picks). */
export function ballotReview(db, user, election, ballotFor) {
  if (!election || !ballotFor) return { have: 0, total: 0, lastDay: null };
  const ids = new Set(ballotFor(user, election).map((x) => x.id));
  const rows = db.prepare('SELECT contest_id id, date(at, ?) day FROM ballot_reviews WHERE user_id=? AND election_id=?').all(sqlShift(), user.id, election.id).filter((r) => ids.has(r.id));
  return { have: rows.length, total: ids.size, lastDay: rows.reduce((m, r) => (r.day > m ? r.day : m), '') || null };
}

function questContext(db, user, election, deps = {}) {
  const day = todayStr();
  const memo = {};
  const once = (k, f) => (k in memo ? memo[k] : (memo[k] = f()));
  return {
    day,
    election,
    friends: db.prepare(`SELECT COUNT(*) n FROM friendships WHERE status='accepted' AND (a=?1 OR b=?1)`).get(user.id).n,
    count: (q) => (q.includes('date(at, ?)') ? db.prepare(q).get(user.id, sqlShift(), day) : db.prepare(q).get(user.id, day)).n,
    get ballot() { return once('ballot', () => ballotReview(db, user, election, deps.ballotFor)); },
    // Events you can still go to in the next 7 days (not share-a-post items), with your RSVP day.
    get week() {
      return once('week', () => {
        if (!deps.visibleActions) return [];
        const now = Date.now();
        const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
        const list = deps.visibleActions(user).filter((a) => a.kind !== 'social' && a.starts_at >= sql(now - 2 * 3600e3) && a.starts_at <= sql(now + 7 * DAY));
        const rs = db.prepare('SELECT action_id id, date(at, ?) day FROM rsvps WHERE user_id=?').all(sqlShift(), user.id);
        const m = new Map(rs.map((r) => [r.id, r.day]));
        return list.map((a) => ({ id: a.id, going: m.has(a.id), rsvpDay: m.get(a.id) || null }));
      });
    },
  };
}

export function dailyQuests(db, user, election, deps) {
  const c = questContext(db, user, election, deps);
  const pool = Object.entries(QUESTS).filter(([, q]) => !q.when || q.when(c));
  pool.sort((a, b) => hash(`${user.id}:${c.day}:${a[0]}`) - hash(`${user.id}:${c.day}:${b[0]}`));
  const picked = pool.slice(0, 3).map(([id, q]) => {
    const claimed = !!db.prepare('SELECT 1 FROM bonuses WHERE user_id=? AND source=?').get(user.id, `quest:${id}:${c.day}`);
    const { have, goal } = q.progress(c);
    return { id, title: q.title, xp: q.xp, done: claimed || have >= goal, claimed, have: Math.min(have, goal), goal, need: q.need ? q.need(c) : null, href: q.href ? q.href(c) : null };
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
const longDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

function nextActions(db, user, ctx) {
  const out = [];
  const add = (a) => out.push(a);
  const day = todayStr();
  if (!user.jurisdiction_id) add({ kind: 'profile', title: 'Add your home address', body: 'We use it to find your ballot and districts.', cta: 'Add your address', href: '#/me/profile', xp: 0 });
;
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
      add({ kind: 'register', title: left === 0 ? 'Registration closes today' : left === 1 ? 'Register by tomorrow' : `Register in the next ${left} days`, body: `Deadline for ${e.name} is ${longDate(e.registration_deadline)}. Check your status in about 2 minutes.`, cta: 'Check registration', href: '#/register', xp: 50, urgent: left <= 7 });
    } else if (open) {
      add(d === 0
        ? { kind: 'vote', title: 'Election day. Go vote.', body: `${e.name}. Your picks and polling place are ready.`, cta: 'Start voting', href: `#/vote/${e.id}`, xp: 100, urgent: true }
        : { kind: 'vote', title: 'Vote early. It\'s open now.', body: `Skip the Election Day line. ${e.name} is ${d === 1 ? 'tomorrow' : `in ${d} days`}, and your picks and polling place are ready.`, cta: 'Start voting', href: `#/vote/${e.id}`, xp: 100, urgent: d <= 3 });
    }
    if (!parts.includes('voted') && !parts.includes('planned'))
      add({ kind: 'plan', title: 'Make your voting plan', body: `Pick when and where you'll vote in ${e.name}. It takes 30 seconds.`, cta: 'Make a plan', href: `#/vote/${e.id}`, xp: 10 });
    // The bottom rung (mode 'voter'): register, plan, see the picks, vote. Nothing else.
    if (user.mode === 'voter') {
      if (!parts.includes('voted'))
        add({ kind: 'picks', title: 'Your picks are ready', body: open ? `${ctx.contests} races, already filled in. Take them with you when you vote.` : `${ctx.contests} races, already filled in. Early voting starts ${longDate(opens)}, and we'll remind you.`, cta: 'See your picks', href: `#/ballot/${e.id}`, xp: 0 });
      else add({ kind: 'voted', title: 'You voted. Thank you.', body: `Minute Man will remind you before the next election.`, cta: 'See your picks', href: `#/ballot/${e.id}`, xp: 0 });
      return out;
    }
    const br = ctx.review;
    if (!parts.includes('voted') && br.total > 0 && br.have < br.total)
      add({ kind: 'ballot', title: 'Review your ballot', progress: `${br.have} of ${br.total} races reviewed`, body: `${br.total} races, already filled in with Minute Man's picks. Read why each pick was made and tap Got it.`, cta: br.have ? 'Keep reviewing' : 'See why', href: `#/ballot/${e.id}/examine`, xp: 15 });
    // Last two weeks: remind someone who isn't on Minute Man (app users get the app's own reminders).
    if (d <= 14 && !db.prepare(`SELECT 1 FROM activity WHERE user_id=? AND kind='reminded' AND day=?`).get(user.id, day))
      add({ kind: 'remind', title: 'Remind someone to vote', body: `${e.name} is ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}. Text a quick reminder to someone who isn't on Minute Man.`, cta: 'Write a reminder', href: '#/act/remind', xp: 5 });
  }
  if (user.mode === 'voter') return out;
  const ev = db.prepare(
    `SELECT a.id, a.title, a.starts_at, a.kind FROM actions a
     WHERE a.starts_at BETWEEN datetime('now','-2 hours') AND datetime('now','+7 days')
       AND (a.leader_id IN (SELECT leader_id FROM bindings WHERE user_id=?1 AND active=1)
            OR a.group_id IN (SELECT group_id FROM group_members WHERE user_id=?1))
       AND NOT EXISTS (SELECT 1 FROM activity x WHERE x.action_id=a.id AND x.user_id=?1)
     ORDER BY a.starts_at LIMIT 1`,
  ).get(user.id);
  if (ev) add({ kind: 'event', title: ev.title, body: `${ACTIVITY[ev.kind]?.label || 'Event'}. Check in there for full points.`, cta: 'See event', href: `#/act/${ev.id}`, xp: ACTIVITY[ev.kind]?.verified || 20, when: ev.starts_at });
  // Then the open actions on your skill tree, each a specific task.
  const skip = new Set(['address', 'registered', 'plan', 'vote']); // covered above
  for (const s of (ctx.ladder?.rungs || []).flatMap((r) => r.steps))
    if (!s.done && !s.locked && !s.opensOn && !skip.has(s.id) && !s.action && !(s.id === 'remind' && out.some((x) => x.kind === 'remind')))
      add({ kind: `step:${s.id}`, title: s.label, progress: s.goal > 1 ? `${s.have} of ${s.goal} done` : null, body: s.goal > 1 ? `${s.have} of ${s.goal} done. ${s.how}` : s.how, cta: s.cta, href: s.href, xpText: s.xp });
  return out;
}

// ---------- routes ----------
export function engagementRoutes(route, { db, HttpError, bad, upcomingElections, today, ballotFor, visibleActions }) {
  const deps = { ballotFor, visibleActions };
  const nextElection = (user) => upcomingElections(user).find((e) => daysBetween(today(), e.date) <= 60) || null;

  route('GET', '/api/today', ({ user }) => {
    const election = nextElection(user);
    const contests = election ? db.prepare('SELECT COUNT(*) n FROM contests WHERE election_id=?').get(election.id).n : 0;
    const bindings = db.prepare('SELECT COUNT(*) n FROM bindings WHERE user_id=? AND active=1').get(user.id).n;
    const ladder = ladderFor(db, user); // awards rung bonuses before we total points
    const review = ballotReview(db, user, election, ballotFor);
    const actions = nextActions(db, user, { election, contests, bindings, ladder, review });
    const sc = scorecard(db, user.id);
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
      upNext: actions.slice(1, 4),
      quests: dailyQuests(db, user, election, deps),
      streak: streak(db, user.id),
      points: sc.points,
      rank: { level: ladder.level, name: ladder.name, duty: ladder.duty, nextName: ladder.nextName, progress: ladder.progress, coach: ladder.coach, of: ladder.rungs.length },
      badges: sc.badges,
      week: { points: week, place, of: weekBoard.length },
      mode: user.mode === 'voter' ? 'voter' : 'minuteman',
      // For the phone's own reminders (public/notify.js): what's done for this election.
      election: election && { ...election, daysLeft: daysBetween(today(), election.date), contests,
        voted: !!db.prepare(`SELECT 1 FROM participation WHERE user_id=? AND election_id=? AND kind='voted'`).get(user.id, election.id),
        registered: db.prepare('SELECT status FROM registrations WHERE user_id=?').get(user.id)?.status === 'confirmed' },
      proof,
    };
  });

  route('POST', '/api/quests/:id/claim', ({ user, params }) => {
    const election = nextElection(user);
    const dq = dailyQuests(db, user, election, deps);
    if (params.id === 'chest') {
      if (!dq.chest.ready) throw bad('finish all three quests first');
      db.prepare(`INSERT OR IGNORE INTO bonuses (user_id, source, points, at) VALUES (?,?,?, datetime('now'))`).run(user.id, `chest:${dq.day}`, CHEST_XP);
      return { ok: true, xp: CHEST_XP };
    }
    const q = dq.quests.find((x) => x.id === params.id);
    if (!q) throw new HttpError(404, 'not one of today\'s quests');
    if (!q.done) throw bad(`Not done yet. ${q.need || q.title} first${q.goal > 1 ? ` (${q.have} of ${q.goal})` : ''}.`);
    if (q.claimed) throw new HttpError(409, 'already claimed');
    db.prepare(`INSERT OR IGNORE INTO bonuses (user_id, source, points, at) VALUES (?,?,?, datetime('now'))`).run(user.id, `quest:${q.id}:${dq.day}`, q.xp);
    return { ok: true, xp: q.xp };
  });

  route('POST', '/api/events', ({ user, body }) => {
    const k = String(body.kind || '');
    if (!/^(ballot_viewed:[\w-]+|events_viewed)$/.test(k)) throw bad('unknown event');
    db.prepare('INSERT OR IGNORE INTO events (user_id, kind, day) VALUES (?,?,?)').run(user.id, k, todayStr());
    return { ok: true };
  });

  route('GET', '/api/feed', ({ user, query }) => rankedFeed(db, user, { cursor: Math.max(0, Number(query.get('cursor')) || 0) }));

  route('POST', '/api/cheers', ({ user, body }) => {
    const item = String(body.item || '');
    const owner = Number(body.ownerId);
    if (!item || owner === user.id) throw bad('cannot cheer that');
    if (!canCheer(db, user, owner)) throw new HttpError(403, "you can't cheer that");
    if (body.remove) db.prepare('DELETE FROM cheers WHERE user_id=? AND item=?').run(user.id, item);
    else db.prepare(`INSERT OR IGNORE INTO cheers (user_id, item, owner_id, at) VALUES (?,?,?, datetime('now'))`).run(user.id, item, owner);
    return { cheers: db.prepare('SELECT COUNT(*) n FROM cheers WHERE item=?').get(item).n };
  });
}
