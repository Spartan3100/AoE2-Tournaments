// Everything the page works out from the data (standings, profiles, head to head, ...).
// ---------------------------------------------------------------- tournament calcs
dash.calc('t_summary', {
  inputs: ['tournaments', 'matches', 'roster'],
  title: 'Tournament progress',
  description: 'Per tournament: pool play games played and left, number of players, and average length of approved games.',
  fn: (tournaments, matches, roster) => tournaments.map((t) => {
    const ms = matches.filter((m) => m.tournament_id === t.tournament_id);
    const pool = ms.filter((m) => m.stage === 'Pool play');
    const mins = ms.filter((m) => m.status === 'Final').map((m) => Number(m.duration_min)).filter((n) => n > 0);
    return {
      tournament_id: t.tournament_id,
      played: ms.filter((m) => m.status === 'Final').length,
      remaining: pool.filter((m) => m.status !== 'Final').length,
      total: pool.length,
      players: roster.filter((r) => r.tournament_id === t.tournament_id).length,
      avg_minutes: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
    };
  }),
});

dash.calc('standings', {
  inputs: ['matches', 'roster'],
  title: 'Pool play standings',
  description: 'Per tournament: wins and losses per player from approved pool play games, ranked by wins, fewest losses, then head-to-head.',
  fn: (matches, roster) => {
    const out = [];
    [...new Set(roster.map((r) => r.tournament_id))].forEach((tid) => {
      const pool = matches.filter((m) => m.tournament_id === tid && m.stage === 'Pool play');
      const done = pool.filter((m) => m.status === 'Final' && m.winner);
      const has = (m, p) => m.player_a === p || m.player_b === p;
      const beat = (a, b) => done.some((m) => m.winner === a && has(m, b));
      const rows = roster.filter((r) => r.tournament_id === tid).map((r) => {
        const played = done.filter((m) => has(m, r.player));
        const wins = played.filter((m) => m.winner === r.player).length;
        return {
          tournament_id: tid, player: r.player, played: played.length, wins, losses: played.length - wins,
          win_pct: played.length ? wins / played.length : null,
          remaining: pool.filter((m) => has(m, r.player)).length - played.length,
        };
      });
      rows.sort((x, y) => y.wins - x.wins || x.losses - y.losses
        || (beat(x.player, y.player) ? -1 : beat(y.player, x.player) ? 1 : 0)
        || x.player.localeCompare(y.player));
      rows.forEach((r, i) => out.push({ tournament_id: tid, rank: i + 1, ...r }));
    });
    return out;
  },
});

dash.calc('h2h', {
  inputs: ['matches', 'roster'],
  title: 'Head-to-head results',
  description: 'Per tournament: each player’s pool play result against every other player: W, L, or vs when not yet played.',
  fn: (matches, roster) => roster.map((r) => {
    const row = { tournament_id: r.tournament_id, player: r.player };
    roster.filter((o) => o.tournament_id === r.tournament_id).forEach((o) => {
      if (o.player === r.player) { row[o.player] = ''; return; }
      const m = matches.find((g) => g.tournament_id === r.tournament_id && g.stage === 'Pool play'
        && ((g.player_a === r.player && g.player_b === o.player) || (g.player_a === o.player && g.player_b === r.player)));
      row[o.player] = !m ? '' : m.status !== 'Final' ? 'vs' : m.winner === r.player ? 'W' : 'L';
    });
    return row;
  }),
});

