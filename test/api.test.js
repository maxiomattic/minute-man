import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openNodeDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { configureClock } from '../src/time.js';
import { aggregate } from '../src/engine/recommend.js';
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
  // Neither source endorsed and one Republican is running: filled in, marked as a party default, credited to nobody.
  const sen2 = b.contests.find((c) => c.id === 'tx26-state-sen-2');
  const reps = sen2.choices.filter((c) => c.party === 'Republican');
  if (reps.length === 1) {
    assert.deepEqual(rec('tx26-state-sen-2').choiceIds, [reps[0].id]);
    assert.equal(rec('tx26-state-sen-2').basis, 'party');
    assert.equal(rec('tx26-state-sen-2').sourceLeaderId, null);
  } else assert.deepEqual(rec('tx26-state-sen-2').choiceIds, []);

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
  const a = await call('/activity', { method: 'POST', body: { kind: 'social', quantity: 4 }, token: t });
  assert.equal(a.data.points, 12);
  const b = await call('/activity', { method: 'POST', body: { kind: 'social', quantity: 4 }, token: t });
  assert.equal(b.data.points, 3); // cap 15/day
  assert.ok((await call('/recognition', { token: t })).data.badges.some((x) => x.id === 'party'));
  const org = await login('org1@example.org');
  assert.equal((await call('/actions', { token: org })).data.find((x) => x.id === meet.id).checkinCode, 'MEET101');
});

test('leaderboards honor opt-out; groups and friends work', async () => {
  const t = await login('demo@example.org');
  const f1 = await login('friend1@example.org');
  await call('/me', { method: 'PATCH', body: { onLeaderboards: false }, token: f1 });
  const lb = (await call('/leaderboard?scope=friends', { token: t })).data;
  assert.ok(!lb.rows.some((r) => r.name === 'Cody Ramirez'));
  assert.ok(lb.rows.some((r) => r.me));
  assert.ok((await call('/leaderboard?scope=friends', { token: f1 })).data.rows.some((r) => r.me), 'you always see yourself');
  await call('/me', { method: 'PATCH', body: { onLeaderboards: true }, token: f1 });

  const g = (await call('/groups', { method: 'POST', body: { name: 'Test Team' }, token: t })).data;
  assert.ok(g.inviteCode);
  assert.equal((await call('/groups/join', { method: 'POST', body: { code: g.inviteCode.toLowerCase() }, token: f1 })).status, 200);
  assert.equal((await call(`/leaderboard?scope=group:${g.id}`, { token: f1 })).data.rows.length, 2);
  const f4 = await login('friend4@example.org');
  assert.equal((await call(`/leaderboard?scope=group:${g.id}`, { token: f4 })).status, 403);

  const fr = (await call('/friends', { token: t })).data;
  const k = fr.find((x) => x.state === 'incoming');
  await call(`/friends/${k.userId}/accept`, { method: 'POST', token: t });
  assert.equal((await call(`/friends/${k.userId}/nudge`, { method: 'POST', body: { electionId: 'tx-2026-general' }, token: t })).status, 200);
  assert.equal((await call(`/friends/${k.userId}/nudge`, { method: 'POST', body: { electionId: 'tx-2026-general' }, token: t })).status, 429);
  assert.ok((await call('/notifications', { token: f4 })).data.some((x) => x.kind === 'nudge'));
});

test('friends only see participation status when shared', async () => {
  const t = await login('demo@example.org');
  const f3 = await login('friend3@example.org');
  await call('/me', { method: 'PATCH', body: { shareStatus: false }, token: f3 });
  assert.equal((await call('/friends', { token: t })).data.find((x) => x.name === 'Wade Collier').status, undefined);
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
  await call('/activity', { method: 'POST', body: { kind: 'social', quantity: 1 }, token: s.token });
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
  // Peggy Lindell keeps herself off leaderboards, so she never shows up.
  assert.ok(!all.some((i) => /Peggy/.test(i.name)));
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
  assert.ok(!peggy.rows.some((x) => /Peggy/.test(x.name)));
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
  assert.equal(l.name, 'Newcomer');
  assert.equal(l.coach.step.id, 'address');
  // Doing a later rung's step first doesn't skip the basics.
  await call('/activity', { method: 'POST', token: t, body: { kind: 'social', quantity: 5 } });
  assert.equal((await call('/ladder', { token: t })).data.level, 1);
  await call('/me/address', { method: 'POST', token: t, body: { address: '401 S Rogers St, Waxahachie, TX' } });
  await call('/registration', { method: 'PUT', token: t, body: { status: 'confirmed' } });
  await call('/participation', { method: 'POST', token: t, body: { electionId: 'tx-2026-general', kind: 'planned' } });
  l = (await call('/ladder', { token: t })).data;
  assert.equal(l.level, 2);
  assert.equal(l.name, 'Registered Voter');
  // Voting isn't open on Oct 1, so the coach waits on it and suggests the next rung meanwhile.
  assert.equal(l.coach.step.id, 'vote');
  assert.match(l.coach.step.opensLabel, /Opens Oct 19/);
  assert.equal(l.coach.meanwhile.rung, 'Messenger');
  assert.ok(l.rungs[3].steps.find((s) => s.id === 'posts').done);
  const rec = (await call('/recognition', { token: t })).data;
  assert.equal(rec.rank.name, 'Registered Voter');
  assert.ok(rec.breakdown.bonus >= 50);
  assert.equal((await call('/today', { token: t })).data.rank.name, 'Registered Voter');
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
  assert.equal(d.recruits[0].rank, null); // not sharing
  assert.equal(d.recruits[0].earned, 25);
  assert.ok((await call('/friends', { token: r })).data.some((f) => f.name === 'Demo Voter' && f.state === 'friends'));

  await call('/me/address', { method: 'POST', token: r, body: { address: '401 S Rogers St, Waxahachie, TX' } });
  await call('/registration', { method: 'PUT', token: r, body: { status: 'confirmed' } });
  await call('/participation', { method: 'POST', token: r, body: { electionId: 'tx-2026-general', kind: 'planned' } });
  await call('/me', { method: 'PATCH', token: r, body: { shareStatus: true } });
  d = (await call('/ladder', { token: demo })).data;
  assert.equal(d.recruits[0].rank, 'Registered Voter');
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
