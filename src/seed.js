// Demo data. All places, people and organizations are fictional.
import { randomBytes, scryptSync } from 'node:crypto';
import { ingest } from './app.js';

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const at = (offset, hour) => `${day(offset)} ${String(hour).padStart(2, '0')}:00:00`;
const pw = (p) => {
  const s = randomBytes(16);
  return s.toString('hex') + ':' + scryptSync(p, s, 32).toString('hex');
};

export function demoData() {
  return {
    jurisdictions: [
      {
        id: 'st-co', name: 'State of Columbia',
        rules: {
          minAge: 18, preregisterAge: 16, closedPrimaries: true, partyChangeDeadlineDays: 29,
          sameDayRegistration: false, idRequired: 'non-strict',
          idNote: 'Bring a photo ID or a utility bill with your name and address.',
          onlineRegistrationUrl: 'https://example.org/register',
          statusLookupUrl: 'https://example.org/lookup',
          ballotPhotoAllowed: false,
        },
      },
      { id: 'cty-cedar', name: 'Cedar Valley County', parentId: 'st-co', rules: {} },
      { id: 'city-maple', name: 'City of Maplewood', parentId: 'cty-cedar', rules: {} },
    ],
    pollingPlaces: [
      { jurisdictionId: 'city-maple', precinct: '12', kind: 'polling', name: 'Maplewood Public Library', address: '200 Elm St, Maplewood', lat: 39.742, lng: -104.99, hours: '7am – 7pm' },
      { jurisdictionId: 'city-maple', precinct: '14', kind: 'polling', name: 'Lincoln Elementary Gym', address: '45 School Rd, Maplewood', lat: 39.751, lng: -104.97, hours: '7am – 7pm' },
      { jurisdictionId: 'city-maple', kind: 'dropbox', name: 'City Hall Drop Box', address: '1 Civic Plaza, Maplewood', lat: 39.739, lng: -104.985, hours: '24 hours until 7pm election day' },
      { jurisdictionId: 'cty-cedar', kind: 'early', name: 'County Clerk Office', address: '500 Court St, Cedar Valley', lat: 39.73, lng: -105.01, hours: 'Mon–Sat 8am – 6pm' },
    ],
    elections: [
      {
        id: 'el-local', name: 'Maplewood Municipal Election', kind: 'local', date: day(9),
        jurisdictionId: 'city-maple', registrationDeadline: day(1), earlyVotingStart: day(-5),
        contests: [
          { id: 'c-mayor', title: 'Mayor', choices: [
            { id: 'ch-mayor-a', label: 'Dana Whitfield' }, { id: 'ch-mayor-b', label: 'Marcus Oyelaran' }, { id: 'ch-mayor-c', label: 'Priya Castellanos' } ] },
          { id: 'c-council', title: 'City Council, At-Large', voteFor: 2, choices: [
            { id: 'ch-cc-a', label: 'Tom Brennan' }, { id: 'ch-cc-b', label: 'Lucia Ferreira' },
            { id: 'ch-cc-c', label: 'Hank Delacroix' }, { id: 'ch-cc-d', label: 'Amara Nwosu' } ] },
          { id: 'c-schools', title: 'School Board, District 3', choices: [
            { id: 'ch-sb-a', label: 'Grace Lindqvist' }, { id: 'ch-sb-b', label: 'Ray Holloway' } ] },
          { id: 'c-meas-a', title: 'Measure A: Library Bond', kind: 'measure',
            description: 'Issue $18M in bonds to renovate and expand branch libraries.', choices: [
            { id: 'ch-ma-y', label: 'Yes' }, { id: 'ch-ma-n', label: 'No' } ] },
          { id: 'c-meas-b', title: 'Measure B: Short-Term Rental Limits', kind: 'measure',
            description: 'Cap short-term rental permits at 2% of housing units per neighborhood.', choices: [
            { id: 'ch-mb-y', label: 'Yes' }, { id: 'ch-mb-n', label: 'No' } ] },
        ],
      },
      {
        id: 'el-primary', name: 'Columbia State Primary', kind: 'primary', date: day(95),
        jurisdictionId: 'st-co', registrationDeadline: day(70), earlyVotingStart: day(80),
        contests: [
          { id: 'c-gov-p', title: 'Governor (Party Primary)', choices: [
            { id: 'ch-gov-a', label: 'Elaine Moritz' }, { id: 'ch-gov-b', label: 'Jordan Sato' } ] },
          { id: 'c-cty-comm', title: 'County Commissioner, District 2', jurisdictionId: 'cty-cedar', choices: [
            { id: 'ch-com-a', label: 'Walt Pruitt' }, { id: 'ch-com-b', label: 'Sofia Benavides' } ] },
        ],
      },
      {
        id: 'el-past', name: 'Maplewood Special Election', kind: 'special', date: day(-200),
        jurisdictionId: 'city-maple',
        contests: [
          { id: 'c-past-meas', title: 'Measure Z: Parks Levy', kind: 'measure', choices: [
            { id: 'ch-z-y', label: 'Yes' }, { id: 'ch-z-n', label: 'No' } ] },
        ],
      },
    ],
  };
}

