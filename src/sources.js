// Endorsement sources every account follows by default, in priority order:
// America First Insight first; where it hasn't endorsed, Donald Trump's pick fills in.
export const SOURCES = [
  {
    key: 'afi', email: 'afi@sources.cvas.app', name: 'America First Insight', kind: 'organization', color: '#1c3f74',
    blurb: "America First Insight's published endorsements, imported from americafirstinsight.com. Minute Man isn't affiliated with them.",
  },
  {
    key: 'trump', email: 'trump@sources.cvas.app', name: 'Donald J. Trump', kind: 'individual', color: '#b22234',
    blurb: "President Trump's endorsements, as tracked by Ballotpedia. Minute Man isn't affiliated with the President or his campaign.",
  },
];


/** Follow AFI first, then Trump as the fallback. Used for every new account. */
export function bindDefaults(db, userId) {
  SOURCES.forEach((s, i) => {
    const l = db.prepare('SELECT l.id FROM leaders l JOIN users u ON u.id=l.owner_id WHERE u.email=?').get(s.email);
    if (l) db.prepare('INSERT OR IGNORE INTO bindings (user_id, leader_id, priority) VALUES (?,?,?)').run(userId, l.id, i + 1);
  });
}

