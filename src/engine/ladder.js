// The Ladder: ranks you earn by doing each step of political engagement in order, from
// registering to running for precinct chair. Points still drive leaderboards; rank comes
// only from the ladder, so you can't skip the basics by grinding one activity.
//
// Recruiting: everyone has an invite link. People who join through it are your recruits,
// and you earn a bonus each time one of them climbs a rung. Recruits also count toward
// the upper rungs. Like all points, these are honorific and can't be redeemed.
import { localDay } from '../time.js';
import { jurisdictionChain } from '../rules.js';

/** Points for finishing each rung (index = level - 1). */
const RUNG_BONUS = [0, 50, 100, 100, 150, 200, 300, 500];
/** What a recruiter earns when a recruit joins (level 1) or reaches each later rung. */
export const RECRUIT_BONUS = [25, 50, 75, 50, 50, 75, 100, 150];

export const EARLY_BONUS = 25;
const sum = (db, q, ...a) => db.prepare(q).get(...a).n;

/** Facts the steps check. Cheap queries only; recruits use their stored rung. */
function facts(db, user) {
  const uid = user.id;
  const act = (kinds) => sum(db, `SELECT COALESCE(SUM(quantity),0) n FROM activity WHERE user_id=? AND kind IN (${kinds.map(() => '?').join(',')})`, uid, ...kinds);
  const chain = user.jurisdiction_id ? jurisdictionChain(db, user.jurisdiction_id) : [];
  const election = chain.length ? db.prepare(
    `SELECT id, date, early_voting_start FROM elections WHERE jurisdiction_id IN (${chain.map(() => '?').join(',')}) AND date >= ? ORDER BY date LIMIT 1`,
  ).get(...chain, localDay()) : null;
  const voted = db.prepare(
    `SELECT p.at, e.date FROM participation p JOIN elections e ON e.id=p.election_id WHERE p.user_id=? AND p.kind='voted'`,
  ).all(uid);
  return {
    election,
    address: !!user.jurisdiction_id,
    registered: !!db.prepare(`SELECT 1 FROM participation WHERE user_id=? AND kind='registered'`).get(uid)
      || db.prepare('SELECT status FROM registrations WHERE user_id=?').get(uid)?.status === 'confirmed',
    // A plan for the coming election (or, between elections, any past plan or vote).
    planned: !!(election
      ? db.prepare(`SELECT 1 FROM participation WHERE user_id=? AND election_id=? AND kind IN ('planned','voted')`).get(uid, election.id)
      : db.prepare(`SELECT 1 FROM participation WHERE user_id=? AND kind IN ('planned','voted')`).get(uid)),
    voted: voted.length > 0,
    votedEarly: voted.some((v) => v.at.slice(0, 10) < v.date),
    posts: act(['social']),
    reminded: sum(db, 'SELECT COUNT(DISTINCT to_id) n FROM nudges WHERE from_id=?', uid),
    meetings: act(['council_meeting', 'party_meeting']),
    inGroup: sum(db, 'SELECT COUNT(*) n FROM group_members WHERE user_id=?', uid) > 0,
    doors: act(['canvass']),
    calls: act(['phonebank']),
    shifts: act(['volunteer', 'gotv']),
    electionWork: act(['election_work']),
    ledGroup: sum(db, `SELECT COALESCE(MAX(c),0) n FROM (SELECT COUNT(*) c FROM groups g JOIN group_members m ON m.group_id=g.id WHERE g.owner_id=? GROUP BY g.id)`, uid),
    recruits: sum(db, 'SELECT COUNT(*) n FROM users WHERE referred_by=?', uid),
    recruitsRegistered: sum(db, 'SELECT COUNT(*) n FROM users WHERE referred_by=? AND rung>=2', uid),
    recruitsActive: sum(db, 'SELECT COUNT(*) n FROM users WHERE referred_by=? AND rung>=4', uid),
    precinctChair: !!db.prepare(`SELECT 1 FROM bonuses WHERE user_id=? AND source='claim:precinct_chair'`).get(uid),
    learned: new Set(db.prepare(`SELECT source FROM bonuses WHERE user_id=? AND source LIKE 'learn:%'`).all(uid).map((r) => r.source.slice(6))),
  };
}

const fmtDay = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Points for finishing a training. Honor system, once each. */
export const LESSON_POINTS = 15;

