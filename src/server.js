import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.CVAS_DB || join(root, 'data', 'cvas.db');
const fresh = !existsSync(dbPath);
const db = openDb(dbPath);
if (fresh || process.env.CVAS_SEED) seed(db);

const handler = createApp(db, { publicDir: join(root, 'public'), adminToken: process.env.CVAS_ADMIN_TOKEN });
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
createServer(handler).listen(port, host, () => console.log(`CVAS on http://${host}:${port}`));
