// "Link my replay folder" (Match review): the player picks AoE2's savegame folder once; the site then looks in it for
// replays of their games that have none (no copy on Microsoft's server, or the game is missing from Microsoft's
// history) and adds them like "Add replay" does (backend.js TT_UPLOAD). Chrome and Edge only (File System Access API).
// The folder stays on the PC: only the matching files are uploaded, and the update job checks each one is that game
// (pipeline/run.py check_upload). A file is matched by when it was last written, which is when the game ended.
(function (root) {
  const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;

  // ---------------------------------------------------------------- remembered folder (IndexedDB holds the handle)
  const DB = 'tt-replay-folder', STORE = 'kv';
  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function kv(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
      const req = fn(s);
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  }
  const get = (k) => kv('readonly', (s) => s.get(k)).catch(() => undefined);
  const put = (k, v) => kv('readwrite', (s) => s.put(v, k));
  const del = (k) => kv('readwrite', (s) => s.delete(k));

  async function folder() { return supported ? get('dir') : undefined; }
  async function link() {
    const dir = await window.showDirectoryPicker({ id: 'aoe2-savegame', startIn: 'documents', mode: 'read' });
    await put('dir', dir);
    return dir;
  }
  async function unlink() { await del('dir'); await del('tried'); }
  // 'granted' | 'prompt' | 'denied'; asking needs a click (ask = true)
  async function permission(dir, ask) {
    const o = { mode: 'read' };
    let p = await dir.queryPermission(o);
    if (p === 'prompt' && ask) p = await dir.requestPermission(o);
    return p;
  }

  // ---------------------------------------------------------------- matching (pure: also run by the tests in Node)
  // files: [{name, lastModified}]; wanted: [{match_id, lo, hi, target}] (ms). Each game gets the file written closest
  // to when it ended, within its window; a file is used once, and never again for a game it was already tried for.
  function match(files, wanted, tried) {
    const used = new Set(), out = [];
    wanted.slice().sort((a, b) => a.hi - a.lo - (b.hi - b.lo)).forEach((w) => {
      const best = files.filter((f) => !used.has(f.name) && f.lastModified >= w.lo && f.lastModified <= w.hi && !(tried && tried.has(w.match_id + '|' + f.name)))
        .sort((a, b) => Math.abs(a.lastModified - w.target) - Math.abs(b.lastModified - w.target))[0];
      if (best) { used.add(best.name); out.push({ want: w, file: best }); }
    });
    return out;
  }

  // ---------------------------------------------------------------- look in the folder, add what matches
  // wanted: as for match(), plus player and game (what add needs); skip(match_id) = already has an added replay.
  // add(file, want) uploads one. Files tried before for a game are not sent again (a rejected one stays rejected).
  let busy = false;
  async function sync(dir, wanted, skip, add, onProgress) {
    if (busy) return null;
    busy = true;
    try {
      const tried = new Set((await get('tried')) || []);
      const open = wanted.filter((w) => !skip(w.match_id));
      const lo = Math.min(...open.map((w) => w.lo));
      const files = [];
      let seen = 0;
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== 'file' || !/\.aoe2record$/i.test(name)) continue;
        seen += 1;
        const f = await h.getFile();
        if (f.lastModified >= lo) files.push({ name, lastModified: f.lastModified, size: f.size, handle: f });
      }
      const pairs = match(files, open, tried).slice(0, 20);
      let added = 0;
      const errors = [];
      for (const p of pairs) {
        if (onProgress) onProgress(`Adding ${added + 1} of ${pairs.length}…`);
        try {
          await add(p.file.handle, p.want);
          added += 1;
        } catch (e) { errors.push(`${p.file.name}: ${e.message || e}`); }
        tried.add(p.want.match_id + '|' + p.file.name);
      }
      await put('tried', [...tried].slice(-2000));
      const result = { at: Date.now(), files: seen, wanted: open.length, added, errors };
      await put('last', result);
      return result;
    } finally { busy = false; }
  }
  const last = () => get('last');

  root.TT_FOLDER = { supported, folder, link, unlink, permission, match, sync, last };
})(typeof window !== 'undefined' ? window : globalThis);