// Short trainings that unlock the in-person steps. Facts are drawn from the linked sources.
export const LESSONS = {
  learn_local: {
    title: 'How local government works in Texas',
    points: [
      'Each county is run by a commissioners court: a county judge and four commissioners, all elected. It sets the county budget and tax rate.',
      'Cities are run by a mayor and city council. They set the city budget, zoning and local ordinances.',
      'School boards set school district budgets and tax rates.',
      'These meetings are public, and most set aside time for public comment.',
    ],
    source: { label: 'Texas Government: Local Government (LibreTexts)', url: 'https://socialsci.libretexts.org/Bookshelves/Political_Science_and_Civics/Texas_Government_(Lumen)/10%3A_Local_Government/10.01%3A_Introduction_to_Local_Government' },
  },
  learn_party: {
    title: 'How your county Republican Party works',
    points: [
      'Every voting precinct can elect a Republican precinct chair in the March primary. They serve two years.',
      'Precinct chairs and the county chair make up the county executive committee.',
      'Precinct chairs represent the party in their precinct, register and turn out voters, work elections and run the precinct convention.',
      'County parties hold regular meetings. Call your county chair to find the next one.',
    ],
    source: { label: 'Republican Party of Texas: Precinct Chairs (PDF)', url: 'https://texasgop.org/wp-content/uploads/2025/10/Precinct-Chair-One-Pager-2026-Primary-2.pdf' },
  },
  learn_canvass: {
    title: 'How a block walk works',
    points: [
      'The campaign gives you a list of addresses, usually in a phone app, and a short script.',
      'Knock, say who you\'re with, ask your question and record the answer before moving on.',
      'Nobody home? Leave the literature and mark it.',
      'Your first time, ask to walk with someone experienced.',
    ],
  },
  learn_election: {
    title: 'Poll watcher training',
    points: [
      'In Texas, a candidate or party appoints poll watchers. Ask your county chair.',
      'Every watcher must take the Secretary of State\'s free online training and bring the printed certificate, along with the certificate of appointment.',
      'The certificate covers a set period (Jan 1 to Aug 31, or Sep 1 to Dec 31), so you may need to retake it for a new election.',
    ],
    source: { label: 'Texas Election Training Portal (Secretary of State)', url: 'https://pollworkertraining.sos.texas.gov' },
  },
  learn_chair: {
    title: 'What a precinct chair does',
    points: [
      'You must live in the precinct, be a qualified voter, be affiliated with the Republican Party, and not hold or be running for public office.',
      'To run, file a notarized application with your county chair by the December filing deadline. If nobody else files, you\'re declared elected.',
      'Empty seats can be filled by the county executive committee between primaries.',
    ],
    source: { label: 'Texas Secretary of State: Precinct Chair', url: 'https://www.sos.texas.gov/elections/candidates/guide/2026/precinct-chair.shtml' },
  },
};
const lesson = (id, label, needs) => ({
  id, label, cta: 'Start the training', href: `#/path/learn/${id}`, how: LESSONS[id].title + '. Takes about 5 minutes.', lesson: true, needs, xp: `+${LESSON_POINTS}`,
  check: (f) => +f.learned.has(id),
});

