// Storage layer. The app talks to a tiny adapter interface so the same code runs on
// Node (node:sqlite) and on Cloudflare (Durable Object SQLite storage):
//   db.prepare(sql).get(...args) / .all(...args) / .run(...args) -> { lastInsertRowid, changes }
//   db.exec(sql)      run one or more statements
//   db.tx(fn)         run fn atomically and return its result
import { SCHEMA } from './schema.js';

export { SCHEMA };

export async function openNodeDb(path = ':memory:') {
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);
  return {
    prepare: (q) => {
      const s = raw.prepare(q);
      return {
        get: (...a) => s.get(...a),
        all: (...a) => s.all(...a),
        run: (...a) => {
          const r = s.run(...a);
          return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
        },
      };
    },
    exec: (q) => raw.exec(q),
    tx: (fn) => {
      raw.exec('BEGIN');
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** Adapter over a Durable Object's ctx.storage (SQLite backend). */
export function durableDb(storage) {
  const sql = storage.sql;
  const split = (q) => q.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  const db = {
    prepare: (q) => ({
      get: (...a) => sql.exec(q, ...a).toArray()[0],
      all: (...a) => sql.exec(q, ...a).toArray(),
      run: (...a) => {
        const c = sql.exec(q, ...a);
        c.toArray();
        const id = sql.exec('SELECT last_insert_rowid() AS id').one().id;
        return { lastInsertRowid: Number(id), changes: c.rowsWritten };
      },
    }),
    exec: (q) => {
      for (const s of split(q)) sql.exec(s);
    },
    tx: (fn) => storage.transactionSync(fn),
  };
  db.exec(SCHEMA);
  return db;
}
