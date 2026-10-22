// When does a detected tournament game count, and how is it written into the schedule?
// Shared by the site (shows confirmed games straight away) and pipeline/apply_confirmations.js
// (saves them into config/matches.json every 30 minutes), so both always agree.
(function (root) {
  // votes: {a, b, org} rows from the Supabase "confirmations" table for one game
  function status(v, s) {
    v = v || {};
    const ans = (k) => (v[k] ? v[k].answer : '');
    const by = (k, player) => v[k] && v[k].answer === 'yes' && v[k].player === player;
    if (ans('org') === 'yes') return 'approved';
    if (ans('org') === 'no') return 'rejected';
    if (ans('a') === 'no' && ans('b') === 'no') return 'rejected';
    if (by('a', s.player_a) && by('b', s.player_b)) return 'confirmed';
    if (ans('a') === 'no' || ans('b') === 'no') return 'disputed';
    return 'waiting';
  }

  // confirmations table rows -> {"<tournament>_<match>": {a, b, org}}
  function index(rows) {
    const out = {};
    (rows || []).forEach((r) => { const k = `${r.tournament_id}_${r.match_id}`; (out[k] = out[k] || {})[r.side] = r; });
    return out;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const playedAt = (iso) => { const d = new Date(iso); return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };

  // matches: the schedule; sugg: t_suggest rows worked out from that schedule; votes: index(...)
  function applyConfirmed(matches, sugg, votes, tournaments) {
    const rows = matches.map((m) => ({ ...m }));
    const applied = [];
    sugg.slice().sort((x, y) => (x.started < y.started ? -1 : 1)).forEach((s) => {
      const v = votes[`${s.tournament_id}_${s.match_id}`];
      const st = status(v, s);
      if (st !== 'confirmed' && st !== 'approved') return;
      if (rows.some((m) => String(m.match_id) === String(s.match_id))) return;
      const fill = {
        status: 'Final', winner: s.winner, civ_a: s.civ_a, civ_b: s.civ_b, map: s.map, duration_min: s.duration_min,
        played_at: playedAt(s.started), match_id: String(s.match_id), confirmed_by: st === 'approved' ? 'organizer' : 'both players',
      };
      if (s.game != null) {
        const row = rows.find((m) => m.tournament_id === s.tournament_id && Number(m.game) === Number(s.game));
        if (!row || row.status === 'Final') return;
        Object.assign(row, fill);
      } else {
        const t = (tournaments || []).find((x) => x.tournament_id === s.tournament_id) || {};
        const need = Math.ceil((Number(t.best_of) || 3) / 2);
        const done = rows.filter((m) => m.tournament_id === s.tournament_id && m.series === s.series && m.status === 'Final');
        if (done.filter((m) => m.winner === s.player_a).length >= need || done.filter((m) => m.winner === s.player_b).length >= need) return;
        const next = Math.max(0, ...rows.filter((m) => m.tournament_id === s.tournament_id).map((m) => Number(m.game) || 0)) + 1;
        rows.push({ tournament_id: s.tournament_id, game: next, stage: s.stage, series: s.series, series_game: done.length + 1, player_a: s.player_a, player_b: s.player_b, ...fill });
      }
      applied.push(String(s.match_id));
    });
    return { rows, applied };
  }

  root.TT_confirm = { status, index, applyConfirmed };
})(typeof window !== 'undefined' ? window : globalThis);