// Each step: label, how (one or two sentences of coaching), href or action, and a check that
// returns a number (progress) against `goal` (default 1).
export const LADDER = [
  { name: 'Newcomer', blurb: 'You joined. Welcome.', steps: [] },
  {
    name: 'Registered Voter', blurb: 'Get ready to vote.',
    steps: [
      { id: 'address', needs: [], cta: 'Add your address', label: 'Add your home address', how: 'It finds your exact ballot and districts. We keep the city, not the street.', href: '#/me/profile', check: (f) => +f.address },
      { id: 'registered', needs: ['address'], xp: '+50', cta: 'Check registration', label: 'Confirm you\'re registered', how: 'The state lookup takes about 2 minutes. If you aren\'t registered, we walk you through it.', href: '#/register', check: (f) => +f.registered },
      { id: 'plan', needs: ['registered'], xp: '+10', cta: 'Make a plan', label: 'Make a voting plan', how: 'Pick when and where you\'ll vote. People with a plan are far more likely to follow through.', href: (f) => (f.election ? `#/vote/${f.election.id}` : '#/ballot'), check: (f) => +f.planned },
    ],
  },
  {
    name: 'Active Voter', blurb: 'Cast your ballot.',
    steps: [
      { id: 'vote', needs: ['plan'], xp: '+100', cta: 'Vote', label: 'Vote, early if you can', how: 'Early voting means no election-day lines, and it frees you up to drive friends on election day. Voting early earns 25 extra XP.',
        href: (f) => (f.election ? `#/vote/${f.election.id}` : '#/ballot'), check: (f) => +f.voted,
        opens: (f) => f.election?.early_voting_start },
    ],
  },
  {
    name: 'Messenger', blurb: 'Spread the word.',
    steps: [
      { id: 'posts', needs: ['registered'], xp: '+3 per share', cta: 'Share a post', label: 'Share 5 posts', how: 'Pick a ready-made post about your ballot or a deadline and share it from your own account. Each share counts.', href: '#/act/share', goal: 5, check: (f) => f.posts },
      { id: 'remind', needs: ['plan'], xp: '+5 per friend', cta: 'Remind friends', label: 'Remind 3 friends to vote', how: 'A personal reminder works better than any ad.', href: '#/board/friends', goal: 3, check: (f) => f.reminded },
      { id: 'recruit1', needs: ['posts'], xp: '+25 each', cta: 'Share your invite', label: 'Bring 1 person to Minute Man', how: 'Send your invite link. You earn a bonus every time they climb a rank.', href: '#/path/invite', check: (f) => f.recruits },
    ],
  },
  {
    name: 'Regular', blurb: 'Show up in person.',
    steps: [
      lesson('learn_local', 'Learn how local government works', ['plan']),
      lesson('learn_party', 'Learn how your county party works', ['learn_local']),
      { id: 'meetings', needs: ['learn_party'], log: 'party_meeting', xp: '+30 each', cta: 'Find a meeting', label: 'Go to 2 local meetings', how: 'Your county GOP meeting and a city council or commissioners court meeting. Check in with the event code for full points.', href: '#/act', goal: 2, check: (f) => f.meetings },
      { id: 'group', needs: ['learn_party'], cta: 'Find a group', label: 'Join a local group', how: 'Ask the organizer at a meeting for their Minute Man invite code.', href: '#/board/groups', check: (f) => +f.inGroup },
    ],
  },
  {
    name: 'Volunteer', blurb: 'Work for a campaign.',
    steps: [
      lesson('learn_canvass', 'Learn how a block walk works', ['group']),
      { id: 'doors', needs: ['learn_canvass'], log: 'canvass', xp: '+1 per door', cta: 'Find a block walk', label: 'Knock 100 doors', how: 'Block walks are the most effective thing a volunteer can do. Most campaigns will pair you with someone your first time.', href: '#/act', goal: 100, check: (f) => f.doors },
      { id: 'shift', needs: ['group'], log: 'volunteer', xp: '+40', cta: 'Find a shift', label: 'Work a campaign or GOTV shift', how: 'Phone banks, sign waving, office help, or rides to the polls.', href: '#/act', check: (f) => f.shifts },
      { id: 'recruit3', needs: ['recruit1'], xp: '+50 each', cta: 'See your recruits', label: '3 recruits reach Registered Voter', how: 'Help the people you brought in check their registration and make a plan.', href: '#/path/invite', goal: 3, check: (f) => f.recruitsRegistered },
    ],
  },
  {
    name: 'Block Captain', blurb: 'Organize your neighborhood.',
    steps: [
      { id: 'doors500', needs: ['doors'], log: 'canvass', xp: '+1 per door', cta: 'Find a block walk', label: 'Knock 500 doors', how: 'Own your block: know who lives there and who still needs to vote.', href: '#/act', goal: 500, check: (f) => f.doors },
      { id: 'lead', needs: ['group'], cta: 'Start a group', label: 'Start a group with 5 members', how: 'Create a group for your block or church and share its invite code.', href: '#/board/groups', goal: 5, check: (f) => f.ledGroup },
      lesson('learn_election', 'Take poll watcher training', ['shift']),
      { id: 'work', needs: ['learn_election'], xp: '+60', cta: 'Log a shift', label: 'Work an election', how: 'Serve as a poll watcher or election worker. Your county party chair appoints poll watchers and recommends election judges.', href: '#/act/log/election_work', check: (f) => f.electionWork },
    ],
  },
  {
    name: 'Precinct Chair', blurb: 'Represent your precinct in the party.',
    steps: [
      lesson('learn_chair', 'Learn what a precinct chair does', ['lead']),
      { id: 'chair', needs: ['learn_chair'], xp: '+100', label: 'Become precinct chair', how: 'Precinct chairs sit on the county party\'s executive committee. You run in the March primary (no filing fee), or the county party can appoint you to an empty seat. Many precincts have none. Call your county chair.',
        action: 'claim:precinct_chair', actionLabel: 'I filed or was appointed', link: 'https://www.sos.texas.gov/elections/candidates/guide/2026/precinct-chair.shtml', check: (f) => +f.precinctChair },
      { id: 'team', needs: ['recruit3'], cta: 'See your recruits', label: '3 recruits reach Messenger', how: 'A precinct chair builds a team. Coach your recruits up the ladder.', href: '#/path/invite', goal: 3, check: (f) => f.recruitsActive },
    ],
  },
];

