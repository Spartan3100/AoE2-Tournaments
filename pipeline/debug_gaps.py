# TEMPORARY: spread of rating gaps (counts only; logs are public)
import collections, json, os, sys
D = sys.argv[1]
players = json.load(open('config/players.json')); num = {p['player']: i for i, p in enumerate(players, 1)}
u = json.load(open(os.path.join(D, 'unrecorded.json')))
h = json.load(open(os.path.join(D, 'history.json')))
gaps = [r for r in u if r.get('kind') == 'not_in_records']
lad = collections.Counter((r['player'], r.get('ladder')) for r in h if r.get('ladder'))
print('ranked rows with ladder per player/ladder', {f'#{num[k[0]]} {k[1]}': v for k, v in lad.items()})
print('gaps by player/ladder', collections.Counter(f"#{num[r['player']]} {r['ladder']}" for r in gaps))
print('gaps by year', sorted(collections.Counter(r['started'][:4] for r in gaps).items()))
print('rated rows by year', sorted(collections.Counter(r['started'][:4] for r in h if r.get('ladder') and r.get('rating') is not None).items()))
print('jump sizes', sorted(collections.Counter((abs(r['rating_diff']) // 8) * 8 for r in gaps).items()))
print('multi-game', sum(1 for r in gaps if (r.get('games') or 1) > 1), 'positive', sum(1 for r in gaps if r['rating_diff'] > 0))
# time between the games either side: a real missing game needs room to be played
import datetime as dt
ts = lambda v: dt.datetime.fromisoformat(v.replace('Z', '+00:00'))
mins = [(ts(r['before']) - ts(r['started'])).total_seconds() / 60 for r in gaps]
print('room (min) buckets', sorted(collections.Counter('<5' if m < 5 else '<15' if m < 15 else '<60' if m < 60 else '<1d' if m < 1440 else '>1d' for m in mins).items()))
small = [r for r, m in zip(gaps, mins) if m < 5]
for r in small[:8]:
    print('  tight', r['match_id'], r['started'], r['before'], r['ladder'], r['rating_diff'])
