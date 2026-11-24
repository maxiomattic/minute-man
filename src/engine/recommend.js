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
