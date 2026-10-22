"""Refresh job for the AoE2 tournament dashboard.

Usage:
  python -I run.py --in DIR --out DIR [--max-replays 40] [--playback-days 30]

DIR (--in) holds the dashboard's current files, as downloaded from its datasets:
  players.json, history.json, replay_analysis.json (may be missing), replay_games.json (may be missing)
--out receives:
  history.json, replay_analysis.json, replay_games.json, pb_<match_id>.json (new playback files)
  manifest.json: {"upload": [...files...], "new_playback": [{match_id, file, title}], "expired_playback": [match_id...],
                  "stats": {...}, "errors": [...]}
Network: data.aoe2companion.com (match lists) and aoe.ms (replay files).
"""
import argparse, datetime as dt, io, json, os, sys, time, urllib.request, urllib.error, zipfile, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import parse_replay, playback_rows  # noqa: E402

API = 'https://data.aoe2companion.com/api/matches?profile_ids={pid}&page={page}'
REPLAY = 'https://aoe.ms/replay/?gameId={mid}&profileId={pid}'
UA = {'User-Agent': 'aoe2-tournament-dashboard/1.0'}
WINDOW_DAYS = 36500  # keep every game (all time); the dashboard filters by period itself


def get(url, binary=False, tries=3):
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                return data if binary else json.loads(data.decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            last = e
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2 * (k + 1))
    raise RuntimeError(f'{url}: {last}')


AN_COLS = ['match_id', 'number', 'name', 'profile_id', 'civ', 'won', 'map', 'duration_min', 'eapm', 'feudal_min', 'castle_min',
           'imperial_min', 'opening', 'castle_plan', 'late_army', 'attack_style', 'defense_style', 'first_attack_min', 'aggression',
           'raid_minutes', 'villagers', 'military_units', 'palisade_tiles', 'stone_wall_tiles', 'towers', 'castles', 'town_centers',
           'market_trades', 'techs', 'unit_data', 'resigned_min', 'player', 'started', 'type', 'opp_civs', 'opp_openings',
           'build_order', 'unit_mix']
GAME_COLS = ['match_id', 'started', 'type', 'map', 'players_tracked', 'checked_at', 'map_size', 'dimension', 'duration_min',
             'rated', 'version', 'players', 'status', 'has_playback', 'playback_id', 'replay_profile_id']


def load(path, default):
    if not os.path.exists(path) and os.path.exists(path[:-5] + '.csv'):
        return default  # header-only placeholder: no rows yet
    try:
        with open(path) as f:
            d = json.load(f)
        if isinstance(d, dict):
            for k in ('rows', 'data', 'results'):
                if isinstance(d.get(k), list):
                    return d[k]
        return d
    except FileNotFoundError:
        return default


def pick(d, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ''):
            return d[k]
    return default


def game_type(m, n_players):
    lb = str(pick(m, 'leaderboardId', 'leaderboard', default='') or '').lower()
    name = str(pick(m, 'leaderboardName', default='') or '').lower()
    ranked = bool(lb) and 'unranked' not in lb and 'unranked' not in name
    if lb in ('rm_1v1', '3') or ('1v1' in lb and 'rm' in lb and ranked):
        return '1v1 ranked'
    if lb in ('rm_team', '4') or ('team' in lb and 'rm' in lb and ranked):
        return 'Team ranked'
    if lb.startswith('ew') and ranked:
        return 'Empire Wars ranked'
    if n_players == 2:
        return '1v1 unranked'
    if n_players > 2:
        return 'Team unranked'
    return 'Other'


