import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openNodeDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { configureClock } from '../src/time.js';
import { aggregate, fallbackPick } from '../src/engine/recommend.js';
import { activityPoints } from '../src/engine/recognition.js';
import { eligibility, ageOn } from '../src/rules.js';

let handle;
const GEO = {
  '401 S Rogers St, Waxahachie, TX': { state: 'TX', county: 'Ellis County', place: 'Waxahachie', cd: '6', sldu: '2', sldl: '10' },
  '901 Bagby St, Houston, TX': { state: 'TX', county: 'Harris County', place: 'Houston', cd: '18', sldu: '15', sldl: '147' },
  '1 Main St, Atlanta, GA': { state: 'GA', county: 'Fulton County', place: 'Atlanta', cd: '5', sldu: '39', sldl: '58' },
};
const base = 'http://t/api';
const ADMIN = 'test-admin';

before(async () => {
  configureClock({ zone: 'America/Chicago', demoDate: '2026-10-01' });
  const db = await openNodeDb(':memory:');
  await seed(db);
  handle = createApp(db, { adminToken: ADMIN, geocode: async (a) => GEO[a] || null });
});

async function call(path, { method = 'GET', body, token } = {}) {
  const r = await handle(new Request(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  return { status: r.status, data: await r.json() };
}
const login = async (email) => (await call('/login', { method: 'POST', body: { email, password: 'demo-password' } })).data.token;

// ---- engines ----
test('priority strategy: top leader wins, others reported as conflicts', () => {
  const recs = [
    { leaderId: 2, leaderName: 'B', priority: 2, choiceIds: ['y'] },
    { leaderId: 1, leaderName: 'A', priority: 1, choiceIds: ['x'] },
  ];
  const r = aggregate('priority', recs, { voteFor: 1 });
  assert.deepEqual(r.choiceIds, ['x']);
  assert.equal(r.sourceLeaderId, 1);
  assert.equal(r.conflicts[0].leaderName, 'B');
});

test('priority strategy skips leaders with no opinion', () => {
  const r = aggregate('priority', [
    { leaderId: 1, leaderName: 'A', priority: 1, choiceIds: [] },
    { leaderId: 2, leaderName: 'B', priority: 2, choiceIds: ['y'] },
  ], { voteFor: 1 });
  assert.deepEqual(r.choiceIds, ['y']);
});

test('consensus strategy: two lower leaders can outvote the top one', () => {
  const r = aggregate('consensus', [
    { leaderId: 1, leaderName: 'A', priority: 1, choiceIds: ['x'] },
    { leaderId: 2, leaderName: 'B', priority: 2, choiceIds: ['y'] },
    { leaderId: 3, leaderName: 'C', priority: 3, choiceIds: ['y'] },
  ], { voteFor: 1 });
  // y: 1/2 + 1/3 = 0.83 < x: 1 → x still wins; add a 4th
  assert.deepEqual(r.choiceIds, ['x']);
  const r2 = aggregate('consensus', [
    { leaderId: 1, leaderName: 'A', priority: 1, choiceIds: ['x'] },
    { leaderId: 2, leaderName: 'B', priority: 2, choiceIds: ['y'] },
    { leaderId: 3, leaderName: 'C', priority: 3, choiceIds: ['y'] },
    { leaderId: 4, leaderName: 'D', priority: 4, choiceIds: ['y'] },
  ], { voteFor: 1 });
  assert.deepEqual(r2.choiceIds, ['y']);
});

test('activity points respect daily caps and verification', () => {
  assert.equal(activityPoints('council_meeting', 1, true), 30);
  assert.equal(activityPoints('council_meeting', 1, false), 15);
  assert.equal(activityPoints('canvass', 50, false, 0), 50);
  assert.equal(activityPoints('canvass', 50, false, 80), 20);
  assert.equal(activityPoints('canvass', 50, true, 100), 20); // bonus only
});

test('eligibility: underage, deadlines, closed primary party change', () => {
  assert.equal(ageOn('2008-12-04', '2026-12-03'), 17);
  const rules = { minAge: 18, closedPrimaries: true, partyChangeDeadlineDays: 29 };
  const e = { name: 'X', date: '2026-12-03', registration_deadline: '2026-11-01', kind: 'primary' };
  const r = eligibility({ user: { jurisdiction_id: 'j', birth_date: '2008-12-04' }, registration: null, election: e, rules, today: '2026-11-20' });
  assert.equal(r.eligible, false);
  assert.ok(r.issues.some((i) => i.includes('minimum age')));
  assert.ok(r.issues.some((i) => i.includes('deadline')));
  const r2 = eligibility({
    user: { jurisdiction_id: 'j', birth_date: '1990-01-01' },
    registration: { status: 'confirmed', party: 'A', desired_party: 'B' },
    election: { ...e, date: '2027-03-01' }, rules, today: '2026-11-20',
  });
  assert.equal(r2.eligible, true);
  assert.ok(r2.actions.some((a) => a.kind === 'party_change'));
});

// ---- API ----
test('signup, login, auth required', async () => {
  const s = await call('/signup', { method: 'POST', body: { email: 'new@x.org', name: 'New', password: 'longenough' } });
  assert.equal(s.status, 200);
  assert.ok(s.data.token);
  assert.equal((await call('/signup', { method: 'POST', body: { email: 'new@x.org', name: 'New', password: 'longenough' } })).status, 409);
  assert.equal((await call('/me')).status, 401);
  assert.equal((await call('/login', { method: 'POST', body: { email: 'new@x.org', password: 'wrong-pass' } })).status, 401);
});

test('every ballot uses AFI first, Trump second, and users cannot change that', async () => {
  const s = (await call('/signup', { method: 'POST', body: { email: 'binds@x.org', name: 'B', password: 'longenough' } })).data;
  const b = (await call('/sources', { token: s.token })).data;
  assert.deepEqual(b.map((x) => x.name), ['America First Insight', 'Donald J. Trump']);
  for (const [method, path] of [['PUT', '/bindings'], ['POST', '/bindings'], ['DELETE', '/bindings/1'], ['POST', '/leaders'], ['PUT', '/leaders/1/recommendations'], ['POST', '/endorse']])
    assert.equal((await call(path, { method, body: [], token: s.token })).status, 404, `${method} ${path}`);
});

test('sample ballot: AFI first, Trump as fallback, no invented picks', async () => {
  const t = await login('demo@example.org');
  const ls = (await call('/leaders')).data;
  const afi = ls.find((l) => l.name === 'America First Insight').id;
  const trump = ls.find((l) => l.name === 'Donald J. Trump').id;
  const b = (await call('/elections/tx-2026-general/ballot', { token: t })).data;
  const rec = (id) => b.contests.find((c) => c.id === id).recommendation;
  assert.deepEqual(rec('tx26-us-sen').choiceIds, ['tx26-us-sen-0']); // Paxton
  assert.equal(rec('tx26-us-sen').sourceLeaderId, afi);
  assert.equal(rec('tx26-gov').sourceLeaderId, trump); // Abbott, via fallback
  assert.equal(rec('tx26-state-house-10').sourceLeaderId, afi);
  // Neither source endorsed and one Republican is running: Minute Man picks the Republican, credited to nobody.
  const sen2 = b.contests.find((c) => c.id === 'tx26-state-sen-2');
  const reps = sen2.choices.filter((c) => c.party === 'Republican');
  assert.equal(reps.length, 1);
  assert.deepEqual(rec('tx26-state-sen-2').choiceIds, [reps[0].id]);
  assert.equal(rec('tx26-state-sen-2').basis, 'party');
  assert.equal(rec('tx26-state-sen-2').sourceLeaderId, null);
  assert.equal(rec('tx26-state-sen-2').why, 'The Republican candidate in this race.');
  // A source's pick with no write-up gets Minute Man's plain line; one with a write-up needs none.
  assert.equal(rec('tx26-gov').why, 'The Republican candidate in this race.');
  // Every race on the seeded Texas ballot has a pick, and every reason is Minute Man's, not a source's.
  for (const c of b.contests) {
    assert.ok(c.recommendation.choiceIds.length >= 1, `${c.id} has a pick`);
    assert.ok(c.recommendation.choiceIds.every((id) => c.choices.some((ch) => ch.id === id)));
    const written = c.sources.some((x) => x.note && c.recommendation.choiceIds.every((id) => x.choiceIds.includes(id)));
    assert.ok(written || c.recommendation.why, `${c.id} has a reason`);
    assert.doesNotMatch(c.recommendation.why || '', /endorse|AFI|America First|Trump/i);
  }
  // Explanations come only from what each source published: its pick, its write-up if any, and where.
  assert.deepEqual(sen2.sources, []);
  const sen = b.contests.find((c) => c.id === 'tx26-us-sen').sources;
  const a = sen.find((x) => x.leaderId === afi);
  assert.equal(a.short, 'AFI');
  assert.match(a.url, /americafirstinsight\.com/);
  assert.deepEqual(a.choiceIds, ['tx26-us-sen-0']);
  const gov = b.contests.find((c) => c.id === 'tx26-gov').sources;
  assert.deepEqual(gov.map((x) => x.short), ['Trump']);
  assert.equal(gov[0].note, null);
  assert.match(gov[0].url, /ballotpedia\.org/);
});

test('fill-in rules: every candidate race gets a pick, with a plain reason', () => {
  const ids = (r) => r?.choiceIds;
  // One Republican running.
  let r = fallbackPick([{ id: 'd', party: 'Democratic' }, { id: 'r', party: 'Republican' }]);
  assert.deepEqual([ids(r), r.basis, r.why], [['r'], 'party', 'The Republican candidate in this race.']);
  // Uncontested.
  r = fallbackPick([{ id: 'd', party: 'Democratic' }]);
  assert.deepEqual([ids(r), r.basis, r.why], [['d'], 'uncontested', 'The only candidate in this race.']);
  // Several Republicans: the incumbent first, otherwise ballot order.
  r = fallbackPick([{ id: 'r1', party: 'Republican' }, { id: 'r2', party: 'Republican', incumbent: true }, { id: 'd', party: 'Democratic' }]);
  assert.deepEqual([ids(r), r.why], [['r2'], 'The incumbent Republican.']);
  r = fallbackPick([{ id: 'd', party: 'Democratic' }, { id: 'r1', party: 'Republican' }, { id: 'r2', party: 'Republican' }]);
  assert.deepEqual([ids(r), r.why], [['r1'], "Several Republicans are running. Minute Man's pick is the first-listed Republican."]);
  // No Republican: Libertarian, then Constitution, then independents, then others; a Democrat last.
  r = fallbackPick([{ id: 'd', party: 'Democratic' }, { id: 'g', party: 'Green' }, { id: 'l', party: 'Libertarian' }]);
  assert.deepEqual([ids(r), r.why], [['l'], "No Republican is running. Minute Man's pick is the Libertarian candidate."]);
  r = fallbackPick([{ id: 'd', party: 'Democratic' }, { id: 'i', party: 'Independent' }, { id: 'c', party: 'Constitution' }]);
  assert.deepEqual(ids(r), ['c']);
  r = fallbackPick([{ id: 'd', party: 'Democratic' }, { id: 'g', party: 'Green' }, { id: 'i', party: 'Independent' }]);
  assert.deepEqual([ids(r), r.why], [['i'], "No Republican is running. Minute Man's pick is the independent candidate."]);
  r = fallbackPick([{ id: 'd', party: 'Democratic' }, { id: 'g', party: 'Green' }]);
  assert.deepEqual(ids(r), ['g']);
  r = fallbackPick([{ id: 'd1', party: 'Democratic' }, { id: 'd2', party: 'Democratic' }]);
  assert.deepEqual([ids(r), r.why], [['d1'], "Only Democrats are running. Minute Man's pick is the first listed."]);
  // Nonpartisan: the incumbent if known, otherwise the first listed.
  r = fallbackPick([{ id: 'a' }, { id: 'b', incumbent: true }]);
  assert.deepEqual([ids(r), r.basis, r.why], [['b'], 'nonpartisan', "A nonpartisan race. Minute Man's pick is the incumbent."]);
  r = fallbackPick([{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual([ids(r), r.why], [['a'], "A nonpartisan race. Minute Man's pick is the first-listed candidate."]);
  // Vote for 2: fills both seats.
  r = fallbackPick([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2);
  assert.deepEqual(ids(r), ['a', 'b']);
  assert.equal(fallbackPick([]), null);
  // No reason ever claims anything beyond party, incumbency or ballot order.
  for (const x of [r]) assert.doesNotMatch(x.why, /endorse|record|conservative|support/i);
});

test('endorsements browser: attributed picks by state', async () => {
  const tok = await login('demo@example.org');
  const tx = (await call('/endorsements?state=TX', { token: tok })).data;
  assert.deepEqual(tx.sources, ['America First Insight', 'Donald J. Trump']);
  const sen = tx.races.find((r) => r.race === 'US-SEN');
  assert.equal(sen.pick.sourceName, 'America First Insight');
  assert.ok(sen.pick.candidate.includes('Paxton'));
  const ga = (await call('/endorsements?state=GA', { token: tok })).data;
  assert.equal(ga.races.find((r) => r.race === 'GOV').pick.sourceName, 'Donald J. Trump');
});

test('voting: turnout points, once per election, no vote choice accepted or stored', async () => {
  const t = await login('friend2@example.org');
  // Oct 1 is before Texas early voting (Oct 19)
  assert.equal((await call('/participation', { method: 'POST', body: { electionId: 'tx-2026-general', kind: 'voted' }, token: t })).status, 400);
  assert.equal((await call('/participation', { method: 'POST', body: { electionId: 'tx-2026-runoff', kind: 'voted' }, token: t })).status, 400);
  const before = (await call('/recognition', { token: t })).data.points;
  const r = await call('/participation', { method: 'POST', body: { electionId: 'tx-2026-general', kind: 'planned', choiceIds: ['tx26-gov-0'] }, token: t });
  assert.equal(r.status, 200);
  assert.equal(r.data.score, before);
  const exp = (await call('/me/export', { token: t })).data;
  assert.ok(!JSON.stringify(exp).includes('tx26-gov-0'), 'vote choice must never be stored');
});

test('activism: check-in codes verify, double check-in rejected, self-logging capped', async () => {
  const t = await login('demo@example.org');
  const acts = (await call('/actions', { token: t })).data;
  const meet = acts.find((a) => a.kind === 'party_meeting');
  assert.equal(meet.checkinCode, undefined, 'attendees must not see the code');
  assert.equal((await call(`/actions/${meet.id}/checkin`, { method: 'POST', body: { code: 'WRONG' }, token: t })).status, 400);
  const ok = await call(`/actions/${meet.id}/checkin`, { method: 'POST', body: { code: 'meet101' }, token: t });
  assert.ok(ok.data.points > 0);
  assert.equal(ok.data.verified, true);
  assert.equal((await call(`/actions/${meet.id}/checkin`, { method: 'POST', body: { code: 'MEET101' }, token: t })).status, 409);
  // Posts count only when shared from the app: no manual count entry.
  assert.equal((await call('/activity', { method: 'POST', body: { kind: 'social', quantity: 4 }, token: t })).status, 400);
  const posts = (await call('/posts', { token: t })).data;
  assert.match(posts.url, /^https:\/\/cvas\.careride\.workers\.dev\/#\/join\/[A-Z0-9]{6}$/);
  const ballot = posts.posts.find((p) => p.id === 'ballot');
  assert.match(ballot.text, /^My Minute Man picks for the Texas ballot \(Nov 3\):\nSenate: Ken Paxton\n/);
  assert.ok(posts.posts.some((p) => /register to vote in Texas is Mon, Oct 5/.test(p.text)));
  assert.ok(posts.posts.every((p) => p.text.length <= 260));
  // Picks are Minute Man's: no post names a source or says anyone endorsed anyone.
  assert.ok(posts.posts.every((p) => !/endorse|\bAFI\b|America First|Trump/i.test(p.text)), 'no source attributions');
  // Every pick a post names is the pick on this voter's ballot; nothing invented.
  const tb = (await call('/elections/tx-2026-general/ballot', { token: t })).data;
  const racePosts = posts.posts.filter((p) => p.id.startsWith('race:'));
  assert.ok(racePosts.length);
  for (const p of racePosts) {
    const c = tb.contests.find((x) => x.id === p.id.slice(5));
    assert.ok(c, p.id);
    const who = c.choices.find((ch) => ch.id === c.recommendation.choiceIds[0]).label;
    assert.ok(p.text.startsWith(`Minute Man's pick for `) && p.text.includes(`: ${who}. Election Day is Tue, Nov 3.`), p.text);
  }
  // The only-Republican fill-in is a Minute Man pick like the rest, so it's posted too.
  assert.ok(racePosts.some((p) => p.id === 'race:tx26-state-sen-2'));
  assert.equal((await call('/posts/share', { method: 'POST', body: { postId: 'nope' }, token: t })).status, 400);
  const pts = [];
  for (let i = 0; i < 6; i++) pts.push((await call('/posts/share', { method: 'POST', body: { postId: posts.posts[i % posts.posts.length].id }, token: t })).data.points);
  assert.deepEqual(pts, [3, 3, 3, 3, 3, 0]); // cap 15/day
  assert.equal((await call('/posts', { token: t })).data.pointsLeftToday, 0);
  const shareEv = acts.find((a) => a.kind === 'social');
  assert.equal((await call(`/actions/${shareEv.id}/checkin`, { method: 'POST', body: { quantity: 5 }, token: t })).status, 400);
  await call('/posts/share', { method: 'POST', body: { postId: 'ballot', actionId: shareEv.id }, token: t });
  assert.ok((await call('/actions', { token: t })).data.find((a) => a.id === shareEv.id).done);
  assert.ok((await call('/recognition', { token: t })).data.badges.some((x) => x.id === 'party'));
  const org = await login('org1@example.org');
  assert.equal((await call('/actions', { token: org })).data.find((x) => x.id === meet.id).checkinCode, 'MEET101');
});

test('leaderboards and sharing status are always on; groups and friends work', async () => {
  const t = await login('demo@example.org');
  const f1 = await login('friend1@example.org');
  assert.equal((await call('/me', { method: 'PATCH', body: { onLeaderboards: false }, token: f1 })).status, 400);
  assert.equal((await call('/me', { method: 'PATCH', body: { shareStatus: false }, token: f1 })).status, 400);
  const still = (await call('/me', { token: f1 })).data;
  assert.equal(still.onLeaderboards, true);
  assert.equal(still.shareStatus, true);
  const lb = (await call('/leaderboard?scope=friends', { token: t })).data;
  assert.ok(lb.rows.some((r) => r.name === 'Cody Ramirez' && r.rank));
  assert.ok(lb.rows.some((r) => r.me));

  const g = (await call('/groups', { method: 'POST', body: { name: 'Test Team' }, token: t })).data;
  assert.ok(g.inviteCode);
  assert.equal((await call('/groups/join', { method: 'POST', body: { code: g.inviteCode.toLowerCase() }, token: f1 })).status, 200);
  assert.equal((await call(`/leaderboard?scope=group:${g.id}`, { token: f1 })).data.rows.length, 2);
  const f4 = await login('friend4@example.org');
  assert.equal((await call(`/leaderboard?scope=group:${g.id}`, { token: f4 })).status, 403);

  const fr = (await call('/friends', { token: t })).data;
  const k = fr.find((x) => x.state === 'incoming');
  await call(`/friends/${k.userId}/accept`, { method: 'POST', token: t });
  // No in-app nudges between friends: they're on Minute Man, so the app already reminds them.
  assert.equal((await call(`/friends/${k.userId}/nudge`, { method: 'POST', body: { electionId: 'tx-2026-general' }, token: t })).status, 404);
  assert.ok(!(await call('/notifications', { token: f4 })).data.some((x) => x.kind === 'nudge'));
  const after = (await call('/friends', { token: t })).data;
  assert.ok(after.every((x) => !('remindedToday' in x)));
  // Accepted friends show their Ladder rank.
  assert.ok(after.some((x) => x.state === 'friends' && x.rank));
  assert.ok(after.filter((x) => x.state !== 'friends').every((x) => !x.rank));
});

test('friends always see whether you voted; nobody sees how', async () => {
  const t = await login('demo@example.org');
  const f3 = await login('friend3@example.org');
  assert.equal((await call('/me', { method: 'PATCH', body: { shareStatus: false }, token: f3 })).status, 400);
  assert.ok((await call('/friends', { token: t })).data.find((x) => x.name === 'Wade Collier').status);
  // Vote choice is never stored: nothing about picks appears in the data export.
  const ex = JSON.stringify((await call('/me/export', { token: f3 })).data);
  assert.ok(!/choice_id|"picks?"/.test(ex));
});

test('registration status, eligibility and registered badge', async () => {
  const t = await login('demo@example.org');
  const el = (await call('/eligibility', { token: t })).data;
  assert.ok(el.elections.some((x) => x.election.id === 'tx-2026-general'));
  await call('/registration', { method: 'PUT', body: { status: 'confirmed' }, token: t });
  assert.ok((await call('/recognition', { token: t })).data.badges.some((b) => b.id === 'registered'));
});

test('admin ingestion requires token and upserts', async () => {
  const data = { elections: [{ id: 'el-new', name: 'New Special', date: '2026-12-12', kind: 'special', jurisdictionId: 'tx-ellis-wax',
    contests: [{ id: 'c-new', title: 'Prop 1', kind: 'measure', choices: [{ id: 'n-y', label: 'Yes' }, { id: 'n-n', label: 'No' }] }] }] };
  assert.equal((await call('/admin/ingest', { method: 'POST', body: data })).status, 401);
  const r = await call('/admin/ingest', { method: 'POST', body: data, token: ADMIN });
  assert.equal(r.data.contests, 1);
  const t = await login('demo@example.org');
  assert.ok((await call('/elections', { token: t })).data.some((e) => e.id === 'el-new'));
});

test('home address sets the most specific area, never stores the street', async () => {
  const s = (await call('/signup', { method: 'POST', body: { email: 'addr@x.org', name: 'A', password: 'longenough' } })).data;
  const set = (address) => call('/me/address', { method: 'POST', body: { address }, token: s.token });
  const w = await set('401 S Rogers St, Waxahachie, TX');
  assert.equal(w.data.jurisdictionId, 'tx-ellis-wax');
  assert.equal(w.data.homeLabel, 'Waxahachie, TX');
  assert.ok(!JSON.stringify((await call('/me/export', { token: s.token })).data).includes('Rogers'));
  const b = (await call('/elections/tx-2026-general/ballot', { token: s.token })).data;
  assert.ok(b.contests.some((c) => c.id === 'tx26-state-house-10'));
  assert.equal((await set('901 Bagby St, Houston, TX')).data.jurisdictionId, 'tx');
  const b2 = (await call('/elections/tx-2026-general/ballot', { token: s.token })).data;
  assert.ok(b2.contests.some((c) => c.id === 'tx26-gov') && !b2.contests.some((c) => c.id === 'tx26-state-house-10'));
  assert.equal((await set('1 Main St, Atlanta, GA')).data.jurisdictionId, 'ga');
  assert.equal((await set('nowhere at all')).status, 400);
});

test('account deletion removes user', async () => {
  const s = (await call('/signup', { method: 'POST', body: { email: 'bye@x.org', name: 'Bye', password: 'longenough' } })).data;
  assert.equal((await call('/me', { method: 'DELETE', token: s.token })).status, 200);
  assert.equal((await call('/me', { token: s.token })).status, 401);
});

test('today: next action, quests, streak, claims', async () => {
  const s = (await call('/signup', { method: 'POST', body: { email: 'fresh@x.org', name: 'Fresh', password: 'longenough' } })).data;
  let t = (await call('/today', { token: s.token })).data;
  assert.equal(t.next.kind, 'profile');
  await call('/me', { method: 'PATCH', body: { jurisdictionId: 'tx-ellis-wax', birthDate: '1990-01-01' }, token: s.token });
  t = (await call('/today', { token: s.token })).data;
  assert.equal(t.next.kind, 'register'); // Texas deadline is Oct 5
  assert.equal(t.quests.quests.length, 3);
  assert.equal(t.streak.weeks, 0);
  // Do the ballot quest if offered, then claim it
  await call('/events', { method: 'POST', body: { kind: 'ballot_viewed:tx-2026-general' }, token: s.token });
  await call('/events', { method: 'POST', body: { kind: 'events_viewed' }, token: s.token });
  await call('/posts/share', { method: 'POST', body: { postId: 'join' }, token: s.token });
  t = (await call('/today', { token: s.token })).data;
  const done = t.quests.quests.filter((q) => q.done);
  assert.ok(done.length >= 1);
  const c = await call(`/quests/${done[0].id}/claim`, { method: 'POST', token: s.token });
  assert.equal(c.status, 200);
  assert.equal((await call(`/quests/${done[0].id}/claim`, { method: 'POST', token: s.token })).status, 409);
  t = (await call('/today', { token: s.token })).data;
  // A week only counts once you reach the weekly minimum.
  assert.equal(t.streak.goal, 50);
  assert.equal(t.streak.weeks, t.streak.pointsThisWeek >= 50 ? 1 : 0);
  while (t.streak.pointsThisWeek < 50) {
    await call('/activity', { method: 'POST', body: { kind: 'canvass', quantity: 20 }, token: s.token });
    t = (await call('/today', { token: s.token })).data;
  }
  assert.equal(t.streak.weeks, 1);
  assert.ok(t.streak.activeThisWeek);
  assert.ok(t.week.points >= done[0].xp);
});

test('feed: ranked, paged, opted-in only, never shows strangers voting', async () => {
  const t = await login('demo@example.org');
  const p1 = (await call('/feed', { token: t })).data;
  assert.equal(p1.items.length, 15);
  assert.ok(p1.next);
  const p2 = (await call(`/feed?cursor=${p1.next}`, { token: t })).data;
  const keys = [...p1.items, ...p2.items].map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, 'no repeats across pages');
  const all = [...p1.items, ...p2.items];
  let cur = p2.next;
  while (cur) { const p = (await call(`/feed?cursor=${cur}`, { token: t })).data; all.push(...p.items); cur = p.next; }
  // Everyone is on the feed; strangers show as first name, last initial.
  assert.ok(all.some((i) => i.name === 'Peggy L.'));
  assert.ok(!all.some((i) => /Peggy Lindell/.test(i.name)));
  // Voting and plans only from friends and group-mates (full names), never strangers.
  for (const i of all.filter((x) => ['voted', 'planned', 'registered'].includes(x.icon))) assert.ok(i.name.includes(' ') && !/\.$/.test(i.name), i.name);
  // Strangers show a first name and last initial.
  assert.ok(all.some((i) => i.name === 'Earl P.'));
  // Near beats far: on average, precinct items rank above out-of-state ones.
  const pos = (f) => { const ix = all.map((x, n) => (f(x) ? n : null)).filter((n) => n !== null); return ix.reduce((a, b) => a + b, 0) / ix.length; };
  assert.ok(pos((i) => i.near === 'precinct') < pos((i) => i.near === 'nation'));
  // You can cheer someone you can see, even a stranger.
  const far = all.find((i) => i.near === 'nation');
  const r = await call('/cheers', { method: 'POST', body: { item: far.key, ownerId: far.userId }, token: t });
  assert.equal(r.data.cheers, far.cheers + 1);
  const peggy = (await call('/leaderboard?scope=area:tx-ellis&period=all', { token: t })).data;
  assert.ok(peggy.rows.some((x) => x.name === 'Peggy L.' && x.where === 'Ennis, TX'));
  // Ladder rank beside the name, for everyone.
  assert.ok(all.some((i) => i.name === 'Ray Delgado' && i.rank === 'Captain'));
  assert.ok(all.some((i) => i.name === 'Earl P.' && i.rank === 'Colonel'));
  // Rank-ups read with the military rank names (rendered from the stored level, not stored text).
  assert.ok(all.some((i) => i.icon === 'rank' && /^became an? (Corporal|Sergeant|Ensign|Lieutenant|Captain|Major|Colonel)$/.test(i.text)));
  assert.ok(!all.some((i) => /Volunteer|Newcomer|Messenger|Block Captain|Precinct Chair|Registered Voter|Active Voter/.test(i.text)));
  // A stranger can't hide their rank; their voting stays hidden from strangers.
  const travis = await login('neighbor7@example.org');
  assert.equal((await call('/me', { method: 'PATCH', body: { shareStatus: false }, token: travis })).status, 400);
  assert.ok(all.some((i) => i.name === 'Travis Y.' && i.rank === 'Lieutenant'));
  assert.ok(!all.some((i) => i.name === 'Travis Y.' && ['voted', 'planned', 'registered'].includes(i.icon)));
});

test('leaderboards: friends, groups and every area level, by week, month or all time', async () => {
  const t = await login('demo@example.org');
  const areas = (await call('/areas', { token: t })).data;
  assert.deepEqual(areas.map((a) => a.label), ['Precinct 101', 'Your districts', 'Ellis County', 'Texas', 'Nationwide']);
  const count = {};
  for (const a of areas) {
    const lb = (await call(`/leaderboard?scope=${a.scope}&period=month`, { token: t })).data;
    assert.equal(lb.period, 'month');
    assert.ok(lb.you && lb.you.me);
    count[a.label] = lb.count;
  }
  assert.ok(count['Precinct 101'] < count['Ellis County'] && count['Ellis County'] < count.Texas && count.Texas < count.Nationwide);
  const pre = (await call('/leaderboard?scope=area:precinct&period=all', { token: t })).data;
  assert.ok(pre.rows.some((r) => r.name === 'Ray Delgado')); // a group-mate: full name
  const county = (await call('/leaderboard?scope=area:tx-ellis&period=all', { token: t })).data;
  assert.ok(county.rows.some((r) => r.name === 'Travis Y.' && r.where === 'Midlothian, TX')); // a stranger: initial and town
  const fr = (await call('/leaderboard?scope=friends&period=week', { token: t })).data;
  assert.ok(fr.rows.some((r) => r.name === 'Cody Ramirez'));
  assert.equal((await call('/leaderboard?scope=area:fl', { token: t })).status, 400);
  const st = (await call('/standing', { token: t })).data;
  assert.equal(st.weeks.length, 8);
  assert.equal(st.places.length, 5);
  assert.ok(st.together.active >= 3 && st.together.doors > 0);
});

test('ladder: ranks follow the steps in order and coach the next one', async () => {
  const su = await call('/signup', { method: 'POST', body: { email: 'climber@example.com', name: 'Casey Climber', password: 'climb-the-ladder' } });
  const t = su.data.token;
  let l = (await call('/ladder', { token: t })).data;
  assert.equal(l.level, 1);
  assert.equal(l.name, 'Private');
  assert.equal(l.coach.step.id, 'address');
  // Doing a later rung's step first doesn't skip the basics.
  for (let i = 0; i < 5; i++) await call('/posts/share', { method: 'POST', token: t, body: { postId: 'join' } });
  assert.equal((await call('/ladder', { token: t })).data.level, 1);
  await call('/me/address', { method: 'POST', token: t, body: { address: '401 S Rogers St, Waxahachie, TX' } });
  await call('/registration', { method: 'PUT', token: t, body: { status: 'confirmed' } });
  await call('/participation', { method: 'POST', token: t, body: { electionId: 'tx-2026-general', kind: 'planned' } });
  l = (await call('/ladder', { token: t })).data;
  assert.equal(l.level, 2);
  assert.equal(l.name, 'Corporal');
  assert.equal(l.duty, 'You\'re registered, with a plan to vote');
  // Voting isn't open on Oct 1, so the coach waits on it and suggests the next rung meanwhile.
  assert.equal(l.coach.step.id, 'vote');
  assert.match(l.coach.step.opensLabel, /Opens Oct 19/);
  assert.equal(l.coach.meanwhile.rung, 'Ensign');
  assert.ok(l.rungs[3].steps.find((s) => s.id === 'posts').done);
  const rec = (await call('/recognition', { token: t })).data;
  assert.equal(rec.rank.name, 'Corporal');
  assert.ok(rec.breakdown.bonus >= 50);
  assert.equal((await call('/today', { token: t })).data.rank.name, 'Corporal');
});

test('invites: recruiter earns a bonus as recruits climb, sees rank only if shared', async () => {
  const demo = await login('demo@example.org');
  const before = (await call('/recognition', { token: demo })).data.points;
  const { invite } = (await call('/ladder', { token: demo })).data;
  assert.match(invite.code, /^[A-Z2-9]{6}$/);
  assert.equal((await call('/ladder', { token: demo })).data.invite.code, invite.code); // stable
  assert.equal((await call(`/invite/${invite.code.toLowerCase()}`)).data.name, 'Demo');
  assert.equal((await call('/invite/NOPE00')).status, 404);

  const r = (await call('/signup', { method: 'POST', body: { email: 'recruit@example.com', name: 'Riley Recruit', password: 'recruit-pass', ref: invite.code } })).data.token;
  let d = (await call('/ladder', { token: demo })).data;
  assert.equal(d.recruits.length, 1);
  assert.equal(d.recruits[0].name, 'Riley');
  assert.equal(d.recruits[0].rank, 'Private'); // everyone shares their rank
  assert.equal(d.recruits[0].earned, 25);
  assert.ok((await call('/friends', { token: r })).data.some((f) => f.name === 'Demo Voter' && f.state === 'friends'));

  await call('/me/address', { method: 'POST', token: r, body: { address: '401 S Rogers St, Waxahachie, TX' } });
  await call('/registration', { method: 'PUT', token: r, body: { status: 'confirmed' } });
  await call('/participation', { method: 'POST', token: r, body: { electionId: 'tx-2026-general', kind: 'planned' } });
  d = (await call('/ladder', { token: demo })).data;
  assert.equal(d.recruits[0].rank, 'Corporal');
  assert.equal(d.recruits[0].earned, 75);
  assert.equal((await call('/recognition', { token: demo })).data.points - before >= 75, true);
  assert.ok(d.rungs[3].steps.find((s) => s.id === 'recruit1').done);
  // Deleting the recruit takes back the bonuses it earned.
  const pts = (await call('/recognition', { token: demo })).data.points;
  await call('/me', { method: 'DELETE', token: r });
  assert.equal((await call('/recognition', { token: demo })).data.points, pts - 75);
});

test('precinct chair is a self-reported claim that can be undone', async () => {
  const t = await login('friend1@example.org');
  let l = (await call('/ladder/claim', { method: 'POST', token: t, body: { id: 'precinct_chair' } })).data;
  assert.ok(l.rungs[7].steps.find((s) => s.id === 'chair').done);
  l = (await call('/ladder/claim', { method: 'POST', token: t, body: { id: 'precinct_chair', remove: true } })).data;
  assert.ok(!l.rungs[7].steps.find((s) => s.id === 'chair').done);
  assert.equal((await call('/ladder/claim', { method: 'POST', token: t, body: { id: 'mayor' } })).status, 400);
});

test('skill tree: trainings unlock in order and pay once', async () => {
  const s = (await call('/signup', { method: 'POST', body: { email: 'learner@x.org', name: 'Lee Learner', password: 'longenough' } })).data;
  const t = s.token;
  // Locked until the voting plan is done.
  assert.equal((await call('/ladder/learn', { method: 'POST', body: { id: 'learn_local' }, token: t })).status, 409);
  assert.equal((await call('/ladder/learn', { method: 'POST', body: { id: 'nope' }, token: t })).status, 400);
  let d = (await call('/ladder', { token: t })).data;
  const step = (id) => d.rungs.flatMap((r) => r.steps).find((x) => x.id === id);
  assert.ok(step('learn_local').locked);
  assert.deepEqual(step('learn_local').lockedBy, ['Make a voting plan']);
  assert.ok(step('learn_local').lesson.source.url.startsWith('https://'));
  assert.ok(!step('address').locked);
  // Skip ahead in the data (address, registered, plan) and the training opens.
  await call('/me', { method: 'PATCH', body: { jurisdictionId: 'tx-ellis-wax' }, token: t });
  await call('/registration', { method: 'PUT', body: { status: 'confirmed' }, token: t });
  await call('/participation', { method: 'POST', body: { kind: 'planned', electionId: 'tx-2026-general' }, token: t });
  const before = (await call('/recognition', { token: t })).data.points;
  const r = await call('/ladder/learn', { method: 'POST', body: { id: 'learn_local' }, token: t });
  assert.equal(r.status, 200);
  d = r.data;
  assert.ok(step('learn_local').done);
  assert.ok(!step('learn_party').locked);
  assert.ok(step('meetings').locked);
  await call('/ladder/learn', { method: 'POST', body: { id: 'learn_local' }, token: t });
  assert.equal((await call('/recognition', { token: t })).data.points, before + 15);
});

// ---- quests need the real action, not a page view ----
let questN = 0;
/** A fresh Waxahachie voter in the block-walk group (so there are events this week) with quest `id` today. */
async function voterWithQuest(id) {
  for (let i = 0; i < 80; i++) {
    const email = `q${++questN}@x.org`;
    const s = (await call('/signup', { method: 'POST', body: { email, name: 'Quest Tester', password: 'longenough' } })).data;
    await call('/me', { method: 'PATCH', body: { jurisdictionId: 'tx-ellis-wax', birthDate: '1990-01-01' }, token: s.token });
    await call('/groups/join', { method: 'POST', body: { code: 'ELLIS101' }, token: s.token });
    await call('/friends', { method: 'POST', body: { email: 'demo@example.org' }, token: s.token });
    const demo = await login('demo@example.org');
    await call('/friends', { method: 'POST', body: { email }, token: demo });
    const q = (await call('/today', { token: s.token })).data.quests.quests.find((x) => x.id === id);
    if (q) return { token: s.token, q };
  }
  throw new Error(`no voter got the ${id} quest`);
}
const quest = async (token, id) => (await call('/today', { token })).data.quests.quests.find((x) => x.id === id);
const claim = (token, id) => call(`/quests/${id}/claim`, { method: 'POST', token });

test('quests: opening the ballot or events page no longer completes anything', async () => {
  for (const id of ['ballot', 'events']) {
    const { token } = await voterWithQuest(id);
    await call('/events', { method: 'POST', body: { kind: 'ballot_viewed:tx-2026-general' }, token });
    await call('/events', { method: 'POST', body: { kind: 'events_viewed' }, token });
    await call('/elections/tx-2026-general/ballot', { token });
    await call('/actions', { token });
    assert.equal((await quest(token, id)).done, false, id);
    assert.equal((await claim(token, id)).status, 400, id);
  }
});

test('quest: ballot needs every race reviewed', async () => {
  const { token, q } = await voterWithQuest('ballot');
  assert.ok(q.goal > 1 && q.have === 0 && /Review all \d+ races/.test(q.need));
  assert.equal(q.href, '#/ballot/tx-2026-general/examine');
  const b = (await call('/elections/tx-2026-general/ballot', { token })).data;
  assert.equal(b.contests.length, q.goal);
  assert.deepEqual(b.reviewed, []);
  assert.equal((await call('/elections/tx-2026-general/reviewed', { method: 'POST', body: { contestId: 'nope' }, token })).status, 400);
  for (const c of b.contests.slice(0, -1)) await call('/elections/tx-2026-general/reviewed', { method: 'POST', body: { contestId: c.id }, token });
  const part = await quest(token, 'ballot');
  assert.equal(part.have, q.goal - 1);
  const no = await claim(token, 'ballot');
  assert.equal(no.status, 400);
  assert.match(no.data.error || JSON.stringify(no.data), /Review all/);
  const r = await call('/elections/tx-2026-general/reviewed', { method: 'POST', body: { contestId: b.contests.at(-1).id }, token });
  assert.deepEqual(r.data, { reviewed: q.goal, total: q.goal });
  assert.equal((await claim(token, 'ballot')).status, 200);
  assert.equal((await call('/elections/tx-2026-general/ballot', { token })).data.reviewed.length, q.goal);
});

test('quest: events needs an RSVP to an event this week', async () => {
  const { token, q } = await voterWithQuest('events');
  assert.match(q.href, /^#\/act\/\d+$/);
  assert.equal((await claim(token, 'events')).status, 400);
  const id = Number(q.href.split('/').pop());
  const r = await call(`/actions/${id}/rsvp`, { method: 'POST', body: { going: true }, token });
  assert.equal(r.status, 200);
  assert.ok(r.data.going && r.data.goingCount >= 1);
  assert.ok((await call('/actions', { token })).data.find((a) => a.id === id).going);
  // Taking it back undoes it.
  await call(`/actions/${id}/rsvp`, { method: 'POST', body: { going: false }, token });
  assert.equal((await claim(token, 'events')).status, 400);
  await call(`/actions/${id}/rsvp`, { method: 'POST', body: { going: true }, token });
  assert.equal((await claim(token, 'events')).status, 200);
  assert.equal((await call('/actions/999999/rsvp', { method: 'POST', body: {}, token })).status, 404);
});

test('quests: cheer, share, remind, doors and calls complete only from the real action', async () => {
  const demoId = (await call('/me', { token: await login('demo@example.org') })).data.id;
  const acts = {
    cheer: async (token) => {
      const item = (await call('/feed', { token })).data.items.find((i) => i.userId);
      return call('/cheers', { method: 'POST', body: { item: item.key, ownerId: item.userId }, token });
    },
    post: async (token) => call('/posts/share', { method: 'POST', body: { postId: (await call('/posts', { token })).data.posts[0].id }, token }),
    remind: async (token) => call('/reminders/share', { method: 'POST', body: { reminderId: (await call('/reminders', { token })).data.reminders[0].id }, token }),
    doors: async (token) => {
      await call('/activity', { method: 'POST', body: { kind: 'canvass', quantity: 6 }, token });
      const q = await quest(token, 'doors');
      assert.equal(q.have, 6);
      assert.equal((await claim(token, 'doors')).status, 400);
      return call('/activity', { method: 'POST', body: { kind: 'canvass', quantity: 4 }, token });
    },
    calls: (token) => call('/activity', { method: 'POST', body: { kind: 'phonebank', quantity: 10 }, token }),
  };
  for (const [id, act] of Object.entries(acts)) {
    const { token } = await voterWithQuest(id);
    assert.equal((await claim(token, id)).status, 400, `${id} before`);
    assert.equal((await act(token)).status, 200, `${id} action`);
    assert.equal((await claim(token, id)).status, 200, `${id} after`);
  }
});

// ---- reminders to vote go to people not on Minute Man, from the voter's own phone ----
test('reminders: ready-made messages, share records it, daily cap, Reminder badge counts shares', async () => {
  const s = (await call('/signup', { method: 'POST', body: { email: 'remind1@x.org', name: 'Rita Reminder', password: 'longenough' } })).data;
  const token = s.token;
  await call('/me', { method: 'PATCH', body: { jurisdictionId: 'tx-ellis-wax', birthDate: '1990-01-01' }, token });
  const d = (await call('/reminders', { token })).data;
  assert.match(d.url, /^https:\/\/cvas\.careride\.workers\.dev\/#\/join\/[A-Z0-9]{6}$/);
  const reg = d.reminders.find((r) => r.id === 'register');
  assert.equal(reg.text, "Hey, Texas voter registration closes Mon, Oct 5 and Election Day is Tue, Nov 3. Here's my sample ballot and voting plan helper:");
  for (const id of ['early', 'mail', 'election', 'general']) assert.ok(d.reminders.some((r) => r.id === id), id);
  assert.ok(d.reminders.every((r) => r.text.length <= 260 && r.label));
  assert.deepEqual([d.perReminder, d.dailyCap, d.sentToday, d.pointsLeftToday], [5, 25, 0, 25]);

  // Never logged by hand, never as an event, and an unknown message is rejected.
  assert.equal((await call('/activity', { method: 'POST', body: { kind: 'reminded', quantity: 5 }, token })).status, 400);
  assert.equal((await call('/reminders/share', { method: 'POST', body: { reminderId: 'nope' }, token })).status, 400);
  assert.ok(!(await call('/meta', { token })).data.activityKinds.some((k) => k.kind === 'reminded'));

  // Cancelling the share sheet sends nothing, so nothing is recorded until a share finishes.
  const before = (await call('/recognition', { token })).data.points;
  const pts = [];
  for (let i = 0; i < 6; i++) pts.push((await call('/reminders/share', { method: 'POST', body: { reminderId: d.reminders[i % d.reminders.length].id }, token })).data.points);
  assert.deepEqual(pts, [5, 5, 5, 5, 5, 0]); // points stop at 25 a day
  const rec = (await call('/recognition', { token })).data;
  assert.equal(rec.points, before + 25);
  const badge = rec.badges.find((b) => b.id === 'reminder');
  assert.ok(badge, 'Reminder badge after 5 shares');
  assert.equal(badge.desc, 'Reminded 5 people to vote');
  assert.equal((await call('/standing', { token })).data.totals.reminded, 6);
  assert.equal((await call('/reminders', { token })).data.pointsLeftToday, 0);
  // Recording stops at 20 a day.
  let status = 200;
  let n = 6;
  while (status === 200 && n < 40) { status = (await call('/reminders/share', { method: 'POST', body: { reminderId: 'general' }, token })).status; n++; }
  assert.equal(status, 429);
  assert.equal(n - 1, 20);
  assert.equal((await call('/reminders', { token })).data.limitLeftToday, 0);

  // A reminded person who joins through the link counts as a recruit.
  const code = d.url.split('/').pop();
  const pre = (await call('/recognition', { token })).data.points;
  const joined = await call('/signup', { method: 'POST', body: { email: 'reminded1@x.org', name: 'Reggie Reminded', password: 'longenough', ref: code } });
  assert.equal(joined.status, 200);
  const l = (await call('/ladder', { token })).data;
  assert.equal(l.recruits.length, 1);
  assert.equal(l.recruits[0].name, 'Reggie');
  assert.equal(l.recruits[0].earned, 25);
  assert.equal((await call('/recognition', { token })).data.points, pre + 25);
  assert.equal((await call('/standing', { token })).data.totals.recruits, 1);
});

// ---- feed posts: words and a photo ----
// A tiny "JPEG" with an EXIF segment that says GPS, to check the server strips it.
const fakeJpeg = () => {
  const exif = [...'Exif\0\0GPS 32.38N 96.84W'].map((c) => c.charCodeAt(0));
  const app1 = [0xff, 0xe1, 0, exif.length + 2, ...exif];
  const app0 = [0xff, 0xe0, 0, 16, ...'JFIF\0'.split('').map((c) => c.charCodeAt(0)), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const bytes = [0xff, 0xd8, ...app0, ...app1, 0xff, 0xda, 0, 2, 1, 2, 3, 4, 5, 0xff, 0xd9];
  return btoa(String.fromCharCode(...bytes));
};
async function feedAllOf(token) {
  const out = [];
  let c = 0;
  while (c !== null) { const p = (await call(`/feed?cursor=${c}`, { token })).data; out.push(...p.items); c = p.next; }
  return out;
}

test('feed posts: text and photo, visibility, limits, report, delete, account deletion', async () => {
  const mk = async (email, name) => (await call('/signup', { method: 'POST', body: { email, name, password: 'longenough' } })).data.token;
  const author = await mk('poster@x.org', 'Paula Poster');
  const friend = await mk('pfriend@x.org', 'Fred Friend');
  const stranger = await mk('pstranger@x.org', 'Sam Stranger');
  await call('/friends', { method: 'POST', body: { email: 'poster@x.org' }, token: friend });
  const me = (await call('/me', { token: author })).data;
  assert.equal((await call(`/friends/${(await call('/me', { token: friend })).data.id}/accept`, { method: 'POST', token: author })).status, 200);

  // Text post, then a photo post. No points for either.
  const before = (await call('/recognition', { token: author })).data.points;
  const t1 = await call('/feed/posts', { method: 'POST', body: { body: 'Knocked on Elm St. <b>Great</b> folks.' }, token: author });
  assert.equal(t1.status, 200);
  const p2 = await call('/feed/posts', { method: 'POST', body: { body: '', image: { data: fakeJpeg(), w: 1280, h: 960 } }, token: author });
  assert.equal(p2.status, 200);
  assert.match(p2.data.post.image, /^\/api\/media\/[A-Za-z0-9_-]{22}\.jpg$/);
  assert.equal((await call('/recognition', { token: author })).data.points, before);
  // The image is served without a token (unguessable URL), as a JPEG, with the GPS segment gone.
  const img = await handle(new Request('http://t' + p2.data.post.image));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  const bytes = new Uint8Array(await img.arrayBuffer());
  assert.ok(!String.fromCharCode(...bytes).includes('GPS'));
  assert.equal(bytes[0], 0xff);
  assert.equal((await handle(new Request('http://t/api/media/AAAAAAAAAAAAAAAAAAAAAA.jpg'))).status, 404);

  // Rejects: empty, too long, not an image.
  assert.equal((await call('/feed/posts', { method: 'POST', body: { body: '  ' }, token: author })).status, 400);
  assert.equal((await call('/feed/posts', { method: 'POST', body: { body: 'x'.repeat(501) }, token: author })).status, 400);
  assert.equal((await call('/feed/posts', { method: 'POST', body: { image: { data: btoa('<svg onload=alert(1)>') } }, token: author })).status, 400);

  // Friends see the posts with the full name.
  const ff = (await feedAllOf(friend)).filter((i) => i.userId === me.id && i.icon === 'post');
  assert.equal(ff.length, 2);
  assert.ok(ff.every((i) => i.name === 'Paula Poster'));
  assert.ok(ff.some((i) => i.body === 'Knocked on Elm St. <b>Great</b> folks.'), 'stored as text; the client escapes it');
  // Strangers see posts too, as first name, last initial.
  const sf = (await feedAllOf(stranger)).filter((i) => i.userId === me.id && i.icon === 'post');
  assert.equal(sf.length, 2);
  assert.ok(sf.every((i) => i.name === 'Paula P.'));

  // A text-only post doesn't outrank verified work from the same moment.
  const raw = (await feedAllOf(stranger));
  assert.ok(raw.findIndex((i) => i.key === t1.data.key) > 0);

  // Report: hidden for the reporter, flagged for the admin, still visible to others.
  assert.equal((await call('/feed/report', { method: 'POST', body: { item: t1.data.key, reason: 'spam' }, token: stranger })).status, 200);
  assert.ok(!(await feedAllOf(stranger)).some((i) => i.key === t1.data.key));
  assert.ok((await feedAllOf(friend)).some((i) => i.key === t1.data.key));
  assert.equal((await call('/feed/report', { method: 'POST', body: { item: t1.data.key }, token: author })).status, 400);
  assert.equal((await call('/admin/reports')).status, 401);
  const flagged = (await call('/admin/reports', { token: ADMIN })).data;
  assert.ok(flagged.some((r) => r.id === t1.data.post.id && r.reports === 1));

  // Note and photo on an activity you logged; only you can add them.
  const act = (await call('/activity', { method: 'POST', body: { kind: 'canvass', quantity: 30 }, token: author })).data;
  assert.ok(act.activityId);
  assert.equal((await call(`/activity/${act.activityId}/post`, { method: 'PUT', body: { body: 'hi' }, token: friend })).status, 404);
  const cap = await call(`/activity/${act.activityId}/post`, { method: 'PUT', body: { body: 'Hot day, good talks.', image: { data: fakeJpeg() } }, token: author });
  assert.equal(cap.status, 200);
  const item = (await feedAllOf(friend)).find((i) => i.key === `a:${act.activityId}`);
  assert.equal(item.body, 'Hot day, good talks.');
  assert.ok(item.image);
  const edited = await call(`/activity/${act.activityId}/post`, { method: 'PUT', body: { body: 'Edited.', removeImage: true }, token: author });
  assert.equal(edited.data.post.image, null);
  assert.equal((await handle(new Request('http://t' + item.image))).status, 404, 'replaced photo is gone');

  // Delete your own post (only yours).
  assert.equal((await call(`/feed/posts/${t1.data.post.id}`, { method: 'DELETE', token: friend })).status, 404);
  assert.equal((await call(`/feed/posts/${t1.data.post.id}`, { method: 'DELETE', token: author })).status, 200);
  assert.ok(!(await feedAllOf(friend)).some((i) => i.key === t1.data.key));

  // Admin removal.
  const bad = (await call('/feed/posts', { method: 'POST', body: { body: 'remove me' }, token: author })).data;
  assert.equal((await call(`/admin/posts/${bad.post.id}`, { method: 'DELETE', token: ADMIN })).status, 200);

  // Rate limit: 10 posts a day (activity notes count when first added).
  let status = 200;
  let n = 0;
  while (status === 200 && n < 20) { status = (await call('/feed/posts', { method: 'POST', body: { body: `post ${n}` }, token: author })).status; n++; }
  assert.equal(status, 429);
  assert.equal(n - 1 + 4, 10, 'ten in all today, counting the earlier ones');

  // Deleting the account removes its posts and photos.
  const img2 = p2.data.post.image;
  assert.equal((await call('/me', { method: 'DELETE', token: author })).status, 200);
  assert.equal((await handle(new Request('http://t' + img2))).status, 404);
  assert.ok(!(await feedAllOf(friend)).some((i) => i.userId === me.id));
});
