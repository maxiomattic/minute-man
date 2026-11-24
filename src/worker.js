// Cloudflare entry: static web app from Workers Assets, /api/* forwarded to one
// SQLite-backed Durable Object that owns the database.
import { DurableObject } from 'cloudflare:workers';
import { durableDb } from './db.js';
import { createApp } from './app.js';
import { r2Media, sqliteMedia } from './engine/feedposts.js';
import { seed } from './seed.js';
import { configureClock } from './time.js';

export class CvasDb extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    configureClock({ zone: env.CVAS_ZONE || 'America/Chicago', demoDate: env.CVAS_DEMO_DATE || null });
    this.db = durableDb(ctx.storage);
    // Feed photos go to R2 (binding MEDIA). The DO reads and writes them itself, so uploads (base64 JSON)
    // and image GETs pass through the Worker unchanged. Without the binding, small blobs live in SQLite.
    const media = env.MEDIA ? r2Media(env.MEDIA) : sqliteMedia(this.db);
    this.handle = createApp(this.db, { adminToken: env.CVAS_ADMIN_TOKEN, seed, media });
    ctx.blockConcurrencyWhile(async () => {
      const n = this.db.prepare('SELECT COUNT(*) n FROM users').get().n;
      // Always refresh reference data (jurisdictions, rules, sources); sample people only on an empty database.
      await seed(this.db, { force: !n });
    });
  }
  fetch(request) {
    return this.handle(request);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const stub = env.CVAS_DB.get(env.CVAS_DB.idFromName('tx2026'));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
