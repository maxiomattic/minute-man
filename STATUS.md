# Minute Man status (formerly CVAS)

Live: https://cvas.careride.workers.dev (Cloudflare Worker + Durable Object SQLite). Demo login: demo@example.org / demo-password.

## Done
- [x] Schema, recommendation engine (priority/consensus), recognition (points, 15 badges)
- [x] API: auth, profile, export/delete, ballots, polling places, leaders, bindings, registration and eligibility, participation, events and check-in, self-logging, leaderboards (weekly and all-time), groups, friends, notifications, admin ingestion and results
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
- [x] Registration asks for your home address as step 1 (street, unit, city, state, ZIP, optional mailing address), checks it with the Census lookup, shows the match to confirm, sets your districts, and lists it ready to copy (residence, mailing, county) before the state site. The street stays on the device (IndexedDB); the profile lookup saves it there too so registration only asks to confirm
- [x] The Ladder: 8 Continental Army ranks earned by doing each step in order (Private → Corporal → Sergeant → Ensign → Lieutenant → Captain → Major → Colonel), each with a one-line meaning, a coach for the next step, rank bonuses
- [x] Rank insignia (chevrons, lozenges, star, laurel) on feed rank chips and the Leaderboard commission box
- [x] Screens lead with the action; detail sits in tap-to-open sections. Registration ends with "Next: make your voting plan" and "Back to Today"
- [x] Android back button: closes sheets, then goes to the previous screen, then Today; only backgrounds the app from Today
- [x] Every candidate race gets a Minute Man pick: AFI, then Trump, then the only Republican, then uncontested, then incumbent Republican or first-listed Republican, then the most right-of-center party (Libertarian, Constitution, ..., independents; a Democrat last), then nonpartisan incumbent or first listed. Measures get no pick
- [x] Renamed Minute Man: Continental navy and brass, IM Fell English headings, tricorn icon (appId org.cvas.app and the workers.dev URL kept)
- [x] Three tabs: Today, Feed, Leaderboard. Ballot opens from Today; profile from the avatar
- [x] Feed: endless, ranked by impact × closeness × freshness with a per-person variety penalty; county muster totals (3+ active people only); cheers for anyone
- [x] Feed shows each person's Ladder rank as a brass chip by their name (everyone's, same as the leaderboard)
- [x] Leaderboard: precinct, districts, county, state, nationwide, friends and groups; week / 30 days / all time; your numbers, 8-week chart, 14 honors
- [x] Sources fixed (AFI, then Trump, then Minute Man's fill-in rules); leader swapping, custom leaders, themes and leader console removed
- [x] Group members can host events with a check-in code
- [x] FOSS under the MIT License (`LICENSE`); "not affiliated" notice on welcome and profile
- [x] 19 fictional neighbors seeded across Ellis County, Texas and 3 other states
- [x] Streak: a week counts only with 50+ points
- [x] Skill tree on Your path: 22 actions, each unlocks after the ones it needs; 5 short trainings (local government, county party, block walking, poll watching, precinct chair) linked to Texas GOP / Secretary of State sources, +15 each on the honor system
- [x] Skill tree redrawn as a graph: one row per step grouped by rank, lines (drawn from each step's `needs`) run down to what it unlocks; done/ready/locked differ by shape, not just colour; locked steps say "Needs: …"; tapping a step traces what it needs and unlocks and opens a sheet with needs, unlocks, points and the action
- [x] No catch-all logging: Today's "Your tasks" lists your open skill-tree actions, and each one logs only its own kind of work (posts, doors, calls, shifts)
- [x] Invite links: recruits join your crew; you earn a bonus each time a recruit reaches a new rank
- [x] Share a post: the app writes the post ("My Minute Man picks for the Texas ballot", "Minute Man's pick for Railroad Commissioner: Bo French."; deadlines; Election Day countdown; never names AFI or Trump) with your invite link. "Share this post" opens the phone's share sheet (or copies); a finished share records the post (+3, 15/day cap). No logging or counting posts by hand
- [x] Remind someone to vote: for people not on Minute Man (app users get the app's own reminders, so friend nudges and the nudge route are gone). The app writes a short personal text from the calendar (registration deadline, early voting, mail-ballot deadline, Election Day, or anytime) with your invite link; you can edit it, and the phone's share sheet sends it (or it's copied). A finished share records a 'reminded' activity (+5, 25/day points, 20/day max); cancelling records nothing. Counts for the remind quest, the "Remind 3 people" step, the Reminder badge (5 people) and your totals. Friends list shows each friend's rank and whether they voted
- [x] Daily quests need the real action, checked by the server: review every race on your ballot (read why in See why and tap "Got it"; the server stores the race, never a pick), RSVP "I'm going" to an event this week, cheer, share, remind, log 10 doors or calls. Opening a page no longer counts. Each quest shows what's left ("Review all 11 races. 3 of 11 done") and taps through to where you do it; Claim appears only when done
- [x] Ballot in two views: Ballot ("Minute Man's picks": each race and its pick, all alike; no controls) and See why (AFI's write-up credited "Write-up: America First Insight" where one exists, otherwise Minute Man's short plain reason; and the per-race review). The choice is remembered. Picks can no longer be changed in the app; the old on-device changes and change log are gone and cleared on load
- [x] 34 tests pass, lint clean; every screen checked at 412px in light and dark (Nov 24 integration)
- [x] Logo redrawn so it reads as a minuteman (the lone tricorn looked like a boat or bird): a militiaman bust in a brass tricorn with a buff cockade, buff face and cravat, brass coat, musket with bayonet over the shoulder, on the navy tile. One drawing (`public/icon.svg`) for the header mark (`logo()` in core.js), favicon, PWA icons (SVG, 192/512 PNG, maskable, apple-touch), Android launcher (all densities, adaptive foreground in the safe zone, round), splash (round badge with a brass ring) and iOS icon, all from `scripts/icons.sh`; offline cache v16
- [x] Quieter chrome: no brass rules on the top bar, tab bar, sidebar, Today hero or Feed muster; bars sit on a 1px darker-navy edge and a soft shadow. Brass stays on the active tab, figures and buttons
- [x] Privacy settings removed: everyone is on the feed and leaderboards with their rank, and friends see whether you voted (existing accounts migrated; the API refuses turning it off). Still true: nobody sees how anyone votes, strangers see first name, last initial and town, area totals need 3+ active people. One line on the profile says so
- [x] Feed posts: write an update (500 characters, one photo) at the top of the Feed, or add a note and photo to something you did (offered right after logging or checking in, and later from your own feed item). Photos resized on the phone to 1280px WebP under 400 KB (EXIF/GPS dropped), type and size checked and metadata stripped again on the server, stored in R2 (`minute-man-media`; disk under data/media locally) at unguessable URLs, tap for full size. No points for posts or photos; 10 posts a day (deleting doesn't refund); text posts rank like a small unverified action, photos get a small boost. Delete your own; Report hides it for you and flags it (`GET /api/admin/reports`, `DELETE /api/admin/posts/:id` with the admin token); deleting your account deletes your posts and photos
- [x] Your own take on a ready-made post: the share sheet has an optional note and photo. Sharing sends your words first, then the post (and the photo on phones that can share files; @capacitor/filesystem writes it to the cache for the Android share sheet), and the feed shows your take above the post's words. "Post on the Minute Man feed only" puts it on the feed without sharing (no points). A take that can't be saved never undoes a share that already went out
- [x] Replies on any feed item: words and one photo (same photo pipeline: resized on the phone, checked and stripped on the server, unguessable /api/media/ URL). Each item shows its reply count and the latest two; tapping opens the whole thread with a reply box. Repliers show with their rank; strangers see first name, last initial and town. Voting-status items take replies only from friends and group-mates. 50 replies a day, no points; replies nudge an item's ranking a little (people talking). Delete your own; Report hides it for you and flags it (`GET /api/admin/reports` lists replies with type 'reply'; `DELETE /api/admin/replies/:id`). Deleting a post or an account deletes its replies and their photos. Offline cache v17
- [x] Rank insignia chips on the Friends list and Leaderboard rows too, so "Private" reads as a rank, not a privacy setting; ballot heading in sentence case ("Minute Man's picks"); offline cache v15 includes the compose and remind views
- [x] Android app installed and verified on the Pixel 6 (rebuild: `scripts/android.sh <phone-ip:port>`)
- [x] Debug APK published as GitHub pre-release `v0.1.0-debug` (asset `minute-man-debug.apk`, the build on the Pixel 6); README links it

## Left / ideas
- [ ] iOS build needs a Mac with Xcode (or a CI runner): `npx cap open ios`
- [ ] Ballots for places beyond Waxahachie (needs a civic-data API or more Ballotpedia parsing)
- [ ] Scheduled refresh of AFI and Trump endorsements
- [ ] Push notifications (native local notifications are installed but not wired up)
- [ ] Per-jurisdiction time zones (one zone for the whole deployment today)
- [ ] Turnout check against public voter-history files
- [ ] Trainings are honor-system; swap in county party videos if one gives us a link
- [ ] Precinct-chair claim is self-reported; could verify against county party rosters
- [x] Source published at https://github.com/maxiomattic/minute-man (public, MIT)
- [ ] Election lawyer review before public launch (see README "Legal design")
