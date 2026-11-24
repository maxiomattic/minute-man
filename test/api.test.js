import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { aggregate } from '../src/engine/recommend.js';
import { activityPoints, rankFor } from '../src/engine/recognition.js';
import { eligibility, ageOn } from '../src/rules.js';

let server;
let base;
const ADMIN = 'test-admin';

before(async () => {
  const db = openDb(':memory:');
  seed(db);
  server = createServer(createApp(db, { adminToken: ADMIN }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
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

test('ranks and custom rank names', () => {
  assert.equal(rankFor(0).name, 'Newcomer');
  assert.equal(rankFor(350).name, 'Regular');
  assert.equal(rankFor(350, ['a', 'b', 'c']).name, 'c');
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

test('sample ballot reflects bindings and priority', async () => {
  const t = await login('demo@example.org');
  const b = (await call('/elections/el-local/ballot', { token: t })).data;
  const mayor = b.contests.find((c) => c.id === 'c-mayor');
  assert.deepEqual(mayor.recommendation.choiceIds, ['ch-mayor-b']);
  // Measure A: both Riverbend (1) and Teachers (2) say yes → no conflict
  const ma = b.contests.find((c) => c.id === 'c-meas-a');
  assert.equal(ma.recommendation.conflicts.length, 0);
  // School board: only Teachers has an opinion
  const sb = b.contests.find((c) => c.id === 'c-schools');
  assert.deepEqual(sb.recommendation.choiceIds, ['ch-sb-a']);

  // Follow taxpayers forum at top priority → mayor flips, conflict shown
  const ls = (await call('/leaders')).data;
  const tf = ls.find((l) => l.name.includes('Taxpayers'));
  let binds = (await call('/bindings', { method: 'POST', body: { leaderId: tf.id }, token: t })).data;
  const order = [tf.id, ...binds.filter((x) => x.leaderId !== tf.id).map((x) => x.leaderId)].map((leaderId) => ({ leaderId }));
  binds = (await call('/bindings', { method: 'PUT', body: order, token: t })).data;
  assert.equal(binds[0].leaderId, tf.id);
  const b2 = (await call('/elections/el-local/ballot', { token: t })).data;
  const m2 = b2.contests.find((c) => c.id === 'c-mayor');
  assert.deepEqual(m2.recommendation.choiceIds, ['ch-mayor-a']);
  assert.equal(m2.recommendation.conflicts.length, 1);
  // Revoke binding
  await call(`/bindings/${tf.id}`, { method: 'DELETE', token: t });
  const b3 = (await call('/elections/el-local/ballot', { token: t })).data;
  assert.deepEqual(b3.contests.find((c) => c.id === 'c-mayor').recommendation.choiceIds, ['ch-mayor-b']);
});

test('leaders can only publish for their own source, with valid choices', async () => {
  const org = await login('org1@example.org');
  const demo = await login('demo@example.org');
  assert.equal((await call('/leaders/2/recommendations', { method: 'PUT', body: { contestId: 'c-mayor', choiceIds: ['ch-mayor-c'] }, token: org })).status, 403);
  assert.equal((await call('/leaders/1/recommendations', { method: 'PUT', body: { contestId: 'c-mayor', choiceIds: ['ch-sb-a'] }, token: org })).status, 400);
  assert.equal((await call('/leaders/1/recommendations', { method: 'PUT', body: { contestId: 'c-council', choiceIds: ['ch-cc-a', 'ch-cc-b', 'ch-cc-c'] }, token: org })).status, 400);
  assert.equal((await call('/leaders/1/recommendations', { method: 'PUT', body: { contestId: 'c-mayor', choiceIds: ['ch-mayor-c'] }, token: demo })).status, 403);
  assert.equal((await call('/leaders/1/recommendations', { method: 'PUT', body: [{ contestId: 'c-mayor', choiceIds: ['ch-mayor-c'], note: 'changed' }], token: org })).status, 200);
  const b = (await call('/elections/el-local/ballot', { token: demo })).data;
  assert.deepEqual(b.contests.find((c) => c.id === 'c-mayor').recommendation.choiceIds, ['ch-mayor-c']);
  await call('/leaders/1/recommendations', { method: 'PUT', body: [{ contestId: 'c-mayor', choiceIds: ['ch-mayor-b'] }], token: org });
});

test('voting: turnout points, once per election, no vote choice accepted or stored', async () => {
  const t = await login('friend2@example.org');
  const before = (await call('/recognition', { token: t })).data.points;
  const r = await call('/participation', { method: 'POST', body: { electionId: 'el-local', kind: 'voted', choiceIds: ['ch-mayor-a'] }, token: t });
  assert.equal(r.status, 200);
  assert.equal(r.data.score, before + 100);
  await call('/participation', { method: 'POST', body: { electionId: 'el-local', kind: 'voted' }, token: t });
  assert.equal((await call('/recognition', { token: t })).data.points, before + 100);
  const exp = (await call('/me/export', { token: t })).data;
  assert.ok(!JSON.stringify(exp).includes('ch-mayor-a'), 'vote choice must never be stored');
  // Primary hasn't opened
  assert.equal((await call('/participation', { method: 'POST', body: { electionId: 'el-primary', kind: 'voted' }, token: t })).status, 400);
});

test('activism: check-in codes verify, double check-in rejected, self-logging capped', async () => {
  const t = await login('demo@example.org');
  const acts = (await call('/actions', { token: t })).data;
  const council = acts.find((a) => a.kind === 'council_meeting' && a.leaderName);
  assert.equal(council.checkinCode, undefined, 'attendees must not see the code');
  assert.equal((await call(`/actions/${council.id}/checkin`, { method: 'POST', body: { code: 'WRONG' }, token: t })).status, 400);
  const ok = await call(`/actions/${council.id}/checkin`, { method: 'POST', body: { code: 'council1' }, token: t });
  assert.equal(ok.data.points, 30);
  assert.equal(ok.data.verified, true);
  assert.equal((await call(`/actions/${council.id}/checkin`, { method: 'POST', body: { code: 'COUNCIL1' }, token: t })).status, 409);
  const a = await call('/activity', { method: 'POST', body: { kind: 'social', quantity: 4 }, token: t });
  assert.equal(a.data.points, 12);
  const b = await call('/activity', { method: 'POST', body: { kind: 'social', quantity: 4 }, token: t });
  assert.equal(b.data.points, 3); // cap 15/day
  const rec = (await call('/recognition', { token: t })).data;
  assert.ok(rec.badges.some((x) => x.id === 'council'));
  // Organizer sees code for own event
  const org = await login('org1@example.org');
  await call('/bindings', { method: 'POST', body: { leaderId: 1 }, token: org });
  const orgActs = (await call('/actions', { token: org })).data;
  assert.equal(orgActs.find((x) => x.id === council.id).checkinCode, 'COUNCIL1');
});

test('leaderboards honor opt-out; groups and friends work', async () => {
  const t = await login('demo@example.org');
  const f1 = await login('friend1@example.org');
  await call('/me', { method: 'PATCH', body: { onLeaderboards: false }, token: f1 });
  const lb = (await call('/leaderboard?scope=friends', { token: t })).data;
  assert.ok(!lb.rows.some((r) => r.name === 'Jamie Ortega'));
  assert.ok(lb.rows.some((r) => r.me));
  const own = (await call('/leaderboard?scope=friends', { token: f1 })).data;
  assert.ok(own.rows.some((r) => r.me), 'you always see yourself');
  await call('/me', { method: 'PATCH', body: { onLeaderboards: true }, token: f1 });

  const g = (await call('/groups', { method: 'POST', body: { name: 'Test Team' }, token: t })).data;
  assert.ok(g.inviteCode);
  assert.equal((await call('/groups/join', { method: 'POST', body: { code: g.inviteCode.toLowerCase() }, token: f1 })).status, 200);
  const glb = (await call(`/leaderboard?scope=group:${g.id}`, { token: f1 })).data;
  assert.equal(glb.rows.length, 2);
  const f4 = await login('friend4@example.org');
  assert.equal((await call(`/leaderboard?scope=group:${g.id}`, { token: f4 })).status, 403);

  // Accept pending request from friend4, then nudge
  const fr = (await call('/friends', { token: t })).data;
  const kim = fr.find((x) => x.state === 'incoming');
  await call(`/friends/${kim.userId}/accept`, { method: 'POST', token: t });
  assert.equal((await call(`/friends/${kim.userId}/nudge`, { method: 'POST', body: { electionId: 'el-local' }, token: t })).status, 200);
  assert.equal((await call(`/friends/${kim.userId}/nudge`, { method: 'POST', body: { electionId: 'el-local' }, token: t })).status, 429);
  const n = (await call('/notifications', { token: f4 })).data;
  assert.ok(n.some((x) => x.kind === 'nudge'));
});

test('friends only see participation status when shared', async () => {
  const t = await login('demo@example.org');
  const f3 = await login('friend3@example.org');
  await call('/me', { method: 'PATCH', body: { shareStatus: false }, token: f3 });
  const fr = (await call('/friends', { token: t })).data;
  assert.equal(fr.find((x) => x.name === 'Ari Feldman').status, undefined);
});

test('registration status, eligibility and registered badge', async () => {
  const t = await login('demo@example.org');
  const el = (await call('/eligibility', { token: t })).data;
  assert.ok(el.elections.length >= 1);
  await call('/registration', { method: 'PUT', body: { status: 'confirmed', desiredParty: 'Green' }, token: t });
  const el2 = (await call('/eligibility', { token: t })).data;
  const primary = el2.elections.find((x) => x.election.kind === 'primary');
  assert.ok(primary.actions.some((a) => a.kind === 'party_change'));
  assert.ok((await call('/recognition', { token: t })).data.badges.some((b) => b.id === 'registered'));
});

test('endorsements and slate wins score without any vote data', async () => {
  const t = await login('demo@example.org');
  const r0 = (await call('/recognition', { token: t })).data;
  assert.equal(r0.breakdown.groupWins, 25); // Measure Z won and Riverbend recommended it
  await call('/endorse', { method: 'POST', body: { leaderId: 1 }, token: t });
  const r1 = (await call('/recognition', { token: t })).data;
  assert.equal(r1.breakdown.endorsements, 20);
});

test('admin ingestion requires token and upserts', async () => {
  const data = { elections: [{ id: 'el-new', name: 'New Special', date: '2030-01-01', kind: 'special', jurisdictionId: 'city-maple',
    contests: [{ id: 'c-new', title: 'Prop 1', kind: 'measure', choices: [{ id: 'n-y', label: 'Yes' }, { id: 'n-n', label: 'No' }] }] }] };
  assert.equal((await call('/admin/ingest', { method: 'POST', body: data })).status, 401);
  const r = await call('/admin/ingest', { method: 'POST', body: data, token: ADMIN });
  assert.equal(r.data.contests, 1);
  const t = await login('demo@example.org');
  assert.ok((await call('/elections', { token: t })).data.some((e) => e.id === 'el-new'));
});

test('account deletion removes user', async () => {
  const s = (await call('/signup', { method: 'POST', body: { email: 'bye@x.org', name: 'Bye', password: 'longenough' } })).data;
  assert.equal((await call('/me', { method: 'DELETE', token: s.token })).status, 200);
  assert.equal((await call('/me', { token: s.token })).status, 401);
});
