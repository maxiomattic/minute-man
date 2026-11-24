// Address -> state, county, city and districts, using the free US Census geocoder.
// Nothing about the address is stored; callers keep only the matched area.
const URL_BASE = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

export async function censusGeocode(address) {
  const u = `${URL_BASE}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`;
  const r = await fetch(u, { headers: { 'user-agent': 'cvas' } });
  if (!r.ok) throw new Error(`Census geocoder returned ${r.status}`);
  const m = (await r.json())?.result?.addressMatches?.[0];
  if (!m) return null;
  const g = m.geographies;
  const first = (re) => Object.entries(g).find(([k]) => re.test(k))?.[1]?.[0];
  const st = first(/^States$/);
  return {
    matchedAddress: m.matchedAddress,
    state: st?.STUSAB || m.addressComponents?.state,
    county: first(/^Counties$/)?.NAME || null,
    place: first(/^Incorporated Places$/)?.BASENAME || first(/^County Subdivisions$/)?.BASENAME || null,
    cd: first(/Congressional Districts$/)?.BASENAME?.replace(/\D/g, '') || null,
    sldu: first(/Legislative Districts - Upper$/)?.BASENAME || null,
    sldl: first(/Legislative Districts - Lower$/)?.BASENAME || null,
  };
}

/**
 * Most specific jurisdiction that matches. A jurisdiction can declare
 * rules.match = { state, county, cd, sldu, sldl }; every listed key must match.
 * Falls back to the state.
 */
export function matchJurisdiction(db, geo) {
  if (!geo?.state) return null;
  const st = geo.state.toLowerCase();
  const rows = db.prepare('SELECT id, rules FROM jurisdictions').all();
  let best = null;
  let bestScore = 0;
  for (const j of rows) {
    const m = JSON.parse(j.rules || '{}').match;
    if (!m || m.state !== geo.state.toUpperCase()) continue;
    const keys = Object.keys(m).filter((k) => k !== 'state');
    if (keys.every((k) => String(geo[k] ?? '').toLowerCase() === String(m[k]).toLowerCase()) && keys.length > bestScore) {
      best = j.id;
      bestScore = keys.length;
    }
  }
  if (best) return best;
  return db.prepare('SELECT 1 FROM jurisdictions WHERE id=?').get(st) ? st : null;
}
