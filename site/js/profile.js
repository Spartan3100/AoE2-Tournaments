// Players > Profiles: one player's games in a view (All games, Ranked 1v1, Ranked team, Unranked, Tournament) and a
// period (All time, Last year, Last 6 months), all three kept in the address bar (?pp=, ?ps=, ?pr=).
// render.js calls TT_PROFILE.draw(ctx) whenever data, filters or the width change; ctx carries the helpers this page
// shares with the others (steamOr, who, mark, fillTable, failed, show, drawCompare for the seasons/ranges cards).
// Charts are inline SVG from charts.js (TT_CHARTS). Every section uses the same list of games: history rows of the
// player tagged with the chosen view by h_scoped (calcs.js), so the sections always agree with each other and with
// p_summary. Games without a result, or missing from Microsoft's records (unrecorded.json), count in game totals only.
(() => {
  const C = window.TT_CHARTS;
  const pct = d3.format('.0%');
  const num = d3.format(',');
  const one = (v) => (v == null || v === '' ? '' : d3.format('.1f')(v));
  const signed = d3.format('+d');
  const enc = encodeURIComponent;
  const el = (id) => document.getElementById(id);
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const empty = (msg) => mk('div', 'pf-empty', msg);
  const wl = (w, n) => `${num(w)}–${num(n - w)}`;
  const fmtDay = (t) => d3.utcFormat(new Date(t).getUTCFullYear() === new Date().getUTCFullYear() ? '%b %-d' : '%b %-d, %Y')(new Date(t));
  const fmtDate = (t) => d3.utcFormat('%b %-d, %Y')(new Date(t));

  // the views in the order the owner chose, and their short names (the value is h_scoped's scope name)
  const VIEWS = [['All games', 'All games'], ['Ranked 1v1', 'Ranked 1v1'], ['Ranked team', 'Ranked team'], ['Unranked & other', 'Unranked'], ['Tournament', 'Tournament']];
  const viewName = (v) => (VIEWS.find((x) => x[0] === v) || [v, v])[1];
  // bars that count something (games, units) rather than win or lose: a neutral colour, so they never read as losses
  const QTY = 'var(--color-fg-muted)';
  const PERIOD_DAYS = { 'Last year': 365, 'Last 6 months': 183 };
  // sort, switch and expand state for this visit
  const ui = { civSort: { k: 'n', dir: -1 }, vsSort: { k: 'n', dir: -1 }, maps: 'overall', vsAll: false, qp: true };
  try { ui.qp = localStorage.getItem('tt-qp') !== '0'; } catch (e) { /* storage blocked */ }
  let last = null; // the last ctx, to redraw one section after a click

  // ---------------------------------------------------------------- the games in view (memoised per data version)
  let memo = { key: null, val: null };
  function gamesOf(hist, scoped, ana, player, scope) {
    if (memo.key && memo.key[0] === hist && memo.key[1] === scoped && memo.key[2] === ana && memo.key[3] === player && memo.key[4] === scope) return memo.val;
    const tags = new Map();
    scoped.forEach((r) => { if (r.player === player) tags.set(String(r.match_id), r.scopes.split('|')); });
    const g = hist.filter((r) => r.player === player && (tags.get(String(r.match_id)) || []).includes(scope))
      .map((r) => ({ ...r, t: Date.parse(r.started), w: Number(r.won) === 1, tour: (tags.get(String(r.match_id)) || []).includes('Tournament') }))
      .sort((a, b) => a.t - b.t);
    const ids = new Set(g.map((r) => String(r.match_id)));
    const rep = new Map();
    ana.forEach((a) => { if (a.player === player && ids.has(String(a.match_id))) rep.set(String(a.match_id), a); });
    const val = { g, rep };
    memo = { key: [hist, scoped, ana, player, scope], val };
    return val;
  }
  const rec = (rows) => { const w = rows.filter((r) => r.w).length; return { n: rows.length, w, wr: rows.length ? w / rows.length : 0 }; };
  function groupBy(rows, keyFn) { const m = new Map(); rows.forEach((r) => { const k = keyFn(r); if (k == null || k === '') return; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; }
  const isTeam = (r) => Number(r.players_n || 0) > 2 || /Team/.test(r.type || '');
  const ratingAfter = (r) => (r.rating_diff != null && r.rating_diff !== '' ? Number(r.rating) + Number(r.rating_diff) : Number(r.rating));
  const gameTip = (r) => [fmtDate(r.t), `${r.w ? 'Won' : 'Lost'} as ${r.civ || '?'}${r.opp_civ ? ` vs ${r.opp_civ}` : r.opp_civs ? ` vs ${r.opp_civs}` : ''}`,
    `${r.map || 'Unknown map'} · ${Math.round(Number(r.duration_min) || 0)} min · ${r.type}`].concat(r.tour ? ['Tournament game'] : []).join('\n');

  // sortable header cells
  function sortHead(cols, state, redraw) {
    const tr = mk('tr');
    cols.forEach(([key, label, cls]) => {
      const th = mk('th', cls || '');
      const b = mk('button', 'pf-sort', label + (state.k === key ? (state.dir < 0 ? ' ↓' : ' ↑') : ''));
      b.type = 'button';
      if (state.k === key) th.setAttribute('aria-sort', state.dir < 0 ? 'descending' : 'ascending');
      b.addEventListener('click', () => { if (state.k === key) state.dir = -state.dir; else { state.k = key; state.dir = typeof key === 'string' && /civ|map|name/.test(key) ? 1 : -1; } redraw(); });
      th.appendChild(b);
      tr.appendChild(th);
    });
    return tr;
  }
  const sorter = (state) => (a, b) => {
    const x = a[state.k], y = b[state.k];
    const c = typeof x === 'string' ? x.localeCompare(y) : (x ?? -1) - (y ?? -1);
    return c * state.dir || b.n - a.n;
  };
  const rateCell = (r) => {
    const td = mk('td', 'num pf-ratecell');
    const box = mk('div', 'pf-rate');
    box.append(C.rateBar(r.wr, `${r.label || ''}\n${wl(r.w, r.n)} in ${num(r.n)} games\n${pct(r.wr)} won`.trim()), mk('span', 'pf-rt', `${pct(r.wr)} (${wl(r.w, r.n)})`));
    td.append(box);
    return td;
  };

  // ---------------------------------------------------------------- controls
  function controls(X) {
    const pick = el('pp-player');
    if (document.activeElement !== pick) {
      pick.replaceChildren(...X.names.map((n) => new Option(X.steam.get(n) ? `${X.steam.get(n)} (${n})` : n, n)));
      if (X.player) pick.value = X.player;
    }
    // render.js fills the chips in its own order; this page shows them in the owner's order, with short names
    const sc = el('pp-scope');
    if (sc.dataset.built !== '1') {
      sc.dataset.built = '1';
      sc.replaceChildren(...VIEWS.map(([v, label]) => {
        const b = mk('button', 'tt-chip', label);
        b.type = 'button'; b.dataset.scope = v;
        b.addEventListener('click', () => dash.setParams({ ps: v }));
        return b;
      }));
    }
    sc.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === X.view)));
    el('pp-period').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === X.period)));
  }

  // ---------------------------------------------------------------- 1. scoreboard
  function ratingSeries(X) {
    const team = X.view === 'Ranked team';
    const type = team ? 'Team ranked' : '1v1 ranked';
    const ladder = team ? 'team ladder' : '1v1 ladder', qpName = team ? 'Quick Play team' : 'Quick Play 1v1';
    // Quick Play has its own rating: drawn as a second line, never mixed into the ladder's
    const okRow = (r) => r.type === type && r.rating != null && r.rating !== '';
    const QP = window.TT_QUICK_PLAY;
    let rows = X.g.filter((r) => okRow(r) && !QP(r)), qpRows = X.g.filter((r) => okRow(r) && QP(r)), note = '';
    if (rows.length < 2 && qpRows.length < 2) {
      // a view with no rated games of its own (Unranked, a quiet Tournament view): the ladder over the same period
      const all = X.hist.filter((r) => r.player === X.player && okRow(r) && X.inPeriod(r))
        .map((r) => ({ ...r, t: Date.parse(r.started), w: Number(r.won) === 1, tour: false })).sort((a, b) => a.t - b.t);
      if (all.length >= 2 && X.view !== 'All games' && X.view !== 'Ranked 1v1' && X.view !== 'Ranked team') {
        note = `${viewName(X.view)} games in this period don’t have enough ${ladder} ratings, so this shows the ${ladder} over the same period.`;
        rows = all.filter((r) => !QP(r));
        qpRows = all.filter(QP);
      }
    }
    const toPts = (list) => list.map((r) => {
      const v = ratingAfter(r);
      return { t: r.t, y: v, won: r.w, r, tip: [fmtDate(r.t), `Rating ${num(v)}${r.rating_diff != null && r.rating_diff !== '' ? ` (${signed(Number(r.rating_diff))})` : ''}`,
        `${r.w ? 'Won' : 'Lost'} as ${r.civ}${r.opp_civ ? ` vs ${r.opp_civ}` : ''} on ${r.map}`].concat(QP(r) ? [qpName] : [], r.tour ? ['Tournament game'] : []).join('\n') };
    });
    return { pts: toPts(rows), qp: toPts(qpRows), ladder, qpName, note };
  }

  function board(X) {
    const host = el('pf-board');
    host.replaceChildren();
    const row = X.sum, g = X.g;
    const where = { player: X.player, scope: X.scope };
    if (!g.length && !(row && row.unknown)) {
      host.append(nameBlock(X, 0), empty('No games in this view and period.'));
      return;
    }
    const R = X.rating;
    const left = mk('div', 'pf-board-l');
    left.append(nameBlock(X, row ? row.games : g.length));
    const big = mk('div', 'pf-big');
    big.append(mk('div', 'tt-label', `Rating now (${R.ladder})`));
    const lastPt = R.pts[R.pts.length - 1];
    big.append(mk('div', 'pf-big-v', lastPt ? num(lastPt.y) : '—'));
    left.append(big);
    if (R.pts.length > 1) {
      const vals = R.pts.slice(-60).map((p) => p.y);
      const sp = mk('div', 'pf-spark');
      left.append(sp);
      C.spark(sp, vals, { height: 54, label: 'Rating trend', tip: `Rating trend\nLast ${vals.length} rated games\nFrom ${num(vals[0])} to ${num(vals[vals.length - 1])}` });
      const first = R.pts[0].y, peak = R.pts.reduce((a, p) => (p.y > a.y ? p : a), R.pts[0]);
      const d = lastPt.y - first;
      left.append(mk('div', 'pf-small', `${d >= 0 ? 'Up' : 'Down'} ${num(Math.abs(d))} points over this period · peak ${num(peak.y)} on ${fmtDay(peak.t)}`));
    } else left.append(mk('div', 'pf-small', `No ${R.ladder} games in this view and period.`));

    const right = mk('div', 'pf-board-r');
    const srow = (k, mid, v) => { const r = mk('div', 'pf-stat'); r.append(mk('div', 'k', k), mid || mk('span'), v); return r; };
    const val = (nodes) => { const v = mk('div', 'v'); v.append(...[].concat(nodes)); return v; };
    const m = (f, text) => X.mark('p_summary', where, f, text, 'span');
    const R0 = rec(g);
    if (row && g.length) {
      right.append(srow('Win rate', C.rateBar(row.win_rate, `Win rate\n${pct(row.win_rate)} of ${num(g.length)} games with a result`), val(m('win_rate', pct(row.win_rate)))));
      const wlb = mk('div', 'tt-c-bar'); const wi = mk('i'); wi.style.cssText = `width:${Math.round(row.win_rate * 100)}%;background:var(--color-ok)`; wlb.append(wi);
      wlb.style.background = 'var(--color-bad)';
      wlb.setAttribute('data-tip', `Record\n${num(R0.w)} wins, ${num(R0.n - R0.w)} losses`);
      right.append(srow('Record', wlb, val(wl(R0.w, R0.n))));
    }
    const gv = val(m('games', num(row ? row.games : g.length)));
    const gs = mk('span', 'pf-small');
    if (row && row.unknown) { gs.append('incl. ', m('unknown', num(row.unknown)), ' with unknown result'); gs.title = 'Games with no result (a disconnect) or that Microsoft left out of its match history. They are not in the win rate.'; }
    right.append(srow('Games', gs, gv));
    if (g.length) {
      const l10 = g.slice(-10);
      const pips = mk('div', 'pf-pips tt-c-tips');
      l10.forEach((r) => { const i = mk('i'); i.style.background = r.w ? 'var(--color-ok)' : 'var(--color-bad)'; i.setAttribute('data-tip', gameTip(r)); pips.append(i); });
      right.append(srow('Last 10', pips, val(`${l10.filter((r) => r.w).length}/${l10.length}`)));
    }
    if (row && g.length) {
      const cur = String(row.streak_now || '');
      const n = Number(cur.slice(1)) || 0, won = cur[0] === 'W';
      right.append(srow('Streaks', mk('span', 'pf-small', `Best: ${num(row.best_streak)} wins in a row`), val([m('streak_now', `${n} ${won ? (n === 1 ? 'win' : 'wins') : (n === 1 ? 'loss' : 'losses')}`)])));
      right.lastChild.title = 'Current streak';
    }
    if (row) {
      const es = mk('span', 'pf-small');
      if (row.eapm != null) { es.append('from ', m('analyzed', num(row.analyzed)), ' replays'); right.append(srow('eAPM', es, val(m('eapm', num(row.eapm))))); }
      else right.append(srow('eAPM', mk('span', 'pf-small', 'No replay read in this view'), val('Unknown')));
      if (g.length) right.append(srow('Avg length', mk('span', 'pf-small', 'real-time minutes'), val(m('avg_minutes', `${one(row.avg_minutes)} min`))));
    }
    const wrap = mk('div', 'pf-board');
    wrap.append(left, right);
    host.append(wrap);
  }
  function nameBlock(X, games) {
    const nb = mk('div', 'pf-name');
    const av = mk('span', 'pf-avatar', (X.steamOr(X.player) || '?').slice(0, 1).toUpperCase());
    const t = mk('div');
    const h = mk('h1', 'pf-h1');
    h.append(...X.who(X.player).map((n) => (n.nodeType ? n : document.createTextNode(n))));
    t.append(h, mk('div', 'pf-small', `${viewName(X.view)} · ${X.period} · ${num(games)} game${games === 1 ? '' : 's'}`));
    nb.append(av, t);
    return nb;
  }

  // ---------------------------------------------------------------- 2. rating over time
  function rating(X) {
    const host = el('pf-rating');
    host.replaceChildren();
    const R = X.rating;
    el('pf-rating-title').textContent = `Rating over time (${R.ladder})`;
    const qpBtn = el('pf-qp');
    qpBtn.hidden = !R.qp.length;
    qpBtn.textContent = `Show ${R.qpName}`;
    qpBtn.setAttribute('aria-pressed', String(ui.qp));
    const qp = ui.qp ? R.qp : [];
    el('pf-rating-note').textContent = (R.note || `Rating on the ${R.ladder} after each ranked game in this view; dots are wins and losses. Hover or tap for the exact number.`) +
      (R.qp.length ? ` ${R.qpName} has its own rating, separate from the ladder${ui.qp ? ': the dashed line' : ''}.` : '');
    if (R.pts.length < 2 && qp.length < 2) { host.append(empty(X.view === 'Unranked & other' ? 'Unranked games have no rating, and there are no ranked games in this period.' : `Not enough ${R.ladder} games in this view and period to draw a trend.`)); return; }
    const QPC = 'var(--color-fg-muted)';
    C.line(host, R.pts, { area: true, dots: true, yTitle: 'Rating', label: `Rating on the ${R.ladder}${qp.length ? ` and ${R.qpName}` : ''} over time`, more: qp.length ? [{ pts: qp, color: QPC, dash: '5 4' }] : [] });
    host.append(C.legend([['var(--color-ok)', 'Win'], ['var(--color-bad)', 'Loss'], ['var(--color-accent)', `Rating after the game (${R.ladder})`]].concat(qp.length ? [[QPC, R.qpName]] : [])));
  }

  // ---------------------------------------------------------------- 3. civs
  function civs(X) {
    const host = el('pf-civs');
    host.replaceChildren();
    const rows = [...groupBy(X.g, (r) => r.civ)].map(([civ, a]) => ({ civ, label: civ, ...rec(a), len: a.reduce((s, r) => s + (Number(r.duration_min) || 0), 0) / a.length }));
    if (!rows.length) { host.append(empty('No games in this view and period.')); return; }
    rows.sort(sorter(ui.civSort));
    const t = mk('table', 'pf-table');
    const th = mk('thead'); th.append(sortHead([['civ', 'Civ'], ['n', 'Games', 'num'], ['wr', 'Win rate', 'num'], ['len', 'Avg length', 'num pf-hide-sm']], ui.civSort, () => civs(last)));
    const tb = mk('tbody');
    rows.forEach((r) => {
      const tr = mk('tr');
      tr.append(mk('td', '', r.civ), mk('td', 'num', num(r.n)), rateCell(r), mk('td', 'num pf-hide-sm', `${Math.round(r.len)} min`));
      tb.append(tr);
    });
    t.append(th, tb);
    const sc = mk('div', 'tt-scroll pf-tall');
    sc.append(t);
    host.append(sc);
  }

  // ---------------------------------------------------------------- 4. maps
  function maps(X) {
    const host = el('pf-maps');
    host.replaceChildren();
    el('pf-maps-mode').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === ui.maps)));
    const gm = [...groupBy(X.g, (r) => r.map)].map(([map, a]) => ({ map, a, ...rec(a) })).sort((x, y) => y.n - x.n || x.map.localeCompare(y.map));
    const note = el('pf-maps-note');
    if (!gm.length) { note.textContent = ''; host.append(empty('No games in this view and period.')); return; }
    if (ui.maps === 'overall') {
      const top = gm.slice(0, 20), mx = top[0].n, few = (host.clientWidth || 320) < 460;
      note.textContent = `Games played and win rate on each map, most played first${gm.length > top.length ? ` (top ${top.length} of ${gm.length} maps)` : ''}. The dashed line is 50%.`;
      C.hbars(host, top.map((r) => {
        const tip = `${r.map}\n${num(r.n)} games: ${wl(r.w, r.n)}\n${pct(r.wr)} won`;
        return { label: r.map, tip, panels: [{ segs: [{ v: r.n, color: QTY }], txt: num(r.n), tip }, { segs: [{ v: r.wr, color: C.winColor(r.wr) }], txt: pct(r.wr), tip }] };
      }), { panels: [{ title: 'Games played', max: mx, ticks: C.niceTicks(0, mx, few ? 2 : 4).filter((v) => v <= mx), fmtT: num }, { title: 'Win rate', max: 1, ref: 0.5, ticks: [0, 0.5, 1], fmtT: pct }], label: 'Games played and win rate by map' });
      return;
    }
    // By month: maps × months, coloured by win rate
    const lastT = Date.now();
    const firstT = X.g[0].t;
    const nMonths = X.period === 'Last 6 months' ? 6 : X.period === 'Last year' ? 12 : Math.min(24, Math.max(1, monthsBetween(firstT, lastT) + 1));
    const months = [];
    const now = new Date(lastT);
    for (let i = nMonths - 1; i >= 0; i -= 1) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() }); }
    const top = gm.slice(0, 12);
    const cells = top.map((r) => { const mm = new Map(); r.a.forEach((x) => { const d = new Date(x.t); const k = d.getUTCFullYear() * 12 + d.getUTCMonth(); if (!mm.has(k)) mm.set(k, []); mm.get(k).push(x); }); return mm; });
    const lab = months.map((x, i) => (i === 0 || x.m === 0 ? d3.utcFormat('%b %y')(new Date(Date.UTC(x.y, x.m, 1))) : d3.utcFormat('%b')(new Date(Date.UTC(x.y, x.m, 1)))));
    note.textContent = `The ${top.length} most played maps in each of the last ${nMonths} months${X.period === 'All time' && monthsBetween(firstT, lastT) + 1 > 24 ? ' (All time shows the last 24)' : ''}. Green: won more than lost that month; red: lost more. Empty boxes: no games.`;
    const w = host.clientWidth || 320;
    C.heat(host, top.map((r) => r.map), lab, (r, c) => {
      const mo = months[c], a = cells[r].get(mo.y * 12 + mo.m) || [], q = rec(a);
      const name = d3.utcFormat('%B %Y')(new Date(Date.UTC(mo.y, mo.m, 1)));
      return a.length ? { fill: C.heatColor(q.wr), tip: `${top[r].map} · ${name}\n${num(q.n)} games: ${wl(q.w, q.n)}\n${pct(q.wr)} won` } : { fill: 'var(--color-panel)', empty: true, tip: `${top[r].map} · ${name}\nNo games` };
    }, { every: Math.max(1, Math.ceil(46 / Math.max(1, (w - (w < 460 ? 82 : 112)) / nMonths))), label: 'Win rate by map and month', cellH: 20 });
    host.append(C.legend([[C.heatColor(0.8), 'Won more'], [C.heatColor(0.5), 'About even'], [C.heatColor(0.2), 'Lost more']]));
  }
  const monthsBetween = (a, b) => { const x = new Date(a), y = new Date(b); return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth(); };

  // ---------------------------------------------------------------- 5. matchups
  function matchups(X) {
    const host = el('pf-vs');
    host.replaceChildren();
    const solo = X.g.filter((r) => r.opp_civ && !isTeam(r));
    const all = [...groupBy(solo, (r) => r.opp_civ)].map(([civ, a]) => ({ civ, label: `vs ${civ}`, ...rec(a) }));
    const note = el('pf-vs-note');
    if (!all.length) { note.textContent = '1v1 games, by the civ the opponent played.'; host.append(empty(X.view === 'Ranked team' ? 'Team games have no single opponent civ. Pick another view for 1v1 matchups.' : 'No 1v1 games in this view and period.')); return; }
    const minN = solo.length > 150 ? 5 : 3;
    const ok = all.filter((r) => r.n >= minN).sort((a, b) => b.wr - a.wr || b.n - a.n);
    note.textContent = `${num(solo.length)} 1v1 games against ${all.length} different civs. Best and toughest count only civs met at least ${minN} times.`;
    if (ok.length >= 2) {
      const k = Math.min(5, Math.floor(ok.length / 2));
      const list = (title, arr, good) => {
        const box = mk('div');
        box.append(mk('h3', 'pf-subh', title));
        const ul = mk('ul', 'pf-list');
        arr.forEach((r) => {
          const li = mk('li');
          li.append(mk('span', 'pf-grow', `vs ${r.civ}`), mk('span', 'pf-small', `${wl(r.w, r.n)} in ${num(r.n)}`), mk('span', `pf-pill ${r.wr >= 0.5 ? 'ok' : 'bad'}`, pct(r.wr)));
          li.title = `${pct(r.wr)} won against ${r.civ} over ${r.n} games`;
          ul.append(li);
        });
        box.append(ul);
        return box;
      };
      const two = mk('div', 'pf-two');
      two.append(list('Best matchups', ok.slice(0, k), true), list('Toughest matchups', ok.slice(-k).reverse(), false));
      host.append(two);
    } else host.append(empty(`Not enough games against any civ yet (needs ${minN} games against the same civ).`));
    const tg = mk('button', 'tt-btn pf-more', ui.vsAll ? 'Hide the full list' : `Show all ${all.length} civs`);
    tg.type = 'button';
    tg.setAttribute('aria-expanded', String(ui.vsAll));
    tg.addEventListener('click', () => { ui.vsAll = !ui.vsAll; matchups(last); });
    host.append(tg);
    if (ui.vsAll) {
      all.sort(sorter(ui.vsSort));
      const t = mk('table', 'pf-table');
      const th = mk('thead'); th.append(sortHead([['civ', 'Opponent civ'], ['n', 'Games', 'num'], ['w', 'Wins', 'num pf-hide-sm'], ['wr', 'Win rate', 'num']], ui.vsSort, () => matchups(last)));
      const tb = mk('tbody');
      all.forEach((r) => { const tr = mk('tr'); tr.append(mk('td', '', r.civ), mk('td', 'num', num(r.n)), mk('td', 'num pf-hide-sm', num(r.w)), rateCell(r)); tb.append(tr); });
      t.append(th, tb);
      const sc = mk('div', 'tt-scroll pf-tall'); sc.id = 'pf-vs-all';
      sc.append(t);
      host.append(sc);
    }
  }

  // ---------------------------------------------------------------- 6. game length & time of day
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function when(X) {
    const lh = el('pf-length'), hh = el('pf-hours');
    lh.replaceChildren(); hh.replaceChildren();
    if (!X.g.length) { lh.append(empty('No games in this view and period.')); hh.append(empty('No games in this view and period.')); return; }
    const bk = [[0, 10, '<10'], [10, 20, '10–20'], [20, 30, '20–30'], [30, 40, '30–40'], [40, 50, '40–50'], [50, 1e9, '50+']];
    const w = lh.clientWidth || 320;
    C.vbars(lh, bk.map(([a, z, l]) => {
      const q = rec(X.g.filter((r) => Number(r.duration_min) >= a && Number(r.duration_min) < z));
      return { label: l, sub: `${num(q.n)}${w > 420 ? ' games' : ''}`, v: q.n ? q.wr : 0, txt: q.n ? pct(q.wr) : '', color: C.winColor(q.wr), opacity: q.n < 5 ? 0.45 : 1,
        tip: `${l} min games\n${q.n ? `${num(q.n)} games: ${wl(q.w, q.n)}\n${pct(q.wr)} won` : 'No games'}` };
    }), { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmtY: pct, ref: 0.5, yTitle: 'Win rate', height: 240, label: 'Win rate by game length' });
    // 7 days × 24 hours, in the viewer's own time zone
    const cnt = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, w: 0 })));
    X.g.forEach((r) => { const d = new Date(r.t); const k = cnt[(d.getDay() + 6) % 7][d.getHours()]; k.n += 1; if (r.w) k.w += 1; });
    const mx = Math.max(1, ...cnt.flat().map((k) => k.n));
    const hw = hh.clientWidth || 320;
    C.heat(hh, DAYS, Array.from({ length: 24 }, (_, i) => String(i)), (r, c) => {
      const k = cnt[r][c];
      const tip = `${DAYS[r]} ${String(c).padStart(2, '0')}:00–${String(c).padStart(2, '0')}:59\n${k.n ? `${num(k.n)} game${k.n === 1 ? '' : 's'}, ${num(k.w)} won (${pct(k.w / k.n)})` : 'No games'}`;
      return k.n ? { fill: `color-mix(in srgb, var(--color-accent) ${Math.round(18 + (k.n / mx) * 82)}%, var(--color-soft))`, tip } : { fill: 'var(--color-soft)', tip };
    }, { labelW: 34, cellH: hw < 460 ? 22 : 18, every: 1, label: 'Games by day and hour', xTitle: 'Hour of day (your time, 0 = midnight)' });
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* no Intl */ }
    // the hour they play most, across all days
    const byHour = Array.from({ length: 24 }, (_, h) => cnt.reduce((a, d) => ({ n: a.n + d[h].n, w: a.w + d[h].w }), { n: 0, w: 0 }));
    const top = byHour.map((k, h) => ({ ...k, h })).sort((a, b) => b.n - a.n)[0];
    const hh2 = (h) => `${String(h % 24).padStart(2, '0')}:00`;
    el('pf-hours-note').textContent = `${top && top.n ? `Plays most between ${hh2(top.h)} and ${hh2(top.h + 1)} (${num(top.n)} games, ${pct(top.w / top.n)} won). ` : ''}Day and hour each game started, in your local time${tz ? ` (${tz})` : ''}. Darker means more games; hover or tap a box for the count.`;
  }

  // ---------------------------------------------------------------- 7. strategy (openings donut)
  function strategy(X) {
    const host = el('pf-strat');
    host.replaceChildren();
    const reps = X.g.map((r) => X.rep.get(String(r.match_id))).filter(Boolean);
    const withOpening = reps.filter((a) => a.opening);
    el('pf-strat-note').textContent = X.g.length
      ? `Openings read from replays: based on ${num(withOpening.length)} of ${num(X.g.length)} games in this view${X.g.length > withOpening.length ? `. The other ${num(X.g.length - withOpening.length)} have no replay that could be read, so their opening is unknown` : ''}.`
      : 'Openings read from replays.';
    if (!withOpening.length) { host.append(empty(X.g.length ? 'No replay could be read for the games in this view, so their openings are unknown.' : 'No games in this view and period.')); return; }
    const gr = [...groupBy(withOpening, (a) => a.opening)].map(([k, a]) => ({ k, n: a.length, w: a.filter((x) => Number(x.won) === 1).length })).sort((a, b) => b.n - a.n);
    let parts = gr;
    if (gr.length > 7) { const rest = gr.slice(6); parts = gr.slice(0, 6).concat([{ k: 'Other', n: rest.reduce((s, r) => s + r.n, 0), w: rest.reduce((s, r) => s + r.w, 0) }]); }
    const tot = withOpening.length;
    const split = mk('div', 'pf-split');
    const dbox = mk('div', 'pf-donut');
    C.donut(dbox, parts.map((r, i) => ({ v: r.n, color: C.PAL[i % C.PAL.length], tip: `${r.k}\n${num(r.n)} games (${pct(r.n / tot)})\n${pct(r.w / r.n)} won` })), { size: 180, center: num(tot), centerSub: tot === 1 ? 'replay' : 'replays', label: 'Openings' });
    const ll = mk('div', 'pf-leg tt-c-tips');
    parts.forEach((r, i) => {
      const line = mk('div', 'pf-leg-r');
      const sw = mk('i'); sw.style.background = C.PAL[i % C.PAL.length];
      const wr = r.w / r.n;
      line.append(sw, mk('span', '', r.k), mk('span', 'pf-small', `${pct(r.n / tot)} · ${num(r.n)}`), mk('span', `pf-pill ${wr >= 0.5 ? 'ok' : 'bad'}`, `${pct(wr)} won`));
      line.setAttribute('data-tip', `${r.k}\n${num(r.n)} of ${num(tot)} games\n${wl(r.w, r.n)}, ${pct(wr)} won`);
      ll.append(line);
    });
    split.append(dbox, ll);
    host.append(split);
  }

  // ---------------------------------------------------------------- 8. recent form
  function form(X) {
    const host = el('pf-form');
    host.replaceChildren();
    if (!X.g.length) { host.append(empty('No games in this view and period.')); return; }
    const l = X.g.slice(-20), q = rec(l), all = rec(X.g);
    const sb = mk('div', 'pf-strip');
    host.append(sb);
    C.strip(sb, l.map((r) => ({ color: r.w ? 'var(--color-ok)' : 'var(--color-bad)', txt: r.w ? 'W' : 'L', tip: gameTip(r) })), { max: 34, slots: 20, label: `Last ${l.length} games` });
    host.append(mk('p', 'pf-form-line', `Last ${l.length}: ${wl(q.w, q.n)} (${pct(q.wr)}), against ${pct(all.wr)} over the whole view. Oldest on the left, newest on the right.`));
    host.append(mk('h3', 'pf-subh', 'Latest games'));
    const ul = mk('ul', 'pf-list');
    X.g.slice(-8).reverse().forEach((r) => {
      const li = mk('li');
      const vs = r.opp_civ || r.opp_civs || '';
      li.append(mk('span', `pf-pill ${r.w ? 'ok' : 'bad'}`, r.w ? 'Won' : 'Lost'), mk('span', 'pf-grow', `${r.civ || '?'}${vs ? ` vs ${vs}` : ''}`),
        mk('span', 'pf-small', `${r.map || 'Unknown map'} · ${Math.round(Number(r.duration_min) || 0)} min · ${fmtDay(r.t)}`));
      if (r.rating_diff != null && r.rating_diff !== '') li.append(mk('span', `pf-small ${Number(r.rating_diff) >= 0 ? 'pf-up' : 'pf-dn'}`, signed(Number(r.rating_diff))));
      if (X.rep.has(String(r.match_id))) {
        const b = mk('button', 'tt-btn pf-review', 'Review ›');
        b.type = 'button';
        b.addEventListener('click', () => { dash.setParams({ m: String(r.match_id) }); X.show('review', true); });
        li.append(b);
      }
      ul.append(li);
    });
    host.append(ul);
  }

  // ---------------------------------------------------------------- 9. team games
  function teams(X) {
    const mh = el('pf-mates'), ch = el('pf-combos');
    mh.replaceChildren(); ch.replaceChildren();
    const tg = X.g.filter(isTeam);
    const note = el('pf-team-note');
    if (!tg.length) {
      note.textContent = '';
      const msg = X.view === 'Ranked 1v1' ? 'No team games in the Ranked 1v1 view. Pick All games or Ranked team.' : 'No team games in this view and period.';
      mh.append(empty(msg)); ch.append(empty(msg));
      return;
    }
    note.textContent = `${num(tg.length)} team games in this view and period (${wl(rec(tg).w, tg.length)}).`;
    const mates = new Map();
    tg.forEach((r) => String(r.teammates || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => { if (!mates.has(n)) mates.set(n, []); mates.get(n).push(r); }));
    const mrows = [...mates].map(([n, a]) => ({ n: a.length, name: n, ...rec(a) })).sort((a, b) => b.n - a.n || b.wr - a.wr).slice(0, 10);
    if (!mrows.length) mh.append(empty('Teammates aren’t known for these games.'));
    else {
      C.hbars(mh, mrows.map((r) => {
        const nm = X.names.includes(r.name) ? X.steamOr(r.name) : r.name;
        const tip = `Playing with ${nm}\n${num(r.n)} games: ${wl(r.w, r.n)}\n${pct(r.wr)} won`;
        return { label: nm, tip, panels: [{ segs: [{ v: r.wr, color: C.winColor(r.wr) }], txt: `${pct(r.wr)} · ${num(r.n)}`, tip }] };
      }), { panels: [{ max: 1, ref: 0.5, ticks: [0, 0.5, 1], fmtT: pct, txtW: 66 }], rowH: 30, label: 'Win rate by teammate' });
      mh.append(mk('p', 'tt-note', `Win rate and games together, for the ${mrows.length} most frequent teammates; every teammate in a game counts. Hover or tap a bar for the record.`));
    }
    const combo = (r) => { const t = String(r.team_civs || '').split(',').map((s) => s.trim()).filter(Boolean).sort(); return t.length && r.civ ? `${r.civ} + ${t.join(', ')}` : null; };
    const minN = tg.length > 80 ? 3 : 2;
    const crows = [...groupBy(tg, combo)].map(([k, a]) => ({ k, label: k, ...rec(a) })).filter((r) => r.n >= minN).sort((a, b) => b.wr - a.wr || b.n - a.n).slice(0, 8);
    if (!crows.length) { ch.append(empty(`No civ combo played ${minN} or more times yet.`)); return; }
    const t = mk('table', 'pf-table');
    const hr = mk('tr'); hr.append(mk('th', '', 'Their civ + teammates’ civs'), mk('th', 'num', 'Games'), mk('th', 'num', 'Win rate'));
    const th = mk('thead'); th.append(hr);
    const tb = mk('tbody');
    crows.forEach((r) => { const tr = mk('tr'); tr.append(mk('td', 'pf-wrap', r.k), mk('td', 'num', num(r.n)), rateCell(r)); tb.append(tr); });
    t.append(th, tb);
    const sc = mk('div', 'tt-scroll');
    sc.append(t);
    ch.append(sc, mk('p', 'tt-note', `Civ combos played together at least ${minN} times, best win rate first.`));
  }

  // ---------------------------------------------------------------- deeper analysis (the earlier profile cards)
  function deeper(X) {
    const { player, scope, period, view, mark, fillTable, failed } = X;
    const where = { player, scope };
    const pick = (id) => { const d = dash.data(id); return d.status === 'ok' ? d.data.filter((r) => r.player === player && r.scope === scope) : null; };

    // how many games the strategy figures come from
    const cov = el('pp-coverage');
    const read = X.g.filter((r) => X.rep.has(String(r.match_id))).length, gap = X.g.length - read;
    cov.hidden = !gap;
    cov.textContent = gap ? `⚠ Strategy figures below come from ${num(read)} of ${num(X.g.length)} games in this view. The other ${num(gap)} have no replay that could be read, so their openings, ages and armies are unknown (their results still count above). Games lists which.` : '';

    // identity cards
    const idBox = el('pp-identity');
    const idd = dash.data('p_identity');
    if (idd.status === 'error') failed(idBox);
    else if (idd.status === 'ok') {
      const r = idd.data.find((x) => x.player === player && x.period === period);
      const iw = { player, period };
      const card = (label, f, noteText) => {
        const c = mk('div', 'tt-card');
        c.id = `id-${f}`;
        c.appendChild(mk('div', 'tt-label', label));
        const v = mk('div', 'v');
        if (r && r[f]) {
          v.appendChild(mark('p_identity', iw, f, r[f], 'span'));
          c.appendChild(v);
          const s = mk('div', 'tt-kpi-s');
          s.append(mark('p_identity', iw, `${f}_rate`, pct(r[`${f}_rate`])), ' won over ', mark('p_identity', iw, `${f}_games`, num(r[`${f}_games`])), ' games');
          c.appendChild(s);
        } else { v.textContent = '—'; c.appendChild(v); c.appendChild(mk('div', 'tt-kpi-s', noteText)); }
        return c;
      };
      idBox.replaceChildren(
        card('Favourite civ (1v1)', 'fav_civ', 'No 1v1 games'),
        card('Best civ (1v1)', 'best_civ', 'No civ with 5+ games'),
        card('Favourite team civ', 'fav_team_civ', 'No team games'),
        card('Best team civ', 'best_team_civ', 'No team civ with 5+ games'),
        card('Best map', 'best_map', 'No map with 5+ games'),
        card('Toughest opponent civ', 'nemesis_civ', 'Not enough 1v1 games'),
        card('Easiest opponent civ', 'prey_civ', 'Not enough 1v1 games'),
      );
    }

    // strategy tables
    const stratCols = (keyField, label, extra = []) => [
      { field: keyField, label },
      { field: 'games', label: 'Games', num: true },
      { field: 'wins', label: 'Wins', num: true },
      { field: 'win_rate', label: 'Win %', num: true, fmt: (v) => pct(v), cls: X.ratePill },
      ...extra,
    ];
    const noReplays = 'No replay could be read in this view yet, so this is unknown.';
    [['pp-castle', 's_castle', 'castle_plan', 'Plan', []],
      ['pp-attack', 's_attack', 'attack_style', 'Style', [{ field: 'first_attack_min', label: 'First attack', num: true, fmt: one }]],
      ['pp-defense', 's_defense', 'defense_style', 'Style', []]].forEach(([tid, id, kf, label, extra]) => {
      const t = el(tid);
      const rows = pick(id);
      if (rows) fillTable(t, rows, stratCols(kf, label, extra), ['player', 'scope', kf], { emptyText: noReplays });
      else if (dash.data(id).status === 'error') failed(t.tBodies[0]);
    });
    const tempo = pick('s_tempo');
    if (tempo) fillTable(el('pp-tempo'), tempo, [
      { field: 'result', label: 'Games' }, { field: 'games', label: 'Count', num: true },
      { field: 'feudal_min', label: 'Feudal', num: true, fmt: one }, { field: 'castle_min', label: 'Castle', num: true, fmt: one },
      { field: 'imperial_min', label: 'Imperial', num: true, fmt: one }, { field: 'first_attack_min', label: '1st attack', num: true, fmt: one },
      { field: 'eapm', label: 'eAPM', num: true, fmt: (v) => (v == null ? '' : num(Math.round(v))) },
    ], ['player', 'scope', 'result'], { emptyText: noReplays });
    else if (dash.data('s_tempo').status === 'error') failed(el('pp-tempo').tBodies[0]);

    // army composition
    const ub = el('pp-units');
    ub.replaceChildren();
    const units = pick('s_units');
    if (units) {
      const top = units.slice(0, 10);
      if (!top.length) ub.append(empty(noReplays));
      else {
        const mx = Math.max(...top.map((r) => r.share));
        C.hbars(ub, top.map((r) => {
          const tip = `${r.unit_class}\n${pct(r.share)} of military units\n${num(r.units)} queued`;
          return { label: r.unit_class, tip, panels: [{ segs: [{ v: r.share, color: QTY }], txt: pct(r.share), tip }] };
        }), { panels: [{ max: mx, ticks: C.niceTicks(0, mx, 3).filter((v) => v <= mx), fmtT: pct }], label: 'Army composition' });
      }
    } else if (dash.data('s_units').status === 'error') failed(ub);

    // scouting report
    const li = (...parts) => { const n = document.createElement('li'); n.append(...parts); return n; };
    const items = [];
    const byRate = (a, b) => b.win_rate - a.win_rate || b.games - a.games;
    const open = (pick('s_openings') || []).filter((r) => r.games >= 3);
    if (open.length) {
      const fav = open[0], w0 = { ...where, opening: fav.opening };
      items.push(li('Usual opening: ', mark('s_openings', w0, 'opening', fav.opening), ' in ', mark('s_openings', w0, 'games', num(fav.games)), ' games, winning ', mark('s_openings', w0, 'win_rate', pct(fav.win_rate)), '.'));
      const best = [...open].sort(byRate)[0], w1 = { ...where, opening: best.opening };
      if (best.opening !== fav.opening) items.push(li('Most successful opening: ', mark('s_openings', w1, 'opening', best.opening), ' (', mark('s_openings', w1, 'win_rate', pct(best.win_rate)), ' over ', mark('s_openings', w1, 'games', num(best.games)), ' games).'));
    }
    const att = (pick('s_attack') || []).filter((r) => r.games >= 3);
    if (att.length) { const w2 = { ...where, attack_style: att[0].attack_style }; items.push(li('Attacks: mostly ', mark('s_attack', w2, 'attack_style', att[0].attack_style.toLowerCase()), ', winning ', mark('s_attack', w2, 'win_rate', pct(att[0].win_rate)), ' of those games.')); }
    const def = (pick('s_defense') || []).filter((r) => r.games >= 3);
    if (def.length) { const w3 = { ...where, defense_style: def[0].defense_style }; items.push(li('Defends with: ', mark('s_defense', w3, 'defense_style', def[0].defense_style.toLowerCase()), ' (', mark('s_defense', w3, 'games', num(def[0].games)), ' games).')); }
    const tw = (tempo || []).find((r) => r.result === 'Wins'), tl = (tempo || []).find((r) => r.result === 'Losses');
    if (tw && tl && tw.castle_min && tl.castle_min) items.push(li('Reaches Castle Age at ', mark('s_tempo', { ...where, result: 'Wins' }, 'castle_min', one(tw.castle_min)), ' min in wins vs ', mark('s_tempo', { ...where, result: 'Losses' }, 'castle_min', one(tl.castle_min)), ' min in losses.'));
    const lens = (pick('p_length') || []).filter((r) => r.games >= 5);
    if (lens.length > 1) {
      const s = [...lens].sort(byRate), b = s[0], w = s[s.length - 1];
      items.push(li('Wins most in ', mark('p_length', { ...where, length: b.length }, 'length', b.length), ' games (', mark('p_length', { ...where, length: b.length }, 'win_rate', pct(b.win_rate)),
        ') and least in ', mark('p_length', { ...where, length: w.length }, 'length', w.length), ' games (', mark('p_length', { ...where, length: w.length }, 'win_rate', pct(w.win_rate)), ').'));
    }
    const vs = (pick('p_vs_civ') || []).filter((r) => r.games >= 3);
    if (vs.length) {
      const tough = [...vs].sort(byRate).pop(), w4 = { ...where, opp_civ: tough.opp_civ };
      items.push(li('Toughest opponent civ: ', mark('p_vs_civ', w4, 'opp_civ', tough.opp_civ), ', winning only ', mark('p_vs_civ', w4, 'win_rate', pct(tough.win_rate)), ' of ', mark('p_vs_civ', w4, 'games', num(tough.games)), ' games.'));
    }
    if (!items.length) items.push(li('Not enough games in this view to build a report yet.'));
    el('pp-findings').replaceChildren(...items);

    // seasons and custom ranges (render.js drawCompare, which fills #pp-seasons and #pp-range)
    if (X.drawCompare) X.drawCompare(player, view);

    // tournament record
    const st = dash.data('standings'), ts = dash.data('tournaments');
    if (st.status === 'ok') {
      const tname = new Map(ts.status === 'ok' ? ts.data.map((t) => [t.tournament_id, t.name]) : []);
      fillTable(el('pp-tourn'), st.data.filter((r) => r.player === player), [
        { field: 'tournament_id', label: 'Tournament', fmt: (v) => tname.get(v) || v },
        { field: 'rank', label: 'Rank', num: true }, { field: 'played', label: 'Played', num: true },
        { field: 'wins', label: 'Wins', num: true }, { field: 'losses', label: 'Losses', num: true },
      ], ['tournament_id', 'player'], { emptyText: 'Not in any tournament yet.', onClick: (r) => { dash.setParams({ t: r.tournament_id }); X.show('standings', true); } });
    } else if (st.status === 'error') failed(el('pp-tourn').tBodies[0]);
  }

  // ---------------------------------------------------------------- the page
  const SECTIONS = ['pf-board', 'pf-rating', 'pf-civs', 'pf-maps', 'pf-vs', 'pf-length', 'pf-hours', 'pf-strat', 'pf-form', 'pf-mates', 'pf-combos'];
  function loading(cls) { SECTIONS.forEach((id) => { const n = el(id); n.replaceChildren(); if (cls === 'error') n.append(empty('Failed to load')); else n.classList.toggle('pf-loading', true); }); }

  function draw(ctx) {
    const P = dash.params();
    const names = ctx.names;
    const player = names.includes(P.pp) ? P.pp : names.includes(ctx.me) ? ctx.me : names[0];
    const view = VIEWS.some((v) => v[0] === P.ps) ? P.ps : 'All games';
    const period = window.TT_PERIODS.includes(P.pr) ? P.pr : 'All time';
    const scope = period === 'All time' ? view : `${view} · ${period}`;
    const X = { ...ctx, player, view, period, scope };
    controls(X);
    if (!player) return;
    const hist = dash.data('history'), hsc = dash.data('h_scoped'), ana = dash.data('replay_analysis'), sm = dash.data('p_summary');
    if ([hist, hsc].some((d) => d.status === 'error')) { loading('error'); return; }
    if ([hist, hsc].some((d) => d.status !== 'ok')) { loading(); return; }
    SECTIONS.forEach((id) => el(id).classList.remove('pf-loading'));
    const { g, rep } = gamesOf(hist.data, hsc.data, ana.status === 'ok' ? ana.data : [], player, scope);
    Object.assign(X, {
      hist: hist.data, g, rep,
      sum: sm.status === 'ok' ? sm.data.find((r) => r.player === player && r.scope === scope) : null,
      inPeriod: (r) => period === 'All time' || (Date.now() - Date.parse(r.started)) / 864e5 <= PERIOD_DAYS[period],
    });
    X.rating = ratingSeries(X);
    last = X;
    // one failing section must not blank the rest of the page
    [board, rating, civs, maps, matchups, when, strategy, form, teams, deeper].forEach((fn) => { try { fn(X); } catch (e) { console.error(`profile ${fn.name}`, e); } });
  }

  // the Overall / By month switch on Maps
  el('pf-maps-mode').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { ui.maps = b.dataset.mode; if (last) maps(last); }));
  el('pf-qp').addEventListener('click', () => {
    ui.qp = !ui.qp;
    try { localStorage.setItem('tt-qp', ui.qp ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (last) rating(last);
  });

  window.TT_PROFILE = { draw };
})();
