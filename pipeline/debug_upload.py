# TEMPORARY: check_upload against a real replay: as the missing game it is (accepted), as a game already listed, for
# the wrong player, and twice. Prints ids, statuses and counts only (logs are public).
import json, os, sys, urllib.request
sys.path.insert(0, 'pipeline')
import run
D = sys.argv[1]
players = json.load(open('config/players.json'))
roster = {str(p['profile_id']): p['player'] for p in players if p.get('profile_id')}
p = players[4]; pid = str(p['profile_id'])
hist = json.load(open(os.path.join(D, 'history.json')))
mine = sorted([r for r in hist if r['player'] == p['player'] and r['type'] == '1v1 ranked'], key=lambda r: r['started'])[-4:]
src = mine[-2]
for r in mine:
    r['ladder'] = 'rm_1v1'  # the data branch predates the ladder field
req = urllib.request.Request(f"https://aoe.ms/replay/?gameId={src['match_id']}&profileId={pid}", headers={'User-Agent': 'aoe2-tournaments'})
res = run.read_replay(urllib.request.urlopen(req, timeout=60).read(), '')
print('replay started_at', res['game']['started_at'], 'listed', src['started'])
rest = [r for r in hist if r['match_id'] != src['match_id']]
def go(name, u, h):
    gaps = run.rating_gaps(h, [])
    try:
        mid, row = run.check_upload(u, res, h, roster, gaps)
        print(name, 'ACCEPTED', mid, row and {k: row[k] for k in ('started', 'won', 'rating', 'rating_diff', 'duration_min', 'ladder')})
        return row
    except ValueError as e:
        print(name, 'rejected:', e)
gap = [g for g in run.rating_gaps(rest, []) if g['player'] == p['player']][:1]
print('gap made by hiding the game', [(g['match_id'], g['started'], g['before'], g['rating'], g['rating_diff']) for g in gap], 'hidden game rating', src['rating'], src['rating_diff'])
u = {'id': 1, 'match_id': gap[0]['match_id'] if gap else 'gap-?', 'player': p['player'], 'game': {}}
row = go('missing game', u, rest)
go('same game already listed', u, hist)
go('wrong player', {**u, 'player': players[0]['player']}, rest)
if row:
    go('second copy after the first', {**u, 'id': 2}, rest + [row])
go('existing game, right id', {'id': 5, 'match_id': src['match_id'], 'player': p['player']}, hist)
go('existing game, wrong id', {'id': 6, 'match_id': mine[0]['match_id'], 'player': p['player']}, hist)
