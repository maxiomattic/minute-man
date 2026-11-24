// Cloudflare entry: static web app from Workers Assets, /api/* forwarded to one
// SQLite-backed Durable Object that owns the database.
import { DurableObject } from 'cloudflare:workers';
import { durableDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';
import { configureClock } from './time.js';

export class CvasDb extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    configureClock({ zone: env.CVAS_ZONE || 'America/Chicago', demoDate: env.CVAS_DEMO_DATE || null });
    this.db = durableDb(ctx.storage);
    this.handle = createApp(this.db, { adminToken: env.CVAS_ADMIN_TOKEN, seed });
    ctx.blockConcurrencyWhile(async () => {
      const n = this.db.prepare('SELECT COUNT(*) n FROM users').get().n;
      if (!n) await seed(this.db, { force: true });
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