dash.calc('bracket', {
  inputs: ['standings', 'matches', 'tournaments'],
  title: 'Playoff bracket',
  description: 'Per tournament: single-elimination series seeded from final pool play standings (top seeds get byes when the field isn’t a power of two).',
  fn: (standings, matches, tournaments) => {
    const out = [];
    tournaments.forEach((t) => {
      const tid = t.tournament_id;
      if (t.playoffs === false) return; // round robin only
      const st = standings.filter((s) => s.tournament_id === tid);
      const pool = matches.filter((m) => m.tournament_id === tid && m.stage === 'Pool play');
      const poolDone = pool.length > 0 && pool.every((m) => m.status === 'Final');
      const n = Math.min(Number(t.advance) || st.length, st.length);
      if (n < 2) return;
      const need = Math.ceil((Number(t.best_of) || 3) / 2);
      let size = 1; while (size < n) size *= 2;
      // standard seeding order, e.g. 8 -> 1,8,4,5,2,7,3,6
      let order = [1];
      while (order.length < size) { const s = order.length * 2 + 1; order = order.flatMap((x) => [x, s - x]); }
      const rounds = Math.log2(size);
      const roundName = (r, real) => {
        const left = size / 2 ** (r - 1);
        if (left === 2) return 'Final';
        if (left === 4) return 'Semifinals';
        if (left === 8) return 'Quarterfinals';
        if (r === 1 && real <= size / 4) return 'Play-in';
        return `Round of ${left}`;
      };
      const seedPlayer = (seed) => (poolDone && seed <= n && st[seed - 1] ? st[seed - 1].player : '');
      const seedOf = (p) => { const r = st.find((s) => s.player === p); return r ? r.rank : 99; };
      let slots = order.map((s) => ({ label: s <= n ? `Seed ${s}` : 'Bye', player: seedPlayer(s), bye: s > n }));
      for (let r = 1; r <= rounds; r += 1) {
        const pairs = [];
        for (let i = 0; i < slots.length; i += 2) pairs.push([slots[i], slots[i + 1]]);
        const real = pairs.filter(([a, b]) => !a.bye && !b.bye).length;
        const next = [];
        pairs.forEach(([a, b], i) => {
          const id = `r${r}-m${i + 1}`;
          if (a.bye || b.bye) { next.push(a.bye ? { ...b } : { ...a }); return; }
          let hi = a, lo = b;
          if (hi.player && lo.player && seedOf(lo.player) < seedOf(hi.player)) [hi, lo] = [lo, hi];
          const games = matches.filter((m) => m.tournament_id === tid && m.series === id && m.status === 'Final');
          const wh = hi.player ? games.filter((m) => m.winner === hi.player).length : 0;
          const wl = lo.player ? games.filter((m) => m.winner === lo.player).length : 0;
          const winner = wh >= need ? hi.player : wl >= need ? lo.player : '';
          out.push({
            tournament_id: tid, series: id, round: roundName(r, real), round_no: r,
            high_label: hi.label, low_label: lo.label, player_high: hi.player, player_low: lo.player,
            wins_high: wh, wins_low: wl, winner,
            status: winner ? 'Final' : hi.player && lo.player ? (wh + wl ? 'In progress' : 'Ready') : 'Waiting',
          });
          const label = roundName(r, real) === 'Final' ? 'Champion' : `Winner of ${roundName(r, real).replace(/s$/, '')} ${pairs.filter(([x, y]) => !x.bye && !y.bye).indexOf(pairs[i]) + 1}`;
          next.push({ label, player: winner, bye: false });
        });
        slots = next;
      }
    });
    return out;
  },
});

dash.calc('t_overview', {
  inputs: ['tournaments', 't_summary', 'standings', 'bracket'],
  title: 'All tournaments',
  description: 'Each tournament with its status, dates, players, games played, and its leader or champion.',
  fn: (tournaments, t_summary, standings, bracket) => tournaments.map((t) => {
    const s = t_summary.find((x) => x.tournament_id === t.tournament_id) || {};
    const final = bracket.find((b) => b.tournament_id === t.tournament_id && b.round === 'Final');
    const lead = standings.find((x) => x.tournament_id === t.tournament_id && x.rank === 1 && x.played > 0);
    return {
      tournament_id: t.tournament_id, name: t.name, status: t.status, start_date: t.start_date, end_date: t.end_date,
      players: s.players ?? 0, played: s.played ?? 0, total: s.total ?? 0,
      champion: final && final.winner ? final.winner : '', leader: lead ? lead.player : '',
    };
  }),
});

dash.calc('civ_stats', {
  inputs: ['matches'],
  title: 'Civilization win rate',
  description: 'Per tournament: games played and won with each civ across approved games.',
  fn: (matches) => {
    const by = new Map();
    matches.filter((m) => m.status === 'Final').forEach((m) => {
      [[m.civ_a, m.player_a], [m.civ_b, m.player_b]].forEach(([civ, p]) => {
        if (!civ) return;
        const k = m.tournament_id + '|' + civ;
        const r = by.get(k) || { tournament_id: m.tournament_id, civ, games: 0, wins: 0 };
        r.games += 1; if (m.winner === p) r.wins += 1; by.set(k, r);
      });
    });
    return [...by.values()].map((r) => ({ ...r, win_rate: r.wins / r.games })).sort((a, b) => b.win_rate - a.win_rate || b.games - a.games);
  },
});

dash.calc('map_stats', {
  inputs: ['matches'],
  title: 'Games by map',
  description: 'Per tournament: number of approved games played on each map.',
  fn: (matches) => {
    const by = new Map();
    matches.filter((m) => m.status === 'Final' && m.map).forEach((m) => {
      const k = m.tournament_id + '|' + m.map;
      const r = by.get(k) || { tournament_id: m.tournament_id, map: m.map, games: 0 };
      r.games += 1; by.set(k, r);
    });
    return [...by.values()].sort((a, b) => b.games - a.games);
  },
});

// ---------------------------------------------------------------- player profile calcs
// Scopes: every game counts in "All games" and in one game type; tournament games also count in "Tournament".
window.TT_SCOPES = ['All games', 'Tournament', 'Ranked 1v1', 'Ranked team', 'Unranked & other'];
// Periods: a game also counts in "<view> · Last year" / "<view> · Last 6 months" when it is that recent. "All time" has no suffix.
window.TT_PERIODS = ['All time', 'Last year', 'Last 6 months'];

dash.calc('h_scoped', {
  inputs: ['history', 'matches'],
  title: 'Games by view',
  description: 'Each history game tagged with the views it counts in: All games, its type (Ranked 1v1, Ranked team, Unranked & other), and Tournament when it is a tournament game; each view also gets a “ · Last year” and “ · Last 6 months” copy when the game is that recent (counted back from today).',
  fn: (history, matches) => {
    const tour = new Set(matches.filter((m) => m.match_id).map((m) => String(m.match_id)));
    return history.map((r) => ({ player: r.player, match_id: String(r.match_id), type: r.type, scopes: viewsOf(r, tour).join('|') }));
  },
});

