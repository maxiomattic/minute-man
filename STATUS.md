# CVAS status

Live: https://cvas.careride.workers.dev (Cloudflare Worker + Durable Object SQLite). Demo login: demo@example.org / demo-password.

## Done
- [x] Schema, recommendation engine (priority/consensus), recognition (points, 15 badges)
- [x] API: auth, profile, export/delete, ballots, polling places, leaders, bindings, registration and eligibility, participation, events and check-in, self-logging, leaderboards (weekly and all-time), groups, friends and nudges, notifications, admin ingestion and results
- [x] Engagement engine: next-action ladder, 3 daily quests + bonus chest, weekly streaks, weekly crew standing, crew feed with cheers, lucky bonus on verified check-ins (never on voting)
- [x] Redesign ("civic print"): Today, Ballot + vote flow, Act, Crew, You, Leaders, Register, leader console; one primary action per screen; phone and desktop layouts
- [x] Deployed to Cloudflare (web + API); demo data reseeds with `POST /api/admin/reseed`
- [x] Local calendar days (America/Chicago): deadlines, quests and streaks roll over at local midnight
- [x] Closed-primary rule for unaffiliated voters
- [x] Capacitor Android + iOS projects, icons, splash, NixOS Android toolchain (`scripts/android.sh`)
- [x] America First Insight as the default source, Trump's endorsements as the fallback (real data, attributed)
- [x] Real Texas Nov 3, 2026 ballot for Waxahachie; endorsements browser for all states
- [x] Demo clock pinned to Oct 1, 2026 (server + client)
- [x] Home address lookup (Census geocoder) sets the voter's districts; no precinct or area picker
- [x] Guided registration flow: asks first, says what to have ready before leaving the app, phone notes per state site
- [x] The Ladder: 8 ranks earned by doing each step in order (Registered → Voter → Messenger → Regular → Volunteer → Block Captain → Precinct Chair), a coach for the next step, rank bonuses
- [x] Invite links: recruits join your crew; you earn a bonus each time a recruit reaches a new rank
- [x] 24 tests pass; screens checked at Pixel 7 and 1280x800
- [x] Android app installed and verified on the Pixel 6 (rebuild: `scripts/android.sh <phone-ip:port>`)

## Left / ideas
- [ ] iOS build needs a Mac with Xcode (or a CI runner): `npx cap open ios`
- [ ] Ballots for places beyond Waxahachie (needs a civic-data API or more Ballotpedia parsing)
- [ ] Scheduled refresh of AFI and Trump endorsements
- [ ] Push notifications (native local notifications are installed but not wired up)
- [ ] Per-jurisdiction time zones (one zone for the whole deployment today)
- [ ] Turnout check against public voter-history files
- [ ] Precinct-chair claim is self-reported; could verify against county party rosters
- [ ] Election lawyer review before public launch (see README "Legal design")
