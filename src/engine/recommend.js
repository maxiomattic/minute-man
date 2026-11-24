// Recommendation aggregation. Strategies are pluggable: register(name, fn).
//
// Input to a strategy for one contest:
//   recs: [{ leaderId, leaderName, priority, choiceIds: [...], note }]  (sorted by priority asc; 1 = highest)
//   contest: { id, voteFor }
// Output: { choiceIds, sourceLeaderId|null, conflicts: [{leaderId, leaderName, choiceIds}] }

const strategies = new Map();

export function register(name, fn) {
  strategies.set(name, fn);
}

export function listStrategies() {
  return [...strategies.keys()];
}

function conflictsAgainst(recs, chosen) {
  const key = JSON.stringify([...chosen].sort());
  return recs
    .filter((r) => JSON.stringify([...r.choiceIds].sort()) !== key)
    .map((r) => ({ leaderId: r.leaderId, leaderName: r.leaderName, choiceIds: r.choiceIds }));
}

// Highest-priority binding that has an opinion wins.
register('priority', (recs) => {
  const top = recs.find((r) => r.choiceIds.length > 0);
  if (!top) return { choiceIds: [], sourceLeaderId: null, conflicts: [] };
  return {
    choiceIds: top.choiceIds,
    sourceLeaderId: top.leaderId,
    conflicts: conflictsAgainst(recs.filter((r) => r.choiceIds.length), top.choiceIds),
  };
});

// Weighted vote across bindings: weight = 1/priority. Ties broken by best priority.
register('consensus', (recs, contest) => {
  const score = new Map();
  const best = new Map();
  for (const r of recs) {
    for (const c of r.choiceIds) {
      score.set(c, (score.get(c) || 0) + 1 / r.priority);
      best.set(c, Math.min(best.get(c) ?? Infinity, r.priority));
    }
  }
  const ranked = [...score.keys()].sort(
    (x, y) => score.get(y) - score.get(x) || best.get(x) - best.get(y),
  );
  const choiceIds = ranked.slice(0, contest.voteFor);
  if (!choiceIds.length) return { choiceIds: [], sourceLeaderId: null, conflicts: [] };
  const src = recs.find((r) => choiceIds.every((c) => r.choiceIds.includes(c)));
  return {
    choiceIds,
    sourceLeaderId: src ? src.leaderId : null,
    conflicts: conflictsAgainst(recs.filter((r) => r.choiceIds.length), choiceIds),
  };
});

export function aggregate(strategy, recs, contest) {
  const fn = strategies.get(strategy) || strategies.get('priority');
  const sorted = [...recs].sort((a, b) => a.priority - b.priority);
  return fn(sorted, contest);
}

// ---------- Minute Man's fill-in when no source endorsed ----------
// Every candidate race gets a pick. After the sources (AFI, then Trump), the order is:
//   1. one Republican running: that Republican;
//   2. no more candidates than seats (uncontested): all of them;
//   3. several Republicans: an incumbent Republican first, otherwise ballot order;
//   4. no Republican: Libertarian, then Constitution and other right-of-center parties, then independents
//      and candidates with no party, then other parties; a Democrat only when nothing else is running;
//   5. nonpartisan (no party labels at all): the incumbent if known, otherwise the first listed.
// `why` is a short, true line about which rule applied. It never claims anything about the candidate.
// Incumbency is read from `choice.incumbent` when the ballot data has it.

const isRep = (p) => /^republican/i.test(p || '');
const isDem = (p) => /^democrat/i.test(p || '');
/** Lower is preferred. */
export function partyRank(p) {
  if (!p) return 4;
  if (isRep(p)) return 0;
  if (/^libertarian/i.test(p)) return 1;
  if (/^constitution/i.test(p)) return 2;
  if (/conservative|reform|america first|american independent|taxpayers/i.test(p)) return 3;
  if (/independent|nonpartisan|no party|unaffiliated|none/i.test(p)) return 4;
  if (isDem(p)) return 6;
  return 5;
}

