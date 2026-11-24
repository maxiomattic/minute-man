# CVAS — Coordinated Voting Assistance System

A web app and Android/iOS app (shared code, installable, works offline) that helps people vote and stay involved in civic life all year:

- **Follow leaders**: individuals, organizations or curated lists. You can rank them, turn them on or off, or unfollow at any time.
- **Sample ballot** built from those leaders' recommendations. You can use two rules to combine them: *priority* (your top leader wins) or *consensus* (picks weighted by your ranking). When your leaders disagree, the ballot says so. Any change you make stays on your device, along with a log of the changes.
- **Election-day guide**: a cheat sheet, step-by-step instructions and nearby polling places or drop boxes sorted by distance. It all works offline once loaded.
- **Registration help**: eligibility checks (age, deadlines, party changes for closed primaries), reminders and a pre-filled summary. Your ID photo and details are stored only on your device (IndexedDB) and never uploaded.
- **Grassroots activism**: city council and local party meetings, campaign volunteering, door knocking, phone banking, get-out-the-vote shifts and social media posts. Organizers post events with a check-in code, which earns attendees verified points. You can also log things yourself for fewer points, with daily caps.
- **Engagement**: a single clear next step on the Today screen, 3 daily quests plus a bonus, weekly streaks, weekly crew standings, a crew feed with cheers, and an occasional lucky bonus for verified event check-ins (never for voting).
- **Gamification**: points, 7 ranks (a leader can rename them for their own branding), 15 badges, and leaderboards for friends, groups and leaders.
- **Social**: friends, groups with invite codes, reminders to vote, and an opt-in view of whether friends have voted.
- **Leader console**: publish recommendations, create events, set brand color and rank names. Leaders only ever see follower totals.
- **Branding**: a neutral mode, or a theme in the color of a leader you follow.

## Legal design

These choices are built in on purpose. Have an election lawyer review before a public launch.

- **No vote-choice verification or rewards.** The app never asks for, stores or rewards *how* anyone voted. Rewarding vote choice is a problem under federal and state vote-buying laws and ballot-photo bans, and it opens people up to pressure from others.
- **Points can't be exchanged for anything.** Under 52 U.S.C. § 10307(c), even rewarding someone *for voting at all* is illegal in federal elections if the reward has value. Points are honorific only. Never add a store, prizes or perks tied to points.
- **"I voted" is self-reported.** No proof is needed, and it only records turnout.
- **Slate wins** count contests where a followed leader's picks won the official results. Every follower gets the same points whether or not they voted, and however they voted.
- **Endorsements** are public statements, like a yard sign, and are never tied to a ballot.
- **Before launch:** charge campaigns and PACs the same normal rate, or free service may count as an illegal in-kind corporate contribution. Any texting or dialing tool must follow the TCPA. Social media actions are for real accounts only, with no sockpuppets or automated posting.

## Run

Live: https://cvas.careride.workers.dev

```
npm start                 # local dev server, http://127.0.0.1:8787, demo data seeded on first run
npm test                  # 19 tests
npx wrangler deploy       # deploy web + API to Cloudflare
scripts/android.sh        # build the Android app, install it on the connected phone and launch it
```

See `MOBILE.md` for Android and iOS details. Calendar days (deadlines, quests, streaks) use America/Denver; change it with `setZone()` in `src/time.js`.

Environment variables: `PORT`, `HOST`, `CVAS_DB` (SQLite path, default `data/cvas.db`), `CVAS_ADMIN_TOKEN` (turns on the election-data ingestion endpoints), `CVAS_SEED=1` (re-seed).

Demo logins all use the password `demo-password`:
- `demo@example.org`: a voter
- `org1@example.org`: owns *Riverbend Civic League* and *Teachers for Cedar Valley*
- `org2@example.org`: owns *Maplewood Taxpayers Forum*

All demo places, people and organizations are made up.

## Architecture

One request handler (`createApp(db)` in `src/app.js`, Fetch API) runs in two places: Node (`src/server.js`, `node:sqlite`) for local work, and a Cloudflare Worker (`src/worker.js`) that forwards `/api/*` to a single SQLite-backed Durable Object and serves `public/` as static assets. The frontend is plain JavaScript ES modules with no build step; the same `public/` folder is the web app and the Capacitor app (which calls the Cloudflare API).

| File | What |
|---|---|
| `src/schema.js` | Schema |
| `src/db.js` | SQLite adapters for Node and Durable Objects |
| `src/worker.js` | Cloudflare Worker + Durable Object |
| `src/engine/engage.js` | Today screen, quests, streaks, feed, cheers |
| `src/time.js` | Local calendar days |
| `src/app.js` | Router, all API endpoints, election-data import |
| `src/engine/recommend.js` | Pluggable rules for combining recommendations (`register(name, fn)`) |
| `src/engine/recognition.js` | Points table, ranks, badges, scorecard |
| `src/rules.js` | Per-jurisdiction rules (inherited from parent areas) and eligibility |
| `src/seed.js` | Demo data with dates relative to today |
| `public/` | The app: `app.js` (shell, router), `core.js` (helpers), `views/*.js` (screens), `styles.css`, `sw.js` (offline) |
| `android/`, `ios/` | Capacitor native projects |

### Election-data ingestion

`POST /api/admin/ingest` with `Authorization: Bearer $CVAS_ADMIN_TOKEN` and a JSON body of `{jurisdictions, pollingPlaces, elections:[{…, contests:[{…, choices}]}]}`. It updates existing records and adds new ones. See `demoData()` in `src/seed.js` for the format. Official results go to `POST /api/admin/results` as `[{contestId, winnerIds}]`.

### Extension points

- Recommendation rules: `register()` in `recommend.js`.
- Activity types and point values: `ACTIVITY` in `recognition.js`.
- Badges: `scorecard()`.
- Jurisdiction rules: JSON in `jurisdictions.rules`.
- Direct electronic ballot submission is not built. Add it only where it's legally allowed.
