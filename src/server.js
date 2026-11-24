// Local/dev server: Node http -> Fetch handler, plus static files from public/.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNodeDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';
import { configureClock } from './time.js';

// Showcase defaults: Waxahachie, TX on Oct 1, 2026. Set CVAS_DEMO_DATE= (empty) for the real date.
configureClock({ zone: process.env.CVAS_ZONE || 'America/Chicago', demoDate: process.env.CVAS_DEMO_DATE ?? '2026-10-01' });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const dbPath = process.env.CVAS_DB || join(root, 'data', 'cvas.db');
const fresh = !existsSync(dbPath);
const db = await openNodeDb(dbPath);
if (fresh || process.env.CVAS_SEED) await seed(db, { force: true });

const handle = createApp(db, { adminToken: process.env.CVAS_ADMIN_TOKEN, seed });
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handle(new Request(url, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks),
    }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || !extname(p)) p = '/index.html';
  try {
    const data = await readFile(join(publicDir, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', function () {
  console.log(`Minute Man on http://${this.address().address}:${this.address().port}`);
});
