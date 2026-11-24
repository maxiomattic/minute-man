// Ready-made posts a voter can share from their own accounts. The app never posts anything itself:
// the voter picks a post, their phone's share sheet sends it, and that share is what counts.
//
// Every claim comes from data the app already has: published endorsements (attributed to the source
// that made them), the election calendar and public events. The "only Republican" fill-in on the
// sample ballot is never presented as an endorsement, so those races are left out.

export const PUBLIC_URL = 'https://cvas.careride.workers.dev';
const MAX = 260; // leaves room for the link inside a 280-character post

const SOURCE_SHORT = { 'Donald J. Trump': 'President Trump' };
const short = (name) => SOURCE_SHORT[name] || name;
const TAG = { 'America First Insight': 'AFI', 'Donald J. Trump': 'Trump' };
const tag = (name) => TAG[name] || name;

/** "Mon, Oct 5" for a YYYY-MM-DD date, independent of the server's zone. */
export const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** Shorter office names for posts ("United States Senator" reads long on a phone). */
const office = (t) => t.replace(/^United States Senator$/, 'U.S. Senate').replace(/^U\.S\. Representative, /, 'U.S. House, ')
  .replace(/^Comptroller of Public Accounts$/, 'Comptroller');
/** Even shorter, for one line per race in the ballot post. */
const abbr = (t) => office(t).replace(/^U\.S\. Senate$/, 'Senate').replace(/, District (\d+)$/, ' $1').replace(/^Lieutenant /, 'Lt. ')
  .replace(/^State Representative/, 'State House').replace(/^State Senator/, 'State Senate');

/**
 * @param {object} o
 * @param {object|null} o.election   next election row (name, date, registration_deadline, early_voting_start, mail_ballot_deadline)
 * @param {string|null} o.stateName  "Texas"
 * @param {Array<{title:string, candidate:string, source:string}>} o.endorsed  races on the voter's ballot a source endorsed in
 * @param {string} o.today           YYYY-MM-DD
 * @returns {Array<{id:string, kind:string, text:string}>}
 */
export function buildPosts({ election, stateName, endorsed = [], today }) {
  const posts = [];
  const add = (id, kind, text) => { if (text.length <= MAX) posts.push({ id, kind, text }); };
  const where = stateName ? `${stateName} ` : '';

  if (election) {
    const day = fmtDay(election.date);
    const until = daysBetween(today, election.date);

    // 1. The voter's sample ballot: endorsed races only, each with its source.
    if (endorsed.length) {
      const sources = [...new Set(endorsed.map((r) => r.source))];
      const head = `Endorsed on my ${where}ballot (${day.replace(/^\w+, /, '')}), from ${sources.map((s) => (short(s).includes(tag(s)) ? short(s) : `${short(s)} (${tag(s)})`)).join(' and ')}:`;
      const lines = endorsed.map((r) => `${abbr(r.title)}: ${r.candidate} (${tag(r.source)})`);
      let n = lines.length;
      const text = (k) => `${head}\n${lines.slice(0, k).join('\n')}${k < lines.length ? '\n...and more' : ''}\nGet yours:`;
      while (n > 1 && text(n).length > MAX) n--;
      add('ballot', 'ballot', text(n));
    }

    // 2. Deadlines still ahead.
    const reg = election.registration_deadline;
    if (reg && reg >= today) {
      const left = daysBetween(today, reg);
      add('register', 'deadline', `${left <= 7 ? `${left === 0 ? 'Today' : left === 1 ? 'Tomorrow' : `${left} days left`}: ` : ''}the deadline to register to vote in ${stateName || 'your state'} is ${fmtDay(reg)}. Make sure you're registered:`);
    }
    if (election.early_voting_start && election.early_voting_start > today)
      add('early', 'deadline', `Early voting ${stateName ? `in ${stateName} ` : ''}starts ${fmtDay(election.early_voting_start)}. Election Day is ${day}. Make your plan now:`);
    if (election.mail_ballot_deadline && election.mail_ballot_deadline >= today)
      add('mail', 'deadline', `Voting by mail${stateName ? ` in ${stateName}` : ''}? Your application has to arrive by ${fmtDay(election.mail_ballot_deadline)}. Election Day is ${day}.`);
    if (until >= 0)
      add('countdown', 'election', `${until === 0 ? 'Election Day is today' : `${until} ${until === 1 ? 'day' : 'days'} until Election Day`} (${day}). Know who's on your ballot before you go:`);

    // 3. One race at a time, each attributed to the source that endorsed.
    for (const r of endorsed)
      add(`race:${r.contestId}`, 'endorsement', `${short(r.source)} endorses ${r.candidate} for ${office(r.title)}. Election Day is ${day}. See your whole ballot:`);
  }

  // Always something to share, even before the voter has an address.
  add('join', 'invite', "I'm using Minute Man to keep up with deadlines and get a sample ballot from America First endorsements. Join me:");
  return posts;
}