def history_rows(m, roster_by_pid):
    """One row per tournament player in this match, in the dashboard's history shape."""
    mid = str(pick(m, 'matchId', 'match_id', 'id'))
    started = pick(m, 'started', 'startTime')
    finished = pick(m, 'finished', 'finishTime')
    if not started or not finished:
        return []  # still being played
    def ts(v):
        if isinstance(v, (int, float)):
            return dt.datetime.fromtimestamp(v, dt.timezone.utc)
        return dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    s, f = ts(started), ts(finished)
    teams = pick(m, 'teams', default=[]) or []
    everyone = []
    for t in teams:
        for p in t.get('players', []) or []:
            everyone.append((pick(t, 'teamId', 'team', default=pick(p, 'team')), p))
    n = len(everyone)
    if not any(pick(q, 'won') in (True, False, 1, 0) for _, q in everyone):
        return []  # no result recorded (abandoned or still being scored): left out, like AoE2 Companion's stats
    gtype = game_type(m, n)
    rows = []
    for team_id, p in everyone:
        pid = str(pick(p, 'profileId', 'profile_id', default=''))
        if pid not in roster_by_pid:
            continue
        mates = [q for tid, q in everyone if tid == team_id and q is not p]
        opps = [q for tid, q in everyone if tid != team_id]
        civ = lambda q: pick(q, 'civName', 'civ', default='')
        won = pick(p, 'won')
        rows.append({
            'player': roster_by_pid[pid], 'match_id': mid, 'started': s.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'type': gtype, 'map': pick(m, 'mapName', 'map', default=''), 'civ': civ(p),
            'opp_civ': civ(opps[0]) if len(opps) == 1 else '', 'opp_name': pick(opps[0], 'name', default='') if len(opps) == 1 else '',
            'opp_civs': ', '.join(civ(q) for q in opps), 'team_civs': ', '.join(civ(q) for q in mates),
            'teammates': ', '.join(str(pick(q, 'name', default='')) for q in mates),
            'players_n': n, 'won': 1 if won is True or won == 1 else 0,
            'rating': pick(p, 'rating'), 'rating_diff': pick(p, 'ratingDiff', 'rating_diff'),
            'duration_min': round((f - s).total_seconds() / 60 * 1.0, 1),
            'replay': 1 if pick(p, 'replay') else 0, 'profile_id': pid,
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--max-replays', type=int, default=40)
    ap.add_argument('--playback-days', type=int, default=30)
    ap.add_argument('--max-playbacks', type=int, default=40, help='keep map playback for at most this many of the newest games')
    ap.add_argument('--replay-days', type=int, default=60, help='only try replays of games this recent')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    errors = []

    players = load(os.path.join(a.inp, 'players.json'), [])
    roster = {str(p['profile_id']): p['player'] for p in players if p.get('profile_id')}
    history = load(os.path.join(a.inp, 'history.json'), [])
    analysis = load(os.path.join(a.inp, 'replay_analysis.json'), [])
    games = load(os.path.join(a.inp, 'replay_games.json'), [])

    # ---------- 1. new matches
    known = {(r['player'], r['match_id']) for r in history}
    cutoff = now - dt.timedelta(days=WINDOW_DAYS)
    added = 0
    for pid, name in roster.items():
        # a player with no games yet (first run, or newly added) gets their whole history; otherwise just the newest pages
        max_page = 40 if any(r['player'] == name for r in history) else 1000
        for page in range(1, max_page):
            try:
                d = get(API.format(pid=pid, page=page))
            except Exception as e:  # noqa: BLE001
                errors.append(f'match list for {name}: {e}')
                break
            ms = pick(d, 'matches', default=[]) if isinstance(d, dict) else (d or [])
            if not ms:
                break
            stop = False
            recent_cut = (now - dt.timedelta(days=2)).strftime('%Y-%m-%dT%H:%M:%SZ')
            for m in ms:
                for r in history_rows(m, roster):
                    if r['started'] < cutoff.strftime('%Y-%m-%dT%H:%M:%SZ'):
                        stop = True
                        continue
                    if (r['player'], r['match_id']) in known:
                        # reached games we already have; keep going through the last 2 days, since games can finish out of order
                        if r['started'] < recent_cut:
                            stop = True
                        continue
                    known.add((r['player'], r['match_id']))
                    history.append(r)
                    added += 1
            if stop:
                break
            time.sleep(0.5)
    history.sort(key=lambda r: (r['started'], r['player']), reverse=True)

    # ---------- 2. replays
    done = {g['match_id'] for g in games}
    rcut = (now - dt.timedelta(days=a.replay_days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    todo = {}
    for r in history:
        if r['match_id'] in done or r['started'] < rcut or r['type'] == 'Other':
            continue
        todo.setdefault(r['match_id'], []).append(r)
    new_pb = []
    tried = 0
    for mid, rows in sorted(todo.items(), key=lambda kv: kv[1][0]['started'], reverse=True):
        if tried >= a.max_replays:
            break
        tried += 1
        data, used_pid, failed_dl = None, None, False
        for r in rows:
            pid = r.get('profile_id') or next((k for k, v in roster.items() if v == r['player']), None)
            if not pid:
                continue
            try:
                data = get(REPLAY.format(mid=mid, pid=pid), binary=True)
            except Exception as e:  # noqa: BLE001
                errors.append(f'replay {mid}: {e}')
                data, failed_dl = None, True
            if data:
                used_pid = pid
                break
        base = {'match_id': mid, 'started': rows[0]['started'], 'type': rows[0]['type'], 'map': rows[0]['map'],
                'players_tracked': ', '.join(sorted({r['player'] for r in rows})), 'checked_at': now.strftime('%Y-%m-%dT%H:%M:%SZ')}
        if not data:
            # keep trying recent games on later runs; give up once they are older than replay-days
            age_days = (now - dt.datetime.fromisoformat(rows[0]['started'].replace('Z', '+00:00'))).days
            if failed_dl and len([e for e in errors if e.startswith('replay ')]) >= 3:
                break  # downloads are failing (network or server), not missing: try again next run
            if age_days >= 3 and not failed_dl:
                games.append({**base, 'status': 'No replay', 'has_playback': 0})
            continue
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = os.path.join(tmp, 'rec.aoe2record')
                if data[:2] == b'PK':
                    with zipfile.ZipFile(io.BytesIO(data)) as z:
                        name = next(n for n in z.namelist() if n.endswith('.aoe2record'))
                        with open(path, 'wb') as f:
                            f.write(z.read(name))
                else:
                    with open(path, 'wb') as f:
                        f.write(data)
                active = sum(1 for g in games if g.get('has_playback'))
                fresh = (rows[0]['started'] >= (now - dt.timedelta(days=a.playback_days)).strftime('%Y-%m-%dT%H:%M:%SZ')
                         and active < a.max_playbacks)
                res = parse_replay(path, match_id=mid, keep_playback=fresh)
        except Exception as e:  # noqa: BLE001
            errors.append(f'parse {mid}: {type(e).__name__}: {e}')
            games.append({**base, 'status': 'Could not read', 'has_playback': 0})
            continue
        pid_to_player = roster
        names_by_pid = {}
        by_num = {r['number']: r for r in res['players']}
        for row in res['players']:
            row['player'] = pid_to_player.get(str(row.get('profile_id') or ''), '')
            if not row['player']:
                continue  # only analyse the dashboard's own players
            row['started'] = base['started']
            row['type'] = base['type']
            official = next((h for h in rows if h['player'] == row['player']), None)
            if official is not None:
                row['won'] = int(official['won'])  # the official result beats the replay's own guess
            opp = [o for o in res['players'] if o.get('team') != row.get('team')]
            row['opp_civs'] = ', '.join(o['civ'] for o in opp)
            row['opp_openings'] = ', '.join(o['opening'] for o in opp)
            row.pop('team', None)
            steps = [b for b in res['build'] if b['number'] == row['number']]
            row['build_order'] = '; '.join(f"{b['min']:.1f} {b['item']}" for b in steps[:18] if b['min'] is not None)
            cls = {}
            for u in res['units']:
                if u['number'] == row['number']:
                    cls[u['class']] = cls.get(u['class'], 0) + u['count']
            row['unit_mix'] = ', '.join(f'{k} {v}' for k, v in sorted(cls.items(), key=lambda kv: -kv[1]) if k != 'Villager')
            analysis.append(row)
        if 'playback' not in res:
            games.append({**base, **{k: v for k, v in res['game'].items() if k != 'match_id'}, 'status': 'Analyzed, playback expired',
                          'has_playback': 0, 'playback_id': '', 'replay_profile_id': used_pid})
            continue
        pb = playback_rows(res['playback'], res['build'], res['units'], mid, res['game']['map'])
        fname = f'pb_{mid}.json'
        with open(os.path.join(a.out, fname), 'w') as f:
            json.dump(pb, f, separators=(',', ':'))
        games.append({**base, **{k: v for k, v in res['game'].items() if k != 'match_id'}, 'status': 'Analyzed',
                      'has_playback': 1, 'playback_id': f'pb_{mid}', 'replay_profile_id': used_pid})
        new_pb.append({'match_id': mid, 'file': fname, 'title': f"Playback {base['map']} {base['started'][:10]}"[:40]})

    # ---------- 3. playback retention
    expired = []
    pcut = (now - dt.timedelta(days=a.playback_days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    keep = {g['match_id'] for g in sorted((g for g in games if g.get('has_playback')), key=lambda g: g['started'], reverse=True)[:a.max_playbacks]}
    for g in games:
        if g.get('has_playback') and (g['started'] < pcut or g['match_id'] not in keep):
            g['has_playback'] = 0
            g['status'] = 'Analyzed, playback expired'
            expired.append(g['match_id'])

    new_pb = [p for p in new_pb if p['match_id'] not in expired]
    for mid in expired:
        try:
            os.remove(os.path.join(a.out, f'pb_{mid}.json'))
        except FileNotFoundError:
            pass

    # analysis: keep within the history window
    analysis = [r for r in analysis if r.get('started', '9') >= cutoff.strftime('%Y-%m-%dT%H:%M:%SZ')]
    games = [g for g in games if g['started'] >= cutoff.strftime('%Y-%m-%dT%H:%M:%SZ')]

    written = []
    for name, rows, cols in (('history.json', history, None), ('replay_analysis.json', analysis, AN_COLS), ('replay_games.json', games, GAME_COLS)):
        if not rows and cols:
            # the dashboard can't read an empty JSON list, so an empty result is a header-only CSV
            name = name[:-5] + '.csv'
            with open(os.path.join(a.out, name), 'w') as f:
                f.write(','.join(cols) + '\n')
        else:
            with open(os.path.join(a.out, name), 'w') as f:
                json.dump(rows, f, separators=(',', ':'), default=str)
        written.append(name)
    manifest = {
        'upload': written + [p['file'] for p in new_pb],
        'new_playback': new_pb, 'expired_playback': expired,
        'stats': {'new_history_rows': added, 'replays_tried': tried, 'replays_analyzed': len(new_pb),
                  'history_rows': len(history), 'analysis_rows': len(analysis)},
        'errors': errors[:50],
    }
    with open(os.path.join(a.out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps(manifest['stats']), len(errors), 'errors')


if __name__ == '__main__':
    main()