// the views a game counts in (see h_scoped)
function viewsOf(r, tour) {
  const kind = (t) => (t === '1v1 ranked' ? 'Ranked 1v1' : t === 'Team ranked' ? 'Ranked team' : 'Unranked & other');
  const base = ['All games', kind(r.type)].concat(tour && tour.has(String(r.match_id)) ? ['Tournament'] : []);
  const age = (Date.now() - Date.parse(r.started)) / 864e5;
  return base.concat(...[['Last year', 365], ['Last 6 months', 183]].filter(([, d]) => age <= d).map(([p]) => base.map((s) => s + ' · ' + p)));
}

dash.calc('p_summary', {
  inputs: ['history', 'h_scoped', 'replay_analysis', 'unrecorded'],
  title: 'Player headline stats',
  description: 'Per player and view: games (including games with no result and games Microsoft left out of its match history: “unknown”), win rate (games with a result only), latest and peak rating, average real-time length, best and current win streak, and average eAPM from analyzed replays.',
  fn: (history, h_scoped, replay_analysis, unrecorded) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const out = [];
    [...new Set(history.map((r) => r.player))].forEach((player) => {
      const mine = history.filter((r) => r.player === player).sort((a, b) => (a.started < b.started ? -1 : 1));
      const tagsOf = (r) => sc.get(player + '|' + String(r.match_id)) || [];
      const all = new Set(); mine.forEach((r) => tagsOf(r).forEach((t) => all.add(t)));
      [...all].forEach((scope) => {
        const g = mine.filter((r) => tagsOf(r).includes(scope));
        if (!g.length) return;
        const wins = g.filter((r) => Number(r.won) === 1).length;
        const suffix = scope.includes(' · ') ? ' · ' + scope.split(' · ')[1] : '';
        const ratedType = scope.split(' · ')[0] === 'Ranked team' ? 'Team ranked' : '1v1 ranked';
        const rated = mine.filter((r) => r.type === ratedType && r.rating != null && tagsOf(r).includes('All games' + suffix));
        let best = 0, run = 0;
        g.forEach((r) => { run = Number(r.won) === 1 ? run + 1 : 0; best = Math.max(best, run); });
        let now = 0; const last = g.length ? Number(g[g.length - 1].won) : 0;
        for (let i = g.length - 1; i >= 0 && Number(g[i].won) === last; i -= 1) now += 1;
        const unknown = unrecorded.filter((r) => r.player === player && viewsOf(r).includes(scope)).reduce((s, r) => s + (Number(r.games) || 1), 0);
        const ids = new Set(g.map((r) => String(r.match_id)));
        const an = replay_analysis.filter((a) => a.player === player && ids.has(String(a.match_id)) && a.eapm != null);
        out.push({
          player, scope, games: g.length + unknown, unknown, wins, win_rate: wins / g.length,
          rating_type: ratedType === '1v1 ranked' ? '1v1' : 'team',
          rating_now: rated.length ? Number(rated[rated.length - 1].rating) : null,
          rating_peak: rated.length ? Math.max(...rated.map((r) => Number(r.rating))) : null,
          avg_minutes: Math.round((g.reduce((s, r) => s + Number(r.duration_min), 0) / g.length) * 10) / 10,
          best_streak: best, streak_now: (last === 1 ? 'W' : 'L') + now,
          analyzed: an.length, eapm: an.length ? Math.round(an.reduce((s, a) => s + Number(a.eapm), 0) / an.length) : null,
        });
      });
    });
    return out;
  },
});

dash.calc('p_identity', {
  inputs: ['history', 'h_scoped'],
  title: 'Civ identity',
  description: 'Per player and period (All time, Last year, Last 6 months): favourite and best civ in 1v1s and in team games, best map, toughest and easiest opponent civ (best needs 5+ games, opponent civs 3+).',
  fn: (history, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const periods = ['All time', 'Last year', 'Last 6 months'];
    return [...new Set(history.map((r) => r.player))].flatMap((player) => periods.map((period) => {
    const tag = period === 'All time' ? 'All games' : 'All games · ' + period;
    const mine = history.filter((r) => r.player === player && (sc.get(player + '|' + String(r.match_id)) || []).includes(tag));
    const solo = mine.filter((r) => Number(r.players_n || 2) <= 2 && !/Team/.test(r.type));
    const team = mine.filter((r) => Number(r.players_n || 0) > 2 || /Team/.test(r.type));
    const agg = (rows, key) => {
      const m = new Map();
      rows.forEach((r) => { const k = r[key]; if (!k) return; const a = m.get(k) || { k, g: 0, w: 0 }; a.g += 1; a.w += Number(r.won) === 1 ? 1 : 0; m.set(k, a); });
      return [...m.values()];
    };
    const fav = (rows) => rows.sort((a, b) => b.g - a.g)[0];
    const best = (rows, min) => rows.filter((a) => a.g >= min).sort((a, b) => b.w / b.g - a.w / a.g || b.g - a.g)[0];
    const worst = (rows, min) => rows.filter((a) => a.g >= min).sort((a, b) => a.w / a.g - b.w / b.g || b.g - a.g)[0];
    const scv = agg(solo, 'civ'), tc = agg(team, 'civ'), mp = agg(mine, 'map'), vs = agg(solo, 'opp_civ');
    const f = (a, p) => (a ? { [p]: a.k, [p + '_games']: a.g, [p + '_rate']: a.w / a.g } : { [p]: '', [p + '_games']: null, [p + '_rate']: null });
    return {
      player, period,
      ...f(fav(scv), 'fav_civ'), ...f(best(scv, 5), 'best_civ'),
      ...f(fav(tc), 'fav_team_civ'), ...f(best(tc, 5), 'best_team_civ'),
      ...f(best(mp, 5), 'best_map'), ...f(worst(vs, 3), 'nemesis_civ'), ...f(best(vs, 3), 'prey_civ'),
    };
  }));
  },
});


