// Jurisdiction rules and eligibility checks. Rules live in jurisdictions.rules as JSON so
// each jurisdiction can differ without code changes. Keys (all optional):
//   minAge (18), preregisterAge, onlineRegistrationUrl, statusLookupUrl, sameDayRegistration,
//   idRequired ('strict'|'non-strict'|'none'), closedPrimaries (bool), partyChangeDeadlineDays,
//   registrationDeadlineDays, ballotPhotoAllowed (informational only), notes

export function rulesFor(db, jurisdictionId) {
  // Walk up the parent chain; child keys override parent keys.
  const chain = [];
  let id = jurisdictionId;
  while (id) {
    const j = db.prepare('SELECT id, parent_id, rules FROM jurisdictions WHERE id = ?').get(id);
    if (!j) break;
    chain.unshift(JSON.parse(j.rules || '{}'));
    id = j.parent_id;
  }
  return Object.assign({ minAge: 18 }, ...chain);
}

export function jurisdictionChain(db, jurisdictionId) {
  const ids = [];
  let id = jurisdictionId;
  while (id) {
    ids.push(id);
    id = db.prepare('SELECT parent_id FROM jurisdictions WHERE id = ?').get(id)?.parent_id;
  }
  return ids;
}

export function ageOn(birthDate, onDate) {
  const b = new Date(birthDate + 'T00:00:00Z');
  const d = new Date(onDate + 'T00:00:00Z');
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

/**
 * Eligibility and action items for one user and one election.
 * Returns { eligible: bool|null, issues: [...], actions: [...] }.
 */
export function eligibility({ user, registration, election, rules, today }) {
  const issues = [];
  const actions = [];
  let eligible = true;

  if (!user.jurisdiction_id) {
    issues.push('Set your home jurisdiction so we can find your elections.');
    eligible = null;
  }
  if (!user.birth_date) {
    issues.push('Add your birth date to check age eligibility.');
    eligible = null;
  } else if (election) {
    const age = ageOn(user.birth_date, election.date);
    if (age < rules.minAge) {
      eligible = false;
      issues.push(`You will be ${age} on election day; the minimum age is ${rules.minAge}.`);
      if (rules.preregisterAge && ageOn(user.birth_date, today) >= rules.preregisterAge)
        actions.push({ kind: 'preregister', text: 'You can pre-register now.' });
    }
  }

  const status = registration?.status || 'unknown';
  if (status !== 'confirmed') {
    const deadline = election?.registration_deadline;
    if (deadline && today > deadline && !rules.sameDayRegistration) {
      issues.push(`The registration deadline (${deadline}) has passed for ${election.name}.`);
      if (status !== 'submitted') eligible = false;
    } else {
      actions.push({
        kind: status === 'submitted' ? 'check_status' : 'register',
        text:
          status === 'submitted'
            ? 'Check that your registration was processed.'
            : status === 'unknown'
              ? 'Check whether you are registered.'
              : 'Register to vote.',
        url: status === 'submitted' || status === 'unknown' ? rules.statusLookupUrl : rules.onlineRegistrationUrl,
        due: deadline || null,
        daysLeft: deadline ? daysBetween(today, deadline) : null,
      });
    }
  }

  const unaffiliated = (p) => !p || /^(independent|unaffiliated|none|no party|undeclared)$/i.test(String(p).trim());
  if (election?.kind === 'primary' && rules.closedPrimaries && !registration?.desired_party && unaffiliated(registration?.party)) {
    // Closed primary and no party on file: they can't vote in it unless they join one.
    const days = rules.partyChangeDeadlineDays ?? 0;
    const due = new Date(new Date(election.date) - days * 86400000).toISOString().slice(0, 10);
    eligible = eligible === true ? false : eligible;
    issues.push(`${election.name} is a closed primary. Only voters registered with a party can vote in it.`);
    if (today <= due)
      actions.push({
        kind: 'party_change',
        text: `To vote in this primary, register with a party by ${due}.`,
        url: rules.onlineRegistrationUrl,
        due,
        daysLeft: daysBetween(today, due),
      });
  }

  if (
    election?.kind === 'primary' &&
    rules.closedPrimaries &&
    registration?.desired_party &&
    !unaffiliated(registration.desired_party) &&
    registration.desired_party !== registration.party
  ) {
    const days = rules.partyChangeDeadlineDays ?? 0;
    const due = new Date(new Date(election.date) - days * 86400000).toISOString().slice(0, 10);
    if (today > due) {
      issues.push(`The party-change deadline (${due}) has passed for this primary.`);
    } else {
      actions.push({
        kind: 'party_change',
        text: `Change your party affiliation to ${registration.desired_party} to vote in this closed primary.`,
        url: rules.onlineRegistrationUrl,
        due,
        daysLeft: daysBetween(today, due),
      });
    }
  }

  if (rules.idRequired && rules.idRequired !== 'none')
    actions.push({ kind: 'bring_id', text: rules.idNote || 'Bring an accepted photo ID to vote in person.' });

  return { eligible, issues, actions };
}
