// SQLite schema shared by Node and Cloudflare.
export const SCHEMA = `

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'voter',          -- voter | leader
  jurisdiction_id TEXT,
  home_label TEXT,                             -- like "Waxahachie, TX" (never the street address)
  precinct TEXT,
  birth_date TEXT,
  share_status INTEGER NOT NULL DEFAULT 1,     -- always 1: friends see whether you voted, others see your rank
  theme TEXT NOT NULL DEFAULT 'neutral',       -- neutral | leader:<id>
  strategy TEXT NOT NULL DEFAULT 'priority',   -- recommendation aggregation strategy
  on_leaderboards INTEGER NOT NULL DEFAULT 1,  -- always 1: you're on the feed and leaderboards
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
  public INTEGER NOT NULL DEFAULT 1,
  rank_names TEXT                               -- JSON array of custom rank titles (branding)
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

CREATE TABLE IF NOT EXISTS results (
  contest_id TEXT PRIMARY KEY REFERENCES contests(id) ON DELETE CASCADE,
  winner_ids TEXT NOT NULL                      -- JSON array, from official results
);

-- Grassroots activism: events published by leaders or groups.
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  jurisdiction_id TEXT REFERENCES jurisdictions(id),
  kind TEXT NOT NULL,      -- council_meeting | party_meeting | volunteer | canvass | phonebank | gotv | social
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  checkin_code TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id INTEGER REFERENCES actions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,          -- doors, calls, posts
  verified INTEGER NOT NULL DEFAULT 0,          -- 1 = checked in with event code
  note TEXT,
  points INTEGER NOT NULL,
  day TEXT NOT NULL DEFAULT (date('now')),
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS activity_once_per_event ON activity(user_id, action_id) WHERE action_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'team',            -- team | neighborhood | chapter
  leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  invite_code TEXT UNIQUE NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

-- Public statement of support (like a yard sign). Never tied to a ballot.
CREATE TABLE IF NOT EXISTS endorsements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, leader_id)
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

-- Engagement: quest bonuses, cheers on feed items, client events (e.g. ballot viewed).
CREATE TABLE IF NOT EXISTS bonuses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                         -- quest:<id>:<day> | lucky:<activity id> | levelup
  points INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, source)
);

CREATE TABLE IF NOT EXISTS events (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                           -- ballot_viewed:<election> | events_viewed | ...
  day TEXT NOT NULL DEFAULT (date('now')),
  PRIMARY KEY (user_id, kind, day)
);

CREATE TABLE IF NOT EXISTS cheers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,                           -- feed item key
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item)
);
-- Feed posts: your own updates (activity_id NULL) or a note/photo on something you did.
-- No points. Images live in R2 (or media_blobs) under an unguessable key. See src/engine/feedposts.js.
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id INTEGER REFERENCES activity(id) ON DELETE CASCADE,
  body TEXT,
  image TEXT,
  image_w INTEGER,
  image_h INTEGER,
  day TEXT NOT NULL DEFAULT (date('now')),
  at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS posts_activity ON posts(activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_at ON posts(at);
-- Posts made per day, for the daily limit (deleting a post doesn't give the slot back).
CREATE TABLE IF NOT EXISTS post_counts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- "Report": hides the item for the reporter and flags its post for the admin.
CREATE TABLE IF NOT EXISTS post_reports (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,                           -- feed item key (u:<post id> | a:<activity id>)
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  reason TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item)
);
`;

// Columns added after launch. Each runs once; 'duplicate column' errors are ignored.
export const MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN home_label TEXT',
  // The Ladder (src/engine/ladder.js): invite code, who invited you, and your current rung.
  'ALTER TABLE users ADD COLUMN ref_code TEXT',
  'ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL',
  'ALTER TABLE users ADD COLUMN rung INTEGER NOT NULL DEFAULT 1',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_ref_code ON users(ref_code)',
  'CREATE INDEX IF NOT EXISTS users_referred_by ON users(referred_by)',
  // Being on the feed and leaderboards, and sharing your rank and whether you voted, are no longer optional.
  // Older databases default these to 0; this turns them on for everyone (cheap and safe to run every start).
  'UPDATE users SET share_status=1, on_leaderboards=1 WHERE share_status<>1 OR on_leaderboards<>1',
  // Feed: recent activity and rank-ups across everyone.
  'CREATE INDEX IF NOT EXISTS activity_at ON activity(at)',
  'CREATE INDEX IF NOT EXISTS bonuses_at ON bonuses(at)',
  // Quests count real actions: races you reviewed on your ballot (never your picks) and events you RSVP'd to.
  `CREATE TABLE IF NOT EXISTS ballot_reviews (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    election_id TEXT NOT NULL,
    contest_id TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, election_id, contest_id)
  )`,
  `CREATE TABLE IF NOT EXISTS rsvps (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, action_id)
  )`,
  // Your own take on a ready-made post: the post's words are kept with the share (activity) or with a
  // feed-only post, so the feed can show them under what you added.
  'ALTER TABLE activity ADD COLUMN quote TEXT',
  'ALTER TABLE posts ADD COLUMN quote TEXT',
  // Replies on feed items (src/engine/replies.js). item is the feed key; owner_id is who the item belongs to.
  `CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT,
    image TEXT,
    image_w INTEGER,
    image_h INTEGER,
    day TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS replies_item ON replies(item, at)',
  'CREATE INDEX IF NOT EXISTS replies_image ON replies(image) WHERE image IS NOT NULL',
  `CREATE TABLE IF NOT EXISTS reply_counts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  )`,
  'ALTER TABLE post_reports ADD COLUMN reply_id INTEGER REFERENCES replies(id) ON DELETE SET NULL',
  // How involved you want to be: 'voter' (register, get reminded, see the picks, vote) or 'minuteman'
  // (the full game: ranks, quests, streaks, events). Older accounts keep the full game; new ones start as voters.
  "ALTER TABLE users ADD COLUMN mode TEXT NOT NULL DEFAULT 'minuteman'",
  // What officials elected on Minute Man's picks have done since. Entered by an admin with a source,
  // shown in the feed of everyone whose areas include the official's.
  `CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY,
    jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions(id),
    official TEXT NOT NULL,
    office TEXT NOT NULL,
    body TEXT NOT NULL,
    source_url TEXT,
    source_label TEXT,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS deliveries_at ON deliveries(at)',
];
