# TEMPORARY: each of the two players' games over the last 10 days (dashboard data), with flags only (logs are public).
import json
A, B = 'Joe', 'Daniel'
players = {p['player']: p for p in json.load(open('config/players.json'))}
h = json.load(open('data/history.json')); u = json.load(open('data/unrecorded.json'))
for pl, other in ((A, B), (B, A)):
    steam = (players[other].get('steam_name') or '').lower()
    rows = sorted([r for r in h + u if r['player'] == pl and r['started'] >= '2026-10-15'], key=lambda r: r['started'])
    print(f'== {pl}: {len(rows)} games since Oct 15')
    for r in rows:
        names = (str(r.get('opp_name') or '') + ',' + str(r.get('teammates') or '')).lower()
        print('  ', r['started'][:16], r.get('kind') or 'listed', r['type'], 'n', r.get('players_n'), 'won', r.get('won'),
              'opp is the other player by name' if steam and steam in names else '', 'map', r.get('map'))
