// Showcase data: the real Nov 3, 2026 Texas general election ballot for Waxahachie (Ellis County),
// with real endorsements from America First Insight and Donald Trump (see src/data/ and
// scripts/build_data.py). The app clock is set to Oct 1, 2026, so no results are shown.
//
// The voters, the volunteer group and its events are fictional sample accounts. Endorsement
// sources are real; a pick only appears where that source actually endorsed that candidate.
import { ingest, hashPw } from './app.js';
import { localDay, utcAt } from './time.js';
import { SOURCES, bindDefaults } from './sources.js';
import BALLOT from './data/ballot-tx-ellis.json' with { type: 'json' };
import ENDORSEMENTS from './data/endorsements.json' with { type: 'json' };

const day = (offset) => localDay(new Date(Date.now() + offset * 86400000));
const at = (offset, hour, minute = 0) => utcAt(day(offset), hour, minute);
// Days until the next Saturday (1-7), so the weekend block walk lands on a Saturday.
const untilSat = () => (6 - new Date(day(0) + 'T12:00:00Z').getUTCDay() + 7) % 7 || 7;

const TX_RULES = {
  minAge: 18, preregisterAge: 17, closedPrimaries: false, sameDayRegistration: false,
  registrationDeadlineDays: 30, idRequired: 'strict',
  idNote: "Bring a Texas driver license, Texas personal ID, election ID certificate, handgun license, U.S. passport, U.S. military ID or U.S. citizenship certificate with photo. If you can't get one, you can sign a Reasonable Impediment Declaration at the polls.",
  onlineRegistrationUrl: 'https://www.votetexas.gov/register-to-vote/',
  statusLookupUrl: 'https://teamrv-mvp.sos.texas.gov/MVP/mvp.do',
  pollingLookupUrl: 'https://www.elliscountytx.gov/312/Elections',
  ballotPhotoAllowed: false,
  notes: "Texas has no online registration: print or request the application, mail it, and it must be postmarked by the deadline. Phones and cameras aren't allowed within 100 feet of the voting stations.",
};

const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
export const stateOf = (jurisdictionId) => (jurisdictionId || '').slice(0, 2).toUpperCase();

export function demoData() {
  const statewide = (c) => !/^(US-HOUSE|STATE-SEN|STATE-HOUSE)/.test(c.race);
  return {
    jurisdictions: [
      ...Object.entries(STATE_NAMES).map(([code, name]) => ({
        id: code.toLowerCase(), name, rules: code === 'TX' ? TX_RULES : {},
      })),
      { id: 'tx-ellis', name: 'Ellis County, Texas', parentId: 'tx', rules: { match: { state: 'TX', county: 'Ellis County' } } },
      { id: 'tx-ellis-wax', name: 'Texas: Congress 6, Senate 2, House 10', parentId: 'tx-ellis', rules: { match: { state: 'TX', cd: '6', sldu: '2', sldl: '10' } } },
    ],
    elections: [
      {
        id: 'tx-2026-general', name: 'Texas General Election', kind: 'general', date: '2026-11-03',
        jurisdictionId: 'tx', registrationDeadline: '2026-10-05', earlyVotingStart: '2026-10-19', mailBallotDeadline: '2026-10-23',
        contests: BALLOT.map((c) => ({
          id: c.id, title: c.title, jurisdictionId: statewide(c) ? 'tx' : 'tx-ellis-wax',
          choices: c.choices.map(({ id, label, party }) => ({ id, label, party })),
        })),
      },
      { id: 'tx-2026-runoff', name: 'Texas Primary Runoff', kind: 'primary', date: '2026-05-26', jurisdictionId: 'tx' },
      { id: 'tx-2026-primary', name: 'Texas Primary Election', kind: 'primary', date: '2026-03-03', jurisdictionId: 'tx' },
    ],
  };
}

// ---------- endorsement sources ----------
const lastName = (s) => s.replace(/,? (Jr\.|Sr\.|II|III|IV)$/i, '').trim().split(/\s+/).pop().toLowerCase();
const firstName = (s) => s.replace(/^Dr\.\s*/i, '').trim().split(/\s+/)[0].toLowerCase();
const sameFirst = (a, b) => a === b || a.startsWith(b) || b.startsWith(a) || (a[0] === b[0] && Math.min(a.length, b.length) <= 3);

