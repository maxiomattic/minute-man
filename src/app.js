import { engagementRoutes, luckyBonus, pointsSince, weekStart } from './engine/engage.js';
import { aggregate, listStrategies } from './engine/recommend.js';
import { ACTIVITY, PARTICIPATION, activityPoints, rankFor, scorecard } from './engine/recognition.js';
import { eligibility, jurisdictionChain, rulesFor } from './rules.js';

class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
import { clockConfig, localDay } from './time.js';
import { SOURCES, bindDefaults } from './sources.js';
import ENDORSEMENTS from './data/endorsements.json' with { type: 'json' };
const today = () => localDay();
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const code = (n = 6) => [...rand(n)].map((b) => ALPHA[b % ALPHA.length]).join('');
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// PBKDF2-SHA256 via WebCrypto: works identically on Node and Cloudflare Workers.
const PBKDF2_ITER = 100000;
async function derive(pw, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
export async function hashPw(pw) {
  const salt = rand(16);
  return `pbkdf2$${PBKDF2_ITER}$${hex(salt)}$${hex(await derive(pw, salt, PBKDF2_ITER))}`;
}
async function checkPw(pw, stored) {
  const [, iter, salt, hash] = stored.split('$');
  const got = await derive(pw, unhex(salt), Number(iter));
  const want = unhex(hash);
  let diff = got.length ^ want.length;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

export function createApp(db, { adminToken, seed } = {}) {
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp(
      '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$',
    );
    routes.push({ method, re, keys, handler, auth: opts.auth ?? true });
  };

  const userPublic = (u) => ({
    id: u.id, email: u.email, name: u.name, role: u.role,
    jurisdictionId: u.jurisdiction_id, precinct: u.precinct, birthDate: u.birth_date,
    shareStatus: !!u.share_status, onLeaderboards: !!u.on_leaderboards,
    theme: u.theme, strategy: u.strategy,
  });

  function issueSession(userId) {
    const token = b64url(rand(24));
    const exp = new Date(Date.now() + 30 * 86400000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, exp);
    return token;
  }

  const isFriend = (a, b) =>
    !!db
      .prepare(
        `SELECT 1 FROM friendships WHERE status='accepted' AND ((a=? AND b=?) OR (a=? AND b=?))`,
      )
      .get(a, b, b, a);

  const ownLeader = (user, id) => {
    const l = db.prepare('SELECT * FROM leaders WHERE id = ?').get(Number(id));
    if (!l) throw new HttpError(404, 'no such leader');
    if (l.owner_id !== user.id) throw new HttpError(403, 'not your leadership source');
    return l;
  };

  const leaderOut = (l) => ({
    id: l.id, name: l.name, kind: l.kind, blurb: l.blurb, brandColor: l.brand_color,
    rankNames: l.rank_names ? JSON.parse(l.rank_names) : null,
    followers: db.prepare('SELECT COUNT(*) n FROM bindings WHERE leader_id=? AND active=1').get(l.id).n,
  });

  function upcomingElections(user) {
    if (!user.jurisdiction_id) return [];
    const chain = jurisdictionChain(db, user.jurisdiction_id);
    return db
      .prepare(
        `SELECT * FROM elections WHERE jurisdiction_id IN (${chain.map(() => '?').join(',')})
         AND date >= ? ORDER BY date`,
      )
      .all(...chain, today());
  }

  // ---------- auth ----------
  route('POST', '/api/signup', async ({ body }) => {
    const { email, name, password } = body;
    if (!email || !/^\S+@\S+$/.test(email)) throw bad('valid email required');
    if (!name) throw bad('name required');
    if (!password || password.length < 8) throw bad('password must be at least 8 characters');
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase()))
      throw new HttpError(409, 'email already registered');
    const r = db
      .prepare('INSERT INTO users (email, name, pw_hash) VALUES (?,?,?)')
      .run(email.toLowerCase(), name, await hashPw(password));
    const id = Number(r.lastInsertRowid);
    bindDefaults(db, id);
    return { token: issueSession(id), user: userPublic(db.prepare('SELECT * FROM users WHERE id=?').get(id)) };
  }, { auth: false });

  route('POST', '/api/login', async ({ body }) => {
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(body.email || '').toLowerCase());
    if (!u || !(await checkPw(String(body.password || ''), u.pw_hash))) throw new HttpError(401, 'wrong email or password');
    return { token: issueSession(u.id), user: userPublic(u) };
  }, { auth: false });

  route('POST', '/api/logout', ({ token }) => {
    db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return { ok: true };
  });

  // ---------- profile ----------
  route('GET', '/api/me', ({ user }) => userPublic(user));

  route('PATCH', '/api/me', ({ user, body }) => {
    const map = {
      name: 'name', jurisdictionId: 'jurisdiction_id', precinct: 'precinct', birthDate: 'birth_date',
      shareStatus: 'share_status', onLeaderboards: 'on_leaderboards', theme: 'theme', strategy: 'strategy',
    };
    if (body.strategy && !listStrategies().includes(body.strategy)) throw bad('unknown strategy');
    if (body.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.birthDate)) throw bad('birthDate must be YYYY-MM-DD');
    if (body.jurisdictionId && !db.prepare('SELECT 1 FROM jurisdictions WHERE id=?').get(body.jurisdictionId))
      throw bad('unknown jurisdiction');
    for (const [k, col] of Object.entries(map)) {
      if (!(k in body)) continue;
      let v = body[k];
      if (typeof v === 'boolean') v = v ? 1 : 0;
      db.prepare(`UPDATE users SET ${col}=? WHERE id=?`).run(v ?? null, user.id);
    }
    return userPublic(db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
  });

  // Data export + deletion: user stays in control of their data.
  route('GET', '/api/me/export', ({ user }) => {
    const q = (sql) => db.prepare(sql).all(user.id);
    return {
      profile: userPublic(user),
      bindings: q('SELECT * FROM bindings WHERE user_id=?'),
      registration: q('SELECT * FROM registrations WHERE user_id=?'),
      participation: q('SELECT * FROM participation WHERE user_id=?'),
      activity: q('SELECT * FROM activity WHERE user_id=?'),
      endorsements: q('SELECT * FROM endorsements WHERE user_id=?'),
      groups: q('SELECT group_id FROM group_members WHERE user_id=?'),
      friends: q('SELECT * FROM friendships WHERE a=?1 OR b=?1'),
    };
  });
  route('DELETE', '/api/me', ({ user }) => {
    db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    return { ok: true };
  });

  route('GET', '/api/clock', () => ({ ...clockConfig(), date: clockConfig().demoDate, now: new Date().toISOString() }), { auth: false });

  route('GET', '/api/meta', () => ({
    strategies: listStrategies(),
    activityKinds: Object.entries(ACTIVITY).map(([k, v]) => ({ kind: k, ...v })),
    participationPoints: PARTICIPATION,
  }), { auth: false });

  // ---------- jurisdictions & elections ----------
  route('GET', '/api/jurisdictions', () =>
    db.prepare('SELECT id, name, parent_id AS parentId FROM jurisdictions ORDER BY name').all(),
  { auth: false });

  route('GET', '/api/elections', ({ user }) => upcomingElections(user));

  route('GET', '/api/elections/:id/ballot', ({ user, params }) => {
    const e = db.prepare('SELECT * FROM elections WHERE id=?').get(params.id);
    if (!e) throw new HttpError(404, 'no such election');
    const chain = user.jurisdiction_id ? jurisdictionChain(db, user.jurisdiction_id) : [e.jurisdiction_id];
    const contests = db
      .prepare(
        `SELECT * FROM contests WHERE election_id=? AND jurisdiction_id IN (${chain.map(() => '?').join(',')})
         ORDER BY sort, title`,
      )
      .all(e.id, ...chain);
    const binds = db
      .prepare(
        `SELECT b.priority, l.id, l.name FROM bindings b JOIN leaders l ON l.id=b.leader_id
         WHERE b.user_id=? AND b.active=1 ORDER BY b.priority`,
      )
      .all(user.id);
    const recStmt = db.prepare('SELECT choice_ids, note FROM recommendations WHERE leader_id=? AND contest_id=?');
    const out = contests.map((c) => {
      const choices = db
        .prepare('SELECT id, label, party FROM choices WHERE contest_id=? ORDER BY sort, label')
        .all(c.id);
      const recs = [];
      for (const b of binds) {
        const r = recStmt.get(b.id, c.id);
        if (r) recs.push({ leaderId: b.id, leaderName: b.name, priority: b.priority, choiceIds: JSON.parse(r.choice_ids), note: r.note });
      }
      const agg = aggregate(user.strategy, recs, { id: c.id, voteFor: c.vote_for });
      return {
        id: c.id, title: c.title, kind: c.kind, voteFor: c.vote_for, description: c.description,
        choices, recommendation: agg,
        notes: recs.filter((r) => r.note).map((r) => ({ leaderName: r.leaderName, note: r.note })),
      };
    });
    const rules = rulesFor(db, user.jurisdiction_id || e.jurisdiction_id);
    return { election: e, strategy: user.strategy, contests: out, rules, generatedAt: new Date().toISOString() };
  });

  route('GET', '/api/polling', ({ user, query }) => {
    if (!user.jurisdiction_id) return [];
    const chain = jurisdictionChain(db, user.jurisdiction_id);
    let rows = db
      .prepare(
        `SELECT * FROM polling_places WHERE jurisdiction_id IN (${chain.map(() => '?').join(',')})
         AND (precinct IS NULL OR precinct = ? OR kind != 'polling')`,
      )
      .all(...chain, user.precinct || '');
    const lat = Number(query.get('lat'));
    const lng = Number(query.get('lng'));
    if (query.has('lat') && Number.isFinite(lat) && Number.isFinite(lng)) {
      const R = 6371;
      const rad = (d) => (d * Math.PI) / 180;
      rows = rows
        .map((p) => {
          if (p.lat == null) return { ...p, km: null };
          const a =
            Math.sin(rad(p.lat - lat) / 2) ** 2 +
            Math.cos(rad(lat)) * Math.cos(rad(p.lat)) * Math.sin(rad(p.lng - lng) / 2) ** 2;
          return { ...p, km: Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10 };
        })
        .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
    }
    return rows;
  });

  // ---------- endorsement directory (every state) ----------
  // One row per race: the pick from each source, in the user's follow order.
  route('GET', '/api/endorsements', ({ user, query }) => {
    const state = String(query.get('state') || (user.jurisdiction_id || '').slice(0, 2)).toUpperCase();
    const order = db.prepare(
      `SELECT u.email FROM bindings b JOIN leaders l ON l.id=b.leader_id JOIN users u ON u.id=l.owner_id
       WHERE b.user_id=? AND b.active=1 ORDER BY b.priority`,
    ).all(user.id).map((r) => SOURCES.find((s) => s.email === r.email)?.key).filter(Boolean);
    const keys = order.length ? order : SOURCES.map((s) => s.key);
    const races = new Map();
    for (const e of ENDORSEMENTS) {
      if (e.state !== state || !keys.includes(e.source)) continue;
      const r = races.get(e.race) || { race: e.race, label: e.raceLabel, picks: [] };
      r.picks.push({ source: e.source, sourceName: SOURCES.find((s) => s.key === e.source).name, candidate: e.candidate, party: e.party, note: e.note || null, url: e.url });
      races.set(e.race, r);
    }
    const rank = (r) => /^US-SEN/.test(r) ? 0 : r === 'GOV' ? 1 : /^US-HOUSE/.test(r) ? 3 : /^STATE-/.test(r) ? 4 : 2;
    const num = (r) => Number(r.split('-').pop()) || 0;
    const list = [...races.values()].map((r) => {
      r.picks.sort((a, b) => keys.indexOf(a.source) - keys.indexOf(b.source));
      return { ...r, pick: r.picks[0] };
    }).sort((a, b) => rank(a.race) - rank(b.race) || a.race.replace(/\d+$/, '').localeCompare(b.race.replace(/\d+$/, '')) || num(a.race) - num(b.race));
    return { state, sources: keys.map((k) => SOURCES.find((s) => s.key === k).name), races: list };
  });

  // ---------- leadership sources ----------
  route('GET', '/api/leaders', () =>
    db.prepare('SELECT * FROM leaders WHERE public=1 ORDER BY name').all().map(leaderOut),
  { auth: false });

  route('POST', '/api/leaders', ({ user, body }) => {
    if (!body.name) throw bad('name required');
    if (!['individual', 'organization', 'list'].includes(body.kind || 'organization')) throw bad('bad kind');
    const r = db
      .prepare('INSERT INTO leaders (owner_id, name, kind, blurb, brand_color, rank_names) VALUES (?,?,?,?,?,?)')
      .run(user.id, body.name, body.kind || 'organization', body.blurb || null,
        body.brandColor || null, body.rankNames ? JSON.stringify(body.rankNames) : null);
    db.prepare(`UPDATE users SET role='leader' WHERE id=?`).run(user.id);
    return leaderOut(db.prepare('SELECT * FROM leaders WHERE id=?').get(Number(r.lastInsertRowid)));
  });

  route('GET', '/api/leaders/mine', ({ user }) =>
    db.prepare('SELECT * FROM leaders WHERE owner_id=?').all(user.id).map(leaderOut));

  route('PATCH', '/api/leaders/:id', ({ user, params, body }) => {
    const l = ownLeader(user, params.id);
    db.prepare('UPDATE leaders SET name=?, blurb=?, brand_color=?, rank_names=? WHERE id=?').run(
      body.name ?? l.name, body.blurb ?? l.blurb, body.brandColor ?? l.brand_color,
      body.rankNames ? JSON.stringify(body.rankNames) : l.rank_names, l.id);
    return leaderOut(db.prepare('SELECT * FROM leaders WHERE id=?').get(l.id));
  });

  route('GET', '/api/leaders/:id/recommendations', ({ params }) =>
    db.prepare(
      `SELECT r.contest_id AS contestId, r.choice_ids AS choiceIds, r.note, c.title, c.election_id AS electionId
       FROM recommendations r JOIN contests c ON c.id=r.contest_id WHERE r.leader_id=?`,
    ).all(Number(params.id)).map((r) => ({ ...r, choiceIds: JSON.parse(r.choiceIds) })),
  { auth: false });

  route('PUT', '/api/leaders/:id/recommendations', ({ user, params, body }) => {
    const l = ownLeader(user, params.id);
    const items = Array.isArray(body) ? body : [body];
    db.tx(() => {
      for (const it of items) {
        const c = db.prepare('SELECT * FROM contests WHERE id=?').get(it.contestId);
        if (!c) throw bad(`unknown contest ${it.contestId}`);
        const ids = it.choiceIds || [];
        if (ids.length > c.vote_for) throw bad(`${c.title}: at most ${c.vote_for} choice(s)`);
        for (const id of ids)
          if (!db.prepare('SELECT 1 FROM choices WHERE id=? AND contest_id=?').get(id, c.id))
            throw bad(`choice ${id} not in ${c.title}`);
        db.prepare(
          `INSERT INTO recommendations (leader_id, contest_id, choice_ids, note) VALUES (?,?,?,?)
           ON CONFLICT(leader_id, contest_id) DO UPDATE SET choice_ids=excluded.choice_ids, note=excluded.note, updated_at=datetime('now')`,
        ).run(l.id, c.id, JSON.stringify(ids), it.note || null);
      }
    });
    return { ok: true, count: items.length };
  });

  route('DELETE', '/api/leaders/:id/recommendations/:contestId', ({ user, params }) => {
    const l = ownLeader(user, params.id);
    db.prepare('DELETE FROM recommendations WHERE leader_id=? AND contest_id=?').run(l.id, params.contestId);
    return { ok: true };
  });

  // ---------- bindings ----------
  const listBindings = (uid) =>
    db.prepare(
      `SELECT b.leader_id AS leaderId, b.priority, b.active, l.name, l.kind, l.brand_color AS brandColor
       FROM bindings b JOIN leaders l ON l.id=b.leader_id WHERE b.user_id=? ORDER BY b.priority`,
    ).all(uid).map((b) => ({ ...b, active: !!b.active }));

  route('GET', '/api/bindings', ({ user }) => listBindings(user.id));

  route('POST', '/api/bindings', ({ user, body }) => {
    const l = db.prepare('SELECT id FROM leaders WHERE id=?').get(Number(body.leaderId));
    if (!l) throw new HttpError(404, 'no such leader');
    const max = db.prepare('SELECT COALESCE(MAX(priority),0) m FROM bindings WHERE user_id=?').get(user.id).m;
    db.prepare(
      `INSERT INTO bindings (user_id, leader_id, priority) VALUES (?,?,?)
       ON CONFLICT(user_id, leader_id) DO UPDATE SET active=1`,
    ).run(user.id, l.id, max + 1);
    return listBindings(user.id);
  });

  // Reorder / toggle: body = [{leaderId, active}] in priority order.
  route('PUT', '/api/bindings', ({ user, body }) => {
    if (!Array.isArray(body)) throw bad('array expected');
    db.tx(() => {
      body.forEach((b, i) => {
        db.prepare('UPDATE bindings SET priority=?, active=? WHERE user_id=? AND leader_id=?')
          .run(i + 1, b.active === false ? 0 : 1, user.id, Number(b.leaderId));
      });
    });
    return listBindings(user.id);
  });

  route('DELETE', '/api/bindings/:leaderId', ({ user, params }) => {
    db.prepare('DELETE FROM bindings WHERE user_id=? AND leader_id=?').run(user.id, Number(params.leaderId));
    return listBindings(user.id);
  });

  // ---------- registration & eligibility ----------
  const getReg = (uid) =>
    db.prepare('SELECT status, party, desired_party AS desiredParty, updated_at AS updatedAt FROM registrations WHERE user_id=?').get(uid) ||
    { status: 'unknown', party: null, desiredParty: null };

  route('GET', '/api/registration', ({ user }) => getReg(user.id));

  route('PUT', '/api/registration', ({ user, body }) => {
    const ok = ['unknown', 'not_registered', 'submitted', 'confirmed'];
    if (body.status && !ok.includes(body.status)) throw bad('bad status');
    const cur = getReg(user.id);
    const status = body.status ?? cur.status;
    db.prepare(
      `INSERT INTO registrations (user_id, status, party, desired_party) VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET status=excluded.status, party=excluded.party,
       desired_party=excluded.desired_party, updated_at=datetime('now')`,
    ).run(user.id, status, body.party ?? cur.party, body.desiredParty ?? cur.desiredParty);
    if (status === 'confirmed')
      db.prepare(`INSERT OR IGNORE INTO participation (user_id, election_id, kind, at) VALUES (?, NULL, 'registered', datetime('now'))`).run(user.id);
    return getReg(user.id);
  });

  route('GET', '/api/eligibility', ({ user }) => {
    const reg = db.prepare('SELECT * FROM registrations WHERE user_id=?').get(user.id);
    const rules = user.jurisdiction_id ? rulesFor(db, user.jurisdiction_id) : { minAge: 18 };
    const els = upcomingElections(user);
    if (!els.length)
      return { rules, elections: [], general: eligibility({ user, registration: reg, election: null, rules, today: today() }) };
    return {
      rules,
      elections: els.map((e) => ({
        election: e,
        ...eligibility({ user, registration: reg, election: e, rules, today: today() }),
      })),
    };
  });

  // ---------- participation (turnout only; never vote choices) ----------
  route('POST', '/api/participation', ({ user, body }) => {
    if (!['planned', 'voted'].includes(body.kind)) throw bad('kind must be planned or voted');
    const e = db.prepare('SELECT * FROM elections WHERE id=?').get(body.electionId);
    if (!e) throw new HttpError(404, 'no such election');
    // Voting opens at early voting, or ~45 days out (mail ballots) if no early-voting date is known.
    const opens = e.early_voting_start || new Date(new Date(e.date + 'T12:00:00Z') - 45 * 86400000).toISOString().slice(0, 10);
    if (body.kind === 'voted' && today() < opens) throw bad(`voting opens ${opens}`);
    if (body.kind === 'voted' && today() > e.date) {
      const late = (new Date(today()) - new Date(e.date)) / 86400000;
      if (late > 7) throw bad('too late to log a vote for this election');
    }
    db.prepare(`INSERT OR IGNORE INTO participation (user_id, election_id, kind, at) VALUES (?,?,?, datetime('now'))`).run(user.id, e.id, body.kind);
    return { ok: true, score: scorecard(db, user.id).points };
  });

  route('GET', '/api/participation', ({ user }) =>
    db.prepare('SELECT election_id AS electionId, kind, at FROM participation WHERE user_id=?').all(user.id));

  // ---------- activism ----------
  route('GET', '/api/actions', ({ user }) => {
    const chain = user.jurisdiction_id ? jurisdictionChain(db, user.jurisdiction_id) : [];
    const rows = db
      .prepare(
        `SELECT a.*, l.name AS leaderName, g.name AS groupName,
           (SELECT 1 FROM activity x WHERE x.action_id=a.id AND x.user_id=?) AS done
         FROM actions a LEFT JOIN leaders l ON l.id=a.leader_id LEFT JOIN groups g ON g.id=a.group_id
         WHERE COALESCE(a.ends_at, a.starts_at) >= datetime('now','-1 day') AND (
           a.leader_id IN (SELECT leader_id FROM bindings WHERE user_id=? AND active=1)
           OR a.group_id IN (SELECT group_id FROM group_members WHERE user_id=?)
           OR a.created_by = ?
           ${chain.length ? `OR (a.leader_id IS NULL AND a.group_id IS NULL AND a.jurisdiction_id IN (${chain.map(() => '?').join(',')}))` : ''}
         ) ORDER BY a.starts_at`,
      )
      .all(user.id, user.id, user.id, user.id, ...chain);
    return rows.map(({ checkin_code, created_by, ...a }) => ({
      ...a,
      done: !!a.done,
      checkinCode: created_by === user.id || (a.leader_id && db.prepare('SELECT 1 FROM leaders WHERE id=? AND owner_id=?').get(a.leader_id, user.id)) ? checkin_code : undefined,
    }));
  });

  route('POST', '/api/actions', ({ user, body }) => {
    if (!ACTIVITY[body.kind]) throw bad('unknown kind');
    if (!body.title || !body.startsAt) throw bad('title and startsAt required');
    if (body.leaderId) ownLeader(user, body.leaderId);
    if (body.groupId && !db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(Number(body.groupId), user.id))
      throw new HttpError(403, 'not in that group');
    const r = db
      .prepare(
        `INSERT INTO actions (leader_id, group_id, jurisdiction_id, kind, title, description, location, starts_at, ends_at, checkin_code, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(body.leaderId ? Number(body.leaderId) : null, body.groupId ? Number(body.groupId) : null,
        body.jurisdictionId || user.jurisdiction_id || null, body.kind, body.title, body.description || null,
        body.location || null, body.startsAt, body.endsAt || null, code(), user.id);
    return db.prepare('SELECT * FROM actions WHERE id=?').get(Number(r.lastInsertRowid));
  });

  route('POST', '/api/actions/:id/checkin', ({ user, params, body }) => {
    const a = db.prepare('SELECT * FROM actions WHERE id=?').get(Number(params.id));
    if (!a) throw new HttpError(404, 'no such event');
    const verified = body.code ? String(body.code).trim().toUpperCase() === a.checkin_code : false;
    if (body.code && !verified) throw bad('wrong check-in code');
    if (db.prepare('SELECT 1 FROM activity WHERE user_id=? AND action_id=?').get(user.id, a.id))
      throw new HttpError(409, 'already logged');
    const qty = Math.max(1, Math.min(1000, Number(body.quantity) || 1));
    const already = db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM activity WHERE user_id=? AND kind=? AND day=?`).get(user.id, a.kind, today()).q;
    const perUnit = ACTIVITY[a.kind].perUnit || 0;
    const pts = activityPoints(a.kind, qty, verified, already * perUnit);
    const ins = db.prepare(`INSERT INTO activity (user_id, action_id, kind, quantity, verified, points, day, at) VALUES (?,?,?,?,?,?,?, datetime('now'))`)
      .run(user.id, a.id, a.kind, qty, verified ? 1 : 0, pts, today());
    const lucky = verified ? luckyBonus(db, user.id, ins.lastInsertRowid) : 0;
    return { ok: true, points: pts, verified, lucky };
  });

  // Self-logged activism with no event (e.g., posted on social media, knocked doors solo).
  route('POST', '/api/activity', ({ user, body }) => {
    if (!ACTIVITY[body.kind]) throw bad('unknown kind');
    const qty = Math.max(1, Math.min(1000, Number(body.quantity) || 1));
    const already = db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM activity WHERE user_id=? AND kind=? AND day=?`).get(user.id, body.kind, today()).q;
    const perUnit = ACTIVITY[body.kind].perUnit || 0;
    const pts = activityPoints(body.kind, qty, false, already * perUnit);
    db.prepare(`INSERT INTO activity (user_id, kind, quantity, note, points, day, at) VALUES (?,?,?,?,?,?, datetime('now'))`)
      .run(user.id, body.kind, qty, body.note ? String(body.note).slice(0, 280) : null, pts, today());
    return { ok: true, points: pts };
  });

  route('GET', '/api/activity', ({ user }) =>
    db.prepare(
      `SELECT a.id, a.kind, a.quantity, a.verified, a.note, a.points, a.at, x.title
       FROM activity a LEFT JOIN actions x ON x.id=a.action_id WHERE a.user_id=? ORDER BY a.at DESC LIMIT 100`,
    ).all(user.id));

  route('POST', '/api/endorse', ({ user, body }) => {
    const l = db.prepare('SELECT id FROM leaders WHERE id=?').get(Number(body.leaderId));
    if (!l) throw new HttpError(404, 'no such leader');
    if (body.remove) db.prepare('DELETE FROM endorsements WHERE user_id=? AND leader_id=?').run(user.id, l.id);
    else db.prepare(`INSERT OR IGNORE INTO endorsements (user_id, leader_id, at) VALUES (?,?, datetime('now'))`).run(user.id, l.id);
    return db.prepare('SELECT leader_id AS leaderId FROM endorsements WHERE user_id=?').all(user.id);
  });

  route('GET', '/api/endorse', ({ user }) =>
    db.prepare('SELECT leader_id AS leaderId FROM endorsements WHERE user_id=?').all(user.id));

  // ---------- recognition ----------
  route('GET', '/api/recognition', ({ user }) => {
    const s = scorecard(db, user.id);
    let names = null;
    if (user.theme?.startsWith('leader:')) {
      const l = db.prepare('SELECT rank_names FROM leaders WHERE id=?').get(Number(user.theme.slice(7)));
      names = l?.rank_names ? JSON.parse(l.rank_names) : null;
    }
    return { ...s, rank: rankFor(s.points, names) };
  });

  route('GET', '/api/leaderboard', ({ user, query }) => {
    const scope = query.get('scope') || 'friends';
    const week = query.get('period') === 'week';
    let ids;
    let title;
    if (scope === 'friends') {
      ids = db.prepare(
        `SELECT CASE WHEN a=?1 THEN b ELSE a END AS id FROM friendships WHERE status='accepted' AND (a=?1 OR b=?1)`,
      ).all(user.id).map((r) => r.id);
      ids.push(user.id);
      title = 'Friends';
    } else if (scope.startsWith('group:')) {
      const gid = Number(scope.slice(6));
      if (!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, user.id))
        throw new HttpError(403, 'not in that group');
      ids = db.prepare('SELECT user_id AS id FROM group_members WHERE group_id=?').all(gid).map((r) => r.id);
      title = db.prepare('SELECT name FROM groups WHERE id=?').get(gid).name;
    } else if (scope.startsWith('leader:')) {
      const lid = Number(scope.slice(7));
      ids = db.prepare('SELECT user_id AS id FROM bindings WHERE leader_id=? AND active=1').all(lid).map((r) => r.id);
      title = db.prepare('SELECT name FROM leaders WHERE id=?').get(lid)?.name || 'Leader';
    } else throw bad('bad scope');
    // Only people who opted in appear (you always see yourself).
    const rows = [...new Set(ids)]
      .map((id) => db.prepare('SELECT id, name, on_leaderboards FROM users WHERE id=?').get(id))
      .filter((u) => u && (u.on_leaderboards || u.id === user.id))
      .map((u) => {
        const s = scorecard(db, u.id);
        const points = week ? pointsSince(db, u.id, weekStart()) : s.points;
        return { userId: u.id, name: u.name, points, total: s.points, rank: rankFor(s.points).name, badges: s.badges.length, me: u.id === user.id };
      })
      .sort((a, b) => b.points - a.points);
    rows.forEach((r, i) => (r.place = i + 1));
    return { title, period: week ? 'week' : 'all', rows };
  });

  // ---------- groups ----------
  route('GET', '/api/groups', ({ user }) =>
    db.prepare(
      `SELECT g.id, g.name, g.kind, g.leader_id AS leaderId, g.invite_code AS inviteCode, g.owner_id=?1 AS owner,
         (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id) AS members
       FROM groups g JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=?1 ORDER BY g.name`,
    ).all(user.id));

  route('POST', '/api/groups', ({ user, body }) => {
    if (!body.name) throw bad('name required');
    if (!['team', 'neighborhood', 'chapter'].includes(body.kind || 'team')) throw bad('bad kind');
    if (body.leaderId) ownLeader(user, body.leaderId);
    const r = db
      .prepare('INSERT INTO groups (name, kind, leader_id, invite_code, owner_id) VALUES (?,?,?,?,?)')
      .run(body.name, body.kind || 'team', body.leaderId ? Number(body.leaderId) : null, code(8), user.id);
    const gid = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?,?)').run(gid, user.id);
    return db.prepare('SELECT id, name, kind, invite_code AS inviteCode FROM groups WHERE id=?').get(gid);
  });

  route('POST', '/api/groups/join', ({ user, body }) => {
    const g = db.prepare('SELECT * FROM groups WHERE invite_code=?').get(String(body.code || '').trim().toUpperCase());
    if (!g) throw new HttpError(404, 'no group with that code');
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)').run(g.id, user.id);
    return { id: g.id, name: g.name };
  });

  route('DELETE', '/api/groups/:id/membership', ({ user, params }) => {
    db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(Number(params.id), user.id);
    return { ok: true };
  });

  // ---------- friends & nudges ----------
  route('GET', '/api/friends', ({ user }) => {
    const rows = db.prepare('SELECT * FROM friendships WHERE a=?1 OR b=?1').all(user.id);
    const els = upcomingElections(user);
    const next = els[0];
    return rows.map((f) => {
      const other = f.a === user.id ? f.b : f.a;
      const u = db.prepare('SELECT id, name, share_status FROM users WHERE id=?').get(other);
      let status;
      if (f.status === 'accepted' && u.share_status && next) {
        const p = db.prepare('SELECT kind FROM participation WHERE user_id=? AND election_id=?').all(u.id, next.id).map((r) => r.kind);
        status = p.includes('voted') ? 'voted' : p.includes('planned') ? 'planned' : 'not_yet';
      }
      return {
        userId: u.id, name: u.name,
        state: f.status === 'accepted' ? 'friends' : f.a === user.id ? 'requested' : 'incoming',
        status, electionId: next?.id,
        remindedToday: !!(next && db.prepare(`SELECT 1 FROM nudges WHERE from_id=? AND to_id=? AND election_id=? AND at > datetime('now','-1 day')`).get(user.id, u.id, next.id)),
      };
    });
  });

  route('POST', '/api/friends', ({ user, body }) => {
    const u = db.prepare('SELECT id FROM users WHERE email=?').get(String(body.email || '').toLowerCase());
    if (!u) throw new HttpError(404, 'no user with that email');
    if (u.id === user.id) throw bad('that is you');
    const reverse = db.prepare('SELECT * FROM friendships WHERE a=? AND b=?').get(u.id, user.id);
    if (reverse) db.prepare(`UPDATE friendships SET status='accepted' WHERE a=? AND b=?`).run(u.id, user.id);
    else db.prepare('INSERT OR IGNORE INTO friendships (a, b) VALUES (?,?)').run(user.id, u.id);
    return { ok: true };
  });

  route('POST', '/api/friends/:id/accept', ({ user, params }) => {
    const r = db.prepare(`UPDATE friendships SET status='accepted' WHERE a=? AND b=?`).run(Number(params.id), user.id);
    if (!r.changes) throw new HttpError(404, 'no pending request');
    return { ok: true };
  });

  route('DELETE', '/api/friends/:id', ({ user, params }) => {
    const o = Number(params.id);
    db.prepare('DELETE FROM friendships WHERE (a=? AND b=?) OR (a=? AND b=?)').run(user.id, o, o, user.id);
    return { ok: true };
  });

  route('POST', '/api/friends/:id/nudge', ({ user, params, body }) => {
    const o = Number(params.id);
    if (!isFriend(user.id, o)) throw new HttpError(403, 'not friends');
    const e = db.prepare('SELECT id FROM elections WHERE id=?').get(body.electionId);
    if (!e) throw new HttpError(404, 'no such election');
    const recent = db.prepare(`SELECT 1 FROM nudges WHERE from_id=? AND to_id=? AND election_id=? AND at > datetime('now','-1 day')`).get(user.id, o, e.id);
    if (recent) throw new HttpError(429, 'you already nudged them today');
    db.prepare(`INSERT INTO nudges (from_id, to_id, election_id, at) VALUES (?,?,?, datetime('now'))`).run(user.id, o, e.id);
    return { ok: true };
  });

  // ---------- notifications (computed; app is dormant otherwise) ----------
  route('GET', '/api/notifications', ({ user }) => {
    const out = [];
    const t = today();
    const days = (d) => Math.round((new Date(d) - new Date(t)) / 86400000);
    for (const e of upcomingElections(user)) {
      const n = days(e.date);
      if (n <= 30) out.push({ kind: 'election', electionId: e.id, urgent: n <= 3, text: n === 0 ? `Today: ${e.name}` : `${e.name} in ${n} day${n === 1 ? '' : 's'}` });
      if (e.registration_deadline && days(e.registration_deadline) >= 0 && days(e.registration_deadline) <= 14)
        out.push({ kind: 'deadline', electionId: e.id, urgent: true, text: `Registration deadline for ${e.name}: ${e.registration_deadline}` });
      if (e.early_voting_start && days(e.early_voting_start) >= 0 && days(e.early_voting_start) <= 7)
        out.push({ kind: 'early', electionId: e.id, text: `Early voting for ${e.name} starts ${e.early_voting_start}` });
    }
    const reg = getReg(user.id);
    if (reg.status !== 'confirmed') out.push({ kind: 'registration', urgent: false, text: 'Confirm your voter registration.' });
    const nudges = db.prepare(
      `SELECT n.id, u.name, e.name AS election FROM nudges n JOIN users u ON u.id=n.from_id
       JOIN elections e ON e.id=n.election_id WHERE n.to_id=? AND n.seen=0`,
    ).all(user.id);
    for (const nu of nudges) out.push({ kind: 'nudge', id: nu.id, text: `${nu.name} reminded you to vote in ${nu.election}` });
    db.prepare('UPDATE nudges SET seen=1 WHERE to_id=?').run(user.id);
    const pending = db.prepare(`SELECT COUNT(*) n FROM friendships WHERE b=? AND status='pending'`).get(user.id).n;
    if (pending) out.push({ kind: 'friend', text: `${pending} friend request${pending > 1 ? 's' : ''}` });
    const soon = db.prepare(
      `SELECT COUNT(*) n FROM actions WHERE starts_at BETWEEN datetime('now') AND datetime('now','+2 days')
       AND (leader_id IN (SELECT leader_id FROM bindings WHERE user_id=? AND active=1) OR group_id IN (SELECT group_id FROM group_members WHERE user_id=?))`,
    ).get(user.id, user.id).n;
    if (soon) out.push({ kind: 'actions', text: `${soon} event${soon > 1 ? 's' : ''} in the next 2 days` });
    return out;
  });

  // ---------- election-data ingestion (admin) ----------
  route('POST', '/api/admin/ingest', ({ body }) => ({ ok: true, ...ingest(db, body) }), { auth: 'admin' });

  route('POST', '/api/admin/results', ({ body }) => {
    db.tx(() => {
      for (const r of body)
        db.prepare('INSERT OR REPLACE INTO results (contest_id, winner_ids) VALUES (?,?)').run(r.contestId, JSON.stringify(r.winnerIds));
    });
    return { ok: true };
  }, { auth: 'admin' });

  engagementRoutes(route, { db, HttpError, bad, upcomingElections, today });

  if (seed) {
    route('POST', '/api/admin/reseed', async () => {
      await seed(db, { force: true });
      return { ok: true };
    }, { auth: 'admin' });
  }

  // ---------- dispatcher: Request -> Response ----------
  const json = (status, obj) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
    });

  return async function handle(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'not found');
      const m = url.pathname.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const raw = await req.text();
        if (raw.length > 2e6) throw new HttpError(413, 'body too large');
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw bad('invalid JSON');
        }
      }
      const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
      let user = null;
      if (r.auth === 'admin') {
        if (!adminToken || token !== adminToken) throw new HttpError(401, 'admin token required');
      } else if (r.auth) {
        user = db.prepare(
          `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > ?`,
        ).get(token, new Date().toISOString());
        if (!user) throw new HttpError(401, 'sign in required');
      }
      return json(200, await r.handler({ req, user, token, params, body, query: url.searchParams }));
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      if (String(e.message).includes('constraint')) return json(400, { error: e.message });
      console.error(e);
      return json(500, { error: 'server error' });
    }
  };
}

/** Load jurisdictions, polling places, elections, contests, choices. Idempotent upsert. */
export function ingest(db, data) {
  const n = { jurisdictions: 0, pollingPlaces: 0, elections: 0, contests: 0, choices: 0 };
  db.tx(() => {
    for (const j of data.jurisdictions || []) {
      db.prepare(
        `INSERT INTO jurisdictions (id, name, parent_id, rules) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_id=excluded.parent_id, rules=excluded.rules`,
      ).run(j.id, j.name, j.parentId || null, JSON.stringify(j.rules || {}));
      n.jurisdictions++;
    }
    for (const p of data.pollingPlaces || []) {
      db.prepare('DELETE FROM polling_places WHERE jurisdiction_id=? AND name=?').run(p.jurisdictionId, p.name);
      db.prepare(
        'INSERT INTO polling_places (jurisdiction_id, precinct, kind, name, address, lat, lng, hours) VALUES (?,?,?,?,?,?,?,?)',
      ).run(p.jurisdictionId, p.precinct || null, p.kind, p.name, p.address, p.lat ?? null, p.lng ?? null, p.hours || null);
      n.pollingPlaces++;
    }
    for (const e of data.elections || []) {
      db.prepare(
        `INSERT INTO elections (id, name, date, kind, jurisdiction_id, registration_deadline, early_voting_start, mail_ballot_deadline)
         VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, date=excluded.date, kind=excluded.kind,
         jurisdiction_id=excluded.jurisdiction_id, registration_deadline=excluded.registration_deadline,
         early_voting_start=excluded.early_voting_start, mail_ballot_deadline=excluded.mail_ballot_deadline`,
      ).run(e.id, e.name, e.date, e.kind || 'general', e.jurisdictionId, e.registrationDeadline || null,
        e.earlyVotingStart || null, e.mailBallotDeadline || null);
      n.elections++;
      (e.contests || []).forEach((c, ci) => {
        db.prepare(
          `INSERT INTO contests (id, election_id, jurisdiction_id, title, kind, vote_for, description, sort) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, kind=excluded.kind, vote_for=excluded.vote_for,
           description=excluded.description, sort=excluded.sort, jurisdiction_id=excluded.jurisdiction_id`,
        ).run(c.id, e.id, c.jurisdictionId || e.jurisdictionId, c.title, c.kind || 'candidate', c.voteFor || 1, c.description || null, ci);
        n.contests++;
        (c.choices || []).forEach((ch, i) => {
          db.prepare(
            `INSERT INTO choices (id, contest_id, label, party, sort) VALUES (?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET label=excluded.label, party=excluded.party, sort=excluded.sort`,
          ).run(ch.id, c.id, ch.label, ch.party || null, i);
          n.choices++;
        });
      });
    }
  });
  return n;
}
