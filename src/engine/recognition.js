// Points, ranks, badges. Points are honorific only: there is deliberately no way to
// redeem them for anything (see README "Legal design").
//
// Points come from three sources, none of which depend on how anyone voted:
//   1. participation (registered, voted, planned)            -- turnout, self-reported
//   2. activity (meetings, canvassing, phone banking, shared posts and voting reminders, ...) -- activism
//   3. wins: contests where a pick on the shared ballot won  -- public results, same for everyone

export const ACTIVITY = {
  council_meeting: { label: 'City council meeting', verified: 30, self: 15, unit: 'meeting' },
  party_meeting: { label: 'Local party meeting', verified: 30, self: 15, unit: 'meeting' },
  volunteer: { label: 'Campaign volunteer shift', verified: 40, self: 20, unit: 'shift' },
  gotv: { label: 'GOTV shift', verified: 40, self: 20, unit: 'shift' },
  canvass: { label: 'Door knocking', perUnit: 1, dailyCap: 100, verifiedBonus: 20, unit: 'door' },
  phonebank: { label: 'Phone banking', perUnit: 1, dailyCap: 100, verifiedBonus: 20, unit: 'call' },
  social: { label: 'Shared post', perUnit: 3, dailyCap: 15, unit: 'post' },
  // A reminder to vote, sent from the voter's own phone to someone not on Minute Man (app users get the
  // app's own reminders). Recorded only when the share sheet finishes; never logged by hand.
  reminded: { label: 'Voting reminder', perUnit: 5, dailyCap: 25, unit: 'reminder', shareOnly: true },
  election_work: { label: 'Poll watcher or election worker', verified: 60, self: 40, unit: 'shift' },
};

export const PARTICIPATION = {
  registered: 50, // once ever (election_id null)
  planned: 10,
  voted: 100,
};
/** Reminders you can record in one day (points stop earlier, at ACTIVITY.reminded.dailyCap). */
export const REMIND_DAILY_LIMIT = 20;
export const ENDORSE_POINTS = 20;
export const WIN_POINTS = 25;

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

/** Full scorecard for a user. */
export function scorecard(db, userId) {
  const part = db
    .prepare(
      `SELECT p.kind, p.election_id, e.kind AS ekind FROM participation p
       LEFT JOIN elections e ON e.id = p.election_id WHERE p.user_id = ?`,
    )
    .all(userId);
  let turnout = 0;
  for (const p of part) turnout += PARTICIPATION[p.kind] || 0;

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

  const bonus = db.prepare('SELECT COALESCE(SUM(points),0) p FROM bonuses WHERE user_id=?').get(userId).p;
  const points = turnout + activism + endorse * ENDORSE_POINTS + groupWins + bonus;

  const voted = part.filter((p) => p.kind === 'voted');
  const badges = [];
  const add = (id, label, desc) => badges.push({ id, label, desc });
  if (part.some((p) => p.kind === 'registered')) add('registered', 'Registered', 'Confirmed your registration');
  if (voted.length) add('voted', 'I Voted', 'Voted in an election');
  if (voted.some((v) => v.ekind === 'primary')) add('primary', 'Primary Voter', 'Voted in a primary');
  if (voted.some((v) => v.ekind === 'local' || v.ekind === 'special')) add('local', 'Local Voter', 'Voted in a local or special election');
  if (voted.length >= 3) add('streak3', 'Habit', 'Voted in 3 elections');
  if (voted.length >= 10) add('streak10', 'Fixture', 'Voted in 10 elections');
  if ((byKind.reminded?.qty || 0) >= 5) add('reminder', 'Reminder', 'Reminded 5 people to vote');
  if (byKind.council_meeting) add('council', 'In the Room', 'Attended a city council meeting');
  if (byKind.party_meeting) add('party', 'Party Regular', 'Attended a local party meeting');
  if ((byKind.canvass?.qty || 0) >= 100) add('doors100', 'Shoe Leather', 'Knocked 100 doors');
  if ((byKind.canvass?.qty || 0) >= 1000) add('doors1000', 'Ground Game', 'Knocked 1,000 doors');
  if ((byKind.phonebank?.qty || 0) >= 100) add('calls100', 'Dialer', 'Made 100 calls');
  if ((byKind.volunteer?.n || 0) + (byKind.gotv?.n || 0) >= 5) add('shifts5', 'Reliable', 'Worked 5 volunteer or GOTV shifts');
  if (endorse) add('endorser', 'On the Record', 'Publicly endorsed a slate');
  if (winContests.size) add('win', 'Victory', 'A candidate on your ballot won');

  return {
    points,
    breakdown: { turnout, activism, endorsements: endorse * ENDORSE_POINTS, groupWins, bonus },
    badges,
    activity: byKind,
    electionsVoted: voted.length,
  };
}
