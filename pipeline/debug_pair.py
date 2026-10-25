# TEMPORARY: every game since Oct 1 with both Joe and Daniel in it, from the dashboard data and AoE2 Companion, and the
# tournament state for that pair. Prints match ids, times, types, flags and statuses (logs are public).
import json, os, time, urllib.request, urllib.parse
A, B = 'Joe', 'Daniel'
cfg = lambda n: json.load(open(f'config/{n}.json'))
players = {p['player']: str(p.get('profile_id') or '') for p in cfg('players')}
print('profile ids set', {k: bool(players.get(k)) for k in (A, B)})
for t in cfg('tournaments'):
    ro = {r['player'] for r in cfg('roster') if r['tournament_id'] == t['tournament_id']}
    ms = [m for m in cfg('matches') if m['tournament_id'] == t['tournament_id'] and {m.get('player_a'), m.get('player_b')} == {A, B}]
    print('tournament', t['tournament_id'], t.get('status'), t.get('start_date'), t.get('end_date'), 'both on roster', A in ro and B in ro,
          'their games', [(m['game'], m['stage'], m['status'], m.get('match_id')) for m in ms])
# admin changes not yet saved could also matter: shown on the site only
h = json.load(open('data/history.json'))
u = json.load(open('data/unrecorded.json'))
def both(rows):
    by = {}
    for r in rows:
        if r['player'] in (A, B) and r['started'] >= '2026-10-01':
            by.setdefault(r['match_id'], []).append(r)
    return {k: v for k, v in by.items() if {r['player'] for r in v} == {A, B}}
for k, v in sorted(both(h).items(), key=lambda kv: kv[1][0]['started']):
    print('history', k, v[0]['started'], v[0]['type'], 'n', v[0]['players_n'], 'won', [(r['player'][0], r['won']) for r in v], 'map', v[0]['map'])
for k, v in both(u).items():
    print('unrecorded', k, v[0]['started'], v[0].get('kind'), v[0]['type'])
# games where only one of them has a row but the other is an opponent by profile
for pl, other in ((A, B), (B, A)):
    for r in h:
        if r['player'] == pl and r['started'] >= '2026-10-15' and r.get('players_n') == 2 and r['match_id'] not in both(h):
            pass
# AoE2 Companion: each one's newest 3 pages, games with the other in them (any result, any state)
seen = set()
for pl, other in ((A, B), (B, A)):
    pid, opid = players[pl], players[other]
    for page in (1, 2, 3):
        req = urllib.request.Request(f'https://data.aoe2companion.com/api/matches?profile_ids={pid}&page={page}', headers={'User-Agent': 'aoe2-tournaments-debug'})
        for m in json.load(urllib.request.urlopen(req, timeout=30)).get('matches') or []:
            ids = [str(q.get('profileId')) for t in m.get('teams', []) for q in t.get('players', [])]
            if opid in ids and m['matchId'] not in seen and str(m.get('started', '')) >= '2026-10-01':
                seen.add(m['matchId'])
                print('companion', m['matchId'], m.get('started'), 'finished', m.get('finished'), m.get('leaderboardId'), m.get('gameModeName'),
                      'n', len(ids), 'won', [q.get('won') for t in m.get('teams', []) for q in t.get('players', [])], 'map', m.get('mapName'),
                      'in history', str(m['matchId']) in {r['match_id'] for r in h})
        time.sleep(1.5)
print('companion games between them since Oct 1:', len(seen))
