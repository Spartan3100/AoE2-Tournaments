"""Temporary diagnosis: is any player's match history incomplete? (Not part of the update job.)

  python pipeline/debug_history.py DATA_DIR

For each tracked player, compares the games the site has with what AoE2 Companion reports, page by page.
Prints profile ids and counts only (workflow logs of a public repository are public).
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run  # noqa: E402

data = sys.argv[1]
players = json.load(open(os.path.join(os.path.dirname(data), 'config', 'players.json')))
history = json.load(open(os.path.join(data, 'history.json')))
for p in players:
    pid, name = str(p['profile_id']), p['player']
    have = [r for r in history if r['player'] == name]
    kinds = collections.Counter(r['type'] for r in have)
    print(f'\n=== profile {pid}: site has {len(have)} games, oldest {min((r["started"] for r in have), default="-")[:10]}; by type {dict(kinds)}', flush=True)
    seen, page, sizes = set(), 1, []
    while page < 400:
        try:
            d = run.get(run.API.format(pid=pid, page=page))
        except Exception as e:  # noqa: BLE001
            print(f'  page {page}: ERROR {e}')
            break
        ms = d.get('matches', []) if isinstance(d, dict) else (d or [])
        if page == 1 and isinstance(d, dict):
            print('  response keys', sorted(d.keys()), {k: d[k] for k in d if k != 'matches' and not isinstance(d[k], (list, dict))})
        sizes.append(len(ms))
        if not ms:
            break
        for m in ms:
            seen.add(str(run.pick(m, 'matchId', 'match_id', 'id')))
        page += 1
    rows = {r['match_id'] for r in have}
    print(f'  companion: {len(seen)} matches over {len(sizes)} pages (sizes {sizes[:5]}...{sizes[-3:]}); missing from site: {len(seen - rows)}')
    try:
        prof = run.get(f'https://data.aoe2companion.com/api/profiles/{pid}')
        for lb in (prof or {}).get('leaderboards', []) or []:
            print('  leaderboard', lb.get('leaderboardId') or lb.get('leaderboardName'), 'games', lb.get('games'), 'wins', lb.get('wins'))
    except Exception as e:  # noqa: BLE001
        print('  profile: ERROR', e)
