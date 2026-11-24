#!/usr/bin/env python3
"""Refresh endorsement source data into data/sources/.

  afi-endorsements.json   America First Insight's public feed (as published)
  trump-2026.json         Donald Trump's 2026 endorsements, parsed from Ballotpedia's tables
  ballot-<slug>.json      general-election candidate lists for the races in data/races.json

Run: python3 scripts/fetch_sources.py
"""
import html, json, re, sys, urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'sources'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8', 'replace')


class Tables(HTMLParser):
    """Collects every <table> as a list of rows of cell text."""

    def __init__(self):
        super().__init__()
        self.tables, self.stack, self.cell = [], [], None

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.stack.append([])
        elif tag == 'tr' and self.stack:
            self.stack[-1].append([])
        elif tag in ('td', 'th') and self.stack and self.stack[-1]:
            self.cell = []
        elif tag == 'br' and self.cell is not None:
            self.cell.append(' ')

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None and self.stack and self.stack[-1]:
            self.stack[-1][-1].append(re.sub(r'\s+', ' ', ''.join(self.cell)).strip())
            self.cell = None
        elif tag == 'table' and self.stack:
            t = self.stack.pop()
            self.tables.append(t)

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def tables(page):
    p = Tables()
    p.feed(page)
    return p.tables


def afi():
    data = json.loads(get('https://data.americafirstinsight.com/Endorsements/data/endorsements.json'))
    (OUT / 'afi-endorsements.json').write_text(json.dumps(data, indent=1))
    print('AFI:', len(data['endorsements']), 'endorsements, updated', data.get('lastUpdated'))


def trump():
    rows = []
    for t in tables(get('https://ballotpedia.org/Endorsements_by_Donald_Trump')):
        if not t or not t[0]:
            continue
        m = re.match(r'(.+) endorsements by Donald Trump, 2026$', t[0][0])
        if not m or m.group(1) == 'Withdrawn':
            continue
        for r in t[2:]:
            if len(r) < 5:
                continue
            name = re.sub(r'\s*source( \d)?', '', r[0]).strip()
            party = re.search(r'\((\w)\)\s*$', name)
            rows.append({
                'category': m.group(1),
                'candidate': re.sub(r'\s*\(\w\)\s*$', '', name),
                'party': party.group(1) if party else None,
                'status': r[1], 'office': r[2], 'type': r[3], 'outcome': r[4],
            })
    (OUT / 'trump-2026.json').write_text(json.dumps({'source': 'https://ballotpedia.org/Endorsements_by_Donald_Trump', 'endorsements': rows}, indent=1))
    print('Trump:', len(rows), 'endorsements')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    which = sys.argv[1:] or ['afi', 'trump']
    for w in which:
        globals()[w]()
