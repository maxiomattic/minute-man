#!/usr/bin/env python3
"""Build the app's data files from data/sources/.

  src/data/endorsements.json   AFI + Trump 2026 endorsements, normalized per race,
                               limited to candidates who were on the November ballot.
  src/data/ballot-tx-ellis.json  Nov 3, 2026 general-election ballot for Waxahachie, TX
                               (Ellis County: TX-6, State Senate 2, State House 10),
                               candidate lists from Ballotpedia race pages.

Outcomes of the general election are deliberately dropped: the showcase runs on Oct 1, 2026.

Run: python3 scripts/fetch_sources.py && python3 scripts/build_data.py
     (add `ballot` to fetch_sources.py args to refresh race pages)
"""
import html, json, re, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'sources'
OUT = ROOT / 'src' / 'data'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

STATES = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA', 'Colorado': 'CO',
    'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA',
    'Maine': 'ME', 'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
    'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
    'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA',
    'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX',
    'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY',
}
STATE_NAME = {v: k for k, v in STATES.items()}

# Race keys shared by both sources and by ballot contests.
EXEC = [  # (regex on office text, key, label)
    (r'lieutenant governor|lt\.? ?governor', 'LTGOV', 'Lieutenant Governor'),
    (r'governor', 'GOV', 'Governor'),
    (r'attorney general|\bag\b', 'AG', 'Attorney General'),
    (r'secretary of state', 'SOS', 'Secretary of State'),
    (r'comptroller', 'COMPTROLLER', 'Comptroller'),
    (r'chief financial officer|\bcfo\b', 'CFO', 'Chief Financial Officer'),
    (r'treasurer', 'TREASURER', 'Treasurer'),
    (r'auditor', 'AUDITOR', 'Auditor'),
    (r'agriculture', 'AGRICULTURE', 'Commissioner of Agriculture'),
    (r'land', 'LAND', 'Land Commissioner'),
    (r'railroad', 'RAILROAD', 'Railroad Commissioner'),
    (r'superintendent|education', 'SUPT', 'Superintendent of Education'),
    (r'insurance', 'INSURANCE', 'Insurance Commissioner'),
    (r'labor', 'LABOR', 'Labor Commissioner'),
]


def race_label(state, key):
    name = STATE_NAME.get(state, state)
    if key == 'US-SEN':
        return f'U.S. Senate, {name}'
    if key == 'US-SEN-SPECIAL':
        return f'U.S. Senate, {name} (special)'
    if key.startswith('US-HOUSE-'):
        d = key.split('-')[-1]
        return f'U.S. House, {name} At-Large' if d == 'AL' else f'U.S. House, {name} District {d}'
    if key.startswith('STATE-SEN-'):
        return f'{name} State Senate, District {key.split("-")[-1]}'
    if key.startswith('STATE-HOUSE-'):
        return f'{name} House, District {key.split("-")[-1]}'
    for _, k, label in EXEC:
        if k == key:
            return f'{label}, {name}'
    return f'{key}, {name}'


def exec_key(text):
    t = text.lower()
    for rx, k, _ in EXEC:
        if re.search(rx, t):
            return k
    return None


def clean(s):
    s = re.sub(r'<[^>]+>', '', s or '')
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


