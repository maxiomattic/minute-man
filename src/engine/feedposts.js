// Feed posts: your own updates (text and one photo) and a note or photo on something you did.
//
// Ground rules:
//   - Same visibility as the feed (src/engine/community.js). A free-form post is seen by friends and
//     group-mates, and by everyone else only if its author is on leaderboards (as first name, last
//     initial and town). A note on an activity follows that activity's rule.
//   - Posts earn no points, so they can't be farmed. A photo on an activity adds no points either.
//   - Photos are resized and re-encoded on the phone (which drops EXIF and GPS); the server checks
//     the type and size and strips any metadata segments again before storing.
//   - Images are served at unguessable URLs (128 random bits). Deleting a post or an account deletes them.
//   - Reporting a post hides it for you and flags it for the admin.

export const POST_MAX = 500;
export const DAILY_POSTS = 10;
export const IMAGE_MAX = 600 * 1024;
const KEY_RE = /^[A-Za-z0-9_-]{22}\.(webp|jpg)$/;

const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------- image checks ----------
/** The real type from the first bytes, or null. Only JPEG and WebP are accepted. */
export function sniffImage(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const s = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length > 16 && s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/** Drop metadata (EXIF, XMP, comments) so a photo can't leak where it was taken. */
export function stripMeta(b, type) {
  if (type === 'image/jpeg') {
    const out = [b.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const m = b[i + 1];
      if (m === 0xda) break; // start of scan: the rest is image data
      const len = (b[i + 2] << 8) | b[i + 3];
      // APP1..APP15 (EXIF, XMP, ICC, maker notes) and COM go; APP0 (JFIF) and the image tables stay.
      if (!((m >= 0xe1 && m <= 0xef) || m === 0xfe)) out.push(b.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    out.push(b.subarray(i));
    const r = new Uint8Array(out.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of out) { r.set(x, o); o += x.length; }
    return r;
  }
  if (type === 'image/webp') {
    const chunks = [];
    let i = 12;
    while (i + 8 <= b.length) {
      const id = String.fromCharCode(...b.subarray(i, i + 4));
      const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
      const end = Math.min(b.length, i + 8 + len + (len & 1));
      if (id !== 'EXIF' && id !== 'XMP ') {
        const c = b.slice(i, end);
        if (id === 'VP8X') c[8] &= ~0x0c; // clear the EXIF and XMP flags
        chunks.push(c);
      }
      i = end;
    }
    const size = chunks.reduce((n, c) => n + c.length, 0);
    const r = new Uint8Array(12 + size);
    r.set(b.subarray(0, 12));
    const riff = size + 4;
    r[4] = riff & 255; r[5] = (riff >> 8) & 255; r[6] = (riff >> 16) & 255; r[7] = (riff >>> 24) & 255;
    let o = 12;
    for (const c of chunks) { r.set(c, o); o += c.length; }
    return r;
  }
  return b;
}

// ---------- storage ----------
/** Fallback image store in SQLite (tests, and the Worker if no R2 bucket is bound). */
export function sqliteMedia(db) {
  db.exec('CREATE TABLE IF NOT EXISTS media_blobs (key TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL)');
  return {
    put: async (key, bytes, type) => { db.prepare('INSERT OR REPLACE INTO media_blobs (key, type, data) VALUES (?,?,?)').run(key, type, bytes); },
    get: async (key) => {
      const r = db.prepare('SELECT type, data FROM media_blobs WHERE key=?').get(key);
      return r ? { type: r.type, body: new Uint8Array(r.data) } : null;
    },
    delete: async (key) => { db.prepare('DELETE FROM media_blobs WHERE key=?').run(key); },
  };
}

/** Cloudflare R2 bucket. */
export function r2Media(bucket) {
  return {
    put: (key, bytes, type) => bucket.put(key, bytes, { httpMetadata: { contentType: type } }),
    get: async (key) => {
      const o = await bucket.get(key);
      return o ? { type: o.httpMetadata?.contentType || 'application/octet-stream', body: o.body } : null;
    },
    delete: (key) => bucket.delete(key),
  };
}

/** Remove every post and image a user made. Call before deleting the account. */
export async function deleteUserPosts(db, media, userId) {
  const keys = db.prepare('SELECT image FROM posts WHERE user_id=? AND image IS NOT NULL').all(userId).map((r) => r.image);
  db.prepare('DELETE FROM posts WHERE user_id=?').run(userId);
  for (const k of keys) await media.delete(k).catch(() => {});
}

// ---------- routes ----------
export function postRoutes(route, { db, HttpError, bad, media, today }) {
  const cleanBody = (v) => {
    const s = String(v ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (s.length > POST_MAX) throw bad(`Keep it under ${POST_MAX} characters`);
    return s || null;
  };
  const checkRate = (userId) => {
    const n = db.prepare('SELECT n FROM post_counts WHERE user_id=? AND day=?').get(userId, today())?.n || 0;
    if (n >= DAILY_POSTS) throw new HttpError(429, `that's ${DAILY_POSTS} posts today. Try again tomorrow`);
  };
  const countPost = (userId) => db.prepare('INSERT INTO post_counts (user_id, day, n) VALUES (?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET n=n+1').run(userId, today());
  /** Decode, check and store an uploaded image. Returns { key, w, h } or null. */
  const saveImage = async (img) => {
    if (!img) return null;
    const data = String(img.data || '').replace(/^data:[^,]*,/, '');
    if (data.length > Math.ceil(IMAGE_MAX / 3) * 4 + 4) throw new HttpError(413, 'that photo is too big');
    let bytes;
    try { bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)); } catch { throw bad('that photo could not be read'); }
    const type = sniffImage(bytes);
    if (!type) throw bad('photos must be JPEG or WebP');
    if (bytes.length > IMAGE_MAX) throw new HttpError(413, 'that photo is too big');
    const key = `${b64url(crypto.getRandomValues(new Uint8Array(16)))}.${type === 'image/webp' ? 'webp' : 'jpg'}`;
    await media.put(key, stripMeta(bytes, type), type);
    const dim = (v) => Math.max(1, Math.min(4096, Math.round(Number(v) || 0))) || null;
    return { key, w: dim(img.w), h: dim(img.h) };
  };
  const view = (p) => p && { id: p.id, body: p.body, image: p.image ? `/api/media/${p.image}` : null, imageW: p.image_w, imageH: p.image_h };
  const dropImage = (key) => key && media.delete(key).catch(() => {});

  // A post of your own.
  route('POST', '/api/feed/posts', async ({ user, body }) => {
    const text = cleanBody(body.body);
    if (!text && !body.image) throw bad('Write something or add a photo');
    checkRate(user.id);
    const img = await saveImage(body.image);
    const id = db.prepare(`INSERT INTO posts (user_id, body, image, image_w, image_h, day, at) VALUES (?,?,?,?,?,?, datetime('now'))`)
      .run(user.id, text, img?.key || null, img?.w || null, img?.h || null, today()).lastInsertRowid;
    countPost(user.id);
    return { ok: true, key: `u:${id}`, post: view(db.prepare('SELECT * FROM posts WHERE id=?').get(id)) };
  });

  // A note and/or photo on something you did. Empty note and no photo removes it.
  route('PUT', '/api/activity/:id/post', async ({ user, params, body }) => {
    const a = db.prepare('SELECT id FROM activity WHERE id=? AND user_id=?').get(Number(params.id), user.id);
    if (!a) throw new HttpError(404, 'no such activity');
    const old = db.prepare('SELECT * FROM posts WHERE activity_id=?').get(a.id);
    const text = cleanBody(body.body);
    if (!old) checkRate(user.id);
    const img = await saveImage(body.image);
    const keep = !img && !body.removeImage && old?.image ? { key: old.image, w: old.image_w, h: old.image_h } : null;
    const next = img || keep;
    if (old?.image && old.image !== next?.key) await dropImage(old.image);
    if (!text && !next) {
      if (old) db.prepare('DELETE FROM posts WHERE id=?').run(old.id);
      return { ok: true, post: null };
    }
    if (old) db.prepare(`UPDATE posts SET body=?, image=?, image_w=?, image_h=?, edited_at=datetime('now') WHERE id=?`).run(text, next?.key || null, next?.w || null, next?.h || null, old.id);
    else {
      db.prepare(`INSERT INTO posts (user_id, activity_id, body, image, image_w, image_h, day, at) VALUES (?,?,?,?,?,?,?, datetime('now'))`)
        .run(user.id, a.id, text, next?.key || null, next?.w || null, next?.h || null, today());
      countPost(user.id);
    }
    return { ok: true, post: view(db.prepare('SELECT * FROM posts WHERE activity_id=?').get(a.id)) };
  });

  // Delete your own post (or the note and photo on your activity).
  route('DELETE', '/api/feed/posts/:id', async ({ user, params }) => {
    const p = db.prepare('SELECT * FROM posts WHERE id=? AND user_id=?').get(Number(params.id), user.id);
    if (!p) throw new HttpError(404, 'no such post');
    db.prepare('DELETE FROM posts WHERE id=?').run(p.id);
    await dropImage(p.image);
    return { ok: true };
  });

  // Report: hides the item for you and flags any words or photo on it.
  route('POST', '/api/feed/report', ({ user, body }) => {
    const item = String(body.item || '');
    const m = item.match(/^(u|a):(\d+)$/);
    if (!m) throw bad('pick a post to report');
    const p = m[1] === 'u'
      ? db.prepare('SELECT id, user_id FROM posts WHERE id=?').get(Number(m[2]))
      : db.prepare('SELECT p.id, a.user_id FROM activity a LEFT JOIN posts p ON p.activity_id=a.id WHERE a.id=?').get(Number(m[2]));
    if (!p) throw new HttpError(404, 'no such post');
    if (p.user_id === user.id) throw bad("you can't report your own post");
    db.prepare(`INSERT OR IGNORE INTO post_reports (user_id, item, post_id, reason, at) VALUES (?,?,?,?, datetime('now'))`)
      .run(user.id, item, p.id || null, body.reason ? String(body.reason).slice(0, 200) : null);
    return { ok: true };
  });

  // Images: unguessable URL, only while the post exists.
  route('GET', '/api/media/:key', async ({ params }) => {
    if (!KEY_RE.test(params.key) || !db.prepare('SELECT 1 FROM posts WHERE image=?').get(params.key)) throw new HttpError(404, 'not found');
    const o = await media.get(params.key);
    if (!o) throw new HttpError(404, 'not found');
    return new Response(o.body, {
      headers: {
        'content-type': o.type, 'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
        'access-control-allow-origin': '*',
      },
    });
  }, { auth: false });

  // Moderation: list flagged posts and remove one. Admin token only.
  route('GET', '/api/admin/reports', () => db.prepare(
    `SELECT p.id, p.user_id userId, u.name, u.email, p.activity_id activityId, p.body, p.image, p.at, COUNT(r.user_id) reports,
       GROUP_CONCAT(r.reason, ' | ') reasons
     FROM post_reports r JOIN posts p ON p.id=r.post_id JOIN users u ON u.id=p.user_id
     GROUP BY p.id ORDER BY reports DESC, p.at DESC LIMIT 200`,
  ).all().map((r) => ({ ...r, image: r.image ? `/api/media/${r.image}` : null })), { auth: 'admin' });

  route('DELETE', '/api/admin/posts/:id', async ({ params }) => {
    const p = db.prepare('SELECT * FROM posts WHERE id=?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'no such post');
    db.prepare('DELETE FROM posts WHERE id=?').run(p.id);
    await dropImage(p.image);
    return { ok: true };
  }, { auth: 'admin' });
}
