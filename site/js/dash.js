// The page's data layer: the same small `dash` API the page was written against on claude.ai,
// backed by this site's JSON files, plus live games straight from AoE2 Companion.
//
//   dash.data(id)       -> {status: 'loading'|'ok'|'error'|'missing', data, columns}
//   dash.calc(id, def)  -> a value worked out from datasets (def.inputs, def.fn)
//   dash.onData(fn)     -> run fn now and whenever data, filters or the width change
//   dash.params() / setParams({k: v}) / resetParams()   (kept in the address bar)
//   dash.setLink(name)  -> #name in the address bar
(() => {
  // backend.js calls TT_setKey(cryptoKey) once an invited person has signed in; until then nothing loads
  if (!window.TT_KEY) window.TT_KEY = new Promise((resolve) => { window.TT_setKey = resolve; });
  // Where each dataset comes from. config/ is edited by the organizers; data/ is written by the update job.
  const FILES = {
    players_file: 'config/players.json', tournaments_file: 'config/tournaments.json', roster_file: 'config/roster.json',
    rules_file: 'config/rules.json', civ_pool_file: 'config/civ_pool.json', civ_styles: 'config/civ_styles.json',
    matches_file: 'config/matches.json', helper_app: 'config/app.json',
    history_file: 'data/history.json', replay_analysis: 'data/replay_analysis.json', replay_games: 'data/replay_games.json',
    data_check: 'data/data_check.json', meta: 'data/meta.json',
  };
  // id -> {status, data, error}; votes and admin_changes are filled in by backend.js
  const store = { votes: { status: 'ok', data: [] }, admin_changes: { status: 'ok', data: [] } };
  const calcs = {};
  const subs = [];
  let version = 0;
  let cache = { version: -1, values: {} };
  let params = {};
  try { params = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) { params = {}; }

  let pending = false;
  const notify = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; subs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); });
  };
  const changed = () => { version += 1; notify(); };

  // Data files are encrypted (see pipeline/crypt.py): 12-byte nonce + AES-GCM of gzip'd JSON. The key comes from
  // backend.js once an invited person has signed in (window.TT_KEY resolves to a CryptoKey).
  async function readFile(url) {
    const key = await window.TT_KEY;
    const r = await fetch(url + '.enc', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const buf = await r.arrayBuffer();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }
  const asRows = (d) => (Array.isArray(d) ? d : d && Array.isArray(d.rows) ? d.rows : d && typeof d === 'object' ? [d] : []);
  function load(id) {
    if (store[id]) return;
    let url = FILES[id];
    if (!url && /^pb_[A-Za-z0-9_]+$/.test(id)) url = `data/playback/${id}.json`;
    if (!url) { store[id] = { status: 'missing', data: [] }; return; }
    store[id] = { status: 'loading', data: [] };
    readFile(url)
      .then((d) => { store[id] = { status: 'ok', data: asRows(d) }; if (id === 'history_file') Live.start(); changed(); })
      .catch((e) => { store[id] = { status: r404(e) ? 'missing' : 'error', data: [], error: String(e) }; changed(); });
  }
  const r404 = (e) => /: 404$/.test(String(e && e.message));

  // datasets that are put together here rather than read straight from a file
  const DERIVED = {
    // tournament setup: the config files plus organizer changes made on the site since the last update
    // (site/js/admin-logic.js; the update job saves them into config/ every 30 minutes)
    config: {
      inputs: ['players_file', 'tournaments_file', 'roster_file', 'matches_file', 'rules_file', 'civ_pool_file', 'admin_changes'],
      fn: (players, tournaments, roster, matches, rules, civ_pool, changes) => TT_admin.apply({ players, tournaments, roster, matches, rules, civ_pool }, changes),
    },
    players: { inputs: ['config'], fn: (c) => c.players },
    tournaments: { inputs: ['config'], fn: (c) => c.tournaments },
    roster: { inputs: ['config'], fn: (c) => c.roster },
    matches_base: { inputs: ['config'], fn: (c) => c.matches },
    rules: { inputs: ['config'], fn: (c) => c.rules },
    civ_pool: { inputs: ['config'], fn: (c) => c.civ_pool },
    // all-time history: the file (updated every 30 minutes) plus any newer games fetched live in this browser
    history: { inputs: ['history_file'], fn: (h) => Live.merge(h) },
    // tournament games: the schedule (config/matches.json, where the update job saves confirmed games every
    // 30 minutes) plus games confirmed since then, so a confirmation counts straight away
    matches: {
      inputs: ['matches_base', 't_suggest_base', 'votes', 'tournaments'],
      fn: (base, sugg, votes, ts) => TT_confirm.applyConfirmed(base, sugg, TT_confirm.index(votes), ts).rows,
    },
  };

  function value(id) {
    if (cache.version !== version) cache = { version, values: {} };
    if (id in cache.values) return cache.values[id];
    let res;
    const def = DERIVED[id] || calcs[id];
    if (def) {
      const ins = def.inputs.map((i) => value(i));
      const bad = ins.find((r) => r.status !== 'ok');
      if (bad) res = { status: bad.status === 'missing' ? 'error' : bad.status, data: [] };
      else {
        try { res = { status: 'ok', data: def.fn(...ins.map((r) => r.data)) }; } catch (e) { console.error(`calc ${id}`, e); res = { status: 'error', data: [], error: String(e) }; }
      }
    } else {
      load(id);
      res = store[id];
    }
    cache.values[id] = res;
    return res;
  }

  const colors = ['#2f6fbd', '#d9822b', '#3f9b55', '#c2464b', '#8a63c9', '#8c6d4f', '#cf5fa8', '#7d8590'];
  window.dash = {
    calc(id, def) {
      calcs[id] = def;
      // t_suggest needs the schedule without the overlay it feeds (otherwise it would depend on itself)
      if (id === 't_suggest') calcs.t_suggest_base = { ...def, inputs: def.inputs.map((i) => (i === 'matches' ? 'matches_base' : i === 'bracket' ? 'bracket_base' : i)) };
      if (id === 'bracket') calcs.bracket_base = { ...def, inputs: def.inputs.map((i) => (i === 'matches' ? 'matches_base' : i === 'standings' ? 'standings_base' : i)) };
      if (id === 'standings') calcs.standings_base = { ...def, inputs: def.inputs.map((i) => (i === 'matches' ? 'matches_base' : i)) };
    },
    loader() {},
    data(id) {
      const r = value(id);
      return { status: r.status, data: r.data || [], columns: r.data && r.data[0] ? Object.keys(r.data[0]) : [], message: r.error || '', refreshing: false, meta: [] };
    },
    onData(fn) { subs.push(fn); try { fn(); } catch (e) { console.error(e); } },
    params: () => ({ ...params }),
    setParams(p) {
      Object.entries(p || {}).forEach(([k, v]) => { if (v == null || v === '') delete params[k]; else params[k] = v; });
      try { history.replaceState(null, '', `${location.pathname}${Object.keys(params).length ? '?' + new URLSearchParams(params) : ''}${location.hash}`); } catch (e) { /* ignore */ }
      changed();
    },
    resetParams() { params = {}; dash.setParams({}); },
    setLink(name) { try { history.replaceState(null, '', `${location.pathname}${location.search}#${name}`); } catch (e) { /* ignore */ } },
    refresh(id) { delete store[id]; changed(); },
    colors,
    _changed: changed,
    _setData(id, rows) { store[id] = { status: 'ok', data: rows }; changed(); },
    _store: store,
  };
  let lastW = 0;
  window.addEventListener('resize', () => { const w = document.documentElement.clientWidth; if (w !== lastW) { lastW = w; notify(); } });

  // ---------------------------------------------------------------- live games from AoE2 Companion
  const API = 'https://data.aoe2companion.com/api/matches?profile_ids=';
  const pick = (d, ...keys) => { for (const k of keys) if (d && d[k] != null && d[k] !== '') return d[k]; return null; };
  function gameType(m, n) {
    const lb = String(pick(m, 'leaderboardId', 'leaderboard') || '').toLowerCase();
    const name = String(pick(m, 'leaderboardName') || '').toLowerCase();
    const ranked = !!lb && !lb.includes('unranked') && !name.includes('unranked');
    if (lb === 'rm_1v1' || lb === '3' || (lb.includes('1v1') && lb.includes('rm') && ranked)) return '1v1 ranked';
    if (lb === 'rm_team' || lb === '4' || (lb.includes('team') && lb.includes('rm') && ranked)) return 'Team ranked';
    if (lb.startsWith('ew') && ranked) return 'Empire Wars ranked';
    if (n === 2) return '1v1 unranked';
    if (n > 2) return 'Team unranked';
    return 'Other';
  }
  const iso = (v) => new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z');
  // same rows as pipeline/run.py history_rows()
  function rowsOf(m, roster) {
    const started = pick(m, 'started', 'startTime'), finished = pick(m, 'finished', 'finishTime');
    if (!started || !finished) return [];
    const every = [];
    (m.teams || []).forEach((t) => (t.players || []).forEach((p) => every.push([pick(t, 'teamId', 'team') ?? pick(p, 'team'), p])));
    if (!every.some(([, q]) => [true, false, 1, 0].includes(q.won))) return [];
    const n = every.length, type = gameType(m, n), mid = String(pick(m, 'matchId', 'match_id', 'id'));
    const civ = (q) => pick(q, 'civName', 'civ') || '';
    const out = [];
    every.forEach(([tid, p]) => {
      const pid = String(pick(p, 'profileId', 'profile_id') || '');
      if (!roster.has(pid)) return;
      const mates = every.filter(([t, q]) => t === tid && q !== p).map(([, q]) => q);
      const opps = every.filter(([t]) => t !== tid).map(([, q]) => q);
      out.push({
        player: roster.get(pid), match_id: mid, started: iso(started), type, map: pick(m, 'mapName', 'map') || '', civ: civ(p),
        opp_civ: opps.length === 1 ? civ(opps[0]) : '', opp_name: opps.length === 1 ? (pick(opps[0], 'name') || '') : '',
        opp_civs: opps.map(civ).join(', '), team_civs: mates.map(civ).join(', '), teammates: mates.map((q) => String(pick(q, 'name') || '')).join(', '),
        players_n: n, won: p.won === true || p.won === 1 ? 1 : 0, rating: pick(p, 'rating'), rating_diff: pick(p, 'ratingDiff', 'rating_diff'),
        duration_min: Math.round(((new Date(finished) - new Date(started)) / 60000) * 10) / 10, replay: pick(p, 'replay') ? 1 : 0, profile_id: pid, live: 1,
      });
    });
    return out;
  }
  const Live = {
    rows: [], fetchedAt: null, error: '', started: false,
    merge(h) {
      if (!this.rows.length) return h;
      const have = new Set(h.map((r) => r.player + '|' + r.match_id));
      const add = this.rows.filter((r) => !have.has(r.player + '|' + r.match_id));
      return add.length ? add.concat(h) : h;
    },
    async poll() {
      const pv = value('players');
      const pl = pv.status === 'ok' ? pv.data : null;
      if (!pl) { setTimeout(() => this.poll(), 1500); return; }
      const roster = new Map(pl.filter((p) => p.profile_id).map((p) => [String(p.profile_id), p.player]));
      const got = [];
      let err = '';
      for (const pid of roster.keys()) {
        try {
          const r = await fetch(API + encodeURIComponent(pid) + '&page=1');
          if (!r.ok) throw new Error(`AoE2 Companion answered ${r.status}`);
          const d = await r.json();
          (d.matches || []).forEach((m) => got.push(...rowsOf(m, roster)));
        } catch (e) { err = String(e.message || e); }
      }
      const seen = new Set();
      this.rows = got.filter((r) => { const k = r.player + '|' + r.match_id; if (seen.has(k)) return false; seen.add(k); return true; });
      this.fetchedAt = new Date();
      this.error = err;
      changed();
    },
    start() {
      if (this.started) return;
      this.started = true;
      this.poll();
      setInterval(() => { if (document.visibilityState === 'visible') this.poll(); }, 5 * 60 * 1000);
    },
  };
  window.TT_LIVE = Live;
})();
