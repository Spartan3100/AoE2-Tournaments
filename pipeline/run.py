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
from analyze import READER, parse_replay, playback_rows  # noqa: E402

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
             'rated', 'version', 'players', 'status', 'has_playback', 'playback_id', 'replay_profile_id', 'retried', 'reader', 'error']


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


BACKFILL_V = 2
MAX_ONE_GAME = 32  # the most one ranked game moves a rating (Elo, K = 32)


def rating_gaps(history, no_result):
    """Games Microsoft counted on the ladder but left out of its match history (so no site can list them): a
    player's rating before a ranked game should be their rating after the previous game on the same ladder. A jump
    in between is one or more unlisted games. Only rows that know their ladder are compared (quick play and ranked
    1v1 are separate ratings), and the history between them is complete, as each player's pages are fetched in order."""
    out = []
    chains = {}
    for r in list(history) + list(no_result):
        if r.get('ladder') and r.get('rating') is not None and 'ranked' in str(r.get('type', '')):
            chains.setdefault((r['player'], r['ladder']), []).append(r)
    for (player, ladder), rows in chains.items():
        rows.sort(key=lambda r: r['started'])
        jumps = []  # (index of the game before the jump, rating after it, jump)
        for i, (a, b) in enumerate(zip(rows, rows[1:])):
            if a.get('rating_diff') is None and a.get('won') is not None:
                continue
            after = int(a['rating']) + int(a.get('rating_diff') or 0)
            if int(b['rating']) != after:
                jumps.append((i, after, int(b['rating']) - after))
        # a jump undone over the next game or few (+23 then -23) is one game listed with the wrong rating, not
        # missing games: seen in team games on 2026-10-24, where it was 10 of 13 jumps
        keep, k = [], 0
        while k < len(jumps):
            end = None
            for j in range(k, min(k + 3, len(jumps))):
                if jumps[j][0] - jumps[k][0] != j - k:
                    break  # only jumps between back-to-back games
                if j > k and sum(x[2] for x in jumps[k:j + 1]) == 0:
                    end = j
                    break
            if end is None:
                keep.append(jumps[k])
                k += 1
            else:
                k = end + 1
        for i, after, jump in keep:
            a, b = rows[i], rows[i + 1]
            end = dt.datetime.fromisoformat(a['started'].replace('Z', '+00:00')) + dt.timedelta(minutes=float(a.get('duration_min') or 0))
            one = abs(jump) <= MAX_ONE_GAME
            out.append({
                'player': player, 'match_id': f"gap-{a['match_id']}-{b['match_id']}", 'kind': 'not_in_records',
                'started': end.strftime('%Y-%m-%dT%H:%M:%SZ'), 'before': b['started'], 'type': a['type'], 'ladder': ladder,
                'rating': after, 'rating_diff': jump, 'won': (1 if jump > 0 else 0) if one else None,
                'games': 1 if one else -(-abs(jump) // MAX_ONE_GAME),  # at least this many
            })
    return sorted(out, key=lambda r: r['started'], reverse=True)


def read_replay(data, mid, playback=False):
    """Parse replay bytes (a .aoe2record, or the zip Microsoft's server sends)."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'rec.aoe2record')
        if data[:2] == b'PK':
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                name = next(n for n in z.namelist() if n.endswith('.aoe2record'))
                data = z.read(name)
        with open(path, 'wb') as f:
            f.write(data)
        return parse_replay(path, match_id=mid, keep_playback=playback)


def check_upload(u, res, history, roster, gaps):
    """Is this uploaded replay the game it was added to? Returns (match_id, new history row or None) or raises
    ValueError with a reason the site shows."""
    pid = next((k for k, v in roster.items() if v == u['player']), None)
    me = next((p for p in res['players'] if pid and p['profile_id'] == pid), None)
    if not me:
        raise ValueError(f"{u['player']} isn't in this replay")
    when = res['game'].get('started_at') or ''
    ts = lambda v: dt.datetime.fromisoformat(v.replace('Z', '+00:00'))
    near = lambda lo, hi: when and ts(lo) <= ts(when) <= ts(hi)
    if not str(u['match_id']).startswith('gap-'):
        rows = [r for r in history if r['match_id'] == u['match_id'] and r['player'] == u['player']]
        if not rows:
            raise ValueError('That game isn\'t in the history')
        lo, hi = (ts(rows[0]['started']) + dt.timedelta(hours=h) for h in (-2, 2))
        if not near(lo.isoformat(), hi.isoformat()):
            raise ValueError(f"This replay is from {when[:16].replace('T', ' ') or 'an unknown time'} UTC, not this game ({rows[0]['started'][:16].replace('T', ' ')} UTC)")
        return u['match_id'], None
    # a game missing from Microsoft's history: one this job found (the site's copy of its details is not trusted), by
    # id, or, as an id names the games either side and can change when another game turns up, by when it was played
    mine = [r for r in gaps if r['player'] == u['player']]
    # a missing game starts after the game before it ended (10 minutes' slack for the two clocks)
    lo, hi = lambda r: (ts(r['started']) - dt.timedelta(minutes=10)).isoformat(), lambda r: (ts(r['before']) + dt.timedelta(minutes=5)).isoformat()
    g = next((r for r in mine if r['match_id'] == u['match_id']), None) or next((r for r in mine if near(lo(r), hi(r))), None)
    listed = next((r for r in history if r['player'] == u['player'] and when and abs((ts(r['started']) - ts(when)).total_seconds()) < 180), None)
    if listed is not None:
        raise ValueError(f"This replay is of a game that is already listed ({listed['started'][:16].replace('T', ' ')} UTC)")
    if g is None:
        raise ValueError('That game is no longer missing (it may have turned up, or a replay was already added for it)')
    if not near(lo(g), hi(g)):
        raise ValueError(f"This replay is from {when[:16].replace('T', ' ') or 'an unknown time'} UTC; the missing game was between "
                         f"{g['started'][:16].replace('T', ' ')} and {g['before'][:16].replace('T', ' ')} UTC")
    players = res['players']
    if ('1v1' in str(g.get('type'))) != (len(players) == 2):
        raise ValueError(f'This replay has {len(players)} players; the missing game was a {g.get("type")} game')
    opps = [p for p in players if p is not me and (me['team'] is None or p['team'] != me['team'])]
    mates = [p for p in players if p is not me and p not in opps]
    jump = int(g.get('rating_diff') or 0)
    one = int(g.get('games') or 1) == 1
    # one game's rating change says who won more reliably than the replay (whose result is missing after a drop)
    won = (1 if jump > 0 else 0) if one and jump else int(me['won'])
    speed = (res['game'].get('speed') or 170) / 100
    mid = f"up_{int(u['id'])}"
    return mid, {
        'player': u['player'], 'match_id': mid, 'started': when, 'type': g.get('type', ''), 'map': res['game']['map'],
        'civ': me['civ'], 'opp_civ': opps[0]['civ'] if len(opps) == 1 else '', 'opp_name': opps[0]['name'] if len(opps) == 1 else '',
        'opp_civs': ', '.join(p['civ'] for p in opps), 'team_civs': ', '.join(p['civ'] for p in mates),
        'teammates': ', '.join(p['name'] for p in mates), 'players_n': len(players), 'won': won,
        # with its rating it closes the gap it fills (rating_gaps); a gap of several games stays, less this one
        'rating': g.get('rating') if one else None, 'rating_diff': jump if one else None,
        'duration_min': round(res['game']['duration_min'] / speed, 1), 'replay': 1, 'profile_id': pid, 'replay_ids': pid,
        'ladder': g.get('ladder', ''), 'uploaded': 1,
    }


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
    # no result recorded (a disconnect, or still being scored): kept apart in unrecorded.json, so it counts as a game
    # played without counting as a win or a loss
    no_result = not any(pick(q, 'won') in (True, False, 1, 0) for _, q in everyone)
    gtype = game_type(m, n)
    ids = replay_ids(everyone)
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
            'players_n': n, 'won': None if no_result else 1 if won is True or won == 1 else 0,
            'rating': pick(p, 'rating'), 'rating_diff': pick(p, 'ratingDiff', 'rating_diff'),
            'duration_min': round((f - s).total_seconds() / 60 * 1.0, 1),
            'replay': 1 if pick(p, 'replay') else 0, 'profile_id': pid, 'replay_ids': ids,
            'ladder': str(pick(m, 'leaderboardId', 'leaderboard', default='') or ''),
        })
    return rows


def is_scenario(rows):
    """A custom scenario game (the match list names its map "... (Scenario)")."""
    return any('(scenario)' in str(r.get('map', '')).lower() for r in rows)


def replay_ids(everyone):
    """Profile IDs of everyone in the match, those the match list says saved a replay first. Each player's game saves
    its own copy, so when one copy is missing on the server another player's usually is not."""
    ids = [(0 if pick(p, 'replay') else 1, str(pick(p, 'profileId', 'profile_id', default=''))) for _, p in everyone]
    return ','.join(dict.fromkeys(pid for _, pid in sorted(ids, key=lambda x: x[0]) if pid))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--max-replays', type=int, default=40)
    ap.add_argument('--playback-days', type=int, default=0, help='0 = keep map playback for every game')
    ap.add_argument('--max-playbacks', type=int, default=0, help='0 = no limit; otherwise keep playback for this many of the newest games')
    # 40 pages spaced 1.5 s apart never drew a 429 (2026-10-23); 150 takes ~4 minutes per run and still pauses cleanly if refused
    ap.add_argument('--backfill-pages', type=int, default=150, help='older match-list pages to fetch per run, all players together')
    ap.add_argument('--replay-days', type=int, default=0, help='0 = try every game in the history; otherwise only games this recent')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    errors = []

    players = load(os.path.join(a.inp, 'players.json'), [])
    roster = {str(p['profile_id']): p['player'] for p in players if p.get('profile_id')}
    history = load(os.path.join(a.inp, 'history.json'), [])
    analysis = load(os.path.join(a.inp, 'replay_analysis.json'), [])
    games = load(os.path.join(a.inp, 'replay_games.json'), [])
    backfill = load(os.path.join(a.inp, 'backfill.json'), {})  # profile id -> {page, done}: how far each history is fetched
    if not isinstance(backfill, dict):
        backfill = {}
    # games without a result (kept apart from history so they never count as a win or a loss)
    no_result = {(r['player'], r['match_id']): r for r in load(os.path.join(a.inp, 'unrecorded.json'), []) if r.get('kind') == 'no_result'}
    # walk every history once more (BACKFILL_V): the first walk dropped games without a result and didn't keep which
    # ladder each game was on, which is what finding games missing from Microsoft's records needs
    for pid, st in list(backfill.items()):
        if isinstance(st, dict) and st.get('v') != BACKFILL_V:
            backfill[pid] = {'page': 1, 'done': False, 'v': BACKFILL_V}
    stats_note = []

    # ---------- 1. matches
    known = {(r['player'], r['match_id']) for r in history}
    by_key = {(r['player'], r['match_id']): r for r in history}
    cutoff = now - dt.timedelta(days=WINDOW_DAYS)
    cut = cutoff.strftime('%Y-%m-%dT%H:%M:%SZ')
    added = 0

    def take(ms):
        """Add every new row in these matches (for any tracked player); returns this page's rows."""
        nonlocal added
        rows = [r for m in ms for r in history_rows(m, roster) if r['started'] >= cut]
        for r in rows:
            k = (r['player'], r['match_id'])
            if r['won'] is None:
                if k not in known:
                    no_result[k] = {**r, 'kind': 'no_result'}
                continue
            no_result.pop(k, None)  # a result has come in since
            if k in known:
                have = by_key.get(k)
                if have is not None:
                    for f in ('replay_ids', 'ladder'):
                        if r.get(f) and not have.get(f):
                            have[f] = r[f]
                continue
            known.add(k)
            by_key[k] = r
            history.append(r)
            added += 1
        return rows

    def page_of(pid, page):
        d = get(API.format(pid=pid, page=page))
        return pick(d, 'matches', default=[]) if isinstance(d, dict) else (d or [])

    # 1a. new games: each player's newest pages, until one of THEIR OWN games we already have (older than 2 days, as
    # games can finish out of order). A game shared with another tracked player doesn't count: that once stopped a
    # player's download after one page because the first player's download had already added their shared games.
    recent_cut = (now - dt.timedelta(days=2)).strftime('%Y-%m-%dT%H:%M:%SZ')
    for pid, name in roster.items():
        mine_before = {mid for (p, mid) in known if p == name}
        for page in range(1, 11):
            try:
                ms = page_of(pid, page)
            except Exception as e:  # noqa: BLE001
                errors.append(f'match list for {name}: {e}')
                break
            if not ms:
                break
            rows = take(ms)
            if any(r['player'] == name and r['match_id'] in mine_before and r['started'] < recent_cut for r in rows):
                break
            time.sleep(1)

    # 1b. older games: each player's full history, a few pages per run (AoE2 Companion refuses quick bursts of
    # requests with "429 Too Many Requests"), resuming where the last run stopped. New games only push older ones
    # onto later pages, so resuming by page number can repeat a game (skipped as known) but never miss one.
    pages_left = a.backfill_pages
    for pid, name in roster.items():
        st = backfill.setdefault(pid, {'page': 1, 'done': False, 'v': BACKFILL_V})
        while not st['done'] and pages_left > 0:
            try:
                ms = page_of(pid, st['page'])
            except Exception as e:  # noqa: BLE001
                stats_note.append(f'history backfill paused at {name} page {st["page"]}: {e}'[:200])
                pages_left = 0  # refused: try again next run
                break
            pages_left -= 1
            if not ms:
                st['done'] = True
                break
            take(ms)
            st['page'] += 1
            time.sleep(1.5)
    # 1c. replays members added on the site (pipeline/uploads.py): checked against the game they were added to
    uploaded, upload_results = {}, []
    gaps = rating_gaps(history, list(no_result.values()))
    for u in load(os.path.join(a.inp, 'uploads.json'), []):
        try:
            with open(u['file'], 'rb') as f:
                data = f.read()
            if not data:
                raise ValueError('The file was empty or too big')
            try:
                res = read_replay(data, '')
            except Exception as e:  # noqa: BLE001
                raise ValueError(f"Couldn't read this file as an AoE2 replay ({type(e).__name__})") from e
            mid, row = check_upload(u, res, history, roster, gaps)
            if row is not None and (row['player'], mid) not in known:
                known.add((row['player'], mid))
                by_key[(row['player'], mid)] = row
                history.append(row)
                added += 1
                gaps = rating_gaps(history, list(no_result.values()))  # that gap is filled now
            uploaded[mid] = data
            upload_results.append({'id': u['id'], 'status': 'done', 'message': ''})
        except Exception as e:  # noqa: BLE001
            upload_results.append({'id': u['id'], 'status': 'rejected', 'message': str(e) if isinstance(e, ValueError) else f'{type(e).__name__}: {e}'})
    games = [g for g in games if g['match_id'] not in uploaded]  # analysed again below, from the added file
    analysis = [r for r in analysis if str(r.get('match_id')) not in uploaded]
    history.sort(key=lambda r: (r['started'], r['player']), reverse=True)
    unrecorded = sorted(no_result.values(), key=lambda r: r['started'], reverse=True) + rating_gaps(history, list(no_result.values()))

    # ---------- 2. replays
    # every game gets one try (newest first, max_replays per run); analysis is kept for good once made, so a player's
    # stats survive after Microsoft deletes the replay
    rcut = (now - dt.timedelta(days=a.replay_days)).strftime('%Y-%m-%dT%H:%M:%SZ') if a.replay_days else ''
    by_match = {}
    for r in history:
        if r['started'] >= rcut and r['type'] != 'Other':
            by_match.setdefault(r['match_id'], []).append(r)
    status = {g['match_id']: g for g in games}
    todo, again = {}, {}
    for mid, rows in by_match.items():
        g = status.get(mid)
        if g is None:
            todo[mid] = rows
        elif g.get('status') == 'No replay' and not g.get('retried') and any(r.get('replay_ids') for r in rows):
            todo[mid] = rows  # tried before with only our players' copies: try everyone's once
        elif g.get('status') == 'Could not read' and g.get('reader') != READER and not is_scenario(rows):
            todo[mid] = rows  # the reader has improved since: try again
        elif g.get('status') == 'Analyzed, playback expired' and not g.get('retried'):
            again[mid] = rows  # analysed, but its playback was dropped by the old 40-game limit: rebuild it once
    new_pb = []
    tried = 0
    # what happened to each replay this run (printed in the log and kept in data/meta.json)
    outcome = {'analyzed': 0, 'not_available_yet': 0, 'no_replay': 0, 'unreadable': 0, 'scenario': 0, 'download_failed': 0}
    # games read as "Could not read" before scenarios were recognised are scenarios: say so
    for g in games:
        if g.get('status') == 'Could not read' and is_scenario(by_match.get(g['match_id'], [])) :
            g['status'] = 'Custom scenario'
    order = sorted(((k, v) for k, v in todo.items() if k in uploaded), key=lambda kv: kv[1][0]['started'], reverse=True) + \
        sorted(((k, v) for k, v in todo.items() if k not in uploaded), key=lambda kv: kv[1][0]['started'], reverse=True) + \
        sorted(again.items(), key=lambda kv: kv[1][0]['started'], reverse=True)
    for mid, rows in order:
        if tried >= a.max_replays:
            break
        tried += 1
        playback_only = mid in again
        old = status.get(mid)
        if old is not None:
            games.remove(old)  # replaced below by what this attempt finds
        data, used_pid, failed_dl = None, None, False
        # whose copy of the replay to ask for: our players who saved one, then everyone in the match (those who saved
        # one first, see replay_ids), then our other players (older rows have no replay_ids)
        own = [(r, r.get('profile_id') or next((k for k, v in roster.items() if v == r['player']), None)) for r in rows]
        pids = [pid for r, pid in own if int(r.get('replay') or 0)]
        for r in rows:
            pids += (r.get('replay_ids') or '').split(',')
        pids += [pid for _, pid in own]
        pids = [p for p in dict.fromkeys(pids) if p][:10]
        if mid in uploaded:
            data, used_pid, pids = uploaded[mid], 'added on the site', []
        for pid in pids:
            try:
                data = get(REPLAY.format(mid=mid, pid=pid), binary=True)
            except Exception as e:  # noqa: BLE001
                errors.append(f'replay {mid}: {e}')
                data, failed_dl = None, True
            if data:
                used_pid = pid
                break
        base = {'match_id': mid, 'started': rows[0]['started'], 'type': rows[0]['type'], 'map': rows[0]['map'],
                'players_tracked': ', '.join(sorted({r['player'] for r in rows})), 'checked_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
                'retried': 1 if old is not None else 0}
        if not data and playback_only:
            games.append({**old, 'retried': 1, 'checked_at': base['checked_at']})  # replay no longer on the server: keep the analysis
            outcome['no_replay'] += 0 if failed_dl else 1
            outcome['download_failed'] += 1 if failed_dl else 0
            continue
        if not data and old is not None and not failed_dl:
            games.append({**old, 'retried': 1, 'checked_at': base['checked_at']})
            outcome['no_replay'] += 1
            continue
        if not data and old is not None:
            games.append(old)  # download error: try again next run
            outcome['download_failed'] += 1
            continue
        if not data:
            # games under 3 days old are tried again on later runs (a replay can take a while to appear); older ones are "No replay"
            age_days = (now - dt.datetime.fromisoformat(rows[0]['started'].replace('Z', '+00:00'))).days
            if failed_dl:
                outcome['download_failed'] += 1
            if failed_dl and len([e for e in errors if e.startswith('replay ')]) >= 3:
                break  # downloads are failing (network or server), not missing: try again next run
            if age_days >= 3 and not failed_dl:
                outcome['no_replay'] += 1
                games.append({**base, 'status': 'No replay', 'has_playback': 0})
            elif not failed_dl:
                outcome['not_available_yet'] += 1
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
                # 0 = no limit (the default now); otherwise only games this recent get playback
                fresh = not a.playback_days or rows[0]['started'] >= (now - dt.timedelta(days=a.playback_days)).strftime('%Y-%m-%dT%H:%M:%SZ')
                res = parse_replay(path, match_id=mid, keep_playback=fresh)
        except Exception as e:  # noqa: BLE001
            if playback_only:
                games.append({**old, 'retried': 1})
            elif is_scenario(rows):
                # custom scenarios (e.g. CBA) carry extra header data the reader can't follow, and have no standard
                # openings or age-ups to read anyway: a known answer, not an error
                outcome['scenario'] += 1
                games.append({**base, 'status': 'Custom scenario', 'has_playback': 0})
            else:
                errors.append(f'parse {mid}: {type(e).__name__}: {e}')
                outcome['unreadable'] += 1
                games.append({**base, 'status': 'Could not read', 'has_playback': 0, 'reader': READER, 'error': f'{type(e).__name__}: {e}'[:200]})
            continue
        outcome['analyzed'] += 1
        if old is not None and not playback_only:
            analysis[:] = [x for x in analysis if str(x.get('match_id')) != str(mid)]  # no duplicate rows on a retry
        pid_to_player = roster
        names_by_pid = {}
        by_num = {r['number']: r for r in res['players']}
        for row in ([] if playback_only else res['players']):
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
                      'has_playback': 1, 'playback_id': f'pb_{mid}', 'replay_profile_id': used_pid, 'uploaded': 1 if mid in uploaded else 0})
        new_pb.append({'match_id': mid, 'file': fname, 'title': f"Playback {base['map']} {base['started'][:10]}"[:40]})

    # ---------- 3. playback retention
    expired = []
    pcut = (now - dt.timedelta(days=a.playback_days)).strftime('%Y-%m-%dT%H:%M:%SZ') if a.playback_days else ''
    newest = sorted((g for g in games if g.get('has_playback')), key=lambda g: g['started'], reverse=True)
    keep = {g['match_id'] for g in (newest[:a.max_playbacks] if a.max_playbacks else newest)}
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

    with open(os.path.join(a.out, 'backfill.json'), 'w') as f:
        json.dump(backfill, f)
    with open(os.path.join(a.out, 'uploads_result.json'), 'w') as f:
        json.dump(upload_results, f)
    written = ['backfill.json']
    for name, rows, cols in (('history.json', history, None), ('unrecorded.json', unrecorded, None), ('replay_analysis.json', analysis, AN_COLS), ('replay_games.json', games, GAME_COLS)):
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
        'stats': {'new_history_rows': added, 'replays_tried': tried, 'replays_analyzed': outcome['analyzed'], 'playbacks_made': len(new_pb),
                  'replays_not_available_yet': outcome['not_available_yet'], 'replays_missing': outcome['no_replay'],
                  'replays_unreadable': outcome['unreadable'], 'custom_scenarios': outcome['scenario'], 'replay_download_errors': outcome['download_failed'],
                  'playbacks_stored': sum(1 for g in games if g.get('has_playback')),
                  'history_rows': len(history), 'analysis_rows': len(analysis),
                  'replays_added_on_site': {'done': sum(1 for r in upload_results if r['status'] == 'done'), 'rejected': sum(1 for r in upload_results if r['status'] != 'done')},
                  'games_without_result': len(no_result), 'rating_gaps': len(unrecorded) - len(no_result),
                  'history_backfill': {roster.get(k, k): ('done' if v.get('done') else f"page {v.get('page')}") for k, v in backfill.items()},
                  'notes': stats_note},
        'errors': errors[:50],
    }
    with open(os.path.join(a.out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps(manifest['stats']), len(errors), 'errors')


if __name__ == '__main__':
    main()