dash.calc('p_civs', {
  inputs: ['history', 'h_scoped'], title: 'Civ results per player',
  description: 'Games, wins and win rate with each civ, per player and view.',
  fn: (history, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    return group(history, (r) => r.civ, 'civ', hScopes);
  },
});
dash.calc('p_maps', {
  inputs: ['history', 'h_scoped'], title: 'Map results per player',
  description: 'Games, wins and win rate on each map, per player and view.',
  fn: (history, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    return group(history, (r) => r.map, 'map', hScopes);
  },
});
dash.calc('p_vs_civ', {
  inputs: ['history', 'h_scoped'], title: 'Results against opponent civs',
  description: 'Games, wins and win rate in 1v1s by the civ the opponent played, per player and view.',
  fn: (history, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    return group(history, (r) => r.opp_civ, 'opp_civ', hScopes);
  },
});
dash.calc('p_length', {
  inputs: ['history', 'h_scoped'], title: 'Win rate by game length',
  description: 'Games and win rate per player and view in four bands of real-time game length.',
  fn: (history, h_scoped) => {
    const bands = ['Under 15 min', '15–25 min', '25–35 min', '35+ min'];
    const band = (d) => (d < 15 ? bands[0] : d < 25 ? bands[1] : d < 35 ? bands[2] : bands[3]);
    const rows = history.map((r) => ({ ...r, length: band(Number(r.duration_min)) }));
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    return group(rows, (r) => r.length, 'length', hScopes).map((r) => ({ ...r, order: bands.indexOf(r.length) })).sort((a, b) => a.order - b.order);
  },
});
dash.calc('p_styles', {
  inputs: ['history', 'h_scoped', 'civ_styles'], title: 'Civ styles played',
  description: 'Share of each player’s games by the main strength of the civ they picked, with win rate, per view.',
  fn: (history, h_scoped, civ_styles) => {
    const styleOf = new Map(civ_styles.map((c) => [c.civ, c.style]));
    const rows = history.map((r) => ({ ...r, style: styleOf.get(r.civ) || 'Unclassified' }));
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    const g = group(rows, (r) => r.style, 'style', hScopes);
    const tot = new Map();
    g.forEach((r) => tot.set(r.player + '|' + r.scope, (tot.get(r.player + '|' + r.scope) || 0) + r.games));
    return g.map((r) => ({ ...r, share: r.games / tot.get(r.player + '|' + r.scope) }));
  },
});

// ---------------------------------------------------------------- replay strategy calcs