/** The choice in `choices` that an endorsement of `candidate` refers to, if any. */
export function matchChoice(choices, candidate) {
  const ln = lastName(candidate);
  const fn = firstName(candidate);
  const hits = choices.filter((c) => lastName(c.label) === ln);
  return hits.length === 1 ? hits[0] : hits.find((c) => sameFirst(firstName(c.label), fn)) || null;
}

/** Create (or find) the AFI and Trump leaders and load their picks for every seeded contest. */
export async function loadSources(db) {
  const ids = {};
  for (const s of SOURCES) {
    let owner = db.prepare('SELECT id FROM users WHERE email=?').get(s.email)?.id;
    if (!owner) {
      owner = Number(db.prepare(
        `INSERT INTO users (email, name, pw_hash, role, share_status, on_leaderboards) VALUES (?,?,?,?,0,0)`,
      ).run(s.email, s.name, await hashPw(crypto.randomUUID() + crypto.randomUUID()), 'leader').lastInsertRowid);
    }
    let id = db.prepare('SELECT id FROM leaders WHERE owner_id=?').get(owner)?.id;
    if (!id) {
      id = Number(db.prepare('INSERT INTO leaders (owner_id, name, kind, blurb, brand_color) VALUES (?,?,?,?,?)')
        .run(owner, s.name, s.kind, s.blurb, s.color).lastInsertRowid);
    } else {
      db.prepare('UPDATE leaders SET name=?, kind=?, blurb=?, brand_color=? WHERE id=?').run(s.name, s.kind, s.blurb, s.color, id);
    }
    ids[s.key] = id;
  }
  for (const c of BALLOT) {
    const choices = db.prepare('SELECT id, label FROM choices WHERE contest_id=?').all(c.id);
    for (const s of SOURCES) {
      const e = ENDORSEMENTS.find((x) => x.source === s.key && x.state === 'TX' && x.race === c.race && matchChoice(choices, x.candidate));
      db.prepare('DELETE FROM recommendations WHERE leader_id=? AND contest_id=?').run(ids[s.key], c.id);
      if (!e) continue;
      db.prepare('INSERT INTO recommendations (leader_id, contest_id, choice_ids, note) VALUES (?,?,?,?)')
        .run(ids[s.key], c.id, JSON.stringify([matchChoice(choices, e.candidate).id]), e.note || null);
    }
  }
  return ids;
}

// ---------- sample voters and volunteer events (fictional) ----------
const EVENTS = [ // [kind, title, location, day offset (fn of today), hour, minute, code, group-only]
  ['social', 'Share your America First sample ballot', 'Online', () => 0, 9, 0, 'SHARE1', false],
  ['phonebank', 'Phone bank: registration deadline reminders', 'Block Walkers HQ, or call from home', () => 1, 18, 0, 'CALLS1', false],
  ['canvass', 'Block walk: Precinct 101 door hangers', 'Meet at Block Walkers HQ', untilSat, 9, 0, 'KNOCK101', false],
  ['party_meeting', 'Precinct 101 neighbors meetup', 'Block Walkers HQ', () => 6, 19, 0, 'MEET101', true],
  ['volunteer', 'Poll watcher training', 'Online', () => 9, 18, 30, 'WATCH9', false],
  ['gotv', 'First day of early voting: rides to the polls', 'Block Walkers HQ', () => 18, 8, 0, 'RIDES18', false],
];

