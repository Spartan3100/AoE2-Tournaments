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
    if '(Scenario)' not in str(g.get('map')):
        # header facts for a regular game: version, AI flag, player count as the reader sees them
        import re, struct
        from mgz.fast import header as fh
        with open(path, 'rb') as f:
            hdr = fh.decompress(f)
            version, game, save, log = fh.parse_version(hdr, f)
        print('version', version, game, 'save', save, 'log', log)
        de = fh.parse_de(hdr, version, save)
        print('de players', len(de['players']) if de else None, 'mod', (de or {}).get('rms_mod_id'))
        pos = hdr.tell()
        ai = struct.unpack('<I', hdr.read(4))[0]
        print('ai flag', ai, 'at', pos)
        rest = hdr.read()
        runs = [m.end() for m in re.finditer(b'\x00' * 4096, rest)][:5]
        print('first 4096-zero runs end at', runs, 'of', len(rest))
        for end in runs[:3]:
            seg = rest[end:end + 60]
            try:
                speed, owner, n, cheats = struct.unpack('<24xf17xhbxb', seg[:48])
                print(f'  if AI data ends at {end}: speed {speed:.2f} owner {owner} players {n} cheats {cheats}')
            except struct.error as e:
                print('  unpack', e)
        # the metadata block starts with game speed 1.0/1.5/1.7/2.0 as a float: find plausible ones after the AI flag
        for m in re.finditer(re.escape(struct.pack('<f', 1.7)) + b'|' + re.escape(struct.pack('<f', 1.5)) + b'|' + re.escape(struct.pack('<f', 2.0)), rest):
            off = m.start() - 24
            if off < 0:
                continue
            try:
                speed, owner, n, cheats = struct.unpack('<24xf17xhbxb', rest[off:off + 48])
            except struct.error:
                continue
            if 2 <= n <= 8 and 0 <= owner <= 8:
                print(f'  plausible metadata at {off}: speed {speed} owner {owner} players {n} (zero runs end at {runs[:3]})')
                break
    try:
        res = parse_replay(path, match_id=mid, keep_playback=True)
        print('READS FINE NOW:', len(res['players']), 'players')
    except Exception:  # noqa: BLE001
        tb = traceback.format_exc().splitlines()
        print('\n'.join(tb[-14:]))
