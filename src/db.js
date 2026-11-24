import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'voter',          -- voter | leader
  jurisdiction_id TEXT,
  precinct TEXT,
  birth_date TEXT,
  share_status INTEGER NOT NULL DEFAULT 0,     -- opt-in: friends can see participation
  theme TEXT NOT NULL DEFAULT 'neutral',       -- neutral | leader:<id>
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jurisdictions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES jurisdictions(id),
  rules TEXT NOT NULL DEFAULT '{}'              -- JSON: deadlines, ID rules, URLs
);

CREATE TABLE IF NOT EXISTS polling_places (
  id INTEGER PRIMARY KEY,
  jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions(id),
  precinct TEXT,
  kind TEXT NOT NULL,                           -- polling | dropbox | early
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL, lng REAL,
  hours TEXT
);

CREATE TABLE IF NOT EXISTS elections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',         -- general | primary | local | special
  jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions(id),
  registration_deadline TEXT,
  early_voting_start TEXT,
  mail_ballot_deadline TEXT
);

CREATE TABLE IF NOT EXISTS contests (
  id TEXT PRIMARY KEY,
  election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'candidate',       -- candidate | measure
  vote_for INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS choices (
  id TEXT PRIMARY KEY,
  contest_id TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  party TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leaders (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'organization',    -- individual | organization | list
  blurb TEXT,
  brand_color TEXT,
  public INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bindings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, leader_id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  contest_id TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  choice_ids TEXT NOT NULL,                     -- JSON array; [] = explicit "no recommendation"
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (leader_id, contest_id)
);

CREATE TABLE IF NOT EXISTS registrations (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown',       -- unknown | not_registered | submitted | confirmed
  party TEXT,
  desired_party TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Turnout-only events. Never stores how anyone voted.
CREATE TABLE IF NOT EXISTS participation (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  election_id TEXT REFERENCES elections(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                           -- registered | planned | voted | reminded
  at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, election_id, kind)
);

CREATE TABLE IF NOT EXISTS friendships (
  a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending (a asked b) | accepted
  PRIMARY KEY (a, b)
);

CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  election_id TEXT REFERENCES elections(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  seen INTEGER NOT NULL DEFAULT 0
);
`;

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
