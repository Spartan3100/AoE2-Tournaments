"""Encrypts and decrypts the site's data files, so only invited people (who get the key after signing in) can read them.

  python pipeline/crypt.py encrypt SRC_DIR DST_DIR [--skip supabase.json]   every *.json -> *.json.enc
  python pipeline/crypt.py decrypt SRC_DIR DST_DIR                          every *.json.enc -> *.json

File format: 12-byte nonce, then AES-256-GCM ciphertext of the gzip-compressed JSON (what the site's dash.js reads).
The key is the one in the Supabase table site_secret. It is read with the service key from the environment
(SUPABASE_SERVICE_KEY) and the project URL in config/supabase.json, or taken directly from SITE_KEY if set.
"""
import base64, gzip, json, os, shutil, sys, urllib.request
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def site_key():
    if os.environ.get('SITE_KEY'):
        return base64.b64decode(os.environ['SITE_KEY'])
    with open(os.path.join(ROOT, 'config', 'supabase.json')) as f:
        url = json.load(f).get('url', '').rstrip('/')
    svc = os.environ.get('SUPABASE_SERVICE_KEY', '')
    if not url or not svc:
        raise SystemExit('Set up Supabase first: the project URL in config/supabase.json and the SUPABASE_SERVICE_KEY secret '
                         '(see README). The site is not published without them, so its data is never public.')
    req = urllib.request.Request(f'{url}/rest/v1/site_secret?select=key', headers={'apikey': svc, 'Authorization': f'Bearer {svc}'})
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.loads(r.read().decode())
    if not rows:
        raise SystemExit('No key in the site_secret table: run supabase/schema.sql in the Supabase SQL editor.')
    return base64.b64decode(rows[0]['key'])


def walk(src):
    for base, _, files in os.walk(src):
        for name in files:
            yield os.path.relpath(os.path.join(base, name), src)


def main():
    if len(sys.argv) < 4 or sys.argv[1] not in ('encrypt', 'decrypt'):
        raise SystemExit(__doc__)
    mode, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    skip = set(sys.argv[sys.argv.index('--skip') + 1].split(',')) if '--skip' in sys.argv else set()
    aes = AESGCM(site_key())
    n = 0
    for rel in walk(src):
        s, name = os.path.join(src, rel), os.path.basename(rel)
        os.makedirs(os.path.dirname(os.path.join(dst, rel)) or dst, exist_ok=True)
        if mode == 'encrypt' and rel.endswith('.json') and name not in skip:
            with open(s, 'rb') as f:
                data = gzip.compress(f.read(), compresslevel=9, mtime=0)
            nonce = os.urandom(12)
            with open(os.path.join(dst, rel + '.enc'), 'wb') as f:
                f.write(nonce + aes.encrypt(nonce, data, None))
            n += 1
        elif mode == 'decrypt' and rel.endswith('.json.enc'):
            with open(s, 'rb') as f:
                blob = f.read()
            with open(os.path.join(dst, rel[:-4]), 'wb') as f:
                f.write(gzip.decompress(aes.decrypt(blob[:12], blob[12:], None)))
            n += 1
        elif mode == 'encrypt' and name in skip:
            shutil.copy(s, os.path.join(dst, rel))
    print(f'{mode}ed {n} files')


if __name__ == '__main__':
    main()
