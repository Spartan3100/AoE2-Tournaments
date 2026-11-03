// Games > a game > Game breakdown: the matchup report. Tabs Overview · eAPM · Town Center idle · Army · Upgrades,
// for 1v1s and team games alike (teams side by side, each player too). Read from coach.js (TT_COACH: facts, strategy
// names, grades, matchup advice) and the per-minute series pipeline/analyze.py saves (analysis rows for tracked
// players, the map playback's 'ser' rows for everyone). render.js calls TT_BREAKDOWN.draw(host, ctx) on every redraw.
//   ctx: { rows, pb, game, map, nPlayers, hist, ana, styles, nameOf }
// Player colours are their in-game colours (the same as the map playback). Charts are inline SVG, tooltips on hover/tap.
(() => {
  const PCOL = ['#2d63e6', '#e3342f', '#2fb344', '#f2c418', '#21c2c9', '#9b40d6', '#9a9a9a', '#f28a1e'];
  const AGE = ['Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age'];
  const ui = { tab: 'overview', view: 'players', army: null, armyMode: 'total', upA: null, upB: null, match: null };
  const NS = 'http://www.w3.org/2000/svg';
  const h = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) n.append(c); });
    return n;
  };
  const sv = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => { if (v != null) n.setAttribute(k, v); }); if (text != null) n.textContent = text; return n; };
  const ms = (m) => { if (m == null) return '—'; const s = Math.round(m * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const sec = (s) => (s >= 60 ? ms(s / 60) : `${Math.round(s)} s`);
  const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
  const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? sum(v) / v.length : null; };
  const gcls = (g) => (g && g !== '—' ? `bd-g-${g[0].toLowerCase()}` : 'bd-g-none');
  const pct = (x) => `${Math.round(x * 100)}%`;

  // ---------------------------------------------------------------- everyone in the game, as coach.js facts
  function people(ctx) {
    const K = window.TT_COACH;
    const tracked = new Set(ctx.rows.map((r) => Number(r.number)));
    const list = ctx.rows.map((r) => ({ f: K.facts(r, ctx.pb), mine: true, player: r.player }))
      .concat(ctx.pb ? ctx.pb.players.filter((p) => !tracked.has(p.number)).map((p) => ({ f: K.fromPlayback(ctx.pb, p.number), mine: false })) : [])
      .filter((x) => x.f);
    const end = (ctx.pb && ctx.pb.duration_s ? ctx.pb.duration_s / 60 : null) || Number(ctx.game && ctx.game.duration_min) || Math.max(...list.map((x) => x.f.dur || 0)) || 1;
    list.forEach((x, i) => {
      x.f.dur = x.f.dur || end;
      x.name = x.mine ? ctx.nameOf(x.player) : x.f.name;
      x.color = PCOL[x.f.color] || PCOL[i % PCOL.length];
      x.team = x.f.team != null ? x.f.team : `p${x.f.number}`;
      x.key = `p${x.f.number}`;
    });
    // without a playback, a 1v1's other side is only known from the opp_ fields: no card for them
    const teams = [...new Set(list.map((x) => x.team))];
    const n = ctx.nPlayers || (ctx.pb ? ctx.pb.players.length : list.length) || 2;
    const roles = K.roles(list.map((x) => x.f));
    list.forEach((x) => {
      const opps = list.filter((y) => y.team !== x.team).map((y) => y.f);
      x.opps = opps.length ? opps : null;
      x.gr = K.grades(x.f, x.opps, n);
      x.sn = K.stratName(x.f);
      x.role = roles.get(x.f.number) || '';
      x.mu = K.matchup(x.f, x.opps, { map: ctx.map, role: x.role, styles: ctx.styles, record: x.mine ? record(ctx, x) : null });
    });
    list.sort((a, b) => String(a.team).localeCompare(String(b.team)) || (b.mine - a.mine));
    const byTeam = teams.map((t) => ({ id: t, members: list.filter((x) => x.team === t) }));
    byTeam.forEach((t, i) => { t.name = t.members.length > 1 ? `Team ${i + 1}` : t.members[0].name; t.color = t.members[0].color; t.won = t.members.some((x) => Number(x.f.won) === 1); t.key = `t${i}`; });
    return { list, teams: byTeam, end, n, teamGame: byTeam.some((t) => t.members.length > 1) };
  }
  // the player's own record on the site: with this civ, against the other civ (1v1), and by opening
  function record(ctx, x) {
    const mine = (ctx.hist || []).filter((r) => r.player === x.player);
    const won = (rs) => [rs.filter((r) => Number(r.won) === 1).length, rs.length];
    const opp = x.opps && x.opps.length === 1 ? x.opps[0].civ : null;
    const ops = new Map();
    (ctx.ana || []).filter((a) => a.player === x.player && a.opening && a.opening !== 'Unclear').forEach((a) => { const v = ops.get(a.opening) || [0, 0]; v[0] += Number(a.won) === 1 ? 1 : 0; v[1] += 1; ops.set(a.opening, v); });
    return {
      civ: won(mine.filter((r) => r.civ === x.f.civ)),
      vsCiv: opp ? won(mine.filter((r) => Number(r.players_n) === 2 && r.opp_civ === opp)) : null,
      openings: [...ops].map(([k, [w, n]]) => [k, w, n]),
    };
  }

  // ---------------------------------------------------------------- an SVG chart over game minutes
  function chart(host, o) {
    const box = h('div', { class: 'bd-chart' });
    host.append(box);
    const W = Math.max(300, Math.floor(box.clientWidth || host.clientWidth || 700)), H = o.height || 260;
    const L = 46, R = o.right ? 46 : 12, T = 20, B = 28, iw = W - L - R, ih = H - T - B;
    const end = o.end;
    const X = (m) => L + (m / end) * iw;
    const ymin = o.ymin || 0, ymax = o.ymax || 1;
    const Y = (v) => T + ih - ((v - ymin) / (ymax - ymin)) * ih;
    const Y2 = o.right ? (v) => T + ih - (v / o.right.max) * ih : null;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.label });
    box.append(svg);
    o.ticks.forEach((v) => {
      svg.append(sv('line', { x1: L, x2: L + iw, y1: Y(v), y2: Y(v), class: 'bd-grid' }));
      svg.append(sv('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'bd-ax' }, o.fmtY ? o.fmtY(v) : v));
    });
    if (o.right) [0, 0.5, 1].forEach((f) => svg.append(sv('text', { x: L + iw + 8, y: Y2(o.right.max * f) + 4, class: 'bd-ax' }, Math.round(o.right.max * f))));
    for (let m = 0; m <= end; m += 10) svg.append(sv('text', { x: X(m), y: H - 8, 'text-anchor': 'middle', class: 'bd-ax' }, m));
    svg.append(sv('text', { x: L + iw, y: H - 8, 'text-anchor': 'end', class: 'bd-ax' }, 'min'));
    (o.ages || []).forEach((a) => {
      if (a.t == null || a.t > end) return;
      svg.append(sv('line', { x1: X(a.t), x2: X(a.t), y1: T, y2: T + ih, stroke: a.color, 'stroke-dasharray': '3 4', 'stroke-width': 1.25, opacity: 0.85 }));
      const nearEnd = X(a.t) > L + iw - 90;
      svg.append(sv('text', { x: X(a.t) + (nearEnd ? -4 : 3), y: T + 9 + (a.row || 0) * 12, 'text-anchor': nearEnd ? 'end' : 'start', class: 'bd-ax bd-chartage', style: `fill:${a.color}` }, a.label));
    });
    const n = Math.max(...o.series.map((x) => x.values.length));
    const bw = iw / end;
    const barSeries = o.series.filter((x) => x.kind === 'bars' || x.kind === 'stack');
    const stackBase = new Array(n).fill(0);
    o.series.forEach((sr) => {
      const yf = sr.axis === 'right' ? Y2 : Y;
      if (sr.kind === 'bars' || sr.kind === 'stack') {
        const k = sr.kind === 'stack' ? 1 : barSeries.length, j = sr.kind === 'stack' ? 0 : barSeries.indexOf(sr);
        sr.values.forEach((v, i) => {
          if (!v) return;
          const w = (bw * 0.8) / k, x = X(i) + bw * 0.1 + j * w;
          const base = sr.kind === 'stack' ? stackBase[i] : 0;
          const y0 = Y(base), y1 = Y(base + v);
          if (sr.kind === 'stack') stackBase[i] += v;
          svg.append(sv('rect', { x, y: Math.min(y0, y1), width: Math.max(1, w - 1), height: Math.max(0.5, Math.abs(y0 - y1)), rx: sr.kind === 'stack' ? 1 : 2, fill: sr.colorOf ? sr.colorOf(v) : sr.color }));
        });
        return;
      }
      const pts = sr.values.map((v, i) => (v == null ? null : [X(Math.min(end, i + 0.5)), yf(v)])).filter(Boolean);
      if (!pts.length) return;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
      if (sr.kind === 'area') {
        const lo = sr.base ? sr.base.map((v, i) => [X(Math.min(end, i + 0.5)), Y(v)]).reverse() : [[pts[pts.length - 1][0], Y(0)], [pts[0][0], Y(0)]];
        svg.append(sv('path', { d: `${d}${lo.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}Z`, fill: sr.color, opacity: sr.fillOpacity ?? 0.18 }));
      }
      svg.append(sv('path', { d, fill: 'none', stroke: sr.color, 'stroke-width': sr.width || 2.25, 'stroke-dasharray': sr.dash || null, 'stroke-linejoin': 'round' }));
      (sr.marks || []).forEach((mk) => {
        const x = X(Math.min(end, mk.i + 0.5)), y = Y(mk.v);
        svg.append(sv('circle', { cx: x, cy: y, r: 4.5, fill: 'var(--color-panel)', stroke: sr.color, 'stroke-width': 2.5 }));
        svg.append(sv('text', { x, y: mk.up ? y - 9 : y + 17, 'text-anchor': 'middle', class: 'bd-ax bd-mk', style: `fill:${sr.color}` }, mk.label));
      });
    });
    // hover / tap: every series at that minute
    const cross = sv('line', { y1: T, y2: T + ih, stroke: 'var(--color-fg-muted)', 'stroke-width': 1, visibility: 'hidden' });
    svg.append(cross);
    const tip = h('div', { class: 'bd-tip', hidden: true });
    box.append(tip);
    const hit = sv('rect', { x: L, y: T, width: iw, height: ih, fill: 'transparent' });
    svg.append(hit);
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(n - 1, Math.floor(((px - L) / iw) * end)));
      cross.setAttribute('x1', X(i + 0.5)); cross.setAttribute('x2', X(i + 0.5)); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(h('div', { class: 'bd-tip-h' }, `Minute ${i}–${i + 1}`), ...o.series.filter((x) => !x.noTip).map((x) => {
        const v = x.tipValues ? x.tipValues[i] : x.values[i];
        return h('div', {}, h('i', { class: 'bd-sw', style: `background:${x.color}` }), `${x.name}: `, h('b', {}, v == null ? '—' : x.fmt ? x.fmt(v) : String(v)));
      }));
      tip.hidden = false;
      const bx = box.getBoundingClientRect();
      tip.style.left = `${Math.max(0, Math.min(e.clientX - bx.left + 14, bx.width - tip.offsetWidth - 4))}px`;
      tip.style.top = `${Math.max(0, e.clientY - bx.top - 60)}px`;
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    if (o.legend) host.append(h('div', { class: 'bd-legend' }, o.legend.map(([c, t, dash]) => h('span', {}, h('i', { class: dash ? 'bd-sw bd-dash' : 'bd-sw', style: `background:${c}` }), t))));
  }
  // a round top for an axis and its ticks: four steps of 1, 2, 2.5, 5, 10... so labels read 0, 25, 50, 75, 100
  function scale(v, n = 4) {
    const steps = [0.5, 1, 2, 2.5, 5, 10, 15, 20, 25, 30, 50, 60, 75, 100, 125, 150, 200, 250, 500, 1000, 2000];
    const step = steps.find((x) => x * n >= v) || Math.ceil(v / n);
    return { max: step * n, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
  }
  const villagers = (n) => `${n} villager${n === 1 ? '' : 's'}`;
  const card = (title, sub, ...kids) => h('section', { class: 'bd-card' }, h('div', { class: 'bd-card-h' }, h('h3', {}, title), sub ? h('span', { class: 'bd-sub' }, sub) : null), ...kids);
  const seg = (label, items, cur, set) => h('div', { class: 'bd-seg', role: 'group', 'aria-label': label }, items.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(cur === v), onclick: () => set(v) }, t)));
  const noSeries = (G) => h('p', { class: 'bd-empty' }, G.list.some((x) => x.f.ser)
    ? 'Some players in this game have no per-minute data (their replay was read before these charts existed).'
    : 'This game was analysed before the per-minute charts existed. “Analyse now” above reads it again while Microsoft still has the replay; otherwise older games are redone a few at a time with each update.');

  // what a chart can show: each player, or each team added up (eAPM averaged)
  function sides(G, how) {
    const withSer = G.list.filter((x) => x.f.ser);
    if (how === 'teams' && G.teamGame) {
      return G.teams.map((t) => {
        const ms2 = t.members.filter((x) => x.f.ser);
        if (!ms2.length) return null;
        const len = Math.max(...ms2.map((x) => x.f.ser.eapm.length));
        const add = (k, f) => Array.from({ length: len }, (_, i) => f(ms2.map((x) => (x.f.ser[k] || [])[i])));
        const army = {};
        ms2.forEach((x) => Object.entries(x.f.ser.army || {}).forEach(([c, v]) => { army[c] = (army[c] || new Array(len).fill(0)).map((y, i) => y + (v[i] || 0)); }));
        const ages = [0, 1, 2].map((k) => avg(t.members.map((x) => [x.f.feudal, x.f.castle, x.f.imperial][k])));
        return { name: t.name, color: t.color, team: true, members: t.members, ser: { eapm: add('eapm', (v) => Math.round(avg(v))), idle: add('idle', sum), vills: add('vills', (v) => sum(v.map((y, i) => y ?? (ms2[i].f.ser.vills || []).slice(-1)[0]))), army },
          ages, eapmAvg: Math.round(avg(t.members.map((x) => x.f.eapm))), boom: t.members.some((x) => window.TT_COACH.isBoom(x.f)), f: t.members[0].f };
      }).filter(Boolean);
    }
    return withSer.map((x) => ({ name: x.name, color: x.color, ser: x.f.ser, ages: [x.f.feudal, x.f.castle, x.f.imperial], eapmAvg: x.f.eapm, f: x.f, boom: window.TT_COACH.isBoom(x.f) }));
  }
  const phaseOf = (ages, m) => { const t = m + 0.5; return ages[0] == null || t < ages[0] ? 0 : ages[1] == null || t < ages[1] ? 1 : ages[2] == null || t < ages[2] ? 2 : 3; };
  const ageMarks = (S) => (S.length <= 2 ? S.flatMap((s, r) => s.ages.map((t, i) => ({ t, label: `${S.length > 1 ? `${s.name.slice(0, 10)} ` : ''}${'FCI'[i]}`, color: s.color, row: r }))) : []);
  const viewSwitch = (G, redraw) => (G.teamGame ? seg('Show', [['players', 'Each player'], ['teams', 'Teams']], ui.view, (v) => { ui.view = v; redraw(); }) : null);

  // ---------------------------------------------------------------- Overview
  function overview(host, G) {
    // scoreboard: a player against a player, or team against team
    const grade = (g, big) => h('span', { class: `bd-grade ${big ? '' : 'sm'} ${gcls(g)}`, title: `Execution grade ${g}` }, g);
    const side = (x) => h('div', { class: 'bd-side', style: `--pc:${x.color}` },
      h('div', { class: 'bd-who' }, h('span', { class: 'bd-av', 'aria-hidden': 'true' }, (x.name || '?')[0].toUpperCase()),
        h('div', { class: 'bd-grow' }, h('b', {}, x.name), h('span', { class: 'bd-sub' }, x.f.civ || '')),
        h('span', { class: `bd-res ${Number(x.f.won) === 1 ? 'win' : 'loss'}` }, Number(x.f.won) === 1 ? 'Won' : 'Lost')),
      h('div', { class: 'bd-strat' }, h('div', { class: 'bd-grow' }, h('div', { class: 'bd-eyebrow' }, 'Strategy'), h('strong', {}, x.sn.name), x.sn.sub ? h('span', { class: 'bd-sub' }, x.sn.sub) : null),
        h('div', { class: 'bd-gwrap' }, grade(x.gr.overall, true), h('span', { class: 'bd-sub bd-tiny' }, 'Execution'))));
    const teamCol = (t) => h('div', { class: 'bd-side bd-team', style: `--pc:${t.color}` },
      h('div', { class: 'bd-who' }, h('b', { class: 'bd-grow' }, t.name), h('span', { class: `bd-res ${t.won ? 'win' : 'loss'}` }, t.won ? 'Won' : 'Lost')),
      t.members.map((x) => h('div', { class: 'bd-member' }, h('i', { class: 'bd-dot', style: `background:${x.color}` }),
        h('div', { class: 'bd-grow' }, h('b', {}, x.name), h('span', { class: 'bd-sub' }, ` ${x.f.civ || ''}${x.role ? ` · ${x.role}` : ''}`), h('div', { class: 'bd-sub' }, x.sn.name)), grade(x.gr.overall))));
    if (G.teams.length === 2) {
      const a = G.teamGame ? teamCol(G.teams[0]) : side(G.teams[0].members[0]);
      const b = G.teamGame ? teamCol(G.teams[1]) : side(G.teams[1].members[0]);
      host.append(h('section', { class: 'bd-score', 'aria-label': 'Scoreboard' }, a, h('div', { class: 'bd-vs', 'aria-hidden': 'true' }, 'VS'), b));
    } else host.append(h('section', { class: 'bd-score bd-ffa', 'aria-label': 'Scoreboard' }, G.list.map(side)));

    // timeline: one lane per player, grouped by team
    const end = G.end;
    const pc = (t) => `left:${Math.min(100, (t / end) * 100).toFixed(2)}%`;
    const lane = (x) => {
      const f = x.f, pts = [0, f.feudal, f.castle, f.imperial, end].map((v, i, all) => (v == null ? null : v));
      const stops = [0]; [f.feudal, f.castle, f.imperial].forEach((t) => { if (t != null) stops.push(t); }); stops.push(end);
      const bar = h('div', { class: 'bd-bar' }, stops.slice(0, -1).map((t, k) => h('div', { style: `width:${(((stops[k + 1] - t) / end) * 100).toFixed(2)}%;background:color-mix(in srgb, ${x.color} ${[14, 38, 68, 100][k]}%, var(--color-panel))` })));
      void pts;
      return h('div', { class: 'bd-lane' }, h('span', { class: 'bd-lname' }, x.name), h('div', { class: 'bd-track' }, bar,
        (f.tcTimes || []).map((t) => h('span', { class: 'bd-mark', style: pc(t), title: `New Town Center ${ms(t)}` }, '◆')),
        f.first_attack != null ? h('span', { class: 'bd-mark', style: pc(f.first_attack), title: `First attack ${ms(f.first_attack)}` }, '▲') : null,
        [f.feudal, f.castle, f.imperial].map((t, i) => (t == null ? null : h('span', { class: 'bd-agel', style: pc(t) }, `${'FCI'[i]} ${ms(t)}`)))));
    };
    const axis = [];
    for (let m = 0; m < end - 3; m += 10) axis.push(h('span', { style: pc(m) }, String(m)));
    axis.push(h('span', { style: 'right:0' }, `${Math.round(end)} min`));
    host.append(card('Timeline', null,
      h('div', { class: 'bd-legend' }, h('span', {}, 'Bands: Dark, Feudal, Castle, Imperial'), h('span', {}, '◆ new Town Center'), h('span', {}, '▲ first attack')),
      G.teams.map((t) => [G.teamGame ? h('div', { class: 'bd-eyebrow bd-lteam' }, t.name) : null, t.members.map(lane)]),
      h('div', { class: 'bd-lane' }, h('span'), h('div', { class: 'bd-axis' }, axis))));

    // head to head: players in a 1v1, teams in a team game
    if (G.teams.length === 2) {
      const [A, B] = G.teams;
      const agg = (t, k, how) => { const v = t.members.map((x) => x.f[k]).filter((y) => y != null); return v.length ? (how === 'sum' ? sum(v) : how === 'min' ? Math.min(...v) : avg(v)) : null; };
      const rows = [['Feudal Age', 'feudal', 'avg', true, ms], ['Castle Age', 'castle', 'avg', true, ms], ['Imperial Age', 'imperial', 'avg', true, ms], ['First attack', 'first_attack', 'min', true, ms],
        ['Villagers', 'villagers', 'sum', false, (v) => String(Math.round(v))], ['Soldiers', 'military', 'sum', false, (v) => String(Math.round(v))], ['Town Centers', 'tcs', 'sum', false, (v) => String(Math.round(v))], ['eAPM', 'eapm', 'avg', false, (v) => String(Math.round(v))]]
        .map(([k, f, how, low, fmt]) => [G.teamGame && how === 'avg' && f !== 'eapm' ? `${k} (avg)` : G.teamGame && f === 'eapm' ? 'eAPM (avg)' : k, agg(A, f, how), agg(B, f, how), low, fmt])
        .filter(([, a, b]) => a != null && b != null);
      if (rows.length) {
        host.append(card('Head to head', 'Bold is better', h('div', { class: 'bd-h2h-names' }, h('span', { style: `color:${A.color}` }, A.name), h('span'), h('span', { style: `color:${B.color}` }, B.name)),
          rows.map(([k, a, b, low, fmt]) => {
            const m = Math.max(a, b) || 1, ab = low ? a < b : a > b, bb = low ? b < a : b > a;
            return h('div', { class: 'bd-h2h' },
              h('span', { class: `bd-num bd-r ${ab ? 'bd-best' : ''}` }, fmt(a)),
              h('div', { class: 'bd-hbw bd-rev' }, h('div', { class: `bd-hb ${ab ? '' : 'bd-dim'}`, style: `width:${(a / m) * 100}%;background:${A.color}` })),
              h('span', { class: 'bd-k' }, k),
              h('div', { class: 'bd-hbw' }, h('div', { class: `bd-hb ${bb ? '' : 'bd-dim'}`, style: `width:${(b / m) * 100}%;background:${B.color}` })),
              h('span', { class: `bd-num ${bb ? 'bd-best' : ''}` }, fmt(b)));
          })));
      }
    }

    // coaching, one card per player
    host.append(h('div', { class: 'bd-two' }, G.list.map((x) => {
      const t = x.gr.tips;
      const units = (x.f.units || []).filter((u) => u.unit !== 'Villager');
      const mx = Math.max(1, ...units.map((u) => u.count));
      return h('section', { class: 'bd-card bd-coach' },
        h('div', { class: 'bd-card-h' }, h('div', { class: 'bd-who' }, h('i', { class: 'bd-dot', style: `background:${x.color}` }), h('h3', {}, `${x.name}’s game`)),
          h('span', { class: 'bd-sub' }, [x.f.civ, G.teamGame ? G.teams.find((tm) => tm.id === x.team).name : '', x.role].filter(Boolean).join(' · '))),
        h('div', { class: 'bd-stratline' }, h('strong', {}, x.sn.name), x.sn.sub ? h('span', { class: 'bd-sub' }, ` ${x.sn.sub}`) : null),
        t.strategy.length ? h('p', { class: 'bd-story' }, t.strategy.join(' ')) : null,
        h('div', { class: 'bd-phases' }, x.gr.phases.map((g) => h('div', { class: 'bd-phase', title: g.why || '' }, h('span', {}, g.k), h('b', { class: `bd-grade sm ${gcls(g.v)}` }, g.v), h('span', { class: 'bd-tiny bd-sub' }, g.why || '')))),
        h('div', { class: 'bd-lists' },
          h('div', { class: 'bd-good' }, h('h4', {}, 'Went well'), t.well.length ? h('ul', {}, t.well.map((w) => h('li', {}, h('b', {}, '+'), h('span', {}, w.text)))) : h('p', { class: 'bd-sub' }, 'Nothing stood out.')),
          h('div', { class: 'bd-fix' }, h('h4', {}, 'To do better with this strategy'), t.better.length ? h('ul', {}, t.better.map((w) => h('li', {}, h('b', {}, '−'), h('span', {}, w.text)))) : h('p', { class: 'bd-sub' }, 'Nothing obvious to fix.'))),
        x.mu.plan || x.mu.record ? h('div', { class: 'bd-plan' }, h('h4', {}, G.teamGame ? 'For this matchup and role' : 'For this matchup'), x.mu.plan ? h('span', {}, x.mu.plan) : null, x.mu.record ? h('span', { class: 'bd-sub' }, x.mu.record) : null) : null,
        h('div', { class: 'bd-units' }, h('h4', {}, `Units made${x.f.villagers ? ` · ${x.f.villagers} villagers` : ''}`),
          !x.f.units ? h('p', { class: 'bd-sub' }, 'This replay doesn’t record units (an older game version).')
            : units.length ? units.slice(0, 10).map((u) => h('div', { class: 'bd-ubar' }, h('span', {}, u.unit), h('span', { class: 'bd-ut' }, h('i', { style: `width:${(u.count / mx) * 100}%;background:${x.color}` })), h('span', { class: 'bd-num bd-r' }, String(u.count))))
              : h('p', { class: 'bd-sub' }, 'No soldiers.'),
          units.length > 10 ? h('p', { class: 'bd-sub' }, `Also ${units.slice(10).map((u) => `${u.unit} ${u.count}`).join(', ')}.`) : null));
    })));
  }

  // ---------------------------------------------------------------- eAPM
  function eapm(host, G, redraw) {
    const S = sides(G, ui.view);
    const head = card('eAPM through the game', 'Effective actions per minute, game time', viewSwitch(G, redraw));
    host.append(head);
    if (!S.length) { head.append(noSeries(G)); return; }
    const stat = (xs) => {
      const inner = xs.slice(1, -1).map((v, i) => [v, i + 1]);
      if (!inner.length) return { max: [xs[0], 0], min: [xs[0], 0] };
      return { max: inner.reduce((a, b) => (b[0] > a[0] ? b : a)), min: inner.reduce((a, b) => (b[0] < a[0] ? b : a)) };
    };
    const st = S.map((s) => stat(s.ser.eapm));
    const tiles = h('div', { class: 'bd-tiles' },
      h('div', { class: 'bd-tile' }, h('div', { class: 'bd-eyebrow' }, 'Average'), h('div', { class: 'bd-vs2' }, S.map((s) => h('span', { class: 'bd-v', style: `color:${s.color}`, title: s.name }, String(s.eapmAvg ?? Math.round(avg(s.ser.eapm))))))),
      h('div', { class: 'bd-tile' }, h('div', { class: 'bd-eyebrow' }, 'Peak'), h('div', { class: 'bd-vs2' }, S.map((s, i) => h('span', { class: 'bd-v', style: `color:${s.color}`, title: s.name }, String(st[i].max[0]), h('small', {}, ` min ${st[i].max[1]}`))))),
      h('div', { class: 'bd-tile' }, h('div', { class: 'bd-eyebrow' }, 'Lowest'), h('div', { class: 'bd-vs2' }, S.map((s, i) => h('span', { class: 'bd-v', style: `color:${s.color}`, title: s.name }, String(st[i].min[0]), h('small', {}, ` min ${st[i].min[1]}`))))));
    let faster = null;
    if (S.length === 2) {
      const n = Math.min(S[0].ser.eapm.length, S[1].ser.eapm.length);
      const a = S[0].ser.eapm.slice(0, n).filter((v, i) => v > S[1].ser.eapm[i]).length, b = S[1].ser.eapm.slice(0, n).filter((v, i) => v > S[0].ser.eapm[i]).length;
      faster = a >= b ? [S[0], a, n] : [S[1], b, n];
      tiles.append(h('div', { class: 'bd-tile' }, h('div', { class: 'bd-eyebrow' }, 'Faster each minute'), h('span', { class: 'bd-v', style: `color:${faster[0].color}` }, `${faster[0].name} `, h('small', {}, `${faster[1]} of ${n} minutes`))));
    }
    head.append(tiles);
    const ys = scale(Math.max(...S.flatMap((s) => s.ser.eapm)));
    chart(head, { label: 'eAPM per minute', end: G.end, ymax: ys.max, ticks: ys.ticks, height: 290, ages: ageMarks(S),
      series: S.map((s, i) => ({ name: s.name, color: s.color, values: s.ser.eapm, kind: 'area', marks: S.length <= 4 ? [{ i: st[i].max[1], v: st[i].max[0], label: `peak ${st[i].max[0]}`, up: true }, { i: st[i].min[1], v: st[i].min[0], label: `low ${st[i].min[0]}`, up: false }] : [] })),
      legend: S.map((s) => [s.color, s.name, true]) });
    // by age
    const avgs = AGE.map((_, k) => S.map((s) => { const xs = s.ser.eapm.filter((__, m) => phaseOf(s.ages, m) === k); return xs.length ? Math.round(avg(xs)) : null; }));
    const tbl = h('div', { class: 'bd-scroll' }, h('table', { class: 'bd-tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Age'), S.map((s) => h('th', { class: 'num', style: `color:${s.color}` }, s.name)))),
      h('tbody', {}, AGE.map((a, k) => h('tr', {}, h('td', {}, a), avgs[k].map((v) => h('td', { class: 'num', style: v != null && v === Math.max(...avgs[k].filter((x) => x != null)) ? 'font-weight:700' : '' }, v == null ? '—' : String(v))))))));
    const notes = [];
    if (S.length === 2 && faster) {
      const gaps = avgs.map((v, k) => [k, v[0] != null && v[1] != null ? Math.abs(v[0] - v[1]) : -1]).sort((x, y) => y[1] - x[1]);
      const k = gaps[0][0];
      if (gaps[0][1] > 0) { const hi = avgs[k][0] >= avgs[k][1] ? 0 : 1; notes.push(`${faster[0].name} was faster in ${faster[1]} of ${faster[2]} minutes. The gap was biggest in ${AGE[k]}: ${avgs[k][hi]} against ${avgs[k][1 - hi]} on average.`); }
    }
    S.slice(0, 4).forEach((s, i) => notes.push(`${s.name} peaked at ${st[i].max[0]} in minute ${st[i].max[1]} (${AGE[phaseOf(s.ages, st[i].max[1])]}) and was slowest at ${st[i].min[0]} in minute ${st[i].min[1]} (${AGE[phaseOf(s.ages, st[i].min[1])]}).`));
    notes.push('eAPM counts the orders that do something, so a fast player isn’t just spamming clicks. A dip during a fight often means production stopped while you controlled the army.');
    host.append(card('By age', 'Average eAPM in each age', tbl, h('ul', { class: 'bd-notes' }, notes.map((t) => h('li', {}, t)))));
  }

  // ---------------------------------------------------------------- Town Center idle
  function idle(host, G, redraw) {
    const K = window.TT_COACH;
    const S = sides(G, ui.view);
    const head = card('Town Center idle time', 'Seconds with nothing queued, all Town Centers together', viewSwitch(G, redraw));
    host.append(head);
    if (!S.length) { head.append(noSeries(G)); return; }
    const reach = (s) => { const i = s.ser.vills.findIndex((v) => v >= 120 * (s.team ? s.members.length : 1)); return i < 0 ? null : i; };
    const before = (s) => sum(s.ser.idle.filter((_, m) => phaseOf(s.ages, m) < 2));
    head.append(h('div', { class: 'bd-tiles' },
      S.map((s) => { const t = sum(s.ser.idle); return h('div', { class: 'bd-tile' }, h('div', { class: 'bd-eyebrow' }, `${s.name}: idle all game`), h('span', { class: 'bd-v', style: `color:${s.color}` }, sec(t), h('small', {}, ` ≈ ${villagers(Math.round(t / 25))}`))); }),
      S.map((s) => h('div', { class: 'bd-tile' }, h('div', { class: 'bd-eyebrow' }, `${s.name}: before Castle Age`), h('span', { class: 'bd-v', style: `color:${s.color}` }, sec(before(s))))),
      S.map((s) => { const r = reach(s); return h('div', { class: 'bd-tile' }, h('div', { class: 'bd-eyebrow' }, `${s.name}: ${s.team ? '120 villagers each' : '120 villagers'}`), h('span', { class: 'bd-v', style: `color:${s.color}` }, r == null ? 'never' : `min ${r}`)); })));
    const cum = S.map((s) => { let a = 0; return s.ser.idle.map((v) => { a += v; return Math.round(a / 6) / 10; }); });
    const ys = scale(Math.max(1, ...cum.flat()));
    const vmax = scale(Math.max(...S.flatMap((s) => s.ser.vills)), 2).max;
    chart(head, { label: 'Running total of Town Center idle, with villagers built', end: G.end, ymax: ys.max, ticks: ys.ticks, fmtY: (v) => `${v}m`, height: 290, right: { max: vmax }, ages: ageMarks(S),
      series: [...S.map((s, i) => ({ name: `${s.name} idle so far`, color: s.color, values: cum[i], kind: 'area', fmt: (v) => `${v} min` })),
        ...S.map((s) => ({ name: `${s.name} villagers built`, color: s.color, values: s.ser.vills, axis: 'right', dash: '5 4', width: 1.75 }))],
      legend: [...S.map((s) => [s.color, `${s.name} idle (minutes so far)`]), ['var(--color-fg-muted)', 'Villagers built, right scale (dashed)', true]] });
    head.append(h('p', { class: 'bd-sub bd-foot' }, 'Villagers built counts every villager queued. The replay records orders, not deaths, so how many were alive at a time isn’t in it.'));
    // by age, and how much it mattered for the strategy played
    const per = S.map((s) => AGE.map((_, k) => sum(s.ser.idle.filter((__, m) => phaseOf(s.ages, m) === k))));
    const why = K.IDLE_WHY(S[0].f);
    const rows = AGE.map((a, k) => h('tr', {}, h('td', {}, h('b', {}, a)),
      S.map((s, i) => { const [cls, label] = K.IDLE_WHY({ ...s.f, tcs: s.boom ? 3 : s.f.tcs })[k]; const v = per[i][k];
        return h('td', {}, h('div', { class: 'bd-num', style: `color:${s.color};font-weight:600` }, `${sec(v)}${v >= 25 ? ` · ≈${villagers(Math.round(v / 25))}` : ''}`), h('span', { class: `bd-pill bd-i-${cls}` }, label)); }),
      h('td', { class: 'bd-why' }, k === 2 ? 'High for a boom: the extra Town Centers only pay off if they never stop. Medium for an all-in, where villagers can slow while the army fights.' : why[k][2])));
    const notes = [];
    S.forEach((s) => {
      const b = before(s), first = s.ser.idle.findIndex((v, m) => v >= 20 && m > 0);
      const last = s.ser.vills.reduce((a, v, m, all) => (m && v > all[m - 1] ? m : a), 0);
      notes.push(`${s.name}: ${sec(b)} idle before Castle Age${b <= 30 ? ', very tidy' : b >= 120 ? ', which cost about ' + Math.round(b / 25) + ' villagers when they mattered most' : ''}. ${first >= 0 ? `Idle starts to build at minute ${first}${s.f.tcTimes && s.f.tcTimes.length && !s.team ? ` (extra Town Centers from ${ms(s.f.tcTimes[0])})` : ''}` : 'Hardly any idle all game'}; villagers were still being made in minute ${last}.`);
    });
    host.append(card('How much it mattered', 'By age, for the strategy each side played', h('div', { class: 'bd-scroll' }, h('table', { class: 'bd-tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Age'), S.map((s) => h('th', { style: `color:${s.color}` }, s.name)), h('th', {}, 'Why'))), h('tbody', {}, rows))),
      h('ul', { class: 'bd-notes' }, notes.map((t) => h('li', {}, t)))));
  }

  // ---------------------------------------------------------------- Army
  const CLS_COL = ['var(--bd-c1)', 'var(--bd-c2)', 'var(--bd-c3)', 'var(--bd-c4)', 'var(--bd-c5)', 'var(--bd-c6)', 'var(--bd-c7)', 'var(--bd-c8)'];
  function army(host, G, redraw) {
    const opts = [...G.list.map((x) => [x.key, x.name]), ...(G.teamGame ? G.teams.map((t) => [t.key, t.name]) : [])];
    if (!opts.some(([k]) => k === ui.army)) ui.army = opts[0][0];
    const pick = G.list.find((x) => x.key === ui.army);
    const team = !pick ? G.teams.find((t) => t.key === ui.army) : null;
    const members = pick ? [pick] : team.members;
    const color = pick ? pick.color : team.color;
    const head = card('Army', 'Units queued, by type', h('div', { class: 'bd-ctrls' },
      h('div', { class: 'bd-seg', role: 'group', 'aria-label': 'Whose army' }, opts.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(k === ui.army), onclick: () => { ui.army = k; redraw(); } }, t))),
      seg('Show', [['total', 'Total built'], ['minute', 'Each minute']], ui.armyMode, (v) => { ui.armyMode = v; redraw(); })));
    host.append(head);
    const withSer = members.filter((x) => x.f.ser);
    if (withSer.length) {
      const len = Math.max(...withSer.map((x) => x.f.ser.eapm.length));
      const by = {};
      withSer.forEach((x) => Object.entries(x.f.ser.army || {}).forEach(([c, v]) => { by[c] = (by[c] || new Array(len).fill(0)).map((y, i) => y + (v[i] || 0)); }));
      const classes = Object.keys(by).sort((a, b) => sum(by[b]) - sum(by[a]));
      if (!classes.length) head.append(h('p', { class: 'bd-empty' }, 'No soldiers made.'));
      else if (ui.armyMode === 'total') {
        const cum = classes.map((c) => { let a = 0; return by[c].map((v) => (a += v)); });
        const stacked = cum.map((_, k) => cum[0].map((__, m) => cum.slice(0, k + 1).reduce((s2, xs) => s2 + xs[m], 0)));
        const ys = scale(Math.max(...stacked[stacked.length - 1]));
        const ages = members.length === 1 ? [members[0].f.feudal, members[0].f.castle, members[0].f.imperial].map((t, i) => ({ t, label: 'FCI'[i], color: color })) : [];
        chart(head, { label: 'Army built up over time, by unit type', end: G.end, ymax: ys.max, ticks: ys.ticks, height: 290, ages,
          series: stacked.map((xs, k) => ({ name: classes[k], color: CLS_COL[k % CLS_COL.length], values: xs, base: k ? stacked[k - 1] : null, tipValues: cum[k], kind: 'area', width: 1.25, fillOpacity: 0.78 })).reverse(),
          legend: classes.map((c, k) => [CLS_COL[k % CLS_COL.length], `${c} ${sum(by[c])}`]) });
      } else {
        const tot = by[classes[0]].map((_, i) => sum(classes.map((c) => by[c][i])));
        const ys = scale(Math.max(1, ...tot), 2);
        chart(head, { label: 'Units made each minute, by unit type', end: G.end, ymax: ys.max, ticks: ys.ticks, height: 270,
          series: classes.map((c, k) => ({ name: c, color: CLS_COL[k % CLS_COL.length], values: by[c], kind: 'stack' })),
          legend: classes.map((c, k) => [CLS_COL[k % CLS_COL.length], c]) });
      }
    } else head.append(noSeries(G));
    // units made, by name
    const units = {};
    members.forEach((x) => (x.f.units || []).forEach((u) => { if (u.unit !== 'Villager') units[u.unit] = (units[u.unit] || 0) + u.count; }));
    const list = Object.entries(units).sort((a, b) => b[1] - a[1]);
    const mx = Math.max(1, ...list.map((u) => u[1]));
    const vills = sum(members.map((x) => x.f.villagers));
    host.append(card(`${pick ? pick.name : team.name}: units made`, vills ? `${vills} villagers` : null,
      list.length ? h('div', { class: 'bd-ulist' }, list.map(([n, c]) => h('div', { class: 'bd-ubar' }, h('span', {}, n), h('span', { class: 'bd-ut' }, h('i', { style: `width:${(c / mx) * 100}%;background:${color}` })), h('span', { class: 'bd-num bd-r' }, String(c)))))
        : h('p', { class: 'bd-empty' }, members.some((x) => x.f.units) ? 'No soldiers made.' : 'This replay doesn’t record units.')));
  }

  // ---------------------------------------------------------------- Upgrades
  function ups(host, G, redraw) {
    const withKey = G.list.filter((x) => x.f.key && x.f.key.size);
    const head = card('Upgrades in order', 'Economy, Blacksmith and unit upgrades');
    host.append(head);
    if (withKey.length < 1) { head.append(h('p', { class: 'bd-empty' }, 'No upgrades were read from this replay.')); return; }
    const def = G.teams.length === 2 ? [G.teams[0].members[0].key, G.teams[1].members[0].key] : [withKey[0].key, (withKey[1] || withKey[0]).key];
    if (!G.list.some((x) => x.key === ui.upA)) ui.upA = def[0];
    if (!G.list.some((x) => x.key === ui.upB)) ui.upB = def[1];
    if (G.list.length > 2) {
      const sel = (cur, set, label) => { const s = h('select', { class: 'bd-select', 'aria-label': label }, G.list.map((x) => h('option', { value: x.key }, x.name))); s.value = cur; s.addEventListener('change', () => { set(s.value); redraw(); }); return s; };
      head.querySelector('.bd-card-h').append(h('div', { class: 'bd-ctrls' }, sel(ui.upA, (v) => { ui.upA = v; }, 'Left player'), h('span', { class: 'bd-sub' }, 'and'), sel(ui.upB, (v) => { ui.upB = v; }, 'Right player')));
    }
    const A = G.list.find((x) => x.key === ui.upA), B = G.list.find((x) => x.key === ui.upB);
    const items = [[A, 0], [B, 1]].flatMap(([x, side]) => (x.f.key ? [...x.f.key].filter(([n]) => !/ Age$/.test(n)).map(([n, t]) => ({ n, t, side, x })) : [])).sort((a, b) => a.t - b.t);
    head.append(h('div', { class: 'bd-ups' },
      h('div', { class: 'bd-eyebrow bd-r', style: `color:${A.color}` }, A.name), h('div'), h('div', { class: 'bd-eyebrow', style: `color:${B.color}` }, B.name),
      items.map((u) => [u.side === 0 ? h('div', { class: 'bd-r' }, h('span', { class: 'bd-up', style: `--pc:${u.x.color}` }, u.n)) : h('div'),
        h('div', { class: 'bd-num bd-m' }, ms(u.t)),
        u.side === 1 ? h('div', {}, h('span', { class: 'bd-up', style: `--pc:${u.x.color}` }, u.n)) : h('div')])));
  }

  // ---------------------------------------------------------------- the card
  const TABS = [['overview', 'Overview', overview], ['eapm', 'eAPM', eapm], ['idle', 'Town Center idle', idle], ['army', 'Army', army], ['ups', 'Upgrades', ups]];
  function draw(host, ctx) {
    if (!window.TT_COACH) { host.hidden = true; return; }
    if (ui.match !== (ctx.game && ctx.game.match_id)) { ui.match = ctx.game && ctx.game.match_id; ui.army = null; ui.upA = null; ui.upB = null; }
    const G = people(ctx);
    if (!G.list.length) { host.hidden = true; host.replaceChildren(); return; }
    host.hidden = false;
    const render = () => {
      const body = h('div', { class: 'bd-body', role: 'tabpanel', id: 'bd-panel' });
      const tabs = h('div', { class: 'bd-tabs', role: 'tablist', 'aria-label': 'Parts of the game' }, TABS.map(([k, label]) => h('button', {
        type: 'button', role: 'tab', id: `bd-tab-${k}`, 'aria-selected': String(ui.tab === k), 'aria-controls': 'bd-panel', tabindex: ui.tab === k ? '0' : '-1',
        onclick: () => { ui.tab = k; render(); const b = document.getElementById(`bd-tab-${k}`); if (b) b.focus(); },
        onkeydown: (e) => {
          const i = TABS.findIndex((t) => t[0] === ui.tab);
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); ui.tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]; render(); const b = document.getElementById(`bd-tab-${ui.tab}`); if (b) b.focus(); }
        },
      }, label)));
      host.replaceChildren(h('div', { class: 'bd-head' }, h('div', {}, h('div', { class: 'bd-eyebrow' }, 'Game breakdown'), h('h2', {}, `${ctx.map || 'Game'} · ${G.teamGame ? G.teams.map((t) => t.members.length).join('v') : G.list.length === 2 ? '1v1' : `${G.list.length} players`}`)),
        h('span', { class: 'bd-chip bd-num' }, `${ms(G.end)} game time`)), tabs, body);
      body.setAttribute('aria-labelledby', `bd-tab-${ui.tab}`);
      const fn = TABS.find((t) => t[0] === ui.tab)[2];
      try { fn(body, G, render, ctx); } catch (e) { console.error('breakdown', e); body.append(h('p', { class: 'bd-empty' }, 'This part couldn’t be drawn for this game.')); }
    };
    render();
  }

  window.TT_BREAKDOWN = { draw };
})();
