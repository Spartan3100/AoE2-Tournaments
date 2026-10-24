# TEMPORARY: for each player, list the last 48 hours of games in AoE2 Companion, Microsoft's API and the dashboard.
# Prints only player numbers, match ids, times, types and result flags (logs are public).
import datetime as dt, json, os, sys, time, urllib.request, urllib.parse

DATA = sys.argv[1]
players = json.load(open('config/players.json'))
hist = json.load(open(os.path.join(DATA, 'history.json')))
cut = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=30)

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'aoe2-tournaments-debug'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception as e:
        return {'_error': str(e)[:120]}

for i, p in enumerate(players, 1):
    if i != 5:
        continue
    pid = str(p.get('profile_id') or '')
    if not pid:
        continue
    print(f'=== player #{i}')
    mine = sorted({r['match_id']: r['started'] for r in hist if r.get('player') == p['player'] and r.get('started', '') >= cut.strftime('%Y-%m-%dT%H:%M:%SZ')}.items(), key=lambda x: x[1])
    print(f'dashboard: {len(mine)}', [m for m, _ in mine])
    c = get(f'https://data.aoe2companion.com/api/matches?profile_ids={pid}&page=1')
    if '_error' in c:
        print('companion error', c['_error'])
    for m in (c.get('matches') or []):
        if str(m.get('started', '')) < cut.isoformat():
            continue
        me = [q for t in m.get('teams', []) for q in t.get('players', []) if str(q.get('profileId')) == pid]
        print('companion', m.get('matchId'), m.get('started'), m.get('finished'), m.get('leaderboardId'), m.get('gameModeName') or m.get('gameMode'),
              'n', sum(len(t.get('players', [])) for t in m.get('teams', [])), 'won', [q.get('won') for q in me],
              'rating', [(q.get('rating'), q.get('ratingDiff')) for q in me])
    time.sleep(1.5)
    for q in ([pid], [int(pid)]):
        url = 'https://aoe-api.worldsedgelink.com/community/leaderboard/getRecentMatchHistory?title=age2&profile_ids=' + urllib.parse.quote(json.dumps(q))
        w = get(url)
        if '_error' not in w and w.get('matchHistoryStats') is not None:
            break
    if '_error' in w:
        print('microsoft error', w['_error'])
    rows = w.get('matchHistoryStats') or []
    print('microsoft keys', sorted(w.keys())[:8], 'rows', len(rows))
    for m in rows:
        st = m.get('startgametime') or 0
        if st < cut.timestamp():
            continue
        res = [r.get('resulttype') for r in m.get('matchhistoryreportresults', []) if str(r.get('profile_id')) == pid]
        mem = [x for x in m.get('matchhistorymember', []) if str(x.get('profile_id')) == pid]
        print('  rating', [(x.get('oldrating'), x.get('newrating')) for x in mem])
        print('microsoft', m.get('id'), dt.datetime.fromtimestamp(st, dt.timezone.utc).isoformat(),
              'end', m.get('completiontime'), 'type', m.get('matchtype_id'), 'n', m.get('maxplayers'),
              'reports', len(m.get('matchhistoryreportresults', [])), 'result', res)
    time.sleep(1.5)

# previous ranked games and Microsoft's ladder totals for player #5
p = players[4]; pid = str(p['profile_id'])
rows = sorted([r for r in hist if r.get('player') == p['player'] and r.get('type') == 'rm_1v1' or (r.get('player') == p['player'] and 'rm_1v1' in str(r.get('type')))], key=lambda r: r['started'])
print('dashboard types', sorted({r.get('type') for r in hist if r.get('player') == p['player']}))
rm = sorted([r for r in hist if r.get('player') == p['player'] and r.get('players_n') == 2 and r.get('rating')], key=lambda r: r['started'])
for r in rm[-5:]:
    print('prev', r['match_id'], r['started'], r.get('type'), 'rating', r.get('rating'), r.get('rating_diff'), 'won', r.get('won'))
print('dashboard 1v1 rated rows', len(rm), 'wins', sum(1 for r in rm if r.get('won')))
w = get('https://aoe-api.worldsedgelink.com/community/leaderboard/GetPersonalStat?title=age2&profile_ids=' + urllib.parse.quote(json.dumps([int(pid)])))
print('personal keys', sorted(w.keys()))
for s in w.get('leaderboardStats', []):
    print('ladder', s.get('leaderboard_id'), 'wins', s.get('wins'), 'losses', s.get('losses'), 'drops', s.get('drops'), 'disputes', s.get('disputes'), 'rating', s.get('rating'), 'last', s.get('lastmatchdate'))
c = get(f'https://data.aoe2companion.com/api/profiles/{pid}')
for l in c.get('leaderboards', []) or []:
    print('companion ladder', l.get('leaderboardId'), 'games', l.get('games'), 'wins', l.get('wins'), 'losses', l.get('losses'), 'drops', l.get('drops'), 'rating', l.get('rating'))
