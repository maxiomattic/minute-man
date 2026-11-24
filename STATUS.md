# CVAS status

## Done
- [x] Schema: users, leaders, bindings, recommendations, elections, contests, choices, registration, participation, activism, groups, friends, nudges, endorsements, results
- [x] Recommendation engine: priority and consensus rules, disagreement detection
- [x] Recognition: turnout, activism, endorsement and slate-win points; ranks (rename per leader); 15 badges
- [x] API: auth, profile, data export and delete, ballots, polling places, leaders, bindings, registration and eligibility, participation, events and check-in, self-logging, leaderboards, groups, friends and nudges, notifications, admin ingestion and results
- [x] Mobile web app: home, ballot (changes stored on device), election-day guide, Act, Social, Me, registration help (ID stays on device), leader console
- [x] Offline service worker
- [x] 17 tests pass
- [x] Checked visually at phone width (Pixel 7)

## Left / ideas
- [ ] Real election data source (state voter files or a civic-data API)
- [ ] Push notifications (Web Push) instead of in-app only
- [ ] Turnout check against public voter-history files
- [ ] Hosting: a public deploy with HTTPS (now runs on the Surface at port 8799)
- [ ] Election lawyer review before public launch (see README "Legal design")
