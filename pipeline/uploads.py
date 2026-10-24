# Replays members add on the site (Supabase table replay_uploads, files in the private storage bucket "replays"), for
# games Microsoft has no replay of, or left out of its match history altogether.
#   python pipeline/uploads.py fetch <dir>   save the waiting uploads' rows (<dir>/uploads.json) and files (<dir>/uploads/)
#   python pipeline/uploads.py mark          record what run.py made of them (_uploads_applied.json): run once the data
#                                            is published, so an upload never reads "done" before its game shows
# run.py checks each replay is that game, then analyses it like a downloaded one. Exits 0 either way: a failed read
# just leaves the uploads waiting for the next run.
import json, os, sys, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DONE = os.path.join(ROOT, '_uploads_applied.json')
MAX_BYTES = 50 * 1024 * 1024


def setup():
    with open(os.path.join(ROOT, 'config', 'supabase.json')) as f:
        url = (json.load(f).get('url') or '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    return (url, {'apikey': key, 'Authorization': f'Bearer {key}'}) if url and key else (None, None)


def call(url, headers, method='GET', body=None, raw=False):
    req = urllib.request.Request(url, method=method, headers={**headers, **({'Content-Type': 'application/json'} if body is not None else {})},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read(MAX_BYTES + 1)
        return data if raw else (json.loads(data) if data else None)


def fetch(out):
    os.makedirs(os.path.join(out, 'uploads'), exist_ok=True)
    rows = []
    base, h = setup()
    if base:
        try:
            for r in call(f'{base}/rest/v1/replay_uploads?status=eq.waiting&order=id&limit=20&select=*', h) or []:
                try:
                    data = call(f"{base}/storage/v1/object/replays/{urllib.parse.quote(r['path'])}", h, raw=True)
                except Exception as e:  # noqa: BLE001
                    print(f"upload {r['id']}: couldn't download the file: {e}")
                    continue
                if len(data) > MAX_BYTES:
                    data = b''  # run.py rejects it
                path = os.path.join(out, 'uploads', f"{int(r['id'])}.bin")
                with open(path, 'wb') as f:
                    f.write(data)
                rows.append({**r, 'file': path})
        except Exception as e:  # noqa: BLE001
            print(f"Couldn't read added replays: {e}")
    with open(os.path.join(out, 'uploads.json'), 'w') as f:
        json.dump(rows, f)
    print(f'{len(rows)} added replay(s) to check')


def mark():
    if not os.path.exists(DONE):
        return
    with open(DONE) as f:
        results = json.load(f)
    base, h = setup()
    if not base:
        return
    for r in results:
        try:
            call(f"{base}/rest/v1/replay_uploads?id=eq.{int(r['id'])}", {**h, 'Prefer': 'return=minimal'}, 'PATCH',
                 {'status': r['status'], 'message': str(r.get('message') or '')[:300]})
        except Exception as e:  # noqa: BLE001
            print(f"upload {r.get('id')}: couldn't record the result: {e}")
    print(f'Recorded {len(results)} added replay result(s)')


if __name__ == '__main__':
    if sys.argv[1:2] == ['fetch']:
        fetch(sys.argv[2])
    elif sys.argv[1:2] == ['mark']:
        mark()
    else:
        sys.exit('usage: uploads.py fetch <dir> | mark')
