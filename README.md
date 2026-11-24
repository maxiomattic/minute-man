# Minute Man

Ready at a minute's notice. A web app and Android/iOS app (shared code, installable, works offline) that helps people vote and stay involved in civic life all year, with an America First focus.

Minute Man is free, open-source software under the MIT License (see `LICENSE`). It isn't run by or affiliated with any party, campaign or candidate. Its picks always come from the same fixed sources, so users can't swap them; anyone who wants different sources can fork it.

- **Fixed sources**: America First Insight first, then Donald Trump's endorsements where AFI hasn't picked. Where neither has picked and exactly one Republican is running, that candidate fills in, labelled "Only Republican" and never shown as an endorsement.
- **Endorsements browser**: every 2026 general-election endorsement from both sources, by state, with AFI's own write-ups and source links.
- **Sample ballot** from those sources. Any change you make stays on your device, along with a log of the changes.
- **Election-day guide**: a cheat sheet, step-by-step instructions and polling places. It works offline once loaded.
- **Registration help**: eligibility checks, deadlines and a guided flow. ID details stay on your device (IndexedDB) and are never uploaded.
- **Three tabs**:
  - **Today**: your next step, your path, tasks, daily quests, events near you, streak. Group members can host events with a check-in code.
  - **Feed**: an endless feed of what people are getting done, ranked by impact and how close it is to you (see below), with a county "muster" total at the top and cheers.
  - **Leaderboard**: your place in your precinct, districts, county, state and nationwide, plus friends and groups; filters for this week, 30 days and all time; your numbers, an 8-week chart and honors (14 badges).
- **The Ladder**: 8 ranks earned by doing each step of political engagement in order, with a skill tree and short trainings before the in-person steps. The ranks are Continental Army ranks: Private (joined), Corporal (registered, with a plan), Sergeant (voted), Ensign (spreads the word), Lieutenant (goes to local meetings), Captain (works for campaigns), Major (organizes a neighborhood) and Colonel (leads a precinct). The DB stores only the level number, so rank names can change without a migration.
- **Invites**: everyone has an invite link and earns a bonus each time a recruit reaches a new rank.

### Feed ranking

`rankedFeed()` in `src/engine/community.js`. Score = impact × closeness × freshness:
- **Impact**: log2(2 + points), ×1.4 if verified by a check-in code, ×1.3 for a rank-up, +15% per cheer (up to 10).
- **Closeness**: same precinct 3, shared district 2.2, county 1.6, state 1.25, elsewhere 1; friends and group-mates ×1.5.
- **Freshness**: halves every 3 days; last 30 days only.
- **Variety**: each further item from the same person is worth 0.6× the one before.

### Who sees what

- Strangers see only people who opted in ("Show what I do on the feed and leaderboards"), as first name, last initial and town.
- Whether someone voted, and their plan, show only to friends and group-mates, and only if they share their status. Rank-ups and trainings need that setting too.
- Area totals appear only when at least 3 people are active there.
- Nobody, including the app, knows how anyone voted.

## Legal design

These choices are built in on purpose. Have an election lawyer review before a public launch.

- **No vote-choice verification or rewards.** The app never asks for, stores or rewards *how* anyone voted. Rewarding vote choice is a problem under federal and state vote-buying laws and ballot-photo bans, and it opens people up to pressure from others.
- **Points can't be exchanged for anything.** Under 52 U.S.C. § 10307(c), even rewarding someone *for voting at all* is illegal in federal elections if the reward has value. Points are honorific only. Never add a store, prizes or perks tied to points.
- **"I voted" is self-reported.** No proof is needed, and it only records turnout.
- **Wins** count contests where a candidate on the sample ballot won. Everyone gets the same points whether or not they voted, and however they voted.
- **Endorsements** are public statements, like a yard sign, and are never tied to a ballot.
- **Before launch:** charge campaigns and PACs the same normal rate, or free service may count as an illegal in-kind corporate contribution. Any texting or dialing tool must follow the TCPA. Social media actions are for real accounts only, with no sockpuppets or automated posting.

## Run

Live: https://cvas.careride.workers.dev

```
npm start                 # local dev server, http://127.0.0.1:8787, demo data seeded on first run
npm test                  # 24 tests
npx wrangler deploy       # deploy web + API to Cloudflare
scripts/android.sh        # build the Android app, install it on the connected phone and launch it
```