dash.calc('s_openings', {
  inputs: ['replay_analysis', 'h_scoped'], title: 'Openings per player',
  description: 'Per player and view: games, wins and win rate with each opening read from replays, with average Feudal and Castle Age times (game minutes).',
  fn: (replay_analysis, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    const kind = (t) => (t === '1v1 ranked' ? 'Ranked 1v1' : t === 'Team ranked' ? 'Ranked team' : 'Unranked & other');
    const rows = replay_analysis.filter((a) => a.player);
    const scopesOf = (a) => sc.get(a.player + '|' + String(a.match_id)) || ['All games', kind(a.type)];
    const avg = (xs) => { const v = xs.map(Number).filter((x) => Number.isFinite(x) && x > 0); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
    return group(rows, (a) => a.opening, 'opening', scopesOf).map((g) => {
      const mine = rows.filter((a) => a.player === g.player && a.opening === g.opening && scopesOf(a).includes(g.scope));
      return { ...g, feudal_min: avg(mine.map((a) => a.feudal_min)), castle_min: avg(mine.map((a) => a.castle_min)) };
    });
  },
});
dash.calc('s_castle', {
  inputs: ['replay_analysis', 'h_scoped'], title: 'Castle Age plans per player',
  description: 'Per player and view: games, wins and win rate with each Castle Age plan read from replays.',
  fn: (replay_analysis, h_scoped) => { const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    const kind = (t) => (t === '1v1 ranked' ? 'Ranked 1v1' : t === 'Team ranked' ? 'Ranked team' : 'Unranked & other');
    const rows = replay_analysis.filter((a) => a.player);
    const scopesOf = (a) => sc.get(a.player + '|' + String(a.match_id)) || ['All games', kind(a.type)];
    const avg = (xs) => { const v = xs.map(Number).filter((x) => Number.isFinite(x) && x > 0); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; }; return group(rows, (a) => a.castle_plan, 'castle_plan', scopesOf); },
});
dash.calc('s_attack', {
  inputs: ['replay_analysis', 'h_scoped'], title: 'Attack styles per player',
  description: 'Per player and view: games, wins and win rate with each attack style read from replays, and the average minute of the first attack.',
  fn: (replay_analysis, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    const kind = (t) => (t === '1v1 ranked' ? 'Ranked 1v1' : t === 'Team ranked' ? 'Ranked team' : 'Unranked & other');
    const rows = replay_analysis.filter((a) => a.player);
    const scopesOf = (a) => sc.get(a.player + '|' + String(a.match_id)) || ['All games', kind(a.type)];
    const avg = (xs) => { const v = xs.map(Number).filter((x) => Number.isFinite(x) && x > 0); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
    return group(rows, (a) => a.attack_style, 'attack_style', scopesOf).map((g) => {
      const mine = rows.filter((a) => a.player === g.player && a.attack_style === g.attack_style && scopesOf(a).includes(g.scope));
      return { ...g, first_attack_min: avg(mine.map((a) => a.first_attack_min)) };
    });
  },
});
dash.calc('s_defense', {
  inputs: ['replay_analysis', 'h_scoped'], title: 'Defense styles per player',
  description: 'Per player and view: games, wins and win rate with each defense style read from replays.',
  fn: (replay_analysis, h_scoped) => { const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    const kind = (t) => (t === '1v1 ranked' ? 'Ranked 1v1' : t === 'Team ranked' ? 'Ranked team' : 'Unranked & other');
    const rows = replay_analysis.filter((a) => a.player);
    const scopesOf = (a) => sc.get(a.player + '|' + String(a.match_id)) || ['All games', kind(a.type)];
    const avg = (xs) => { const v = xs.map(Number).filter((x) => Number.isFinite(x) && x > 0); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; }; return group(rows, (a) => a.defense_style, 'defense_style', scopesOf); },
});
dash.calc('s_tempo', {
  inputs: ['replay_analysis', 'h_scoped'], title: 'Tempo in wins and losses',
  description: 'Per player and view: average Feudal, Castle and Imperial Age times, first attack minute and eAPM, in won and lost games.',
  fn: (replay_analysis, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    const kind = (t) => (t === '1v1 ranked' ? 'Ranked 1v1' : t === 'Team ranked' ? 'Ranked team' : 'Unranked & other');
    const rows = replay_analysis.filter((a) => a.player);
    const scopesOf = (a) => sc.get(a.player + '|' + String(a.match_id)) || ['All games', kind(a.type)];
    const avg = (xs) => { const v = xs.map(Number).filter((x) => Number.isFinite(x) && x > 0); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
    const out = [];
    const m = new Map();
    rows.forEach((a) => scopesOf(a).forEach((scope) => ['All', Number(a.won) === 1 ? 'Wins' : 'Losses'].forEach((result) => {
      const k = [a.player, scope, result].join('|');
      if (!m.has(k)) m.set(k, { player: a.player, scope, result, list: [] });
      m.get(k).list.push(a);
    })));
    m.forEach((v) => out.push({
      player: v.player, scope: v.scope, result: v.result, games: v.list.length,
      feudal_min: avg(v.list.map((a) => a.feudal_min)), castle_min: avg(v.list.map((a) => a.castle_min)),
      imperial_min: avg(v.list.map((a) => a.imperial_min)), first_attack_min: avg(v.list.map((a) => a.first_attack_min)),
      eapm: avg(v.list.map((a) => a.eapm)),
    }));
    const ord = { All: 0, Wins: 1, Losses: 2 };
    return out.sort((a, b) => ord[a.result] - ord[b.result]);
  },
});
dash.calc('s_units', {
  inputs: ['replay_analysis', 'h_scoped'], title: 'Army composition',
  description: 'Per player and view: share of military units queued by unit type, summed over analyzed replays.',
  fn: (replay_analysis, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const group = (rows, keyFn, keyName, scopesOf) => {
      const m = new Map();
      rows.forEach((r) => {
        const key = keyFn(r);
        if (key == null || key === '') return;
        scopesOf(r).forEach((scope) => {
          const k = [r.player, scope, key].join('|');
          const a = m.get(k) || { player: r.player, scope, [keyName]: key, games: 0, wins: 0 };
          a.games += 1; a.wins += Number(r.won) === 1 ? 1 : 0; m.set(k, a);
        });
      });
      return [...m.values()].map((a) => ({ ...a, win_rate: a.wins / a.games })).sort((x, y) => y.games - x.games);
    };
    const hScopes = (r) => sc.get(r.player + '|' + String(r.match_id)) || [];
    const kind = (t) => (t === '1v1 ranked' ? 'Ranked 1v1' : t === 'Team ranked' ? 'Ranked team' : 'Unranked & other');
    const rows = replay_analysis.filter((a) => a.player);
    const scopesOf = (a) => sc.get(a.player + '|' + String(a.match_id)) || ['All games', kind(a.type)];
    const avg = (xs) => { const v = xs.map(Number).filter((x) => Number.isFinite(x) && x > 0); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
    const m = new Map(), tot = new Map();
    rows.forEach((a) => String(a.unit_mix || '').split(', ').filter(Boolean).forEach((part) => {
      const i = part.lastIndexOf(' ');
      const cls = part.slice(0, i), n = Number(part.slice(i + 1));
      if (!cls || !Number.isFinite(n) || cls === 'Trade') return;
      scopesOf(a).forEach((scope) => {
        const k = [a.player, scope, cls].join('|');
        const r = m.get(k) || { player: a.player, scope, unit_class: cls, units: 0 };
        r.units += n; m.set(k, r);
        tot.set(a.player + '|' + scope, (tot.get(a.player + '|' + scope) || 0) + n);
      });
    }));
    return [...m.values()].map((r) => ({ ...r, share: r.units / tot.get(r.player + '|' + r.scope) })).sort((a, b) => b.units - a.units);
  },
});

dash.calc('review_list', {
  inputs: ['replay_games', 'history', 'h_scoped', 'unrecorded'], title: 'Games',
  description: 'Every game of the tracked players, newest first: the result for each player (from the match list), and whether its replay was found and analysed. A game without a replay still shows, with its strategy details unknown. So do games with no result (a disconnect) and games Microsoft counted on the ladder but left out of its match history (found from a jump in rating between two listed games), marked as such.',
  fn: (replay_games, history, h_scoped, unrecorded) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const games = new Map(replay_games.map((g) => [String(g.match_id), g]));
    const byMatch = new Map();
    history.forEach((r) => { const k = String(r.match_id); if (!byMatch.has(k)) byMatch.set(k, []); byMatch.get(k).push(r); });
    const week = new Date(Date.now() - 3 * 864e5).toISOString();
    return [...byMatch.entries()].map(([mid, hs]) => {
      const g = games.get(mid) || {};
      const st = String(g.status || '');
      // analysed | waiting (recent, replay not up yet, or not tried yet) | missing (no player's copy on the server) | unreadable
      const replay = st.startsWith('Analyzed') ? 'analysed' : st === 'No replay' ? 'missing' : st === 'Could not read' ? 'unreadable' : st === 'Custom scenario' ? 'scenario'
        : hs[0].type === 'Other' ? 'missing' : hs[0].started >= week || !st ? 'waiting' : 'missing';
      const scopes = new Set(hs.flatMap((r) => sc.get(r.player + '|' + mid) || []));
      return {
        match_id: mid, started: hs[0].started, type: hs[0].type, map: g.map || hs[0].map, duration_min: g.duration_min ?? hs[0].duration_min,
        players: hs.map((r) => r.player).join(', '),
        result: hs.map((r) => `${r.player} ${Number(r.won) === 1 ? 'won' : 'lost'} as ${r.civ}`).join('; '),
        tournament: scopes.has('Tournament') ? 1 : 0, replay,
        views: [...scopes].join('|'), has_playback: Number(g.has_playback) === 1 ? 1 : 0, playback_id: g.playback_id || '',
      };
    }).concat(unknownGames(unrecorded)).sort((a, b) => (a.started < b.started ? 1 : -1));
  },
});

// review_list rows for games without a result and games missing from Microsoft's match history
function unknownGames(unrecorded) {
  const byMatch = new Map();
  unrecorded.forEach((r) => { const k = String(r.match_id); if (!byMatch.has(k)) byMatch.set(k, []); byMatch.get(k).push(r); });
  const signed = (n) => (n > 0 ? '+' : '') + n;
  return [...byMatch.entries()].map(([mid, rs]) => {
    const r = rs[0], gap = r.kind === 'not_in_records';
    const result = rs.map((x) => (gap
      ? `${x.player}: rating ${signed(Number(x.rating_diff))}, ${Number(x.games) > 1 ? `at least ${x.games} games` : `likely a ${Number(x.rating_diff) > 0 ? 'win' : 'loss'}`}`
      : `${x.player}: no result${x.civ ? ` as ${x.civ}` : ''}`)).join('; ');
    return {
      match_id: mid, started: r.started, type: r.type, map: gap ? 'Unknown map' : r.map, duration_min: gap ? null : r.duration_min,
      players: rs.map((x) => x.player).join(', '), result, tournament: 0, replay: gap ? 'norecord' : 'noresult',
      views: viewsOf(r).join('|'), has_playback: 0, playback_id: '',
      // what is known about a missing game, sent with a replay added for it (pipeline/run.py check_upload)
      info: gap ? { started: r.started, before: r.before, type: r.type, ladder: r.ladder, rating: r.rating, rating_diff: r.rating_diff, games: r.games } : null,
    };
  });
}

// ---------------------------------------------------------------- tournament game detection
dash.calc('t_suggest', {
  inputs: ['history', 'matches', 'tournaments', 'roster', 'bracket'],
  title: 'Possible tournament games',
  description: 'Online 1v1 games between two players of an active tournament, played since it started, that fill an open slot: an unplayed pool play game for that pair, or the next game of their playoff series. Each waits for both players (or the organizer) to confirm before it counts.',
  fn: (history, matches, tournaments, roster, bracket) => {
    const used = new Set(matches.filter((m) => m.match_id).map((m) => String(m.match_id)));
    const out = [];
    tournaments.filter((t) => t.status === 'Active').forEach((t) => {
      const tid = t.tournament_id;
      const players = new Set(roster.filter((r) => r.tournament_id === tid).map((r) => r.player));
      const start = t.start_date || '0000';
      const end = t.end_date ? t.end_date + 'T23:59:59Z' : '9999';
      const byMatch = new Map();
      history.forEach((r) => {
        const mid = String(r.match_id);
        if (!players.has(r.player) || Number(r.players_n) !== 2 || r.started < start || r.started > end || used.has(mid)) return;
        byMatch.set(mid, (byMatch.get(mid) || []).concat([r]));
      });
      const open = matches.filter((m) => m.tournament_id === tid && m.status !== 'Final' && m.player_a && m.player_b);
      const series = bracket.filter((b) => b.tournament_id === tid && b.player_high && b.player_low && !b.winner);
      [...byMatch.values()].filter((g) => g.length === 2 && Number(g[0].won) !== Number(g[1].won))
        .sort((g, h) => (g[0].started < h[0].started ? -1 : 1))
        .forEach(([x, y]) => {
          const pair = (p, q) => (p === x.player && q === y.player) || (p === y.player && q === x.player);
          const m = open.find((o) => pair(o.player_a, o.player_b));
          const s = m ? null : series.find((b) => pair(b.player_high, b.player_low));
          if (!m && !s) return;
          const pa = m ? m.player_a : s.player_high, pb = m ? m.player_b : s.player_low;
          const ra = x.player === pa ? x : y, rb = ra === x ? y : x;
          out.push({
            tournament_id: tid, match_id: String(x.match_id), started: x.started,
            stage: m ? m.stage : s.round, game: m ? m.game : null, series: m ? (m.series || '') : s.series,
            series_game: m ? m.series_game : s.wins_high + s.wins_low + 1, slot: m ? 'game ' + m.game : s.series,
            player_a: pa, player_b: pb, winner: Number(ra.won) === 1 ? pa : pb,
            civ_a: ra.civ, civ_b: rb.civ, map: x.map, duration_min: x.duration_min, type: x.type,
          });
        });
    });
    return out.sort((a, b) => (a.started < b.started ? 1 : -1));
  },
});

// ---------------------------------------------------------------- head to head (all games between two players)
dash.calc('rivals', {
  inputs: ['history', 'h_scoped'],
  title: 'Head to head between players',
  description: 'For every pair of players and period (All time, Last year, Last 6 months): their 1v1 record against each other, team games on opposite sides, team games together, and when they last met. Opponents are told apart from teammates by the result: in the same game, opposite results means opposite teams.',
  fn: (history, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const periods = [['All time', 'All games'], ['Last year', 'All games · Last year'], ['Last 6 months', 'All games · Last 6 months']];
    const byMatch = new Map();
    history.forEach((r) => { const k = String(r.match_id); byMatch.set(k, (byMatch.get(k) || []).concat([r])); });
    const players = [...new Set(history.map((r) => r.player))].sort();
    const acc = new Map();
    players.forEach((a) => players.forEach((b) => { if (a !== b) periods.forEach(([p]) => acc.set(a + '|' + b + '|' + p, { a, b, period: p, games: 0, wins: 0, team_vs_games: 0, team_vs_wins: 0, with_games: 0, with_wins: 0, last_played: '' })); }));
    byMatch.forEach((rows) => {
      if (rows.length < 2) return;
      rows.forEach((ra) => rows.forEach((rb) => {
        if (ra.player === rb.player) return;
        const tags = sc.get(ra.player + '|' + String(ra.match_id)) || [];
        periods.forEach(([p, tag]) => {
          if (!tags.includes(tag)) return;
          const o = acc.get(ra.player + '|' + rb.player + '|' + p);
          const won = Number(ra.won) === 1 ? 1 : 0;
          if (Number(ra.won) === Number(rb.won)) { o.with_games += 1; o.with_wins += won; }
          else if (Number(ra.players_n) === 2) { o.games += 1; o.wins += won; }
          else { o.team_vs_games += 1; o.team_vs_wins += won; }
          if (ra.started > o.last_played) o.last_played = ra.started;
        });
      }));
    });
    return [...acc.values()].map((o) => ({ ...o, losses: o.games - o.wins, win_rate: o.games ? o.wins / o.games : null }));
  },
});
dash.calc('rival_maps', {
  inputs: ['history', 'h_scoped'],
  title: 'Head to head by map',
  description: 'For every pair of players and period: their 1v1 games against each other on each map, and how many the first player won.',
  fn: (history, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const periods = [['All time', 'All games'], ['Last year', 'All games · Last year'], ['Last 6 months', 'All games · Last 6 months']];
    const byMatch = new Map();
    history.filter((r) => Number(r.players_n) === 2).forEach((r) => { const k = String(r.match_id); byMatch.set(k, (byMatch.get(k) || []).concat([r])); });
    const m = new Map();
    byMatch.forEach((rows) => {
      if (rows.length !== 2 || Number(rows[0].won) === Number(rows[1].won)) return;
      [[rows[0], rows[1]], [rows[1], rows[0]]].forEach(([ra, rb]) => {
        const tags = sc.get(ra.player + '|' + String(ra.match_id)) || [];
        periods.forEach(([p, tag]) => {
          if (!tags.includes(tag)) return;
          const k = [ra.player, rb.player, p, ra.map].join('|');
          const o = m.get(k) || { a: ra.player, b: rb.player, period: p, map: ra.map, games: 0, wins: 0 };
          o.games += 1; o.wins += Number(ra.won) === 1 ? 1 : 0; m.set(k, o);
        });
      });
    });
    return [...m.values()].map((o) => ({ ...o, win_rate: o.wins / o.games })).sort((x, y) => y.games - x.games);
  },
});
dash.calc('rival_civs', {
  inputs: ['history', 'h_scoped'],
  title: 'Head to head by civ',
  description: 'For every pair of players and period: the civ the first player picked in their 1v1s against each other, with games and wins.',
  fn: (history, h_scoped) => {
    const sc = new Map(h_scoped.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const periods = [['All time', 'All games'], ['Last year', 'All games · Last year'], ['Last 6 months', 'All games · Last 6 months']];
    const byMatch = new Map();
    history.filter((r) => Number(r.players_n) === 2).forEach((r) => { const k = String(r.match_id); byMatch.set(k, (byMatch.get(k) || []).concat([r])); });
    const m = new Map();
    byMatch.forEach((rows) => {
      if (rows.length !== 2 || Number(rows[0].won) === Number(rows[1].won)) return;
      [[rows[0], rows[1]], [rows[1], rows[0]]].forEach(([ra, rb]) => {
        const tags = sc.get(ra.player + '|' + String(ra.match_id)) || [];
        periods.forEach(([p, tag]) => {
          if (!tags.includes(tag)) return;
          const k = [ra.player, rb.player, p, ra.civ].join('|');
          const o = m.get(k) || { a: ra.player, b: rb.player, period: p, civ: ra.civ, games: 0, wins: 0 };
          o.games += 1; o.wins += Number(ra.won) === 1 ? 1 : 0; m.set(k, o);
        });
      });
    });
    return [...m.values()].map((o) => ({ ...o, win_rate: o.wins / o.games })).sort((x, y) => y.games - x.games);
  },
});

// ---------------------------------------------------------------- seasons
dash.calc('p_seasons', {
  inputs: ['history', 'tournaments'],
  title: 'Seasons per player',
  description: 'Per player: every calendar year and every tournament’s dates as a season, with games, win rate, average length, most-played civ and 1v1 rating at the start and end of the season.',
  fn: (history, tournaments) => {
    const years = [...new Set(history.map((r) => r.started.slice(0, 4)))].sort().reverse();
    const seasons = tournaments.filter((t) => t.start_date).map((t) => ({
      season: t.name, kind: 'Tournament', start: t.start_date, end: t.end_date || '',
      from: t.start_date, to: t.end_date ? t.end_date + 'T23:59:59Z' : '9999',
    })).concat(years.map((y) => ({ season: y, kind: 'Year', start: y + '-01-01', end: y + '-12-31', from: y, to: y + '-12-31T23:59:59Z' })));
    const out = [];
    [...new Set(history.map((r) => r.player))].forEach((player) => {
      const mine = history.filter((r) => r.player === player).sort((a, b) => (a.started < b.started ? -1 : 1));
      seasons.forEach((s) => {
        const g = mine.filter((r) => r.started >= s.from && r.started <= s.to);
        if (!g.length) return;
        const wins = g.filter((r) => Number(r.won) === 1).length;
        const civs = new Map(); g.forEach((r) => civs.set(r.civ, (civs.get(r.civ) || 0) + 1));
        const top = [...civs.entries()].sort((a, b) => b[1] - a[1])[0];
        const rated = g.filter((r) => r.type === '1v1 ranked' && r.rating != null);
        out.push({
          player, season: s.season, kind: s.kind, start: s.start, end: s.end, games: g.length, wins, win_rate: wins / g.length,
          avg_minutes: Math.round((g.reduce((a, r) => a + Number(r.duration_min), 0) / g.length) * 10) / 10,
          top_civ: top ? top[0] : '', top_civ_games: top ? top[1] : null,
          rating_start: rated.length ? Number(rated[0].rating) : null,
          rating_end: rated.length ? Number(rated[rated.length - 1].rating) : null,
          rating_change: rated.length ? Number(rated[rated.length - 1].rating) - Number(rated[0].rating) : null,
        });
      });
    });
    return out;
  },
});