# ---------- America First Insight ----------
def afi_rows():
    feed = json.loads((SRC / 'afi-endorsements.json').read_text())
    rows = []
    for x in feed['endorsements']:
        if not x.get('visible', True) or x['year'] != 2026:
            continue
        badges = [b['text'].lower() for b in x.get('badges', [])]
        if any(b in ('lost primary', 'withdrew', 'lost primary runoff') for b in badges):
            continue  # not on the November ballot
        st, office, alt = x['state'], x['office'], x.get('imageAlt') or ''
        d = (x.get('district') or '').strip()
        key = None
        if office == 'senate':
            key = 'US-SEN-SPECIAL' if (st, x['candidateName']) in {('FL', 'Ashley Moody'), ('OH', 'Jon Husted')} else 'US-SEN'
        elif office in ('house', 'openhouseraces'):
            m = re.search(r'-(\d+)', alt)
            d = d or (m.group(1) if m else '')
            key = f'US-HOUSE-{int(d)}' if d else None
        elif office == 'governor':
            key = 'GOV' if 'senate' not in alt.lower() else 'US-SEN'
        elif office == 'statewide':
            key = exec_key(alt) or exec_key(x.get('officeLabel', ''))
        elif office == 'statehouse':
            m = re.search(r'\b(HD|SD)-?(\d+)', alt)
            if not m and d:
                key = f'STATE-HOUSE-{int(d)}'
            elif m:
                key = ('STATE-HOUSE-' if m.group(1) == 'HD' else 'STATE-SEN-') + str(int(m.group(2)))
        if not key or (st in ('NJ', 'VA') and key == 'GOV'):
            continue  # president 2028 entries, amendments, 2025 governor races, unparseable
        paras = [clean(p) for p in x.get('paragraphs', []) if clean(p)]
        note = ' '.join(paras[:2])
        if len(note) > 420:
            note = note[:417].rsplit(' ', 1)[0] + '…'
        rows.append({
            'source': 'afi', 'state': st, 'race': key, 'candidate': x['candidateName'].replace('Dr.', 'Dr. ').replace('  ', ' ').strip(),
            'party': 'R' if x.get('party', '').startswith('Rep') else (x.get('party') or '')[:1],
            'status': x.get('status', ''), 'note': note,
            'url': x.get('articleUrl') or 'https://americafirstinsight.com/america-first-endorsements/',
        })
    return rows


# ---------- Donald Trump (Ballotpedia) ----------
def trump_rows():
    data = json.loads((SRC / 'trump-2026.json').read_text())
    rows = []
    for x in data['endorsements']:
        out, typ, office = x['outcome'].lower(), x['type'], x['office']
        if 'not on the ballot' in out or out.startswith('lost primary'):
            continue
        if 'General' not in typ and not out.startswith('won primary') and 'general' not in out:
            continue
        key = state = None
        m = re.match(r'U\.S\. Senate (.+?)( \(special\))?$', office)
        if m:
            state, key = STATES.get(m.group(1)), 'US-SEN-SPECIAL' if m.group(2) else 'US-SEN'
        m = m or None
        if not key:
            m = re.match(r'U\.S\. House (.+?) (District (\d+)|At-large District)', office)
            if m:
                state, key = STATES.get(m.group(1)), f'US-HOUSE-{m.group(3)}' if m.group(3) else 'US-HOUSE-AL'
        if not key:
            m = re.match(r'(.+?) (State Senate|House of Representatives|State Assembly) District (\w+)', office)
            if m:
                state = STATES.get(m.group(1))
                key = ('STATE-SEN-' if m.group(2) == 'State Senate' else 'STATE-HOUSE-') + m.group(3)
        if not key:
            m = re.search(r' of (' + '|'.join(STATES) + r')$', office) or re.match(r'(' + '|'.join(STATES) + r') ', office)
            if m:
                state, key = STATES[m.group(1)], exec_key(office)
        if not (state and key) or '(special)' in office and not key.startswith('US-SEN'):
            continue
        rows.append({
            'source': 'trump', 'state': state, 'race': key, 'candidate': x['candidate'], 'party': x['party'] or 'R',
            'status': x['status'], 'note': '', 'url': data['source'],
        })
    return rows


