import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openNodeDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { configureClock } from '../src/time.js';

// The registration address step: the lookup returns the matched address and districts for
// confirmation, sets the ballot area, and the server never keeps the street.
let handle;
const GEO = {
  '401 S Rogers St, Waxahachie, TX 75165': {
    matchedAddress: '401 S ROGERS ST, WAXAHACHIE, TX, 75165', state: 'TX', county: 'Ellis County', place: 'Waxahachie', cd: '6', sldu: '2', sldl: '10',
  },
};
before(async () => {
  configureClock({ zone: 'America/Chicago', demoDate: '2026-10-01' });
  const db = await openNodeDb(':memory:');
  await seed(db);
  handle = createApp(db, { adminToken: 'x', geocode: async (a) => GEO[a] || null });
});
async function call(path, { method = 'GET', body, token } = {}) {
  const r = await handle(new Request('http://t/api' + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  return { status: r.status, data: await r.json() };
}

test('registration address: matched address comes back for confirmation, street is not stored', async () => {
  const s = (await call('/signup', { method: 'POST', body: { email: 'reg-addr@x.org', name: 'R', password: 'longenough' } })).data;
  const r = await call('/me/address', { method: 'POST', token: s.token, body: { address: '401 S Rogers St, Waxahachie, TX 75165' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.matchedAddress, '401 S ROGERS ST, WAXAHACHIE, TX, 75165');
  assert.deepEqual(r.data.districts, { congress: '6', stateSenate: '2', stateHouse: '10', county: 'Ellis County' });
  assert.equal(r.data.jurisdictionId, 'tx-ellis-wax');
  const me = (await call('/me', { token: s.token })).data;
  assert.ok(!('matchedAddress' in me));
  assert.ok(!/rogers/i.test(JSON.stringify((await call('/me/export', { token: s.token })).data)));
  // Same area again keeps a precinct the voter set; a different area clears it.
  await call('/me', { method: 'PATCH', token: s.token, body: { precinct: '101' } });
  assert.equal((await call('/me/address', { method: 'POST', token: s.token, body: { address: '401 S Rogers St, Waxahachie, TX 75165' } })).data.precinct, '101');
  const bad = await call('/me/address', { method: 'POST', token: s.token, body: { address: '99999 Nowhere Ln, Waxahachie, TX 75165' } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /couldn't find/);
});
