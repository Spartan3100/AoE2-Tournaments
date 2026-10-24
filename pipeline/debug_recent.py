# TEMPORARY: run rating_gaps over each player's newest 100 games, to see how often it finds a jump (logs are public:
# player numbers, match ids and rating changes only).
import json, sys, time, types, urllib.request
sys.path.insert(0, 'pipeline')
import run

players = json.load(open('config/players.json'))
roster = {str(p['profile_id']): p['player'] for p in players if p.get('profile_id')}
num = {p['player']: i for i, p in enumerate(players, 1)}
rows, nores = {}, {}
for pid in roster:
    for page in range(1, 6):
        req = urllib.request.Request(run.API.format(pid=pid, page=page), headers={'User-Agent': 'aoe2-tournaments-debug'})
        ms = json.load(urllib.request.urlopen(req, timeout=30)).get('matches') or []
        for m in ms:
            for r in run.history_rows(m, roster):
                if r['player'] != roster[pid]:
                    continue
                (nores if r['won'] is None else rows)[(r['player'], r['match_id'])] = r
        time.sleep(1.5)
gaps = run.rating_gaps(list(rows.values()), list(nores.values()))
for name in roster.values():
    mine = [g for g in gaps if g['player'] == name]
    n = sum(1 for r in rows.values() if r['player'] == name)
    print(f'player #{num[name]}: {n} games, {sum(1 for r in nores.values() if r["player"] == name)} without result, {len(mine)} gaps')
    for g in mine:
        print('  ', g['match_id'], g['started'], g['ladder'], 'jump', g['rating_diff'], 'won', g['won'], 'games', g['games'])
