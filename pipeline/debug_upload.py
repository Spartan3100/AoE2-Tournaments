# TEMPORARY: add a real replay as if uploaded, twice (right and wrong missing-game window), run run.py, print the
# outcome. Prints ids, statuses and counts only (logs are public).
import json, os, shutil, subprocess, sys, urllib.request
D = sys.argv[1]
players = json.load(open('config/players.json'))
p = players[4]; pid = str(p['profile_id'])
hist = json.load(open(os.path.join(D, 'history.json')))
mine = sorted([r for r in hist if r['player'] == p['player'] and r['type'] == '1v1 ranked'], key=lambda r: r['started'])[-3:]
src = mine[-1]
req = urllib.request.Request(f"https://aoe.ms/replay/?gameId={src['match_id']}&profileId={pid}", headers={'User-Agent': 'aoe2-tournaments'})
data = urllib.request.urlopen(req, timeout=60).read()
print('replay bytes', len(data), 'zip', data[:2] == b'PK')
inp, out = 'w/in', 'w/out'
os.makedirs(inp + '/uploads', exist_ok=True); os.makedirs(out, exist_ok=True)
shutil.copy('config/players.json', inp)
# pretend the source game is missing from the history (a gap between the games either side)
rest = [r for r in hist if not (r['match_id'] == src['match_id'])]
json.dump(rest, open(inp + '/history.json', 'w'))
for n in ('replay_analysis', 'replay_games', 'unrecorded', 'backfill'):
    shutil.copy(os.path.join(D, n + '.json'), inp + f'/{n}.json') if os.path.exists(os.path.join(D, n + '.json')) else json.dump([] if n != 'backfill' else {}, open(inp + f'/{n}.json', 'w'))
for i in (1, 2):
    open(f'{inp}/uploads/{i}.bin', 'wb').write(data)
gap = {'started': mine[-2]['started'], 'before': '2099-01-01T00:00:00Z', 'type': '1v1 ranked', 'ladder': 'rm_1v1',
       'rating': src['rating'], 'rating_diff': src['rating_diff'], 'games': 1}
wrong = {**gap, 'started': '2020-01-01T00:00:00Z', 'before': '2020-01-02T00:00:00Z'}
ups = [{'id': 1, 'match_id': 'gap-x-y', 'player': p['player'], 'game': gap, 'file': f'{inp}/uploads/1.bin'},
       {'id': 2, 'match_id': 'gap-a-b', 'player': p['player'], 'game': wrong, 'file': f'{inp}/uploads/2.bin'},
       {'id': 3, 'match_id': 'gap-c-d', 'player': players[0]['player'], 'game': gap, 'file': f'{inp}/uploads/1.bin'}]
json.dump(ups, open(inp + '/uploads.json', 'w'))
r = subprocess.run([sys.executable, 'pipeline/run.py', '--in', inp, '--out', out, '--max-replays', '1', '--backfill-pages', '0'], capture_output=True, text=True)
print('run.py exit', r.returncode, r.stderr[-1500:])
print('results', json.load(open(out + '/uploads_result.json')))
h = json.load(open(out + '/history.json'))
row = next((x for x in h if x['match_id'] == 'up_1'), None)
print('new row', row and {k: row[k] for k in ('match_id', 'started', 'type', 'won', 'rating', 'rating_diff', 'duration_min', 'players_n', 'ladder')}, 'source started', src['started'], 'source duration', src['duration_min'], 'source won', src['won'])
g = next((x for x in json.load(open(out + '/replay_games.json')) if x['match_id'] == 'up_1'), None)
print('replay_games', g and {k: g.get(k) for k in ('status', 'has_playback', 'uploaded', 'started_at', 'speed', 'duration_min')})
an = [x for x in json.load(open(out + '/replay_analysis.json')) if x['match_id'] == 'up_1']
print('analysis rows', len(an), 'pb file', os.path.exists(out + '/pb_up_1.json'))
