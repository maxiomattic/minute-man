// Points, ranks, badges. Points are honorific only: there is deliberately no way to
// redeem them for anything (see README "Legal design").
//
// Points come from three sources, none of which depend on how anyone voted:
//   1. participation (registered, voted, planned, reminded)  -- turnout, self-reported
//   2. activity (meetings, canvassing, phone banking, ...)    -- activism
//   3. group wins: contests where a bound leader's slate won  -- public results, same for every follower

export const ACTIVITY = {
  council_meeting: { label: 'City council meeting', verified: 30, self: 15, unit: 'meeting' },
  party_meeting: { label: 'Local party meeting', verified: 30, self: 15, unit: 'meeting' },
  volunteer: { label: 'Campaign volunteer shift', verified: 40, self: 20, unit: 'shift' },
  gotv: { label: 'GOTV shift', verified: 40, self: 20, unit: 'shift' },
  canvass: { label: 'Door knocking', perUnit: 1, dailyCap: 100, verifiedBonus: 20, unit: 'door' },
  phonebank: { label: 'Phone banking', perUnit: 1, dailyCap: 100, verifiedBonus: 20, unit: 'call' },
  social: { label: 'Social media post', perUnit: 3, dailyCap: 15, unit: 'post' },
};

export const PARTICIPATION = {
  registered: 50, // once ever (election_id null)
  planned: 10,
  voted: 100,
  reminded: 5, // per friend nudged, capped below
};
export const REMIND_CAP = 10; // reminders that score, per election
export const ENDORSE_POINTS = 20;
export const WIN_POINTS = 25;

export const DEFAULT_RANKS = [
  [0, 'Newcomer'],
  [100, 'Voter'],
  [300, 'Regular'],
  [700, 'Organizer'],
  [1500, 'Captain'],
  [3000, 'Precinct Leader'],
  [6000, 'Movement Builder'],
];

/** Points for one activity log entry, given what the user already logged that day. */
export function activityPoints(kind, quantity, verified, alreadyToday = 0) {
  const a = ACTIVITY[kind];
  if (!a) throw new Error('unknown activity kind');
  if (a.perUnit) {
    const room = Math.max(0, a.dailyCap - alreadyToday);
    const base = Math.min(room, quantity * a.perUnit);
    return base + (verified && a.verifiedBonus ? a.verifiedBonus : 0);
  }
  return verified ? a.verified : a.self;
}

export function rankFor(points, customNames) {
  let idx = 0;
  DEFAULT_RANKS.forEach(([min], i) => {
    if (points >= min) idx = i;
  });
  const next = DEFAULT_RANKS[idx + 1];
  const name = (customNames && customNames[idx]) || DEFAULT_RANKS[idx][1];
  return {
    level: idx + 1,
    name,
    nextAt: next ? next[0] : null,
    nextName: next ? (customNames && customNames[idx + 1]) || next[1] : null,
  };
}

/** Full scorecard for a user. */
export function scorecard(db, userId) {
  const part = db
    .prepare(
      `SELECT p.kind, p.election_id, e.kind AS ekind FROM participation p
       LEFT JOIN elections e ON e.id = p.election_id WHERE p.user_id = ?`,
    )
    .all(userId);
  let turnout = 0;
  for (const p of part) if (p.kind !== 'reminded') turnout += PARTICIPATION[p.kind] || 0;

  const reminders = db
    .prepare(
      `SELECT election_id, MIN(COUNT(*), ?) AS n FROM nudges WHERE from_id = ? GROUP BY election_id`,
    )
    .all(REMIND_CAP, userId);
  const remindCount = reminders.reduce((s, r) => s + r.n, 0);
  turnout += remindCount * PARTICIPATION.reminded;

  const act = db
    .prepare(
      `SELECT kind, SUM(points) AS pts, SUM(quantity) AS qty, SUM(verified) AS ver, COUNT(*) AS n
       FROM activity WHERE user_id = ? GROUP BY kind`,
    )
    .all(userId);
  const activism = act.reduce((s, r) => s + r.pts, 0);
  const byKind = Object.fromEntries(act.map((r) => [r.kind, r]));

  const endorse = db.prepare(`SELECT COUNT(*) AS n FROM endorsements WHERE user_id = ?`).get(userId).n;

  // Contests where any actively bound leader's recommendation matched the official winners.
  const rows = db
    .prepare(
      `SELECT r.contest_id, r.choice_ids, res.winner_ids FROM recommendations r
       JOIN bindings b ON b.leader_id = r.leader_id AND b.user_id = ? AND b.active = 1
       JOIN results res ON res.contest_id = r.contest_id
       WHERE r.choice_ids != '[]'`,
    )
    .all(userId);
  const winContests = new Set();
  for (const r of rows) {
    const win = JSON.parse(r.winner_ids);
    if (JSON.parse(r.choice_ids).every((c) => win.includes(c))) winContests.add(r.contest_id);
  }
  const groupWins = winContests.size * WIN_POINTS;

  const points = turnout + activism + endorse * ENDORSE_POINTS + groupWins;

  const voted = part.filter((p) => p.kind === 'voted');
  const badges = [];
  const add = (id, label, desc) => badges.push({ id, label, desc });
  if (part.some((p) => p.kind === 'registered')) add('registered', 'Registered', 'Confirmed your registration');
  if (voted.length) add('voted', 'I Voted', 'Voted in an election');
  if (voted.some((v) => v.ekind === 'primary')) add('primary', 'Primary Voter', 'Voted in a primary');
  if (voted.some((v) => v.ekind === 'local' || v.ekind === 'special')) add('local', 'Local Voter', 'Voted in a local or special election');
  if (voted.length >= 3) add('streak3', 'Habit', 'Voted in 3 elections');
  if (voted.length >= 10) add('streak10', 'Fixture', 'Voted in 10 elections');
  if (remindCount >= 5) add('reminder', 'Reminder', 'Nudged 5 friends to vote');
  if (byKind.council_meeting) add('council', 'In the Room', 'Attended a city council meeting');
  if (byKind.party_meeting) add('party', 'Party Regular', 'Attended a local party meeting');
  if ((byKind.canvass?.qty || 0) >= 100) add('doors100', 'Shoe Leather', 'Knocked 100 doors');
  if ((byKind.canvass?.qty || 0) >= 1000) add('doors1000', 'Ground Game', 'Knocked 1,000 doors');
  if ((byKind.phonebank?.qty || 0) >= 100) add('calls100', 'Dialer', 'Made 100 calls');
  if ((byKind.volunteer?.n || 0) + (byKind.gotv?.n || 0) >= 5) add('shifts5', 'Reliable', 'Worked 5 volunteer or GOTV shifts');
  if (endorse) add('endorser', 'On the Record', 'Publicly endorsed a slate');
  if (winContests.size) add('win', 'Victory', 'A slate you follow won a contest');

  return {
    points,
    breakdown: { turnout, activism, endorsements: endorse * ENDORSE_POINTS, groupWins },
    badges,
    activity: byKind,
    electionsVoted: voted.length,
  };
}