/** Seed showcase data. With force on an existing database, refresh sources and event dates. */
export async function seed(db, { force = false } = {}) {
  ingest(db, demoData());
  const fresh = !db.prepare(`SELECT COUNT(*) n FROM users WHERE email NOT LIKE '%@sources.cvas.app'`).get().n;
  const src = await loadSources(db);
  if (!fresh) {
    if (force) refreshEventDates(db);
    return;
  }
  const hashed = await hashPw('demo-password');
  const user = (email, name, extra = {}) =>
    Number(db.prepare(
      `INSERT INTO users (email, name, pw_hash, role, jurisdiction_id, home_label, precinct, birth_date, share_status, on_leaderboards)
       VALUES (?,?,?,?,?,'Waxahachie, TX',?,?,1,1)`,
    ).run(email, name, hashed, extra.role || 'voter', 'tx-ellis-wax', extra.precinct || '101', extra.birth || '1988-06-14').lastInsertRowid);
  const org = user('org1@example.org', 'Dale Whitmore', { role: 'leader' });
  const demo = user('demo@example.org', 'Demo Voter');
  const friends = ['Cody Ramirez', 'Shelby Hart', 'Wade Collier', 'Kristen Boyd'].map((n, i) =>
    user(`friend${i + 1}@example.org`, n, { precinct: i % 2 ? '104' : '101' }));
  for (const u of [org, demo, ...friends]) bindDefaults(db, u);

  for (const f of friends.slice(0, 3)) db.prepare(`INSERT INTO friendships (a, b, status) VALUES (?,?,'accepted')`).run(demo, f);
  db.prepare(`INSERT INTO friendships (a, b, status) VALUES (?,?,'pending')`).run(friends[3], demo);

  const g = Number(db.prepare(`INSERT INTO groups (name, kind, leader_id, invite_code, owner_id) VALUES ('Ellis County Block Walkers','neighborhood',?, 'ELLIS101', ?)`).run(src.afi, org).lastInsertRowid);
  for (const u of [org, demo, ...friends.slice(0, 3)]) db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?,?)').run(g, u);

  for (const [kind, title, loc, off, h, m, code, groupOnly] of EVENTS) {
    db.prepare(
      `INSERT INTO actions (group_id, jurisdiction_id, kind, title, location, starts_at, ends_at, checkin_code, created_by)
       VALUES (?, 'tx-ellis-wax', ?,?,?,?,?,?,?)`,
    ).run(groupOnly ? g : null, kind, title, loc, at(off(), h, m), at(off(), h + 2, m), code, org);
  }

  // History so leaderboards and the feed have something on them.
  const log = (u, kind, qty, verified, pts, d = -3) =>
    db.prepare(`INSERT INTO activity (user_id, kind, quantity, verified, points, day, at) VALUES (?,?,?,?,?,?,?)`)
      .run(u, kind, qty, verified, pts, day(d), at(d, 11));
  log(friends[0], 'canvass', 85, 1, 105);
  log(friends[0], 'phonebank', 60, 0, 60, -2);
  log(friends[0], 'party_meeting', 1, 1, 30, -6);
  log(friends[1], 'council_meeting', 1, 1, 30, -5);
  log(friends[1], 'social', 4, 0, 12, -1);
  log(friends[2], 'volunteer', 1, 1, 40, -4);
  log(friends[2], 'gotv', 1, 1, 40, -9);
  log(demo, 'social', 2, 0, 6, -2);
  const part = (u, e, kind, d) =>
    db.prepare('INSERT INTO participation (user_id, election_id, kind, at) VALUES (?,?,?,?)').run(u, e, kind, at(d, 12));
  for (const u of [friends[0], friends[1], friends[2], demo]) part(u, 'tx-2026-primary', 'voted', -212);
  for (const u of [friends[0], friends[2]]) part(u, 'tx-2026-runoff', 'voted', -128);
  part(friends[1], 'tx-2026-general', 'planned', -1);
  for (const u of [friends[0], friends[1], friends[2]]) part(u, null, 'registered', -300);
  db.prepare(`INSERT INTO nudges (from_id, to_id, election_id, at) VALUES (?,?, 'tx-2026-general', ?)`).run(friends[0], demo, at(-1, 19));
}

function refreshEventDates(db) {
  const org = db.prepare(`SELECT id FROM users WHERE email='org1@example.org'`).get()?.id;
  if (!org) return;
  for (const [, , , off, h, m, code] of EVENTS) {
    db.prepare('UPDATE actions SET starts_at=?, ends_at=? WHERE created_by=? AND checkin_code=?')
      .run(at(off(), h, m), at(off(), h + 2, m), org, code);
  }
}
