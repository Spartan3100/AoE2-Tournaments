"""Temporary diagnosis: why do some replays fail to read? (Not part of the update job.)

  python pipeline/debug_replays.py DATA_DIR OUT_DIR

Finds the games marked "Could not read" in DATA_DIR/replay_games.json, downloads each replay again, runs the
reader on it with the full traceback, and saves the file to OUT_DIR. Prints only match ids, file facts and
errors (no player names), because workflow logs of a public repository are public.
"""
import io
import json
import os
import sys
import traceback
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run  # noqa: E402
from analyze import parse_replay  # noqa: E402
import mgz  # noqa: E402

data, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
games = json.load(open(os.path.join(data, 'replay_games.json')))
history = json.load(open(os.path.join(data, 'history.json')))
bad = [g for g in games if g.get('status') == 'Could not read']
# regression check: a few games that read fine before must still read the same with the patched reader
good = [g for g in sorted(games, key=lambda g: g['started'], reverse=True) if str(g.get('status', '')).startswith('Analyzed')]
bad += [dict(g, regression=1) for g in good[:3] + good[-2:]]
print(f'mgz {getattr(mgz, "__version__", "?")}; {len(bad)} unreadable games', flush=True)
for g in bad:
    mid = str(g['match_id'])
    rows = [r for r in history if str(r['match_id']) == mid]
    pids = [r.get('profile_id') for r in rows] + [p for r in rows for p in (r.get('replay_ids') or '').split(',')]
    pids = [p for p in dict.fromkeys(pids) if p]
    print(f'\n=== {mid} started {g.get("started")} map {g.get("map")} type {g.get("type")}', flush=True)
    raw = None
    for pid in pids:
        try:
            raw = run.get(run.REPLAY.format(mid=mid, pid=pid), binary=True)
        except Exception as e:  # noqa: BLE001
            print('download error', type(e).__name__, e)
        if raw:
            print(f'downloaded {len(raw)} bytes (copy #{pids.index(pid) + 1} of {len(pids)})')
            break
    if not raw:
        print('no copy downloadable now')
        continue
    if raw[:2] == b'PK':
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names = z.namelist()
            print('zip entries', names)
            name = next((n for n in names if n.endswith('.aoe2record')), names[0])
            raw = z.read(name)
    path = os.path.join(out, f'{mid}.aoe2record')
    with open(path, 'wb') as f:
        f.write(raw)
    print('record bytes', len(raw), 'head', raw[:16].hex())
    if not g.get('regression') and '(Scenario)' not in str(g.get('map')):
        import re, struct
        from mgz.fast import header as fh
        with open(path, 'rb') as f:
            hdr = fh.decompress(f)
            version, game, save, log = fh.parse_version(hdr, f)
        fh.parse_de(hdr, version, save)
        start = hdr.tell()
        rest = hdr.read()[4:]
        meta = struct.Struct('<24xf17xhbxb')
        z = re.search(b'\x00' * 4096, rest)
        end = re.compile(b'\x00+').match(rest, z.start()).end()
        print('zero run', z.start(), '->', end, 'len', end - z.start(), 'of', len(rest))
        print('bytes before end', rest[end - 32:end].hex())
        print('bytes after end ', rest[end:end + 96].hex())
        # every place in the header that looks like a settings block, anywhere
        hits = []
        for sp in (1.0, 1.5, 1.7, 2.0):
            for m in re.finditer(re.escape(struct.pack('<f', sp)), rest):
                at = m.start() - 24
                if at < 0 or at + meta.size > len(rest):
                    continue
                speed, owner, n, cheats = meta.unpack_from(rest, at)
                if 2 <= n <= 9 and 0 <= owner <= 8 and cheats in (0, 1):
                    hits.append((at, sp, owner, n, cheats))
        hits.sort()
        print('settings-like blocks:', len(hits), 'first ones:', hits[:12])
        print('after the zero run:', [h for h in hits if h[0] >= z.start()][:6])
    try:
        res = parse_replay(path, match_id=mid, keep_playback=True)
        print(('regression check OK: ' if g.get('regression') else 'READS FINE NOW: ') + f"{len(res['players'])} players, {res['game'].get('duration_min')} min, {len(res['build'])} build steps")
    except Exception:  # noqa: BLE001
        tb = traceback.format_exc().splitlines()
        print('\n'.join(tb[-14:]))