const partyNoun = (p) => (!p || partyRank(p) === 4 ? (p && /independent/i.test(p) ? 'independent' : null) : p.replace(/ Party$/i, '').replace(/^Democratic$/i, 'Democratic'));

/**
 * @param {Array<{id:string, party?:string|null, incumbent?:boolean}>} choices in ballot order
 * @param {number} voteFor
 * @returns {{choiceIds:string[], basis:string, why:string}|null}
 */
export function fallbackPick(choices, voteFor = 1) {
  const n = Math.max(1, voteFor || 1);
  if (!choices.length) return null;
  const plural = n > 1;
  const order = (list, rank = () => 0) => list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || (b.c.incumbent ? 1 : 0) - (a.c.incumbent ? 1 : 0) || a.i - b.i)
    .map((x) => x.c);
  const reps = choices.filter((c) => isRep(c.party));
  const ids = (list) => list.slice(0, n).map((c) => c.id);

  if (reps.length && reps.length === n)
    return { choiceIds: ids(reps), basis: 'party', why: plural ? 'The Republican candidates in this race.' : 'The Republican candidate in this race.' };
  if (choices.length <= n)
    return { choiceIds: ids(choices), basis: 'uncontested', why: choices.length > 1 ? 'The only candidates in this race.' : 'The only candidate in this race.' };
  if (choices.every((c) => !c.party)) {
    const picked = order(choices).slice(0, n);
    const inc = picked.some((c) => c.incumbent);
    return { choiceIds: ids(picked), basis: 'nonpartisan',
      why: `A nonpartisan race. Minute Man's ${plural ? 'picks are' : 'pick is'} ${inc ? `the incumbent${plural ? ', then the first listed' : ''}` : `the first-listed candidate${plural ? 's' : ''}`}.` };
  }
  if (reps.length > n) {
    const picked = order(reps).slice(0, n);
    const inc = picked.some((c) => c.incumbent);
    return { choiceIds: ids(picked), basis: 'republican',
      why: inc && !plural ? 'The incumbent Republican.'
        : `Several Republicans are running. Minute Man's ${plural ? 'picks are' : 'pick is'} ${inc ? 'the incumbent, then the first listed' : `the first-listed Republican${plural ? 's' : ''}`}.` };
  }
  // No Republican (or fewer than the seats): fill by party, then ballot order.
  const picked = order(choices, (c) => partyRank(c.party)).slice(0, n);
  if (reps.length)
    return { choiceIds: ids(picked), basis: 'party-order', why: "Minute Man's picks are the Republican candidates, then the rest by party and ballot order." };
  const top = picked[0];
  const noun = partyNoun(top.party);
  const sameParty = choices.filter((c) => partyRank(c.party) === partyRank(top.party)).length > 1;
  let why;
  if (plural) why = "No Republican is running. Minute Man's picks follow party, then ballot order.";
  else if (choices.every((c) => isDem(c.party))) why = "Only Democrats are running. Minute Man's pick is the first listed.";
  else if (noun) why = `No Republican is running. Minute Man's pick is ${sameParty ? `the first-listed ${noun} candidate` : `the ${noun} candidate`}.`;
  else why = `No Republican is running. Minute Man's pick is ${sameParty ? 'the first-listed candidate with no party' : 'the candidate with no party'}.`;
  return { choiceIds: ids(picked), basis: 'party-order', why };
}

/** Minute Man's line for a source's pick that has no write-up. Only states the candidate's party. */
export function partyWhy(choices, ids) {
  const picked = choices.filter((c) => ids.includes(c.id));
  if (!picked.length) return '';
  if (picked.every((c) => isRep(c.party))) {
    const reps = choices.filter((c) => isRep(c.party)).length;
    if (picked.length > 1) return reps === picked.length ? 'The Republican candidates in this race.' : 'Republican candidates in this race.';
    return reps === 1 ? 'The Republican candidate in this race.' : 'A Republican candidate in this race.';
  }
  return picked.length > 1 ? "Minute Man's picks for this race." : "Minute Man's pick for this race.";
}
