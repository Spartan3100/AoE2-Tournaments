// Organizer changes made on the site (Supabase table "admin_changes"): tournaments, players, rules and civ pools.
// Shared by the site (shows a change straight away) and pipeline/apply_admin_changes.js (saves it into
// config/*.json every 30 minutes, then clears it), so both always agree. Applying the same change twice gives
// the same files, so a change that was saved but not yet cleared does no harm.
(function (root) {
  const STATUSES = ['Upcoming', 'Active', 'Completed'];
  const MAP_PICKS = ['seeds', 'loser', 'fixed'];
  const validId = (tid) => /^[A-Za-z0-9_-]{1,40}$/.test(tid);
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };

  // everyone plays everyone once, in rounds (circle method; with an odd count one player sits out each round)
  function roundRobin(players) {
    const ps = players.slice();
    if (ps.length % 2) ps.push(null);
    const n = ps.length, out = [];
    for (let r = 0; r < n - 1; r += 1) {
      for (let i = 0; i < n / 2; i += 1) {
        const a = ps[i], b = ps[n - 1 - i];
        if (a && b) out.push(r % 2 ? [b, a] : [a, b]);
      }
      ps.splice(1, 0, ps.pop());
    }
    return out;
  }

  const game = (tid, n, a, b) => ({
    tournament_id: tid, game: n, stage: 'Pool play', series: '', series_game: null, player_a: a, player_b: b,
    status: 'Scheduled', winner: '', civ_a: '', civ_b: '', map: '', duration_min: null, played_at: '', match_id: '',
  });

  const FILES = ['players', 'tournaments', 'roster', 'matches', 'rules', 'civ_pool'];

  // cfg: {players, tournaments, roster, matches, rules, civ_pool}; changes: admin_changes rows, oldest first
  function apply(cfg, changes) {
    const out = {};
    FILES.forEach((k) => { out[k] = (cfg[k] || []).map((r) => ({ ...r })); });
    const applied = [];
    (changes || []).slice().sort((x, y) => Number(x.id) - Number(y.id)).forEach((c) => {
      const p = c.payload || {};
      if (c.kind === 'player') {
        const name = str(p.player, 40);
        if (!name) return;
        const row = { player: name, steam_name: str(p.steam_name, 60), profile_id: str(p.profile_id, 20).replace(/\D/g, '') };
        const have = out.players.find((x) => x.player === name);
        if (have) Object.assign(have, row); else out.players.push(row);
      } else if (c.kind === 'tournament') {
        const tid = str(p.tournament_id, 40);
        if (!validId(tid)) return;
        let t = out.tournaments.find((x) => x.tournament_id === tid);
        if (!t) {
          if (!str(p.name)) return;
          t = { tournament_id: tid };
          out.tournaments.push(t);
        }
        if (str(p.name)) t.name = str(p.name, 80);
        t.status = STATUSES.includes(p.status) ? p.status : t.status || 'Upcoming';
        t.start_date = date(p.start_date);
        t.end_date = date(p.end_date);
        t.format = str(p.format, 200);
        t.best_of = int(p.best_of, 1, 9, Number(t.best_of) || 3);
        if (t.best_of % 2 === 0) t.best_of += 1;
        t.advance = int(p.advance, 0, 64, Number(t.advance) || 0);
        t.game3_map = str(p.game3_map, 60);
        if ('playoffs' in p) t.playoffs = p.playoffs !== false;
        if ('map_pick' in p) t.map_pick = MAP_PICKS.includes(p.map_pick) ? p.map_pick : 'seeds';
        if ('pool_size' in p) t.pool_size = int(p.pool_size, 0, 60, 0);
        if (Array.isArray(p.players)) {
          const known = new Set(out.players.map((x) => x.player));
          const names = [...new Set(p.players.map((x) => str(x, 40)))].filter((x) => known.has(x));
          const before = out.roster.filter((r) => r.tournament_id === tid).map((r) => r.player);
          out.roster = out.roster.filter((r) => r.tournament_id !== tid).concat(names.map((player) => ({ tournament_id: tid, player })));
          const played = out.matches.some((m) => m.tournament_id === tid && m.status === 'Final');
          if (!played) {
            // nothing played yet: a fresh pool play schedule when asked for
            if (p.schedule === true) {
              const pairs = roundRobin(names);
              out.matches = out.matches.filter((m) => m.tournament_id !== tid).concat(pairs.map(([a, b], i) => game(tid, i + 1, a, b)));
            }
          } else if (p.schedule === true) {
            // games have been played: keep them, drop the unplayed games of anyone removed, and add pool games for
            // anyone new at the end of the schedule
            const gone = new Set(before.filter((x) => !names.includes(x)));
            out.matches = out.matches.filter((m) => !(m.tournament_id === tid && m.stage === 'Pool play' && m.status !== 'Final' && (gone.has(m.player_a) || gone.has(m.player_b))));
            const pool = out.matches.filter((m) => m.tournament_id === tid && m.stage === 'Pool play');
            const has = (a, b) => pool.some((m) => (m.player_a === a && m.player_b === b) || (m.player_a === b && m.player_b === a));
            let next = Math.max(0, ...out.matches.filter((m) => m.tournament_id === tid).map((m) => Number(m.game) || 0));
            names.filter((x) => !before.includes(x)).forEach((a) => names.forEach((b) => {
              if (a === b || has(a, b)) return;
              const g = game(tid, ++next, a, b);
              out.matches.push(g); pool.push(g);
            }));
          }
        }
      } else if (c.kind === 'rules') {
        const tid = str(p.tournament_id, 40);
        if (!validId(tid) || !Array.isArray(p.rules)) return;
        const rows = p.rules.slice(0, 40).map((r) => ({ label: str(r && r.label, 40), text: str(r && r.text, 400) })).filter((r) => r.label || r.text)
          .map((r, i) => ({ tournament_id: tid, order: i + 1, ...r }));
        out.rules = out.rules.filter((r) => r.tournament_id !== tid).concat(rows);
      } else if (c.kind === 'civ_pool') {
        const tid = str(p.tournament_id, 40);
        if (!validId(tid) || !p.pools || typeof p.pools !== 'object' || Array.isArray(p.pools)) return;
        const rows = [];
        Object.entries(p.pools).slice(0, 64).forEach(([player, civs]) => {
          const name = str(player, 40);
          if (!name || !Array.isArray(civs)) return;
          [...new Set(civs.map((x) => str(x, 40)).filter(Boolean))].slice(0, 80).forEach((civ) => rows.push({ tournament_id: tid, player: name, civ }));
        });
        out.civ_pool = out.civ_pool.filter((r) => r.tournament_id !== tid).concat(rows);
      } else return;
      applied.push(c.id);
    });
    return { ...out, applied };
  }

  root.TT_admin = { apply, roundRobin, STATUSES, MAP_PICKS, FILES };
})(typeof window !== 'undefined' ? window : globalThis);