# ---------- Waxahachie ballot (Ballotpedia race pages) ----------
BALLOT = [  # (race key, contest title, ballotpedia page)
    ('US-SEN', 'United States Senator', 'United_States_Senate_election_in_Texas,_2026'),
    ('US-HOUSE-6', 'U.S. Representative, District 6', "Texas'_6th_Congressional_District_election,_2026"),
    ('GOV', 'Governor', 'Texas_gubernatorial_election,_2026'),
    ('LTGOV', 'Lieutenant Governor', 'Lieutenant_Governor_of_Texas'),
    ('AG', 'Attorney General', 'Texas_Attorney_General_election,_2026'),
    ('COMPTROLLER', 'Comptroller of Public Accounts', 'Texas_Comptroller_election,_2026'),
    ('LAND', 'Commissioner of the General Land Office', 'Texas_Public_Lands_Commissioner_election,_2026'),
    ('AGRICULTURE', 'Commissioner of Agriculture', 'Texas_Agriculture_Commissioner_election,_2026'),
    ('RAILROAD', 'Railroad Commissioner', 'Texas_Railroad_Commissioner_election,_2026'),
    ('STATE-SEN-2', 'State Senator, District 2', 'Texas_State_Senate_District_2'),
    ('STATE-HOUSE-10', 'State Representative, District 10', 'Texas_House_of_Representatives_District_10'),
]
PARTY = {'R': 'Republican', 'D': 'Democratic', 'L': 'Libertarian', 'G': 'Green'}
PARTY_ORDER = 'RDLG'


def page(slug):
    cache = SRC / 'ballotpedia' / (re.sub(r'[^A-Za-z0-9_]', '', slug) + '.html')
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request('https://ballotpedia.org/' + urllib.request.quote(slug, safe=",_'"), headers={'User-Agent': UA})
        cache.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    return cache.read_text()


def general_candidates(slug):
    s = page(slug)
    for b in s.split('class="votebox"')[1:]:
        t = re.sub(r'<style.*?</style>', '', b, flags=re.S)
        t = re.sub(r'\s+', ' ', t)
        t = re.sub(r'<[^>]+>', '|', t)
        t = re.sub(r'\|[\s|]*', '|', html.unescape(t)).replace('\xa0', ' ')
        parts = [p.strip() for p in t.split('|') if p.strip() not in ('', '>')]
        if not parts or not parts[0].startswith('General election for') or 'November 3, 2026' not in t:
            continue
        body = t.split('Candidate|%|Votes|', 1)[1].split('Total votes')[0]
        toks = [p.strip() for p in body.split('|') if p.strip() and p.strip() not in ('✔', 'Submit photo')]
        out = []
        for i, tok in enumerate(toks):
            m = re.fullmatch(r'\((\w+|Independent)\)', tok)
            if not m:
                continue
            name = toks[i - 1]
            write_in = i + 1 < len(toks) and toks[i + 1] == '(Write-in)'
            if write_in:
                continue
            p = m.group(1)
            out.append({'label': name, 'party': PARTY.get(p, p)})
        out.sort(key=lambda c: PARTY_ORDER.find(c['party'][0]) if c['party'][0] in PARTY_ORDER else 9)
        return out
    raise SystemExit(f'no general election box on {slug}')


def ballot():
    contests = []
    for i, (key, title, slug) in enumerate(BALLOT):
        cands = general_candidates(slug)
        cid = 'tx26-' + key.lower()
        contests.append({
            'id': cid, 'race': key, 'title': title, 'sort': i,
            'choices': [{'id': f'{cid}-{j}', **c} for j, c in enumerate(cands)],
            'source': 'https://ballotpedia.org/' + slug,
        })
    return contests


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = afi_rows() + trump_rows()
    for r in rows:
        r['raceLabel'] = race_label(r['state'], r['race'])
    rows.sort(key=lambda r: (r['state'], r['race'], r['source']))
    (OUT / 'endorsements.json').write_text(json.dumps(rows, indent=0, ensure_ascii=False))
    print('endorsements:', len(rows), '(afi', sum(r['source'] == 'afi' for r in rows), 'trump', sum(r['source'] == 'trump' for r in rows), ')')
    b = ballot()
    (OUT / 'ballot-tx-ellis.json').write_text(json.dumps(b, indent=1, ensure_ascii=False))
    for c in b:
        print(c['title'], '|', ', '.join(f"{x['label']} ({x['party'][0]})" for x in c['choices']))


if __name__ == '__main__':
    main()