/** Full ladder state for a user. Awards rung and recruiter bonuses as a side effect. */
export function ladderFor(db, user, names) {
  const f = facts(db, user);
  const day = localDay();
  const rungs = LADDER.map((r, i) => {
    const steps = r.steps.map((s) => {
      const goal = s.goal || 1;
      const have = Math.min(goal, s.check(f));
      const opens = s.opens?.(f);
      return {
        id: s.id, label: s.label, cta: s.cta || null, how: s.how, goal, have, done: have >= goal,
        href: typeof s.href === 'function' ? s.href(f) : s.href || null,
        action: s.action || null, actionLabel: s.actionLabel || null, link: s.link || null,
        needs: s.needs || [], xp: s.xp || null, log: s.log || null, lesson: s.lesson ? LESSONS[s.id] : null,
        opensOn: have < goal && opens && day < opens ? opens : null,
        opensLabel: have < goal && opens && day < opens ? `Opens ${fmtDay(opens)}` : null,
      };
    });
    return { level: i + 1, name: (names && names[i]) || r.name, blurb: r.blurb, bonus: RUNG_BONUS[i], steps, complete: steps.every((s) => s.done) };
  });
  // A step is locked until every step it needs is done.
  const byId = new Map(rungs.flatMap((r) => r.steps.map((s) => [s.id, s])));
  for (const s of byId.values()) {
    const missing = s.needs.map((n) => byId.get(n)).filter((n) => !n.done);
    s.locked = !s.done && missing.length > 0;
    s.lockedBy = s.locked ? missing.map((n) => n.label) : [];
  }
  // Your rank is the last rung reached without skipping one.
  let level = 1;
  while (level < rungs.length && rungs[level].complete) level++;

  award(db, user, level, f);

  const current = rungs[level - 1];
  const next = rungs[level] || null;
  // Coaching: the first open step on the next rung that isn't waiting on a date. If they're all
  // waiting (early voting hasn't opened), suggest something from the rung after while they wait.
  let coach = null;
  if (next) {
    const ready = next.steps.find((s) => !s.done && !s.opensOn && !s.locked);
    const waiting = next.steps.find((s) => !s.done && (s.opensOn || s.locked));
    const after = rungs[level + 1]?.steps.find((s) => !s.done && !s.opensOn && !s.locked);
    coach = ready ? { step: ready, rung: next.name }
      : { step: waiting, rung: next.name, meanwhile: after ? { step: after, rung: rungs[level + 1].name } : null };
  }
  const doneSteps = next ? next.steps.filter((s) => s.done).length : 0;
  return {
    level, name: current.name, nextName: next?.name || null, nextAt: null,
    progress: next ? { done: doneSteps, of: next.steps.length } : null,
    coach, rungs,
  };
}

function award(db, user, level, f) {
  const ins = db.prepare(`INSERT OR IGNORE INTO bonuses (user_id, source, points, at) VALUES (?,?,?, datetime('now'))`);
  if (f.votedEarly) ins.run(user.id, 'early-vote', EARLY_BONUS);
  for (let l = 2; l <= level; l++) ins.run(user.id, `rung:${l}`, RUNG_BONUS[l - 1]);
  if ((user.rung || 0) !== level) db.prepare('UPDATE users SET rung=? WHERE id=?').run(level, user.id);
  if (user.referred_by)
    for (let l = 1; l <= level; l++) ins.run(user.referred_by, `recruit:${user.id}:${l}`, RECRUIT_BONUS[l - 1]);
}

/** Recruits with what the recruiter may see: rank only if the recruit shares their status. */
export function recruitsOf(db, user, names) {
  return db.prepare('SELECT * FROM users WHERE referred_by=? ORDER BY id DESC LIMIT 100').all(user.id).map((u) => {
    const lad = ladderFor(db, u); // refreshes their stored rung and your bonuses
    const earned = sum(db, `SELECT COALESCE(SUM(points),0) n FROM bonuses WHERE user_id=? AND source LIKE ?`, user.id, `recruit:${u.id}:%`);
    return {
      id: u.id, name: u.name.split(/\s+/)[0], earned,
      rank: u.share_status ? (names?.[lad.level - 1] || lad.name) : null,
      level: u.share_status ? lad.level : null,
    };
  });
}

/** Stable invite code per user, made on first use. */
export function inviteCode(db, user) {
  if (user.ref_code) return user.ref_code;
  const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ABC[b % ABC.length]).join('');
    try {
      db.prepare('UPDATE users SET ref_code=? WHERE id=?').run(code, user.id);
      return code;
    } catch { /* collision, try again */ }
  }
}

export const RANK_NAMES = LADDER.map((r) => r.name);
