"""One update of the site's data. Run by .github/workflows/update.yml (every 30 minutes).

  python pipeline/update.py [--max-replays 60]

Reads config/ (edited by the organizers) and data/ (written by this script), then:
  1. adds new online games for every player to data/history.json (all time, never trimmed)
     and to data/unrecorded.json the games that have no result or that Microsoft left out of its match history
  2. downloads and reads new replays: data/replay_analysis.json, data/replay_games.json, data/playback/pb_<id>.json
  3. re-checks the data against AoE2 Companion: data/data_check.json
  4. writes data/meta.json with the time of this update
(Confirmed tournament games are saved into config/matches.json by pipeline/apply_confirmations.js.)
"""
import argparse, datetime as dt, json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = os.path.join(ROOT, 'config')
DATA = os.path.join(ROOT, 'data')
PB = os.path.join(DATA, 'playback')
HERE = os.path.dirname(os.path.abspath(__file__))


def rj(path, default):
    try:
        with open(path) as f:
            d = json.load(f)
        return d.get('rows', d) if isinstance(d, dict) and 'rows' in d else d
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def wj(path, obj, compact=True):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, separators=(',', ':') if compact else None, indent=None if compact else 1, default=str)
    os.replace(tmp, path)


def py(*args):
    print('+', ' '.join(args), flush=True)
    return subprocess.run([sys.executable, '-I', *args], check=False).returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-replays', type=int, default=60)
    a = ap.parse_args()
    os.makedirs(PB, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    stamp = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    work = tempfile.mkdtemp()
    inp, out = os.path.join(work, 'in'), os.path.join(work, 'out')
    os.makedirs(inp); os.makedirs(out)

    # 1-2. games and replays (pipeline/run.py does the work, as it did for the claude.ai dashboard)
    shutil.copy(os.path.join(CFG, 'players.json'), inp)
    for n in ('history', 'replay_analysis', 'replay_games', 'unrecorded'):
        wj(os.path.join(inp, n + '.json'), rj(os.path.join(DATA, n + '.json'), []))
    wj(os.path.join(inp, 'backfill.json'), rj(os.path.join(DATA, 'backfill.json'), {}))  # how far each player's history is fetched
    before = len(rj(os.path.join(DATA, 'history.json'), []))
    code = py(os.path.join(HERE, 'run.py'), '--in', inp, '--out', out, '--max-replays', str(a.max_replays),
              '--playback-days', '0', '--max-playbacks', '0')  # 0 = map playback for every game
    manifest = rj(os.path.join(out, 'manifest.json'), {})
    if code != 0 or not manifest:
        print('run.py failed; keeping the previous data', flush=True)
    else:
        hist = rj(os.path.join(out, 'history.json'), [])
        if len(hist) < before:
            raise SystemExit(f'history shrank from {before} to {len(hist)} rows; not saving')
        wj(os.path.join(DATA, 'history.json'), hist)
        for n in ('replay_analysis', 'replay_games', 'unrecorded'):
            src = os.path.join(out, n + '.json')
            wj(os.path.join(DATA, n + '.json'), rj(src, []) if os.path.exists(src) else [])
        wj(os.path.join(DATA, 'backfill.json'), rj(os.path.join(out, 'backfill.json'), {}))
        for f in os.listdir(out):
            if f.startswith('pb_') and f.endswith('.json'):
                shutil.copy(os.path.join(out, f), os.path.join(PB, f))
        keep = {f"pb_{g['match_id']}.json" for g in rj(os.path.join(DATA, 'replay_games.json'), []) if int(g.get('has_playback') or 0) == 1}
        for f in os.listdir(PB):
            if f.startswith('pb_') and f != 'pb_sample.json' and f not in keep:
                os.remove(os.path.join(PB, f))

    if not os.path.exists(os.path.join(DATA, 'unrecorded.json')):
        wj(os.path.join(DATA, 'unrecorded.json'), [])  # the site reads it on every page
    errors = list(manifest.get('errors') or [])

    # 3. accuracy check
    # validate.py was written for the claude.ai dashboard's database; describe this site's files the same way
    docs = [{'id': k, 'data': {'source': {'url': '/_blob/site', 'name': k + '.json'}, 'updated': {'at': stamp}}}
            for k in ('history', 'replay_analysis', 'replay_games', 'players')]
    for f in os.listdir(PB):
        if f.startswith('pb_') and f.endswith('.json') and f != 'pb_sample.json':
            docs.append({'id': f[:-5], 'data': {}})
    chk = os.path.join(work, 'check')
    os.makedirs(chk)
    for n in ('history', 'replay_analysis', 'replay_games', 'unrecorded'):
        shutil.copy(os.path.join(DATA, n + '.json'), chk)
    shutil.copy(os.path.join(CFG, 'players.json'), chk)
    wj(os.path.join(work, 'datasets.json'), docs)
    if py(os.path.join(HERE, 'validate.py'), '--data', chk, '--datasets', os.path.join(work, 'datasets.json'),
          '--out', os.path.join(DATA, 'data_check.json')) != 0:
        errors.append('data check failed to run')

    # 4. meta
    wj(os.path.join(DATA, 'meta.json'), {'updated_at': stamp, 'stats': manifest.get('stats', {}), 'errors': errors[:20]}, compact=False)
    shutil.rmtree(work, ignore_errors=True)
    print(json.dumps({'stats': manifest.get('stats'), 'errors': len(errors)}))


if __name__ == '__main__':
    main()
