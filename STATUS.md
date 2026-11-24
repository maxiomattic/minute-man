# Minute Man status (formerly CVAS)

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
- [x] The Ladder: 8 ranks earned by doing each step in order (Registered Voter → Active Voter → Messenger → Regular → Volunteer → Block Captain → Precinct Chair), a coach for the next step, rank bonuses
- [x] Screens lead with the action; detail sits in tap-to-open sections. Registration ends with "Next: make your voting plan" and "Back to Today"
- [x] Android back button: closes sheets, then goes to the previous screen, then Today; only backgrounds the app from Today
- [x] Races with no endorsement and exactly one Republican fill in that candidate, labelled "Only Republican" (never shown as an endorsement)
- [x] Renamed Minute Man: Continental navy and brass, IM Fell English headings, tricorn icon (appId org.cvas.app and the workers.dev URL kept)
- [x] Three tabs: Today, Feed, Leaderboard. Ballot opens from Today; profile from the avatar
- [x] Feed: endless, ranked by impact × closeness × freshness with a per-person variety penalty; county muster totals (3+ active people only); cheers for anyone opted in
- [x] Feed shows each person's Ladder rank as a brass chip by their name (yours always; others only if they share their status, same rule as rank-ups and the leaderboard)
- [x] Leaderboard: precinct, districts, county, state, nationwide, friends and groups; week / 30 days / all time; your numbers, 8-week chart, 14 honors
- [x] Sources fixed (AFI, then Trump, then only Republican); leader swapping, custom leaders, themes and leader console removed
- [x] Group members can host events with a check-in code
- [x] FOSS under AGPL-3.0 (`LICENSE`); "not affiliated" notice on welcome and profile
- [x] 19 fictional neighbors seeded across Ellis County, Texas and 3 other states
- [x] Streak: a week counts only with 50+ points
- [x] Skill tree on Your path: 22 actions, each unlocks after the ones it needs; 5 short trainings (local government, county party, block walking, poll watching, precinct chair) linked to Texas GOP / Secretary of State sources, +15 each on the honor system
- [x] No catch-all logging: Today's "Your tasks" lists your open skill-tree actions, and each one logs only its own kind of work (posts, doors, calls, shifts)
- [x] Invite links: recruits join your crew; you earn a bonus each time a recruit reaches a new rank
- [x] Share a post: the app writes the post (endorsed races on your ballot, each attributed to AFI or Trump; deadlines; Election Day countdown) with your invite link. "Share this post" opens the phone's share sheet (or copies); a finished share records the post (+3, 15/day cap). No logging or counting posts by hand
- [x] 24 tests pass; screens checked at Pixel 7 and 1280x800
- [x] New logo: a front-view tricorn (crown behind two cocked flaps, cockade) in brass, for the header mark, web icon, Android launcher (adaptive, safe zone) and splash; `scripts/icons.sh` now uses coat navy
- [x] Quieter chrome: no brass rules on the top bar, tab bar, sidebar, Today hero or Feed muster; bars sit on a 1px darker-navy edge and a soft shadow. Brass stays on the active tab, figures and buttons
- [x] Android app installed and verified on the Pixel 6 (rebuild: `scripts/android.sh <phone-ip:port>`)

## Left / ideas
- [ ] iOS build needs a Mac with Xcode (or a CI runner): `npx cap open ios`
- [ ] Ballots for places beyond Waxahachie (needs a civic-data API or more Ballotpedia parsing)
- [ ] Scheduled refresh of AFI and Trump endorsements
- [ ] Push notifications (native local notifications are installed but not wired up)
- [ ] Per-jurisdiction time zones (one zone for the whole deployment today)
- [ ] Turnout check against public voter-history files
- [ ] Trainings are honor-system; swap in county party videos if one gives us a link
- [ ] Precinct-chair claim is self-reported; could verify against county party rosters
- [ ] Publish the source publicly (no remote yet)
- [ ] Election lawyer review before public launch (see README "Legal design")
