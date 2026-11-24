// Replies: people talking about a feed item, in words and optionally one photo.
//
// Ground rules (same as posts, src/engine/feedposts.js):
//   - You can reply to anything you can see in your feed. Whether someone voted, planned or registered
//     is only shown to friends and group-mates, so only they can reply to it.
//   - Repliers show with their Ladder rank. Strangers see a first name, last initial and town.
//   - Replies earn no points. 50 a day (deleting one doesn't give the slot back).
//   - Photos go through the same pipeline as posts (checked, metadata stripped, unguessable URL).
//   - Report hides a reply for you and flags it for the admin. Deleting the item, the reply or the
//     account deletes the reply and its photo.
import { LADDER } from './ladder.js';
import { crewIds } from './engage.js';

export const DAILY_REPLIES = 50;
export const THREAD_PREVIEW = 2;

const short = (name) => {
  const p = String(name || '').trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
};

/** Who owns a feed item, if this user can see it; otherwise null. */
export function itemOwner(db, user, key) {
  const m = String(key || '').match(/^(u|a|b|p):(\d+)(?::(.+))?$/);
  if (!m) return null;
  const id = Number(m[2]);
  if (m[1] === 'u') return db.prepare('SELECT user_id FROM posts WHERE id=? AND activity_id IS NULL').get(id)?.user_id ?? null;
  if (m[1] === 'a') return db.prepare('SELECT user_id FROM activity WHERE id=?').get(id)?.user_id ?? null;
  if (m[1] === 'b') return db.prepare('SELECT user_id FROM bonuses WHERE user_id=? AND source=?').get(id, m[3] || '')?.user_id ?? null;
  // p:<user>:<election>:<kind>: voting status, friends and group-mates only.
  const [election, kind] = String(m[3] || '').split(/:(?=[^:]+$)/);
  if (!db.prepare('SELECT 1 FROM participation WHERE user_id=? AND election_id IS ? AND kind=?').get(id, election === 'null' ? null : election, kind)) return null;
  return id === user.id || crewIds(db, user.id).includes(id) ? id : null;
}

/** A reply as the viewer may see it. crew is a Set of the viewer's friends and group-mates. */
function view(r, viewer, crew) {
  const mine = r.user_id === viewer.id;
  return {
    id: r.id, key: `r:${r.id}`, item: r.item, userId: r.user_id, mine,
    name: mine || crew.has(r.user_id) ? r.name : short(r.name),
    rank: LADDER[(r.rung || 1) - 1]?.name || null,
    place: r.home_label || null,
    body: r.body || null,
    image: r.image ? `/api/media/${r.image}` : null, imageW: r.image_w, imageH: r.image_h,
    at: r.at,
  };
}

const COLS = 'r.id, r.user_id, r.item, r.body, r.image, r.image_w, r.image_h, r.at, u.name, u.rung, u.home_label';
const NOT_HIDDEN = `NOT EXISTS (SELECT 1 FROM post_reports x WHERE x.user_id=? AND x.item='r:' || r.id)`;

/** Reply counts and the latest few replies for a page of feed items (adds replyCount and replies). */
export function addThreads(db, viewer, items, crew) {
  const count = db.prepare(`SELECT COUNT(*) n FROM replies r WHERE r.item=? AND ${NOT_HIDDEN}`);
  const latest = db.prepare(`SELECT ${COLS} FROM replies r JOIN users u ON u.id=r.user_id
    WHERE r.item=? AND ${NOT_HIDDEN} ORDER BY r.at DESC, r.id DESC LIMIT ${THREAD_PREVIEW}`);
  for (const it of items) {
    it.replyCount = count.get(it.key, viewer.id).n;
    it.replies = it.replyCount ? latest.all(it.key, viewer.id).reverse().map((r) => view(r, viewer, crew)) : [];
  }
}

/** Remove replies (and their photos). where is a SQL condition on replies r. */
export async function dropReplies(db, media, where, ...args) {
  const rows = db.prepare(`SELECT r.id, r.image FROM replies r WHERE ${where}`).all(...args);
  for (const r of rows) db.prepare('DELETE FROM replies WHERE id=?').run(r.id);
  for (const r of rows) if (r.image) await media.delete(r.image).catch(() => {});
  return rows.length;
}

export function replyRoutes(route, { db, HttpError, bad, today, cleanBody, saveImage, media }) {
  const one = (id, viewer) => {
    const r = db.prepare(`SELECT ${COLS} FROM replies r JOIN users u ON u.id=r.user_id WHERE r.id=?`).get(id);
    return r && view(r, viewer, new Set(crewIds(db, viewer.id)));
  };

  // The whole thread on one item, oldest first.
  route('GET', '/api/feed/replies', ({ user, query }) => {
    const item = String(query.get('item') || '');
    if (itemOwner(db, user, item) === null) throw new HttpError(404, 'no such post');
    const crew = new Set(crewIds(db, user.id));
    const rows = db.prepare(`SELECT ${COLS} FROM replies r JOIN users u ON u.id=r.user_id
      WHERE r.item=? AND ${NOT_HIDDEN} ORDER BY r.at, r.id LIMIT 500`).all(item, user.id);
    return { item, replies: rows.map((r) => view(r, user, crew)) };
  });

  route('POST', '/api/feed/replies', async ({ user, body }) => {
    const item = String(body.item || '');
    const owner = itemOwner(db, user, item);
    if (owner === null) throw new HttpError(404, 'no such post');
    const text = cleanBody(body.body);
    if (!text && !body.image) throw bad('Write something or add a photo');
    const n = db.prepare('SELECT n FROM reply_counts WHERE user_id=? AND day=?').get(user.id, today())?.n || 0;
    if (n >= DAILY_REPLIES) throw new HttpError(429, `that's ${DAILY_REPLIES} replies today. Try again tomorrow`);
    const img = await saveImage(body.image);
    const id = db.prepare(`INSERT INTO replies (user_id, item, owner_id, body, image, image_w, image_h, day, at) VALUES (?,?,?,?,?,?,?,?, datetime('now'))`)
      .run(user.id, item, owner, text, img?.key || null, img?.w || null, img?.h || null, today()).lastInsertRowid;
    db.prepare('INSERT INTO reply_counts (user_id, day, n) VALUES (?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET n=n+1').run(user.id, today());
    return { ok: true, reply: one(Number(id), user) };
  });

  // Delete your own reply.
  route('DELETE', '/api/feed/replies/:id', async ({ user, params }) => {
    if (!(await dropReplies(db, media, 'r.id=? AND r.user_id=?', Number(params.id), user.id))) throw new HttpError(404, 'no such reply');
    return { ok: true };
  });

  route('DELETE', '/api/admin/replies/:id', async ({ params }) => {
    if (!(await dropReplies(db, media, 'r.id=?', Number(params.id)))) throw new HttpError(404, 'no such reply');
    return { ok: true };
  }, { auth: 'admin' });
}
