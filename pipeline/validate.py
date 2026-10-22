"""Independent accuracy checks for the AoE2 Tournaments dashboard.

Usage: python -I validate.py --data DIR --datasets DATASETS_JSON --out data_check.json

DIR holds the dashboard's current files (players.json, history.json, replay_analysis.json|.csv, replay_games.json|.csv).
DATASETS_JSON is a list of the dashboard's dataset documents ({id, data}) as read from its database.
It re-checks the dashboard's data against the live AoE2 Companion match API and against itself,
and writes one row per check: {check, area, status (pass/warn/fail), result, detail, checked_at}.
"""
import argparse, collections, datetime as dt, json, os, sys, urllib.request

API = 'https://data.aoe2companion.com/api/matches?profile_ids={pid}&page={page}'


def load(path):
    for p in (path, path[:-5] + '.csv'):
        if os.path.exists(p):
            if p.endswith('.csv'):
                return []
            with open(p) as f:
                d = json.load(f)
            return d.get('rows', d) if isinstance(d, dict) else d
    return []


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'aoe2-tournament-dashboard-check/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--datasets', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    stamp = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    rows = []

    def add(check, area, status, result, detail=''):
        rows.append({'check': check, 'area': area, 'status': status, 'result': result, 'detail': detail, 'checked_at': stamp})

    players = load(os.path.join(a.data, 'players.json'))
    history = load(os.path.join(a.data, 'history.json'))
    analysis = load(os.path.join(a.data, 'replay_analysis.json'))
    games = load(os.path.join(a.data, 'replay_games.json'))
    with open(a.datasets) as f:
        docs = {d['id']: d.get('data', d) for d in json.load(f)}

    # 1. freshness of the match history
    upd = (docs.get('history', {}).get('updated') or {}).get('at')
    if upd:
        age_h = (now - dt.datetime.fromisoformat(upd.replace('Z', '+00:00'))).total_seconds() / 3600
        add('Match history updated recently', 'Freshness', 'pass' if age_h <= 12 else 'warn' if age_h <= 30 else 'fail',
            f'Last updated {age_h:.0f} h ago', 'The site updates every 30 minutes; more than 12 hours means updates have stopped.')

    # 2-3. every recent game on AoE2 Companion is in the dashboard, and latest ratings match
    hist_ids = collections.defaultdict(set)
    for r in history:
        hist_ids[r['player']].add(str(r['match_id']))
    cutoff = (now - dt.timedelta(days=7)).timestamp()
    for p in players:
        name, pid = p['player'], str(p.get('profile_id') or '')
        if not pid:
            add(f'{name}: profile linked', 'Completeness', 'fail', 'No AoE2 profile ID', 'Without it no games can be found.')
            continue
        try:
            api = []
            for page in (1, 2):
                ms = get(API.format(pid=pid, page=page)).get('matches') or []
                api += ms
                if not ms:
                    break
        except Exception as e:  # noqa: BLE001
            add(f'{name}: compared with AoE2 Companion', 'Completeness', 'warn', 'Could not reach AoE2 Companion', str(e)[:200])
            continue
        def ts(v):
            return dt.datetime.fromisoformat(str(v).replace('Z', '+00:00')).timestamp()
        has_result = lambda m: any(q.get('won') in (True, False) for t in m.get('teams', []) for q in t.get('players', []))
        recent = [m for m in api if m.get('finished') and has_result(m) and ts(m['started']) >= cutoff and ts(m['finished']) < now.timestamp() - 3 * 3600]
        missing = [str(m['matchId']) for m in recent if str(m['matchId']) not in hist_ids[name]]
        add(f'{name}: all games from the last 7 days are in the dashboard', 'Completeness',
            'pass' if not missing else 'fail', f'{len(recent) - len(missing)} of {len(recent)} found',
            ('Missing match IDs: ' + ', '.join(missing[:10])) if missing else 'Compared with AoE2 Companion (games older than 3 hours).')
        # latest 1v1 rating
        api_1v1 = [m for m in api if m.get('leaderboardId') == 'rm_1v1' and m.get('finished')]
        mine = sorted((r for r in history if r['player'] == name and r['type'] == '1v1 ranked' and r.get('rating') is not None), key=lambda r: r['started'])
        if api_1v1 and mine:
            m = max(api_1v1, key=lambda m: ts(m['started']))
            me = next((q for t in m.get('teams', []) for q in t.get('players', []) if str(q.get('profileId')) == pid), None)
            if me and me.get('rating') is not None:
                same = str(m['matchId']) == str(mine[-1]['match_id'])
                ok = same and int(me['rating']) == int(mine[-1]['rating'])
                add(f'{name}: latest 1v1 rating matches', 'Accuracy', 'pass' if ok else 'warn' if not same else 'fail',
                    f"Dashboard {mine[-1]['rating']}, AoE2 Companion {me['rating']}", f"Latest ranked 1v1: match {m['matchId']}.")
        # spot check: civ and result of the 5 newest games, field by field
        by_id = {str(r['match_id']): r for r in history if r['player'] == name}
        bad, checked = [], 0
        for m in sorted(api, key=lambda m: ts(m['started']), reverse=True)[:5]:
            h = by_id.get(str(m['matchId']))
            me = next((q for t in m.get('teams', []) for q in t.get('players', []) if str(q.get('profileId')) == pid), None)
            if not h or not me or me.get('won') is None:
                continue
            checked += 1
            won = 1 if me.get('won') else 0
            if (me.get('civName') or '') != h.get('civ') or won != int(h.get('won') or 0):
                bad.append(f"{m['matchId']} (dashboard {h.get('civ')}/{'won' if int(h.get('won') or 0) else 'lost'}, site {me.get('civName')}/{'won' if won else 'lost'})")
        if checked:
            add(f'{name}: civ and result of newest games match', 'Accuracy', 'pass' if not bad else 'fail',
                f'{checked - len(bad)} of {checked} match', '; '.join(bad) if bad else 'Civ and win/loss compared with AoE2 Companion.')

    # 4. the replay agrees with the match list (two independent sources)
    hist_by = {(r['player'], str(r['match_id'])): r for r in history}
    agree = disagree = 0
    examples = []
    for r in analysis:
        h = hist_by.get((r.get('player'), str(r.get('match_id'))))
        if not h:
            continue
        same = (str(h.get('civ')) == str(r.get('civ'))) and (int(h.get('won') or 0) == int(r.get('won') or 0))
        if same:
            agree += 1
        else:
            disagree += 1
            if len(examples) < 5:
                examples.append(f"{r['match_id']} {r['player']}: replay {r.get('civ')}/{'won' if int(r.get('won') or 0) else 'lost'}, match list {h.get('civ')}/{'won' if int(h.get('won') or 0) else 'lost'}")
    if agree + disagree:
        share = agree / (agree + disagree)
        add('Replays agree with the match list (civ and result)', 'Accuracy', 'pass' if share >= 0.97 else 'warn' if share >= 0.9 else 'fail',
            f'{share:.0%} of {agree + disagree} player-games agree', '; '.join(examples) if examples else 'The replay file and AoE2 Companion are separate sources.')

    # 5. no duplicates
    dup = len(history) - len({(r['player'], str(r['match_id'])) for r in history})
    add('No duplicate games', 'Integrity', 'pass' if dup == 0 else 'fail', f'{dup} duplicates', '')
    dup_a = len(analysis) - len({(r.get('player'), str(r.get('match_id'))) for r in analysis})
    add('No duplicate replay analyses', 'Integrity', 'pass' if dup_a == 0 else 'fail', f'{dup_a} duplicates', '')

    # 6. every kept playback is listed, and every listed one has its file
    want = {f"pb_{g['match_id']}" for g in games if int(g.get('has_playback') or 0) == 1}
    have = {k for k in docs if k.startswith('pb_') and k != 'pb_sample'}
    missing, extra = sorted(want - have), sorted(have - want)
    add('Playbacks match the games list', 'Integrity', 'pass' if not missing and not extra else 'fail',
        f'{len(want & have)} of {len(want)} present', (f'Missing: {", ".join(missing[:8])}. ' if missing else '') + (f'Not listed: {", ".join(extra[:8])}.' if extra else ''))
    for k in ('history', 'replay_analysis', 'replay_games', 'players'):
        src = (docs.get(k, {}).get('source') or {})
        ok = str(src.get('url', '')).startswith('/_blob/') and src.get('name')
        add(f'Source "{k}" points to a file', 'Integrity', 'pass' if ok else 'fail', 'OK' if ok else 'Missing file link', '')

    # 7. replay coverage
    tried = [g for g in games]
    read = [g for g in games if str(g.get('status', '')).startswith('Analyzed')]
    unread = [g for g in games if g.get('status') == 'Could not read']
    if tried:
        bad_share = len(unread) / max(1, len(read) + len(unread))
        add('Replays that downloaded could be read', 'Accuracy', 'pass' if bad_share <= 0.05 else 'warn' if bad_share <= 0.2 else 'fail',
            f'{len(read)} read, {len(unread)} unreadable', 'Many unreadable replays usually means a game update the replay reader does not support yet.')

    with open(a.out, 'w') as f:
        json.dump(rows, f, indent=1)
    print(json.dumps(collections.Counter(r['status'] for r in rows)))


if __name__ == '__main__':
    main()
