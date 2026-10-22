// Organizer changes made on the site (Supabase table "admin_changes"): new or edited tournaments and players.
// Shared by the site (shows a change straight away) and pipeline/apply_admin_changes.js (saves it into
// config/*.json every 30 minutes, then clears it), so both always agree. Applying the same change twice gives
// the same files, so a change that was saved but not yet cleared does no harm.
(function (root) {
  const STATUSES = ['Upcoming', 'Active', 'Completed'];
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

  // cfg: {players, tournaments, roster, matches}; changes: admin_changes rows, oldest first
  function apply(cfg, changes) {
    const out = {
      players: (cfg.players || []).map((r) => ({ ...r })), tournaments: (cfg.tournaments || []).map((r) => ({ ...r })),
      roster: (cfg.roster || []).map((r) => ({ ...r })), matches: (cfg.matches || []).map((r) => ({ ...r })),
    };
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
        if (!/^[A-Za-z0-9_-]+$/.test(tid)) return;
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
        if (Array.isArray(p.players)) {
          const known = new Set(out.players.map((x) => x.player));
          const names = [...new Set(p.players.map((x) => str(x, 40)))].filter((x) => known.has(x));
          out.roster = out.roster.filter((r) => r.tournament_id !== tid).concat(names.map((player) => ({ tournament_id: tid, player })));
          // a new pool play schedule only while no game of this tournament has been played
          const played = out.matches.some((m) => m.tournament_id === tid && m.status === 'Final');
          if (p.schedule === true && !played) {
            const pairs = roundRobin(names);
            out.matches = out.matches.filter((m) => m.tournament_id !== tid).concat(pairs.map(([a, b], i) => game(tid, i + 1, a, b)));
          }
        }
      } else return;
      applied.push(c.id);
    });
    return { ...out, applied };
  }

  root.TT_admin = { apply, roundRobin, STATUSES };
})(typeof window !== 'undefined' ? window : globalThis);