export function seed(db) {
  ingest(db, demoData());
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;

  const user = (email, name, extra = {}) =>
    Number(
      db.prepare(
        `INSERT INTO users (email, name, pw_hash, role, jurisdiction_id, precinct, birth_date, share_status, on_leaderboards)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(email, name, pw('demo-password'), extra.role || 'voter', 'city-maple', extra.precinct || '12',
        extra.birth || '1990-04-12', 1, 1).lastInsertRowid,
    );
  const org1 = user('org1@example.org', 'Riverbend Civic League', { role: 'leader' });
  const org2 = user('org2@example.org', 'Maplewood Taxpayers Forum', { role: 'leader' });
  const demo = user('demo@example.org', 'Demo Voter');
  const friends = ['Jamie Ortega', 'Sam Whitaker', 'Ari Feldman', 'Kim Nakamura'].map((n, i) =>
    user(`friend${i + 1}@example.org`, n, { precinct: i % 2 ? '14' : '12' }));

  const leader = (owner, name, kind, blurb, color, ranks) =>
    Number(db.prepare('INSERT INTO leaders (owner_id, name, kind, blurb, brand_color, rank_names) VALUES (?,?,?,?,?,?)')
      .run(owner, name, kind, blurb, color, ranks ? JSON.stringify(ranks) : null).lastInsertRowid);
  const l1 = leader(org1, 'Riverbend Civic League', 'organization', 'Neighborhood-first local politics since 1998.', '#2f6f4f',
    ['Neighbor', 'Member', 'Block Regular', 'Block Captain', 'Ward Captain', 'Steward', 'Elder']);
  const l2 = leader(org2, 'Maplewood Taxpayers Forum', 'organization', 'Fiscal accountability for city hall.', '#8a4b1f');
  const l3 = leader(org1, 'Teachers for Cedar Valley', 'list', 'School board and education measures only.', '#3b5a9a');

  const rec = (l, c, ids, note) =>
    db.prepare('INSERT INTO recommendations (leader_id, contest_id, choice_ids, note) VALUES (?,?,?,?)').run(l, c, JSON.stringify(ids), note || null);
  rec(l1, 'c-mayor', ['ch-mayor-b'], 'Marcus has shown up to every neighborhood meeting for six years.');
  rec(l1, 'c-council', ['ch-cc-b', 'ch-cc-d']);
  rec(l1, 'c-meas-a', ['ch-ma-y']);
  rec(l1, 'c-meas-b', ['ch-mb-y']);
  rec(l1, 'c-past-meas', ['ch-z-y']);
  rec(l2, 'c-mayor', ['ch-mayor-a'], 'Only candidate who committed to a line-item budget review.');
  rec(l2, 'c-council', ['ch-cc-a', 'ch-cc-c']);
  rec(l2, 'c-meas-a', ['ch-ma-n'], 'Bond cost outpaces projected use.');
  rec(l2, 'c-meas-b', ['ch-mb-n']);
  rec(l3, 'c-schools', ['ch-sb-a'], 'Former teacher; backs smaller class sizes.');
  rec(l3, 'c-meas-a', ['ch-ma-y']);
  db.prepare(`INSERT INTO results (contest_id, winner_ids) VALUES ('c-past-meas', '["ch-z-y"]')`).run();

  const bind = (u, l, p) => db.prepare('INSERT INTO bindings (user_id, leader_id, priority) VALUES (?,?,?)').run(u, l, p);
  bind(demo, l1, 1);
  bind(demo, l3, 2);
  friends.forEach((f, i) => bind(f, i < 3 ? l1 : l2, 1));

  for (const f of friends.slice(0, 3)) db.prepare(`INSERT INTO friendships (a, b, status) VALUES (?,?,'accepted')`).run(demo, f);
  db.prepare(`INSERT INTO friendships (a, b, status) VALUES (?,?,'pending')`).run(friends[3], demo);

  const g = Number(db.prepare(`INSERT INTO groups (name, kind, leader_id, invite_code, owner_id) VALUES ('Elm Street Block Team','neighborhood',?, 'ELMST001', ?)`).run(l1, org1).lastInsertRowid);
  for (const u of [org1, demo, ...friends.slice(0, 3)]) db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?,?)').run(g, u);

  const action = (l, kind, title, loc, offset, hour, codeStr) =>
    Number(db.prepare(
      `INSERT INTO actions (leader_id, jurisdiction_id, kind, title, location, starts_at, ends_at, checkin_code, created_by)
       VALUES (?, 'city-maple', ?,?,?,?,?,?,?)`,
    ).run(l, kind, title, loc, at(offset, hour), at(offset, hour + 2), codeStr, org1).lastInsertRowid);
  action(l1, 'council_meeting', 'City Council regular session — zoning item 7', 'City Hall Chambers', 2, 18, 'COUNCIL1');
  action(l1, 'canvass', 'Saturday canvass: Precinct 12', 'Meet at Elm St Coffee', 4, 10, 'KNOCK12');
  action(l1, 'phonebank', 'Evening phone bank', 'Riverbend office or remote', 3, 18, 'CALLS3');
  action(l1, 'gotv', 'Election-day GOTV shift', 'Riverbend office', 9, 8, 'GOTV9');
  action(l1, 'party_meeting', 'Ward 4 monthly meeting', 'VFW Hall', 6, 19, 'WARD4');
  action(l3, 'volunteer', 'School board candidate forum volunteers', 'Lincoln Elementary', 5, 17, 'FORUM5');
  action(null, 'council_meeting', 'County Commission public hearing — budget', 'County Courthouse', 12, 9, 'BUDGET12');
  db.prepare(
    `INSERT INTO actions (leader_id, jurisdiction_id, kind, title, location, starts_at, checkin_code, created_by)
     VALUES (?, 'city-maple', 'social', 'Share the Measure A explainer', 'Online', ?, 'SHAREA', ?)`,
  ).run(l1, at(0, 9), org1);

  // History for friends so leaderboards have something on them.
  const log = (u, kind, qty, verified, pts, actionId = null) =>
    db.prepare('INSERT INTO activity (user_id, action_id, kind, quantity, verified, points, day) VALUES (?,?,?,?,?,?, date(\'now\',\'-3 day\'))')
      .run(u, actionId, kind, qty, verified, pts);
  log(friends[0], 'canvass', 85, 1, 105);
  log(friends[0], 'phonebank', 60, 0, 60);
  log(friends[0], 'party_meeting', 1, 1, 30);
  log(friends[1], 'council_meeting', 1, 1, 30);
  log(friends[1], 'social', 4, 0, 12);
  log(friends[2], 'volunteer', 1, 1, 40);
  log(friends[2], 'gotv', 1, 1, 40);
  log(demo, 'social', 2, 0, 6);
  for (const u of [friends[0], friends[1], friends[2], demo])
    db.prepare(`INSERT INTO participation (user_id, election_id, kind) VALUES (?, 'el-past', 'voted')`).run(u);
  for (const u of [friends[0], friends[2]])
    db.prepare(`INSERT INTO participation (user_id, election_id, kind) VALUES (?, 'el-local', 'voted')`).run(u);
  db.prepare(`INSERT INTO participation (user_id, election_id, kind) VALUES (?, 'el-local', 'planned')`).run(friends[1]);
  for (const u of [friends[0], friends[1], friends[2]])
    db.prepare(`INSERT INTO participation (user_id, election_id, kind) VALUES (?, NULL, 'registered')`).run(u);
  db.prepare(`INSERT INTO registrations (user_id, status, party) VALUES (?, 'submitted', 'Independent')`).run(demo);
  db.prepare(`INSERT INTO nudges (from_id, to_id, election_id) VALUES (?,?, 'el-local')`).run(friends[0], demo);
}