See `MOBILE.md` for Android and iOS details.

Environment variables: `PORT`, `HOST`, `CVAS_DB` (SQLite path, default `data/cvas.db`), `CVAS_ADMIN_TOKEN` (turns on the election-data ingestion endpoints), `CVAS_SEED=1` (re-seed), `CVAS_ZONE` (calendar zone, default America/Chicago), `CVAS_DEMO_DATE` (default `2026-10-01`; set it empty to run on the real date). The Worker sets the same two in `wrangler.jsonc`.

### Showcase: Waxahachie, Texas, on Oct 1, 2026

The app runs as if today were Oct 1, 2026 (the time of day is real). Server and browser share the clock through `GET /api/clock` and `public/clock.js`. The sample voter lives in Waxahachie (Ellis County: TX-6, State Senate 2, State House 10) and sees the real Nov 3 general-election ballot.

Real data:
- America First Insight's endorsements, from their public feed (`data.americafirstinsight.com/Endorsements/data/endorsements.json`).
- Donald Trump's 2026 endorsements and the Texas candidate lists, from Ballotpedia.
- Texas deadlines and rules from votetexas.gov. No polling places are made up; the vote flow links to the Ellis County elections page.

Refresh it with `python3 scripts/fetch_sources.py` then `python3 scripts/build_data.py`, which write `data/sources/` and `src/data/`. Neither source is affiliated with Minute Man, and the app says so. A race with no endorsement from either source is left blank.

Made up: the sample voters and the 19 neighbors on the feed and leaderboards, the Ellis County Block Walkers group and its events. Demo logins all use the password `demo-password`:
- `demo@example.org`: a voter
- `org1@example.org`: runs the Block Walkers group and its events

## Architecture

One request handler (`createApp(db)` in `src/app.js`, Fetch API) runs in two places: Node (`src/server.js`, `node:sqlite`) for local work, and a Cloudflare Worker (`src/worker.js`) that forwards `/api/*` to a single SQLite-backed Durable Object and serves `public/` as static assets. The frontend is plain JavaScript ES modules with no build step; the same `public/` folder is the web app and the Capacitor app (which calls the Cloudflare API).

| File | What |
|---|---|
| `src/schema.js` | Schema |
| `src/db.js` | SQLite adapters for Node and Durable Objects |
| `src/worker.js` | Cloudflare Worker + Durable Object |
| `src/engine/engage.js` | Today screen, quests, streaks, cheers |
| `src/engine/community.js` | Ranked feed, area leaderboards, your standing, area totals |
| `src/app.js` | Router, all API endpoints, election-data import |
| `src/engine/recommend.js` | Pluggable rules for combining recommendations (`register(name, fn)`) |
| `src/engine/recognition.js` | Points table, badges, scorecard |
| `src/engine/ladder.js` | The Ladder and skill tree: steps, unlocks, trainings, coaching, rank and recruit bonuses, invite codes |
| `src/rules.js` | Per-jurisdiction rules (inherited from parent areas) and eligibility |
| `src/seed.js` | Showcase data: Texas ballot, sources, sample voters and events |
| `src/sources.js` | The two fixed endorsement sources |
| `src/time.js`, `public/clock.js` | Local calendar days and the demo clock |
| `public/` | The app: `app.js` (shell, router), `core.js` (helpers), `views/*.js` (screens), `styles.css`, `sw.js` (offline) |
| `android/`, `ios/` | Capacitor native projects |

### Election-data ingestion

`POST /api/admin/ingest` with `Authorization: Bearer $CVAS_ADMIN_TOKEN` and a JSON body of `{jurisdictions, pollingPlaces, elections:[{…, contests:[{…, choices}]}]}`. It updates existing records and adds new ones. See `demoData()` in `src/seed.js` for the format. Official results go to `POST /api/admin/results` as `[{contestId, winnerIds}]`.

### Extension points

- Activity types and point values: `ACTIVITY` in `recognition.js`.
- Badges: `scorecard()`.
- Jurisdiction rules: JSON in `jurisdictions.rules`.
- Direct electronic ballot submission is not built. Add it only where it's legally allowed.
