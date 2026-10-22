// Draws every tab of the page.
(() => {
  const pct = d3.format('.0%');
  const num = d3.format(',');
  const txt = (v) => (v == null ? '' : String(v));
  const one = (v) => (v == null || v === '' ? '' : d3.format('.1f')(v));
  const SCOPES = window.TT_SCOPES;
  const PERIODS = window.TT_PERIODS;
  const enc = encodeURIComponent;
  const el = (id) => document.getElementById(id);
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const empty = (msg) => mk('div', 'tt-empty', msg);

  function fillTable(table, rows, cols, key, opts = {}) {
    const head = document.createElement('tr');
    cols.forEach((c) => {
      const th = document.createElement('th');
      if (c.headNode) th.append(...c.headNode()); else th.textContent = c.label;
      th.dataset.field = c.field;
      if (c.source) th.dataset.source = c.source;
      if (c.num) th.className = 'num';
      head.appendChild(th);
    });
    table.tHead.replaceChildren(head);
    table.tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = Array.isArray(key) ? key.map((k) => enc(String(r[k]))).join(',') : String(r[key]);
      if (opts.onClick && (!opts.clickable || opts.clickable(r))) { tr.className = 'click'; tr.addEventListener('click', () => opts.onClick(r)); }
      if (opts.selected && opts.selected(r)) tr.classList.add('sel');
      cols.forEach((c) => {
        const td = document.createElement('td');
        if (c.node) td.append(...c.node(r[c.field], r));
        else td.textContent = c.fmt ? c.fmt(r[c.field], r) : txt(r[c.field]);
        const cls = [c.num ? 'num' : '', c.wrap ? 'wrap' : '', c.cls ? c.cls(r[c.field], r) : ''].filter(Boolean).join(' ');
        if (cls) td.className = cls;
        tr.appendChild(td);
      });
      return tr;
    }));
    if (!rows.length && opts.emptyText) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = cols.length; td.className = 'tt-empty'; td.textContent = opts.emptyText;
      tr.appendChild(td);
      table.tBodies[0].appendChild(tr);
    }
  }
  const failed = (box) => box.replaceChildren(empty('Failed to load'));
  function mark(source, where, field, text, tag = 'b') {
    const s = document.createElement(tag);
    s.dataset.source = source;
    s.dataset.where = Object.entries(where).map(([k, v]) => `${k}=${enc(String(v))}`).join('&');
    s.dataset.field = field;
    s.textContent = text;
    return s;
  }
  const ratePill = (v) => (v >= 0.55 ? 'win' : v <= 0.45 ? 'loss' : '');

  // Steam name first, placeholder name small in parentheses.
  let steam = new Map();
  function who(name) {
    if (!name) return [''];
    const s = steam.get(name);
    if (!s) return [name];
    const a = mk('span', '', s);
    const b = mk('span', 'ph', `(${name})`);
    return [a, b];
  }
  const steamOr = (name) => steam.get(name) || name;

  // ---------------------------------------------------------------- state
  const P = () => dash.params();
  const tabs = [...document.querySelectorAll('.tt-tabs button')];
  let current = 'home';
  function show(id, link) {
    current = id;
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    document.querySelectorAll('.tt-page').forEach((p) => { p.hidden = p.id !== id; });
    if (link) dash.setLink(id);
    draw();
  }
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab, true)));
  window.TT_show = show;

  el('check-badge').addEventListener('click', () => show('check', true));
  const tPick = el('t-pick');
  tPick.addEventListener('change', () => dash.setParams({ t: tPick.value }));
  function currentTournament(ts) {
    const ids = ts.map((t) => t.tournament_id);
    if (ids.includes(P().t)) return P().t;
    const active = ts.filter((t) => t.status === 'Active').sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
    if (active.length) return active[0].tournament_id;
    return ts.slice().sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0]?.tournament_id;
  }

  // ---------------------------------------------------------------- charts
  function bars(box, rows, labelKey, valueKey, fmt, max, tipLines) {
    box.replaceChildren();
    const W = box.clientWidth;
    if (!W) return;
    const rowH = 28;
    const H = rows.length * rowH + 8;
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    const probe = svg.append('text').attr('font-size', 12);
    let labW = 0;
    rows.forEach((r) => { probe.text(r[labelKey]); labW = Math.max(labW, probe.node().getComputedTextLength()); });
    labW = Math.min(labW, W * 0.45);
    probe.text(fmt(max));
    const valW = probe.node().getComputedTextLength();
    probe.remove();
    const x = d3.scaleLinear([0, max || 1], [0, Math.max(10, W - labW - valW - 24)]);
    const tip = d3.select(box).append('div').attr('class', 'tt-tip').style('display', 'none');
    const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rowH + 4})`);
    g.append('text').attr('x', labW).attr('y', 14).attr('text-anchor', 'end').attr('font-size', 12)
      .attr('fill', 'var(--color-fg)').text((d) => d[labelKey]);
    g.append('rect').attr('x', labW + 8).attr('y', 4).attr('height', 16).attr('rx', 4)
      .attr('width', (d) => Math.max(2, x(d[valueKey]))).attr('fill', dash.colors[0]);
    g.append('text').attr('x', (d) => labW + 12 + Math.max(2, x(d[valueKey]))).attr('y', 16).attr('font-size', 12)
      .attr('fill', 'var(--color-fg-muted)').text((d) => fmt(d[valueKey]));
    g.on('mousemove', (event, d) => {
      const [mx, my] = d3.pointer(event, box);
      tip.style('display', null).selectAll('*').remove();
      tip.append('div').attr('class', 'k').text(d[labelKey]);
      tipLines(d).forEach((l) => tip.append('div').text(l));
      const tw = tip.node().offsetWidth;
      tip.style('left', `${Math.min(Math.max(0, mx + 12), W - tw)}px`).style('top', `${my + 12}px`);
    }).on('mouseleave', () => tip.style('display', 'none'));
  }

  function chart(box, id, emptyText, rowsFn, drawFn) {
    const d = dash.data(id);
    if (d.status === 'error') { box.classList.remove('dash-skeleton'); return failed(box); }
    if (d.status !== 'ok') { box.classList.add('dash-skeleton'); box.replaceChildren(); return; }
    box.classList.remove('dash-skeleton');
    const rows = rowsFn(d.data);
    if (!rows.length) { box.replaceChildren(empty(emptyText)); return; }
    drawFn(rows);
  }

  const signed = d3.format('+d');
  function ratingChart(box, series) {
    box.replaceChildren();
    const W = box.clientWidth;
    if (!W) return;
    const H = 230, mt = 10, mb = 24;
    const all = series.flatMap((s) => s.pts);
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
      .style('font-size', 'var(--cds-font-size-caption)').style('color', 'var(--color-fg-muted)');
    const y = d3.scaleLinear(d3.extent(all, (p) => p.v), [H - mb, mt]).nice();
    const yAxis = svg.append('g').call(d3.axisLeft(y).ticks(5).tickSize(0)).attr('font-size', null).attr('font-family', null);
    yAxis.select('.domain').remove();
    let lw = 0;
    yAxis.selectAll('text').each(function () { lw = Math.max(lw, this.getComputedTextLength()); });
    const ml = lw + 10;
    yAxis.attr('transform', `translate(${ml - 6},0)`);
    // end labels need room on the right
    const probe = svg.append('text').attr('font-size', 12);
    let endW = 0;
    series.forEach((s) => { probe.text(`${s.name} ${s.pts[s.pts.length - 1].v}`); endW = Math.max(endW, probe.node().getComputedTextLength()); });
    probe.remove();
    const mr = Math.min(endW + 12, W * 0.35);
    const x = d3.scaleUtc(d3.extent(all, (p) => p.d), [ml, W - mr]);
    svg.insert('g', ':first-child').selectAll('line').data(y.ticks(5)).join('line')
      .attr('x1', ml).attr('x2', W - mr).attr('y1', (t) => y(t)).attr('y2', (t) => y(t)).attr('stroke', 'var(--cds-chart-grid)');
    const xAxis = svg.append('g').attr('transform', `translate(0,${H - mb})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((W - mr) / 110))).tickFormat(d3.utcFormat((x.domain()[1] - x.domain()[0]) > 300 * 864e5 ? '%b %Y' : '%b %-d')).tickSizeOuter(0))
      .attr('font-size', null).attr('font-family', null);
    xAxis.select('.domain').attr('stroke', 'var(--cds-chart-axis)');
    xAxis.selectAll('.tick line').attr('stroke', 'var(--cds-chart-axis)');
    let lastY = [];
    series.forEach((s, i) => {
      svg.append('path').datum(s.pts).attr('class', 'tt-line').attr('stroke', dash.colors[i])
        .attr('d', d3.line().x((p) => x(p.d)).y((p) => y(p.v)));
      const lp = s.pts[s.pts.length - 1];
      let ly = y(lp.v) + 4;
      lastY.forEach((o) => { if (Math.abs(o - ly) < 14) ly = o + (ly >= o ? 14 : -14); });
      lastY.push(ly);
      svg.append('text').attr('x', x(lp.d) + 6).attr('y', ly).attr('font-size', 12).attr('fill', dash.colors[i]).text(`${s.name} ${lp.v}`);
    });
    const dot = svg.append('circle').attr('r', 4).style('display', 'none');
    const tip = d3.select(box).append('div').attr('class', 'tt-tip').style('display', 'none');
    const del = d3.Delaunay.from(all, (p) => x(p.d), (p) => y(p.v));
    svg.append('rect').attr('x', ml).attr('y', mt).attr('width', Math.max(1, W - ml - mr)).attr('height', H - mt - mb).attr('fill', 'transparent')
      .on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event);
        const p = all[del.find(mx, my)];
        if (!p) return;
        dot.style('display', null).attr('cx', x(p.d)).attr('cy', y(p.v)).attr('fill', p.color);
        tip.style('display', null).selectAll('*').remove();
        tip.append('div').attr('class', 'k').text(d3.utcFormat('%b %-d, %Y')(p.d));
        tip.append('div').text(`${p.series} rating ${p.v}${p.r.rating_diff != null ? ` (${signed(p.r.rating_diff)})` : ''}`);
        tip.append('div').text(`${Number(p.r.won) === 1 ? 'Won' : 'Lost'} as ${p.r.civ}${p.r.opp_civ ? ` vs ${p.r.opp_civ}` : ''} on ${p.r.map}`);
        const tw = tip.node().offsetWidth;
        tip.style('left', `${Math.min(Math.max(0, x(p.d) + 12), W - tw)}px`).style('top', `${y(p.v) + 12}px`);
      })
      .on('mouseleave', () => { dot.style('display', 'none'); tip.style('display', 'none'); });
  }

  // ---------------------------------------------------------------- profiles
  const ppPlayer = el('pp-player');
  ppPlayer.addEventListener('change', () => dash.setParams({ pp: ppPlayer.value }));
  const ppScope = el('pp-scope');
  ppScope.replaceChildren(...SCOPES.map((s) => {
    const b = mk('button', 'tt-chip', s);
    b.type = 'button'; b.dataset.scope = s;
    b.addEventListener('click', () => dash.setParams({ ps: s }));
    return b;
  }));
  const ppPeriod = el('pp-period');
  ppPeriod.replaceChildren(...PERIODS.map((s) => {
    const b = mk('button', 'tt-chip', s);
    b.type = 'button'; b.dataset.period = s;
    b.addEventListener('click', () => dash.setParams({ pr: s }));
    return b;
  }));
  el('how-link').addEventListener('click', (e) => { e.preventDefault(); el('how').scrollIntoView(); dash.setLink('how'); });

  function drawProfiles(names) {
    const player = names.includes(P().pp) ? P().pp : names.includes(ME.player) ? ME.player : names[0];
    const view = SCOPES.includes(P().ps) ? P().ps : 'All games';
    const period = PERIODS.includes(P().pr) ? P().pr : 'All time';
    const scope = period === 'All time' ? view : view + ' · ' + period;
    const inPeriod = (r) => period === 'All time' || (Date.now() - Date.parse(r.started)) / 864e5 <= { 'Last year': 365, 'Last 6 months': 183 }[period];
    if (document.activeElement !== ppPlayer) {
      ppPlayer.replaceChildren(...names.map((n) => new Option(steam.get(n) ? `${steam.get(n)} (${n})` : n, n)));
      if (player) ppPlayer.value = player;
    }
    ppScope.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === view)));
    ppPeriod.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === period)));
    if (!player) return;
    const where = { player, scope };
    const pick = (id) => { const d = dash.data(id); return d.status === 'ok' ? d.data.filter((r) => r.player === player && r.scope === scope) : null; };

    // headline figures
    const sum = pick('p_summary');
    const row = sum && sum[0];
    el('pp-rating-label').textContent = view === 'Ranked team' ? 'Latest team rating' : 'Latest 1v1 rating';
    document.querySelectorAll('#pp-kpis [data-k]').forEach((n) => {
      const k = n.dataset.k;
      Object.assign(n.dataset, { source: 'p_summary', where: `player=${enc(player)}&scope=${enc(scope)}`, field: k });
      const v = row ? row[k] : null;
      n.textContent = v == null ? '—' : k === 'win_rate' ? pct(v) : num(v);
    });
    const sub = (k, label) => {
      const n = document.querySelector(`#pp-kpis [data-k2="${k}"]`);
      n.replaceChildren();
      if (row && row[k] != null) n.append(label, mark('p_summary', where, k, k === 'streak_now' ? row[k] : num(row[k])));
    };
    sub('rating_peak', 'Peak ');
    sub('streak_now', 'Current ');
    const ek = document.querySelector('#pp-kpis [data-k3="eapm"]');
    const es = document.querySelector('#pp-kpis [data-k3s="analyzed"]');
    Object.assign(ek.dataset, { source: 'p_summary', where: `player=${enc(player)}&scope=${enc(scope)}`, field: 'eapm' });
    ek.textContent = row && row.eapm != null ? num(row.eapm) : '—';
    es.replaceChildren();
    if (row) es.append('From ', mark('p_summary', where, 'analyzed', num(row.analyzed)), ' analyzed games');

    // identity cards
    const idBox = el('pp-identity');
    const idd = dash.data('p_identity');
    if (idd.status === 'error') failed(idBox);
    else if (idd.status === 'ok') {
      const r = idd.data.find((x) => x.player === player && x.period === period);
      const iw = { player, period };
      const card = (label, f, note) => {
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
        } else { v.textContent = '—'; c.appendChild(v); c.appendChild(mk('div', 'tt-kpi-s', note)); }
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

    drawCompare(player, view);

    // strategy tables
    const stratCols = (keyField, label, extra = []) => [
      { field: keyField, label },
      { field: 'games', label: 'Games', num: true },
      { field: 'wins', label: 'Wins', num: true },
      { field: 'win_rate', label: 'Win %', num: true, fmt: (v) => pct(v), cls: ratePill },
      ...extra,
    ];
    const noReplays = 'No analyzed replays in this view yet.';
    [['pp-open', 's_openings', 'opening', 'Opening', [{ field: 'feudal_min', label: 'Feudal', num: true, fmt: one }, { field: 'castle_min', label: 'Castle', num: true, fmt: one }]],
      ['pp-castle', 's_castle', 'castle_plan', 'Plan', []],
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
    chart(el('pp-units'), 's_units', noReplays, (rows) => rows.filter((r) => r.player === player && r.scope === scope).slice(0, 10), (rows) => {
      bars(el('pp-units'), rows, 'unit_class', 'share', pct, d3.max(rows, (r) => r.share), (d) => [`${pct(d.share)} of military units`, `${num(d.units)} queued`]);
    });

    // scouting report
    const li = (...parts) => { const n = document.createElement('li'); n.append(...parts); return n; };
    const items = [];
    const byRate = (a, b) => b.win_rate - a.win_rate || b.games - a.games;
    const open = (pick('s_openings') || []).filter((r) => r.games >= 3);
    if (open.length) {
      const fav = open[0];
      items.push(li('Usual opening: ', mark('s_openings', { ...where, opening: fav.opening }, 'opening', fav.opening), ' in ',
        mark('s_openings', { ...where, opening: fav.opening }, 'games', num(fav.games)), ' games, winning ',
        mark('s_openings', { ...where, opening: fav.opening }, 'win_rate', pct(fav.win_rate)), '.'));
      const best = [...open].sort(byRate)[0];
      if (best.opening !== fav.opening) items.push(li('Most successful opening: ', mark('s_openings', { ...where, opening: best.opening }, 'opening', best.opening), ' (',
        mark('s_openings', { ...where, opening: best.opening }, 'win_rate', pct(best.win_rate)), ' over ', mark('s_openings', { ...where, opening: best.opening }, 'games', num(best.games)), ' games).'));
    }
    const att = (pick('s_attack') || []).filter((r) => r.games >= 3);
    if (att.length) items.push(li('Attacks: mostly ', mark('s_attack', { ...where, attack_style: att[0].attack_style }, 'attack_style', att[0].attack_style.toLowerCase()), ', winning ',
      mark('s_attack', { ...where, attack_style: att[0].attack_style }, 'win_rate', pct(att[0].win_rate)), ' of those games.'));
    const def = (pick('s_defense') || []).filter((r) => r.games >= 3);
    if (def.length) items.push(li('Defends with: ', mark('s_defense', { ...where, defense_style: def[0].defense_style }, 'defense_style', def[0].defense_style.toLowerCase()), ' (',
      mark('s_defense', { ...where, defense_style: def[0].defense_style }, 'games', num(def[0].games)), ' games).'));
    const tw = (tempo || []).find((r) => r.result === 'Wins'), tl = (tempo || []).find((r) => r.result === 'Losses');
    if (tw && tl && tw.castle_min && tl.castle_min) {
      items.push(li('Reaches Castle Age at ', mark('s_tempo', { ...where, result: 'Wins' }, 'castle_min', one(tw.castle_min)), ' min in wins vs ',
        mark('s_tempo', { ...where, result: 'Losses' }, 'castle_min', one(tl.castle_min)), ' min in losses.'));
    }
    const lens = (pick('p_length') || []).filter((r) => r.games >= 5);
    if (lens.length > 1) {
      const s = [...lens].sort(byRate), b = s[0], w = s[s.length - 1];
      items.push(li('Wins most in ', mark('p_length', { ...where, length: b.length }, 'length', b.length), ' games (', mark('p_length', { ...where, length: b.length }, 'win_rate', pct(b.win_rate)),
        ') and least in ', mark('p_length', { ...where, length: w.length }, 'length', w.length), ' games (', mark('p_length', { ...where, length: w.length }, 'win_rate', pct(w.win_rate)), ').'));
    }
    const vs = (pick('p_vs_civ') || []).filter((r) => r.games >= 3);
    if (vs.length) {
      const tough = [...vs].sort(byRate).pop();
      items.push(li('Toughest opponent civ: ', mark('p_vs_civ', { ...where, opp_civ: tough.opp_civ }, 'opp_civ', tough.opp_civ), ', winning only ',
        mark('p_vs_civ', { ...where, opp_civ: tough.opp_civ }, 'win_rate', pct(tough.win_rate)), ' of ', mark('p_vs_civ', { ...where, opp_civ: tough.opp_civ }, 'games', num(tough.games)), ' games.'));
    }
    if (!items.length) items.push(li('Not enough games in this view to build a report yet.'));
    el('pp-findings').replaceChildren(...items);

    // rating
    const hist = dash.data('history');
    const rbox = el('pp-rating');
    if (hist.status === 'error') failed(rbox);
    else if (hist.status === 'ok') {
      const series = [['1v1', '1v1 ranked'], ['Team', 'Team ranked']].map(([name, type], i) => ({
        name,
        pts: hist.data.filter((r) => r.player === player && r.type === type && r.rating != null && inPeriod(r))
          .sort((a, b) => (a.started < b.started ? -1 : 1))
          .map((r) => ({ d: new Date(r.started), v: Number(r.rating), r, series: name, color: dash.colors[i] })),
      })).filter((s) => s.pts.length >= 2);
      if (!series.length) rbox.replaceChildren(empty('Not enough ranked games to draw a trend.'));
      else ratingChart(rbox, series);
    }

    // style + length charts
    chart(el('pp-style'), 'p_styles', 'No games in this view.', (rows) => rows.filter((r) => r.player === player && r.scope === scope), (rows) => {
      bars(el('pp-style'), rows, 'style', 'share', pct, d3.max(rows, (r) => r.share), (d) => [`${pct(d.share)} of games (${d.games})`, `Win rate ${pct(d.win_rate)}`]);
    });
    chart(el('pp-length'), 'p_length', 'No games in this view.', (rows) => rows.filter((r) => r.player === player && r.scope === scope), (rows) => {
      bars(el('pp-length'), rows, 'length', 'win_rate', pct, 1, (d) => [`Win rate ${pct(d.win_rate)}`, `${d.games} games`]);
    });

    // tables
    const rateCols = (keyField, label) => [
      { field: keyField, label },
      { field: 'games', label: 'Games', num: true },
      { field: 'wins', label: 'Wins', num: true },
      { field: 'win_rate', label: 'Win %', num: true, fmt: (v) => pct(v), cls: ratePill },
    ];
    [['pp-civs', 'p_civs', 'civ', 'Civ'], ['pp-maps', 'p_maps', 'map', 'Map'], ['pp-vs', 'p_vs_civ', 'opp_civ', 'Opponent civ']].forEach(([tid, id, kf, label]) => {
      const t = el(tid);
      const rows = pick(id);
      if (rows) fillTable(t, rows, rateCols(kf, label), ['player', 'scope', kf], { emptyText: 'No games in this view.' });
      else if (dash.data(id).status === 'error') failed(t.tBodies[0]);
    });
    const st = dash.data('standings'), ts = dash.data('tournaments');
    if (st.status === 'ok') {
      const tname = new Map(ts.status === 'ok' ? ts.data.map((t) => [t.tournament_id, t.name]) : []);
      fillTable(el('pp-tourn'), st.data.filter((r) => r.player === player), [
        { field: 'tournament_id', label: 'Tournament', fmt: (v) => tname.get(v) || v },
        { field: 'rank', label: 'Rank', num: true }, { field: 'played', label: 'Played', num: true },
        { field: 'wins', label: 'Wins', num: true }, { field: 'losses', label: 'Losses', num: true },
      ], ['tournament_id', 'player'], { emptyText: 'Not in any tournament yet.', onClick: (r) => { dash.setParams({ t: r.tournament_id }); show('standings', true); } });
    }
    const scoped = dash.data('h_scoped'), games = dash.data('replay_games');
    if (hist.status === 'ok' && scoped.status === 'ok') {
      const sc = new Map(scoped.data.map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
      const analyzed = new Set(games.status === 'ok' ? games.data.filter((g) => String(g.status).startsWith('Analyzed')).map((g) => String(g.match_id)) : []);
      const rows = hist.data.filter((r) => r.player === player && (sc.get(player + '|' + String(r.match_id)) || []).includes(scope))
        .sort((a, b) => (a.started < b.started ? 1 : -1)).slice(0, 40);
      fillTable(el('pp-recent'), rows, [
        { field: 'started', label: 'Date', fmt: (v) => d3.utcFormat(new Date(v).getUTCFullYear() === new Date().getUTCFullYear() ? '%b %-d' : '%b %-d, %Y')(new Date(v)) },
        { field: 'won', label: 'Result', fmt: (v) => (Number(v) === 1 ? 'Win' : 'Loss'), cls: (v) => (Number(v) === 1 ? 'win' : 'loss') },
        { field: 'type', label: 'Type' },
        { field: 'civ', label: 'Civ' },
        { field: 'opp_civ', label: 'Vs civ', fmt: (v, r) => v || r.opp_civs || '' },
        { field: 'map', label: 'Map' },
        { field: 'rating_diff', label: 'Rating', num: true, fmt: (v) => (v == null ? '' : signed(v)) },
        { field: 'duration_min', label: 'Min', num: true, fmt: (v) => d3.format('.0f')(v) },
        { field: 'match_id', label: 'Replay', fmt: (v) => (analyzed.has(String(v)) ? 'Review ›' : '') },
      ], ['player', 'match_id'], {
        emptyText: 'No games in this view.',
        clickable: (r) => analyzed.has(String(r.match_id)),
        onClick: (r) => { dash.setParams({ m: String(r.match_id) }); show('review', true); },
      });
    }
  }

  // ---------------------------------------------------------------- match review
  const rvPlayer = el('rv-player'), rvType = el('rv-type');
  rvPlayer.addEventListener('change', () => dash.setParams({ rp: rvPlayer.value || null }));
  rvType.addEventListener('change', () => dash.setParams({ rt: rvType.value || null }));
  const appVer = () => { const d = dash.data('helper_app'); return d.status === 'ok' && d.data[0] ? String(d.data[0].version) : ''; };
  const links = (mid, pids) => {
    const a = (href, text) => { const n = mk('a', '', text); n.href = href; n.target = '_blank'; n.rel = 'noopener noreferrer'; return n; };
    const out = [];
    if (pids.length) {
      const w = a(`aoe2replay://watch/${enc(mid)}/${enc(pids[0][1])}${appVer() ? `?v=${enc(appVer())}` : ''}`, '▶ Watch in AoE2');
      w.style.fontWeight = 'var(--cds-font-weight-medium)';
      w.style.borderColor = 'var(--color-fg)';
      out.push(w);
    }
    out.push(...pids.map(([name, pid]) => a(`https://aoe.ms/replay/?gameId=${enc(mid)}&profileId=${enc(pid)}`, `Download replay (${steamOr(name)}'s view)`)));
    out.push(a(`https://www.aoe2companion.com/matches/${enc(mid)}`, 'Open on AoE2 Companion'));
    out.push(a(`https://www.aoe2insights.com/match/${enc(mid)}/`, 'Open on AoE2 Insights'));
    return out;
  };

  function drawReview(names) {
    if (document.activeElement !== rvPlayer) {
      rvPlayer.replaceChildren(new Option('All players', ''), ...names.map((n) => new Option(steamOr(n), n)));
      rvPlayer.value = P().rp && names.includes(P().rp) ? P().rp : '';
    }
    rvType.value = P().rt || '';
    const list = dash.data('review_list');
    const tbl = el('rv-list');
    let rows = [];
    if (list.status === 'error') failed(tbl.tBodies[0]);
    else if (list.status === 'ok') {
      rows = list.data.filter((r) => (!P().rp || r.players.split(', ').includes(P().rp)) && (!P().rt || r.views.split('|').includes(P().rt)));
      fillTable(tbl, rows, [
        { field: 'started', label: 'Date', fmt: (v) => d3.utcFormat('%b %-d, %Y')(new Date(v)) },
        { field: 'type', label: 'Type', fmt: (v, r) => (r.tournament ? `Tournament · ${v}` : v) },
        { field: 'map', label: 'Map' },
        { field: 'result', label: 'Result', wrap: true },
        { field: 'duration_min', label: 'Min', num: true, fmt: (v) => d3.format('.0f')(v) },
        { field: 'has_playback', label: 'Playback', fmt: (v) => (Number(v) === 1 ? 'Yes' : 'Expired') },
      ], 'match_id', {
        emptyText: 'No analyzed games yet. They appear here once the update job has read their replays. Try the sample game below to see the viewer.',
        onClick: (r) => dash.setParams({ m: r.match_id }),
        selected: (r) => r.match_id === P().m,
      });
    }
    let mid = P().m;
    if (!mid && list.status === 'ok') mid = list.data.length ? list.data[0].match_id : 'sample';
    if (!mid) return;
    const g = list.status === 'ok' ? list.data.find((r) => r.match_id === mid) : null;
    const isSample = mid === 'sample';
    const hist = dash.data('history');
    const hs = hist.status === 'ok' ? hist.data.filter((r) => String(r.match_id) === String(mid)) : [];
    const pl = dash.data('players');
    const pidOf = new Map(pl.status === 'ok' ? pl.data.map((p) => [p.player, String(p.profile_id)]) : []);

    // game card
    const title = el('rv-game-title'), note = el('rv-game-note'), lk = el('rv-links');
    if (isSample) {
      title.textContent = 'Sample game';
      el('rv-dl-note').replaceChildren();
      note.textContent = 'A public replay of two pro players, included so you can try the viewer before your own games are analyzed.';
      lk.replaceChildren();
      if (list.status === 'ok' && list.data.length) {
        const b = mk('button', 'tt-btn', 'Back to your games'); b.type = 'button';
        b.addEventListener('click', () => dash.setParams({ m: list.data[0].match_id }));
        lk.appendChild(b);
      }
    } else {
      title.replaceChildren(g ? mark('review_list', { match_id: mid }, 'map', g.map, 'span') : document.createTextNode('Game'),
        document.createTextNode(g ? ` · ${d3.utcFormat('%b %-d, %Y')(new Date(g.started))}` : ''));
      note.replaceChildren();
      if (g) note.append(mark('review_list', { match_id: mid }, 'result', g.result, 'span'), ` · ${d3.format('.0f')(g.duration_min)} min · ${g.tournament ? 'Tournament game · ' : ''}${g.type}`);
      else note.textContent = 'This game hasn’t been analyzed.';
      const wp = hs.map((r) => [r.player, r.profile_id || pidOf.get(r.player)]).filter(([, p]) => p);
      lk.replaceChildren(...links(mid, wp));
      const dl = el('rv-dl-note');
      dl.replaceChildren();
      if (wp.length) {
        dl.append('“Watch in AoE2” opens this game in Age of Empires II: DE on your PC (one-time setup: download AoE2 Replay below; you need version 1.1 or newer, so if it says the link doesn’t look right, download it again). If the button does nothing, open “AoE2 Replay” from the Start menu and paste: ');
        const code = mk('code', '', `aoe2replay://watch/${mid}/${wp[0][1]}${appVer() ? `?v=${appVer()}` : ''}`);
        code.style.userSelect = 'all';
        dl.append(code, '. A downloaded replay is a game file, not a video, so media players can’t open it.');
      }
      const s = mk('button', 'tt-btn', 'Try the sample game'); s.type = 'button';
      s.addEventListener('click', () => dash.setParams({ m: 'sample' }));
      if (dash.data('pb_sample').status === 'ok') lk.appendChild(s); // the sample game is optional (data/playback/pb_sample.json)
    }

    // viewer
    const vbox = el('rv-viewer');
    const pbId = isSample ? 'pb_sample' : g && g.has_playback ? g.playback_id : '';
    if (!pbId) {
      vbox.removeAttribute('data-source');
      vbox.replaceChildren(empty(g ? 'Playback is kept for the 40 newest analyzed games, so this one has none. The analysis below stays, and the replay can still be downloaded from the links above while Microsoft keeps it.' : 'Pick a game above.'));
    } else {
      vbox.dataset.source = pbId;
      window.TT_viewer(vbox, pbId, (n) => (pidOf.size ? steamOr(n) : n));
    }

    // side by side + build orders
    const an = dash.data('replay_analysis');
    const ctab = el('rv-compare');
    const grid = el('rv-build-grid');
    if (isSample) {
      const pb = dash.data('pb_sample');
      ctab.tBodies[0].replaceChildren();
      ctab.tHead.replaceChildren();
      grid.replaceChildren();
      const sp = pb.status === 'ok' && Array.isArray(pb.data) ? window.TT_unpack(pb.data) : null;
      if (sp) grid.replaceChildren(...buildCards(sp, 'pb_sample'));
      return;
    }
    if (an.status === 'error') failed(ctab.tBodies[0]);
    else if (an.status === 'ok') {
      const rows = an.data.filter((a) => String(a.match_id) === String(mid));
      fillTable(ctab, rows, [
        { field: 'player', label: 'Player', node: (v) => who(v) },
        { field: 'civ', label: 'Civ' },
        { field: 'won', label: 'Result', fmt: (v) => (Number(v) === 1 ? 'Win' : 'Loss'), cls: (v) => (Number(v) === 1 ? 'win' : 'loss') },
        { field: 'opp_civs', label: 'Vs' },
        { field: 'opening', label: 'Opening' },
        { field: 'opp_openings', label: 'Their opening' },
        { field: 'castle_plan', label: 'Castle plan' },
        { field: 'late_army', label: 'Late army' },
        { field: 'attack_style', label: 'Attack', wrap: true },
        { field: 'defense_style', label: 'Defense', wrap: true },
        { field: 'feudal_min', label: 'Feudal', num: true, fmt: one },
        { field: 'castle_min', label: 'Castle', num: true, fmt: one },
        { field: 'imperial_min', label: 'Imperial', num: true, fmt: one },
        { field: 'first_attack_min', label: '1st attack', num: true, fmt: one },
        { field: 'eapm', label: 'eAPM', num: true },
        { field: 'villagers', label: 'Villagers', num: true },
        { field: 'military_units', label: 'Military', num: true },
        { field: 'palisade_tiles', label: 'Palisade', num: true },
        { field: 'stone_wall_tiles', label: 'Stone wall', num: true },
        { field: 'towers', label: 'Towers', num: true },
        { field: 'castles', label: 'Castles', num: true },
        { field: 'town_centers', label: 'TCs', num: true },
        { field: 'unit_mix', label: 'Army', wrap: true },
      ], ['match_id', 'profile_id'], { emptyText: 'No replay analysis for this game.' });
      const pbd = pbId ? dash.data(pbId) : null;
      const upb = pbd && pbd.status === 'ok' && Array.isArray(pbd.data) ? window.TT_unpack(pbd.data) : null;
      if (upb) grid.replaceChildren(...buildCards(upb, pbId));
      else grid.replaceChildren(...rows.map((a) => {
        const c = mk('div', 'tt-card');
        c.appendChild(mk('h2', '', `${steamOr(a.player)} build order`));
        c.appendChild(mk('p', 'tt-note', 'First steps, game minutes.'));
        const ul = mk('ul', 'tt-rules');
        String(a.build_order || '').split('; ').filter(Boolean).forEach((s) => ul.appendChild(mk('li', '', s)));
        c.appendChild(ul);
        c.dataset.source = 'replay_analysis';
        c.dataset.where = `match_id=${enc(a.match_id)}&profile_id=${enc(a.profile_id)}`;
        c.dataset.field = 'build_order';
        return c;
      }));
    }
  }

  function buildCards(pb, source) {
    return pb.players.map((p) => {
      const c = mk('div', 'tt-card');
      c.dataset.source = source;
      c.appendChild(mk('h2', '', `${p.name} build order`));
      c.appendChild(mk('p', 'tt-note', `${p.civ} · first 40 steps, game minutes`));
      const box = mk('div', 'tt-scroll tt-tall');
      const t = mk('table');
      t.append(mk('thead'), mk('tbody'));
      box.appendChild(t);
      c.appendChild(box);
      fillTable(t, pb.build.filter((b) => b.number === p.number), [
        { field: 'min', label: 'Min', num: true, fmt: one }, { field: 'kind', label: 'Type' }, { field: 'item', label: 'Item' },
      ], 'step');
      return c;
    });
  }

  // ---------------------------------------------------------------- main draw
  // ---------------------------------------------------------------- shared helpers for the newer pages
  const PERIOD_DAYS = { 'Last year': 365, 'Last 6 months': 183 };
  const periodOk = (period, started) => period === 'All time' || (Date.now() - Date.parse(started)) / 864e5 <= PERIOD_DAYS[period];
  const fmtDay = (v) => { const d = new Date(v); return d3.utcFormat(d.getUTCFullYear() === new Date().getUTCFullYear() ? '%b %-d' : '%b %-d, %Y')(d); };
  const ago = (h) => (h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`);
  const extLinks = (mid) => {
    const box = mk('span', 'tt-links');
    [['AoE2 Companion', `https://www.aoe2companion.com/matches/${enc(mid)}`], ['AoE2 Insights', `https://www.aoe2insights.com/match/${enc(mid)}/`]].forEach(([n, u]) => {
      const a = mk('a', '', n); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.append(a);
    });
    return box;
  };
  const whoNodes = (name) => who(name).map((n) => (n.nodeType ? n : document.createTextNode(n)));
  const btn = (text, onClick, cls) => { const b = mk('button', 'tt-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', onClick); return b; };

  // ---------------------------------------------------------------- who is viewing ("I'm"), shared confirmations
  const ME = { player: '', id: null, owner: false, canWrite: null, db: null, assets: null, confReady: false, confErr: false };
  const CONF = new Map();
  const mePick = el('me-pick');
  const lsGet = () => { try { return localStorage.getItem('tt-me') || ''; } catch (e) { return ''; } };
  const lsSet = (v) => { try { localStorage.setItem('tt-me', v); } catch (e) { /* storage blocked: kept for this visit */ } };
  ME.player = lsGet();
  mePick.addEventListener('change', async () => {
    ME.player = mePick.value;
    lsSet(ME.player);
    if (ME.db && ME.id) {
      try { await ME.db.doc(`data/users/${ME.id}/me`).set({ player: ME.player, at: new Date().toISOString() }); } catch (e) { /* view-only access: kept in this browser */ }
    }
    if (ME.player) dash.setParams({ pp: ME.player, ha: ME.player });
    else draw();
  });
  let confirmMsg = '';
  (async () => {
    const use = (n) => (window.claude && window.claude.use ? Promise.resolve(window.claude.use(n)).catch(() => null) : Promise.resolve(null));
    const [db, user, assets] = await Promise.all([use('db'), use('user'), use('assets')]);
    ME.db = db; ME.assets = assets;
    if (user) {
      try { ME.id = await user.id(); ME.owner = await user.isOwner(); ME.canWrite = await user.can('data.write'); } catch (e) { /* no identity */ }
    }
    if (db && ME.id) {
      try {
        const snap = await db.doc(`data/users/${ME.id}/me`).get();
        const v = snap.exists ? (snap.data() || {}).player : '';
        if (v && v !== ME.player) { ME.player = String(v); lsSet(ME.player); }
      } catch (e) { /* not available */ }
    }
    if (db) {
      try {
        db.collection('confirm').onSnapshot((q) => {
          CONF.clear();
          q.docs.forEach((d) => CONF.set(d.id, d.data() || {}));
          ME.confReady = true;
          draw();
          autoApply();
        }, () => { ME.confErr = true; draw(); });
      } catch (e) { ME.confErr = true; }
    } else ME.confErr = true;
    draw();
  })();

  // ---------------------------------------------------------------- confirming tournament games
  const cid = (s, k) => `${s.tournament_id}_${s.match_id}_${k}`;
  function confState(s) {
    const a = CONF.get(cid(s, 'a')), b = CONF.get(cid(s, 'b')), o = CONF.get(cid(s, 'org'));
    const ans = (d) => (d ? d.answer : '');
    let status = 'waiting';
    if (ans(o) === 'yes') status = 'approved';
    else if (ans(o) === 'no') status = 'rejected';
    else if (ans(a) === 'no' && ans(b) === 'no') status = 'rejected';
    else if (ans(a) === 'yes' && ans(b) === 'yes') status = 'confirmed';
    else if (ans(a) === 'no' || ans(b) === 'no') status = 'disputed';
    return { a: ans(a), b: ans(b), o: ans(o), status };
  }
  async function vote(s, k, answer) {
    if (!ME.db) { confirmMsg = 'Confirming isn’t set up on this site yet.'; draw(); return; }
    try {
      await ME.db.doc('confirm/' + cid(s, k)).set({
        tournament_id: s.tournament_id, match_id: s.match_id, slot: s.slot, side: k,
        player: k === 'a' ? s.player_a : k === 'b' ? s.player_b : 'organizer', answer, user: ME.id || '', at: new Date().toISOString(),
      });
      confirmMsg = '';
    } catch (e) {
      confirmMsg = 'Your answer wasn’t saved. Sign in (top right) and set “I’m” to yourself first.';
      draw();
    }
  }
  const pad = (n) => String(n).padStart(2, '0');
  const playedAt = (iso) => { const d = new Date(iso); return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
  let applying = false;
  async function applyGame(s) {
    if (applying || !ME.db || !ME.assets) return;
    applying = true;
    try {
      const lock = await ME.db.doc('locks/matches').acquire({ holder: ME.id || 'page', ttlMs: 30000 });
      if (!lock.acquired) return;
      const md = dash.data('matches');
      if (md.status !== 'ok' || md.data.some((m) => String(m.match_id) === s.match_id)) return;
      const rows = md.data.map((m) => ({ ...m }));
      const fill = { status: 'Final', winner: s.winner, civ_a: s.civ_a, civ_b: s.civ_b, map: s.map, duration_min: s.duration_min, played_at: playedAt(s.started), match_id: s.match_id };
      const row = s.game != null ? rows.find((m) => m.tournament_id === s.tournament_id && Number(m.game) === Number(s.game)) : null;
      if (row) {
        if (row.status === 'Final') return;
        Object.assign(row, fill);
      } else {
        const next = Math.max(0, ...rows.filter((m) => m.tournament_id === s.tournament_id).map((m) => Number(m.game) || 0)) + 1;
        rows.push({ tournament_id: s.tournament_id, game: next, stage: s.stage, series: s.series, series_game: s.series_game, player_a: s.player_a, player_b: s.player_b, ...fill });
      }
      const up = await ME.assets.upload(new Blob([JSON.stringify(rows, null, 1)], { type: 'application/json' }), { type: 'application/json' });
      await ME.db.doc('datasets/matches').update({
        source: { kind: 'file', url: '/_blob/' + up.id, name: 'matches.json' },
        updated: { at: new Date().toISOString(), by: 'Confirmed on the dashboard' },
      });
      await ME.db.doc('confirm/' + cid(s, 'applied')).set({ tournament_id: s.tournament_id, match_id: s.match_id, user: ME.id || '', at: new Date().toISOString() });
      confirmMsg = `${s.slot === s.series ? 'Series game' : 'Game ' + s.game} (${steamOr(s.player_a)} vs ${steamOr(s.player_b)}) now counts in the standings.`;
    } catch (e) {
      confirmMsg = 'The confirmed game couldn’t be added to the standings yet (' + ((e && e.code) || 'error') + '). It will be tried again the next time someone with edit access opens the dashboard.';
    } finally {
      applying = false;
      draw();
    }
  }
  function autoApply() {
    if (!ME.assets || !ME.confReady) return;
    const sg = dash.data('t_suggest');
    if (sg.status !== 'ok') return;
    const done = new Set();
    const ready = sg.data.slice().sort((x, y) => (x.started < y.started ? -1 : 1)).find((s) => {
      if (done.has(s.slot)) return false;
      const st = confState(s).status;
      if (st === 'confirmed' || st === 'approved') return true;
      return false;
    });
    if (ready) applyGame(ready);
  }

  // ---------------------------------------------------------------- home
  function drawHome(tid, names, strows) {
    // freshness
    const dc = dash.data('data_check');
    const fresh = el('home-fresh');
    if (dc.status === 'ok' && dc.data.length) {
      const at = d3.max(dc.data, (d) => d.checked_at);
      const hrs = (Date.now() - new Date(at)) / 36e5;
      const fails = dc.data.filter((x) => x.status === 'fail').length;
      fresh.className = 'tt-banner ' + (hrs > 12 || fails ? 'bad' : 'ok');
      fresh.replaceChildren(
        mk('b', '', hrs > 12 ? '⚠ Data may be out of date' : fails ? `⚠ ${fails} data check${fails > 1 ? 's' : ''} failed` : '✓ Data up to date'),
        document.createTextNode(` · Last updated and checked ${ago(hrs)} (${d3.utcFormat('%b %-d, %H:%M UTC')(new Date(at))}). The site updates every 30 minutes${window.TT_LIVE && TT_LIVE.fetchedAt ? `; newest games loaded live at ${d3.timeFormat('%H:%M')(TT_LIVE.fetchedAt)}` : ''}.`),
        btn('See the data check', () => show('check', true)),
      );
    } else if (dc.status === 'error') { fresh.className = 'tt-banner bad'; fresh.textContent = 'Couldn’t load when the data was last updated.'; }

    const md = dash.data('matches');
    const ms = md.status === 'ok' ? md.data.filter((m) => m.tournament_id === tid) : [];
    const open = ms.filter((m) => m.status !== 'Final' && m.player_a && m.player_b).sort((a, b) => Number(a.game) - Number(b.game));
    const doneM = ms.filter((m) => m.status === 'Final').sort((a, b) => (Date.parse(b.played_at) || 0) - (Date.parse(a.played_at) || 0) || Number(b.game) - Number(a.game));

    // your next game
    const meCard = el('home-me-card'), meBox = el('home-me');
    meCard.hidden = false;
    if (!ME.player || !names.includes(ME.player)) {
      el('home-me-title').textContent = 'Your next game';
      meBox.replaceChildren(mk('p', 'tt-note', 'Choose who you are under “I’m” at the top to see your next game and open your own profile by default.'));
    } else {
      el('home-me-title').textContent = `Your next game, ${steamOr(ME.player)}`;
      const mine = open.find((m) => m.player_a === ME.player || m.player_b === ME.player);
      const br = dash.data('bracket');
      const ser = !mine && br.status === 'ok' ? br.data.find((s) => s.tournament_id === tid && !s.winner && (s.player_high === ME.player || s.player_low === ME.player) && s.player_high && s.player_low) : null;
      const opp = mine ? (mine.player_a === ME.player ? mine.player_b : mine.player_a) : ser ? (ser.player_high === ME.player ? ser.player_low : ser.player_high) : '';
      if (!opp) meBox.replaceChildren(mk('p', 'tt-note', 'No open games for you in this tournament right now.'));
      else {
        const line = mk('div', 'row');
        const left = mk('div');
        left.append(mk('span', 'tt-vs', 'vs '), ...whoNodes(opp));
        line.append(left, mk('span', 'tt-pill', mine ? `Game ${mine.game} · ${mine.stage}` : `${ser.round} · series ${ser.wins_high}–${ser.wins_low}`));
        const rv = dash.data('rivals');
        const rr = rv.status === 'ok' ? rv.data.find((r) => r.a === ME.player && r.b === opp && r.period === 'All time') : null;
        const sub = mk('div', 'sub');
        if (rr && rr.games) sub.append('All-time 1v1s against them: ', mark('rivals', { a: ME.player, b: opp, period: 'All time' }, 'wins', num(rr.wins), 'span'), ' won, ', mark('rivals', { a: ME.player, b: opp, period: 'All time' }, 'losses', num(rr.losses), 'span'), ' lost.');
        else if (rr) sub.textContent = 'You haven’t played a 1v1 against them yet.';
        const b = mk('div', 'tt-btns');
        b.append(btn('Head to head ›', () => { dash.setParams({ ha: ME.player, hb: opp }); show('rivals', true); }),
          btn('My profile ›', () => { dash.setParams({ pp: ME.player }); show('profiles', true); }));
        meBox.replaceChildren(line, sub, b);
      }
    }

    // confirmations
    const sg = dash.data('t_suggest');
    const list = el('confirm-list');
    if (sg.status === 'error') failed(list);
    else if (sg.status === 'ok') {
      const rows = sg.data.filter((s) => s.tournament_id === tid).filter((s) => confState(s).status !== 'rejected');
      const items = rows.map((s) => {
        const c = confState(s);
        const li = mk('li');
        const w = { tournament_id: s.tournament_id, match_id: s.match_id };
        const top = mk('div', 'row');
        const title = mk('div');
        title.append(mk('b', '', s.game != null ? `Game ${s.game}` : `${s.stage} game ${s.series_game}`), ` · ${s.stage} · `, ...whoNodes(s.player_a), ' vs ', ...whoNodes(s.player_b));
        const stTxt = { waiting: 'Waiting for confirmation', confirmed: 'Confirmed: adding to standings', approved: 'Approved by organizer: adding to standings', disputed: 'Disputed: organizer decides' }[c.status];
        const pill = mk('span', 'tt-pill' + (c.status === 'confirmed' || c.status === 'approved' ? ' active' : ''), stTxt);
        if (c.status === 'disputed') { pill.style.color = 'var(--color-warn)'; pill.style.borderColor = 'var(--color-warn)'; }
        top.append(title, pill);
        const sub = mk('div', 'sub');
        sub.append(mark('t_suggest', w, 'winner', steamOr(s.winner), 'b'), ' won · ', mark('t_suggest', w, 'civ_a', s.civ_a, 'span'), ' vs ', mark('t_suggest', w, 'civ_b', s.civ_b, 'span'),
          ' · ', mark('t_suggest', w, 'map', s.map, 'span'), ' · ', mark('t_suggest', w, 'duration_min', d3.format('.0f')(s.duration_min), 'span'), ' min · ',
          d3.utcFormat('%b %-d, %H:%M UTC')(new Date(s.started)), ` · ${s.type}`);
        const votes = mk('div', 'sub');
        const v = (ans) => (ans === 'yes' ? '✓ confirmed' : ans === 'no' ? '✕ says it wasn’t a tournament game' : 'waiting');
        votes.textContent = `${steamOr(s.player_a)}: ${v(c.a)} · ${steamOr(s.player_b)}: ${v(c.b)}${c.o ? ` · Organizer: ${c.o === 'yes' ? 'approved' : 'rejected'}` : ''}`;
        const actions = mk('div', 'tt-btns');
        const side = ME.player === s.player_a ? 'a' : ME.player === s.player_b ? 'b' : '';
        const can = ME.db && ME.canWrite !== false;
        if (side && can && c.status !== 'confirmed' && c.status !== 'approved') {
          actions.append(btn(c[side] === 'yes' ? '✓ You confirmed' : 'Yes, it counts', () => vote(s, side, 'yes'), c[side] === 'yes' ? '' : 'primary'),
            btn(c[side] === 'no' ? '✕ You said no' : 'Not a tournament game', () => vote(s, side, 'no')));
        }
        const org = window.TT_ORG ? TT_ORG.canRun(s.tournament_id) : ME.owner;
        if (org && can && c.status !== 'confirmed' && c.status !== 'approved') {
          actions.append(btn('Approve as organizer', () => vote(s, 'org', 'yes'), side ? '' : 'primary'), btn('Reject', () => vote(s, 'org', 'no')));
        }
        actions.append(extLinks(s.match_id));
        li.append(top, sub, votes, actions);
        return li;
      });
      if (!items.length) {
        const li = mk('li');
        li.append(mk('div', 'sub', 'Nothing to confirm. When two players in this tournament play a 1v1 that fills an open game, it shows up here within a few minutes.'));
        items.push(li);
      }
      list.replaceChildren(...items);
      const note = el('confirm-note');
      const base = 'Online 1v1 games between two players in this tournament that fill an open slot. A game counts once both players confirm it (or the organizer approves it).';
      const who2 = !ME.db || ME.confErr ? ' Confirming isn’t set up on this site yet.' : ME.canWrite === false ? ' Sign in (top right) to confirm your games.' : !ME.player ? ' Set “I’m” to yourself to confirm your games.' : '';
      note.textContent = base + who2 + (confirmMsg ? ' ' + confirmMsg : '');
    }

    // up next / latest
    const nx = el('home-next'), lt = el('home-latest');
    if (md.status === 'error') { failed(nx); failed(lt); }
    else if (md.status === 'ok') {
      const nextItems = open.slice(0, 6).map((m) => {
        const li = mk('li');
        const r = mk('div', 'row');
        const l = mk('div');
        l.append(mk('b', '', `Game ${m.game}`), ' · ', ...whoNodes(m.player_a), ' vs ', ...whoNodes(m.player_b));
        r.append(l, mk('span', 'tt-pill', (m.player_a === ME.player || m.player_b === ME.player) ? 'You' : m.stage));
        li.append(r);
        return li;
      });
      nx.replaceChildren(...(nextItems.length ? nextItems : [mk('li', 'sub', 'No open games in this tournament.')]));
      const lastItems = doneM.slice(0, 6).map((m) => {
        const li = mk('li');
        const w = { tournament_id: m.tournament_id, game: m.game };
        const loser = m.winner === m.player_a ? m.player_b : m.player_a;
        const r = mk('div', 'row');
        const l = mk('div');
        l.append(mark('matches', w, 'winner', steamOr(m.winner), 'b'), ' beat ', ...whoNodes(loser));
        r.append(l, mk('span', 'tt-pill', `Game ${m.game}`));
        const sub = mk('div', 'sub', [m.winner === m.player_a ? m.civ_a : m.civ_b, 'vs', m.winner === m.player_a ? m.civ_b : m.civ_a].join(' ') + ` · ${m.map || ''}${m.duration_min ? ` · ${d3.format('.0f')(m.duration_min)} min` : ''}`);
        li.append(r, sub);
        if (m.match_id) {
          li.classList.add('click');
          li.style.cursor = 'pointer';
          li.addEventListener('click', () => { dash.setParams({ m: String(m.match_id) }); show('review', true); });
        }
        return li;
      });
      lt.replaceChildren(...(lastItems.length ? lastItems : [mk('li', 'sub', 'No results yet.')]));
    }

    // standings
    const st = dash.data('standings');
    const t = el('home-standings');
    if (st.status === 'ok') fillTable(t, strows, [
      { field: 'rank', label: '#', num: true },
      { field: 'player', label: 'Player', node: (v) => who(v) },
      { field: 'wins', label: 'Wins', num: true },
      { field: 'losses', label: 'Losses', num: true },
      { field: 'remaining', label: 'Left', num: true },
    ], ['tournament_id', 'player'], { emptyText: 'No players yet.', onClick: (r) => { dash.setParams({ pp: r.player }); show('profiles', true); }, selected: (r) => r.player === ME.player });
    else if (st.status === 'error') failed(t.tBodies[0]);
  }

  // ---------------------------------------------------------------- head to head
  const hhA = el('hh-a'), hhB = el('hh-b'), hhPeriod = el('hh-period');
  hhA.addEventListener('change', () => dash.setParams({ ha: hhA.value }));
  hhB.addEventListener('change', () => dash.setParams({ hb: hhB.value }));
  hhPeriod.replaceChildren(...PERIODS.map((s) => {
    const b = mk('button', 'tt-chip', s);
    b.type = 'button'; b.dataset.period = s;
    b.addEventListener('click', () => dash.setParams({ hp: s }));
    return b;
  }));
  function drawRivals(names) {
    if (!names.length) return;
    const a = names.includes(P().ha) ? P().ha : names.includes(ME.player) ? ME.player : names[0];
    const others = names.filter((n) => n !== a);
    const b = others.includes(P().hb) ? P().hb : others[0];
    const period = PERIODS.includes(P().hp) ? P().hp : 'All time';
    const opt = (n) => new Option(steam.get(n) ? `${steam.get(n)} (${n})` : n, n);
    if (document.activeElement !== hhA) { hhA.replaceChildren(...names.map(opt)); hhA.value = a; }
    if (document.activeElement !== hhB) { hhB.replaceChildren(...others.map(opt)); hhB.value = b; }
    hhPeriod.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.period === period)));
    const w = { a, b, period };
    const rv = dash.data('rivals');
    const row = rv.status === 'ok' ? rv.data.find((r) => r.a === a && r.b === b && r.period === period) : null;
    const set = (id, nodes) => el(id).replaceChildren(...nodes);
    if (rv.status === 'error') ['hh-record', 'hh-teamvs', 'hh-with', 'hh-last'].forEach((id) => set(id, ['—']));
    else if (row) {
      set('hh-record', [mark('rivals', w, 'wins', num(row.wins), 'span'), ' – ', mark('rivals', w, 'losses', num(row.losses), 'span')]);
      set('hh-rate', row.games ? [steamOr(a), ' wins ', mark('rivals', w, 'win_rate', pct(row.win_rate), 'span'), ' of ', mark('rivals', w, 'games', num(row.games), 'span'), ' 1v1s'] : ['No 1v1s against each other in this period']);
      set('hh-teamvs', [mark('rivals', w, 'team_vs_games', num(row.team_vs_games), 'span')]);
      set('hh-teamvs-s', row.team_vs_games ? [steamOr(a), '’s side won ', mark('rivals', w, 'team_vs_wins', num(row.team_vs_wins), 'span')] : []);
      set('hh-with', [mark('rivals', w, 'with_games', num(row.with_games), 'span')]);
      set('hh-with-s', row.with_games ? ['Won ', mark('rivals', w, 'with_wins', num(row.with_wins), 'span'), ' together (', pct(row.with_wins / row.with_games), ')'] : []);
      set('hh-last', row.last_played ? [mark('rivals', w, 'last_played', fmtDay(row.last_played), 'span')] : ['Never']);
    }
    const rateCols2 = (kf, label) => [
      { field: kf, label },
      { field: 'games', label: 'Games', num: true },
      { field: 'wins', label: `${steamOr(a)} won`, num: true },
      { field: 'win_rate', label: 'Win %', num: true, fmt: (v) => pct(v), cls: ratePill },
    ];
    [['hh-maps', 'rival_maps', 'map', 'Map'], ['hh-civs', 'rival_civs', 'civ', `${steamOr(a)}’s civ`]].forEach(([tid2, id, kf, label]) => {
      const d = dash.data(id);
      const t = el(tid2);
      if (d.status === 'ok') fillTable(t, d.data.filter((r) => r.a === a && r.b === b && r.period === period), rateCols2(kf, label), ['a', 'b', 'period', kf], { emptyText: 'No 1v1s against each other in this period.' });
      else if (d.status === 'error') failed(t.tBodies[0]);
    });
    const h = dash.data('history');
    const gt = el('hh-games');
    if (h.status === 'ok') {
      const bRows = new Map(h.data.filter((r) => r.player === b).map((r) => [String(r.match_id), r]));
      const rows = h.data.filter((r) => r.player === a && periodOk(period, r.started)).filter((r) => {
        const o = bRows.get(String(r.match_id));
        return o && Number(o.won) !== Number(r.won);
      }).sort((x, y) => (x.started < y.started ? 1 : -1)).slice(0, 150);
      fillTable(gt, rows, [
        { field: 'started', label: 'Date', fmt: fmtDay },
        { field: 'type', label: 'Type' },
        { field: 'won', label: `${steamOr(a)}`, fmt: (v) => (Number(v) === 1 ? 'Won' : 'Lost'), cls: (v) => (Number(v) === 1 ? 'win' : 'loss') },
        { field: 'civ', label: `${steamOr(a)}’s civ` },
        { field: 'opp_civ', label: `${steamOr(b)}’s civ`, fmt: (v, r) => (bRows.get(String(r.match_id)) || {}).civ || '' },
        { field: 'map', label: 'Map' },
        { field: 'duration_min', label: 'Min', num: true, fmt: (v) => d3.format('.0f')(v) },
        { field: 'match_id', label: 'Compare', node: (v) => [extLinks(v)] },
      ], ['player', 'match_id'], { emptyText: 'They haven’t played against each other in this period.' });
    } else if (h.status === 'error') failed(gt.tBodies[0]);
  }

  // ---------------------------------------------------------------- profile: seasons and custom ranges
  const crIds = ['cr-a1', 'cr-a2', 'cr-b1', 'cr-b2'];
  const crKeys = { 'cr-a1': 'ca1', 'cr-a2': 'ca2', 'cr-b1': 'cb1', 'cr-b2': 'cb2' };
  const crDefaults = () => {
    const y = new Date().getUTCFullYear();
    return { ca1: `${y}-01-01`, ca2: new Date().toISOString().slice(0, 10), cb1: `${y - 1}-01-01`, cb2: `${y - 1}-12-31` };
  };
  const crVal = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(String(P()[k] || '')) ? P()[k] : crDefaults()[k]);
  crIds.forEach((id) => {
    const inp = el(id);
    inp.addEventListener('change', () => { if (inp.value && inp.validity.valid) dash.setParams({ [crKeys[id]]: inp.value }); });
    inp.addEventListener('blur', () => { inp.value = crVal(crKeys[id]); });
  });
  el('cr-reset').addEventListener('click', () => dash.setParams({ ca1: null, ca2: null, cb1: null, cb2: null }));
  function drawCompare(player, view) {
    const ps = dash.data('p_seasons');
    const t = el('pp-seasons');
    if (ps.status === 'ok') {
      const rows = ps.data.filter((r) => r.player === player).sort((x, y) => (x.kind === y.kind ? (x.start < y.start ? 1 : -1) : x.kind === 'Tournament' ? -1 : 1));
      const chg = (v) => (v == null ? '' : signed(v));
      fillTable(t, rows, [
        { field: 'season', label: 'Season' },
        { field: 'kind', label: 'Type' },
        { field: 'games', label: 'Games', num: true },
        { field: 'win_rate', label: 'Win %', num: true, fmt: (v) => pct(v), cls: ratePill },
        { field: 'avg_minutes', label: 'Avg min', num: true, fmt: one },
        { field: 'top_civ', label: 'Most played civ' },
        { field: 'rating_start', label: '1v1 start', num: true, fmt: (v) => (v == null ? '' : num(v)) },
        { field: 'rating_end', label: '1v1 end', num: true, fmt: (v) => (v == null ? '' : num(v)) },
        { field: 'rating_change', label: 'Change', num: true, fmt: chg, cls: (v) => (v > 0 ? 'win' : v < 0 ? 'loss' : '') },
      ], ['player', 'season'], { emptyText: 'No games yet.' });
    } else if (ps.status === 'error') failed(t.tBodies[0]);

    crIds.forEach((id) => { const inp = el(id); if (document.activeElement !== inp) inp.value = crVal(crKeys[id]); });
    const h = dash.data('history'), scoped = dash.data('h_scoped');
    const rt = el('pp-range');
    if (h.status === 'error') { failed(rt.tBodies[0]); return; }
    if (h.status !== 'ok' || scoped.status !== 'ok') return;
    const sc = new Map(scoped.data.filter((r) => r.player === player).map((r) => [r.match_id, r.scopes.split('|')]));
    const mine = h.data.filter((r) => r.player === player && (sc.get(String(r.match_id)) || []).includes(view)).sort((x, y) => (x.started < y.started ? -1 : 1));
    const stats = (from, to) => {
      const g = mine.filter((r) => r.started.slice(0, 10) >= from && r.started.slice(0, 10) <= to);
      const wins = g.filter((r) => Number(r.won) === 1).length;
      const top = (k) => { const m = new Map(); g.forEach((r) => { if (r[k]) m.set(r[k], (m.get(r[k]) || 0) + 1); }); const e = [...m.entries()].sort((x, y) => y[1] - x[1])[0]; return e ? `${e[0]} (${e[1]})` : '—'; };
      const rated = g.filter((r) => r.type === '1v1 ranked' && r.rating != null);
      return {
        games: g.length, wins, rate: g.length ? wins / g.length : null,
        mins: g.length ? g.reduce((s, r) => s + Number(r.duration_min), 0) / g.length : null,
        civ: top('civ'), map: top('map'),
        change: rated.length ? Number(rated[rated.length - 1].rating) - Number(rated[0].rating) : null,
        peak: rated.length ? Math.max(...rated.map((r) => Number(r.rating))) : null,
      };
    };
    const A = stats(crVal('ca1'), crVal('ca2')), B = stats(crVal('cb1'), crVal('cb2'));
    const dNum = (x, y, f) => (x == null || y == null ? '' : (x - y > 0 ? '+' : '') + f(x - y));
    const metrics = [
      ['Games', A.games, B.games, num, (x, y) => dNum(x, y, num)],
      ['Wins', A.wins, B.wins, num, (x, y) => dNum(x, y, num)],
      ['Win rate', A.rate, B.rate, (v) => (v == null ? '—' : pct(v)), (x, y) => (x == null || y == null ? '' : `${x - y > 0 ? '+' : ''}${Math.round((x - y) * 100)} pts`)],
      ['Average game (min)', A.mins, B.mins, (v) => (v == null ? '—' : one(v)), (x, y) => dNum(x, y, one)],
      ['Most played civ', A.civ, B.civ, (v) => v, () => ''],
      ['Most played map', A.map, B.map, (v) => v, () => ''],
      ['1v1 rating change', A.change, B.change, (v) => (v == null ? '—' : signed(v)), () => ''],
      ['Peak 1v1 rating', A.peak, B.peak, (v) => (v == null ? '—' : num(v)), (x, y) => dNum(x, y, num)],
    ];
    const lab = (k1, k2) => `${fmtDay(crVal(k1))} – ${fmtDay(crVal(k2))}`;
    rt.tHead.replaceChildren((() => { const tr = mk('tr'); [['', ''], [`A: ${lab('ca1', 'ca2')}`, 'num'], [`B: ${lab('cb1', 'cb2')}`, 'num'], ['A vs B', 'num']].forEach(([x, c]) => { const th = mk('th', c, x); tr.append(th); }); return tr; })());
    rt.tBodies[0].replaceChildren(...metrics.map(([label, a, b, f, d]) => {
      const tr = mk('tr');
      const diff = d(a, b);
      tr.append(mk('td', '', label), mk('td', 'num', f(a)), mk('td', 'num', f(b)), mk('td', 'num ' + (diff.startsWith('+') ? 'win' : /^[-−]/.test(diff) ? 'loss' : ''), diff));
      return tr;
    }));
  }

  function draw() {
    const ts = dash.data('tournaments');
    const pl = dash.data('players');
    steam = new Map(pl.status === 'ok' ? pl.data.filter((r) => r.steam_name && r.steam_name !== 'TBD').map((r) => [r.player, r.steam_name]) : []);
    const tlist = ts.status === 'ok' ? ts.data : [];
    const tid = currentTournament(tlist);
    const T = tlist.find((t) => t.tournament_id === tid);
    if (document.activeElement !== tPick) {
      const groups = ['Active', 'Upcoming', 'Completed'].map((s) => {
        const og = document.createElement('optgroup'); og.label = s;
        tlist.filter((t) => (t.status || 'Active') === s).sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
          .forEach((t) => og.appendChild(new Option(t.name, t.tournament_id)));
        return og;
      }).filter((og) => og.children.length);
      tPick.replaceChildren(...groups);
      if (tid) tPick.value = tid;
    }
    const stat = el('t-status');
    stat.textContent = T ? T.status : '';
    stat.className = 'tt-pill' + (T && T.status === 'Active' ? ' active' : '');
    stat.hidden = !T;
    if (T) Object.assign(stat.dataset, { source: 'tournaments', where: `tournament_id=${enc(tid)}`, field: 'status' });
    el('t-dates').textContent = T ? [T.start_date && `Started ${d3.utcFormat('%b %-d, %Y')(new Date(T.start_date))}`, T.end_date && `ended ${d3.utcFormat('%b %-d, %Y')(new Date(T.end_date))}`].filter(Boolean).join(', ') : '';

    // headline
    const sum = dash.data('t_summary');
    const srow = sum.status === 'ok' ? sum.data.find((r) => r.tournament_id === tid) : null;
    document.querySelectorAll('#headline [data-k]').forEach((n) => {
      if (sum.status === 'ok' || sum.status === 'error') n.classList.remove('dash-skeleton');
      Object.assign(n.dataset, { source: 't_summary', where: `tournament_id=${enc(tid || '')}`, field: n.dataset.k });
      const v = srow ? srow[n.dataset.k] : null;
      n.textContent = v == null ? '—' : num(v);
    });
    const st = dash.data('standings');
    const strows = st.status === 'ok' ? st.data.filter((r) => r.tournament_id === tid) : [];
    const take = el('takeaway');
    take.replaceChildren();
    if (T && srow) {
      take.append(mark('tournaments', { tournament_id: tid }, 'name', T.name, 'span'), ': ',
        mark('t_summary', { tournament_id: tid }, 'played', num(srow.played), 'span'), ' of ',
        mark('t_summary', { tournament_id: tid }, 'total', num(srow.total), 'span'), ' pool play games played');
      const lead = strows[0];
      if (lead && lead.played > 0) take.append('; ', ...who(lead.player).map((n) => { if (n.nodeType) return n; return document.createTextNode(n); }), ' leads with ',
        mark('standings', { tournament_id: tid, player: lead.player }, 'wins', num(lead.wins), 'span'), ' wins');
      take.append('.');
    } else take.textContent = ts.status === 'ok' && !tlist.length ? 'No tournaments yet.' : '—';

    const names = pl.status === 'ok' ? pl.data.map((r) => r.player) : [];
    if (document.activeElement !== mePick && pl.status === 'ok') {
      mePick.replaceChildren(new Option('Choose…', ''), ...names.map((n) => new Option(steam.get(n) ? `${steam.get(n)} (${n})` : n, n)));
      mePick.value = names.includes(ME.player) ? ME.player : '';
    }
    if (current === 'home') drawHome(tid, names, strows);
    if (current === 'rivals') drawRivals(names);

    if (current === 'standings') {
      const t = el('standings-table');
      if (st.status === 'ok') fillTable(t, strows, [
        { field: 'rank', label: '#', num: true },
        { field: 'player', label: 'Player', node: (v) => who(v) },
        { field: 'played', label: 'Played', num: true },
        { field: 'wins', label: 'Wins', num: true },
        { field: 'losses', label: 'Losses', num: true },
        { field: 'win_pct', label: 'Win %', num: true, fmt: (v) => (v == null ? '' : pct(v)) },
        { field: 'remaining', label: 'Left', num: true },
      ], ['tournament_id', 'player'], { emptyText: 'No players in this tournament yet.', onClick: (r) => { dash.setParams({ pp: r.player }); show('profiles', true); } });
      else if (st.status === 'error') failed(t.tBodies[0]);
      const h = dash.data('h2h');
      const ht = el('h2h-table');
      if (h.status === 'ok') {
        const rows = h.data.filter((r) => r.tournament_id === tid);
        const opps = rows.map((r) => r.player);
        fillTable(ht, rows, [{ field: 'player', label: 'Player', node: (v) => who(v) }, ...opps.map((o) => ({
          field: o, label: o, headNode: () => who(o), cls: (v) => (v === 'W' ? 'win' : v === 'L' ? 'loss' : ''),
        }))], ['tournament_id', 'player']);
      } else if (h.status === 'error') failed(ht.tBodies[0]);
    }

    if (current === 'playoffs') {
      const b = dash.data('bracket');
      const box = el('bracket');
      el('bracket-note').textContent = T ? `${T.advance && Number(T.advance) < strows.length ? `Top ${T.advance} advance` : 'Everyone advances'}, seeded by pool play standings. Every series is best of ${T.best_of || 3}. Players fill in when pool play ends.` : '';
      if (b.status === 'error') failed(box);
      else if (b.status !== 'ok') { box.classList.add('dash-skeleton'); box.replaceChildren(); }
      else {
        box.classList.remove('dash-skeleton');
        const series = b.data.filter((s) => s.tournament_id === tid);
        const rounds = [...new Set(series.sort((x, y) => x.round_no - y.round_no).map((s) => s.round))];
        if (!series.length) box.replaceChildren(empty('No playoff bracket for this tournament.'));
        else box.replaceChildren(...rounds.map((round) => {
          const col = mk('div', 'tt-round');
          col.appendChild(mk('div', 'tt-round-name', round));
          series.filter((s) => s.round === round).forEach((s) => {
            const card = mk('div', 'tt-series');
            card.id = `series-${s.series}`;
            const wh = { tournament_id: tid, series: s.series };
            [['high', s.player_high, s.wins_high, s.high_label], ['low', s.player_low, s.wins_low, s.low_label]].forEach(([side, player, wins, label]) => {
              const slot = mk('div', 'tt-slot' + (s.winner && s.winner === player ? ' won' : ''));
              const left = mk('div');
              left.appendChild(mk('span', 'seed', label));
              const nameBox = mk('span', 'name');
              if (!player) nameBox.textContent = 'TBD';
              else nameBox.appendChild(mark('bracket', wh, `player_${side}`, steamOr(player), 'span'));
              left.appendChild(nameBox);
              slot.appendChild(left);
              slot.appendChild(mark('bracket', wh, `wins_${side}`, String(wins), 'span'));
              card.appendChild(slot);
            });
            const g3 = T && T.game3_map ? `, deciding game ${T.game3_map}` : '';
            card.appendChild(mk('div', 'tt-picks', s.player_high && s.player_low
              ? `Map picks: game 1 ${steamOr(s.player_high)}, game 2 ${steamOr(s.player_low)}${g3}`
              : `Map picks: game 1 higher seed, game 2 lower seed${g3}`));
            card.appendChild(mark('bracket', wh, 'status', s.status, 'div'));
            card.lastChild.className = 'tt-picks';
            col.appendChild(card);
          });
          return col;
        }));
      }
    }

    if (current === 'schedule') {
      const m = dash.data('matches');
      const t = el('schedule-table');
      const rl = dash.data('review_list');
      const analyzed = new Set(rl.status === 'ok' ? rl.data.map((r) => r.match_id) : []);
      if (m.status === 'ok') fillTable(t, m.data.filter((r) => r.tournament_id === tid), [
        { field: 'game', label: 'Game', num: true },
        { field: 'stage', label: 'Stage' },
        { field: 'series_game', label: 'Series game', num: true },
        { field: 'player_a', label: 'Player', node: (v) => who(v) },
        { field: 'player_b', label: 'Opponent', node: (v) => who(v) },
        { field: 'status', label: 'Status' },
        { field: 'winner', label: 'Winner', node: (v) => who(v) },
        { field: 'map', label: 'Map' },
        { field: 'civ_a', label: 'Player civ' },
        { field: 'civ_b', label: 'Opponent civ' },
        { field: 'duration_min', label: 'Minutes', num: true },
        { field: 'match_id', label: 'Replay', fmt: (v) => (v && analyzed.has(String(v)) ? 'Review ›' : '') },
      ], ['tournament_id', 'game'], {
        emptyText: 'No games scheduled yet.',
        clickable: (r) => r.match_id && analyzed.has(String(r.match_id)),
        onClick: (r) => { dash.setParams({ m: String(r.match_id) }); show('review', true); },
      });
      else if (m.status === 'error') failed(t.tBodies[0]);
    }

    if (current === 'civs-maps') {
      chart(el('civ-chart'), 'civ_stats', 'No approved games yet. Civ win rates appear after the first result.', (rows) => rows.filter((r) => r.tournament_id === tid), (rows) => {
        bars(el('civ-chart'), rows, 'civ', 'win_rate', pct, 1, (d) => [`Win rate ${pct(d.win_rate)}`, `${d.wins} wins in ${d.games} games`]);
      });
      chart(el('map-chart'), 'map_stats', 'No approved games yet. Maps appear after the first result.', (rows) => rows.filter((r) => r.tournament_id === tid), (rows) => {
        bars(el('map-chart'), rows, 'map', 'games', num, d3.max(rows, (r) => r.games), (d) => [`${d.games} games`]);
      });
    }

    if (current === 'format') {
      el('format-note').textContent = T && T.format ? T.format + '.' : 'How pool play and the playoffs work.';
      const rl = dash.data('rules');
      const ul = el('rules-list');
      if (rl.status === 'error') failed(ul);
      else if (rl.status === 'ok') {
        const rows = rl.data.filter((r) => r.tournament_id === tid).sort((a, b) => a.order - b.order);
        ul.replaceChildren(...(rows.length ? rows.map((r) => {
          const li = document.createElement('li');
          const w = { tournament_id: tid, order: r.order };
          li.append(mark('rules', w, 'label', `${r.label}:`), ' ', mark('rules', w, 'text', r.text, 'span'));
          return li;
        }) : [mk('li', 'tt-empty', 'No rules written for this tournament yet.')]));
      }
      const cp = dash.data('civ_pool');
      const box = el('civ-pool');
      if (cp.status === 'error') failed(box);
      else if (cp.status !== 'ok') { box.classList.add('dash-skeleton'); box.replaceChildren(); }
      else {
        box.classList.remove('dash-skeleton');
        const rows = cp.data.filter((r) => r.tournament_id === tid);
        if (!rows.length) box.replaceChildren(empty('No civ pools set for this tournament. Every civ is allowed.'));
        else {
          const ps = [...new Set(rows.map((r) => r.player))];
          const count = d3.rollup(rows, (v) => v.length, (r) => r.civ);
          box.replaceChildren(...ps.map((name) => {
            const group = mk('div', 'tt-civ-group');
            const head = mk('div', 'tt-civ-who');
            head.append(...who(name));
            const chips = mk('div', 'tt-civ-chips');
            rows.filter((r) => r.player === name).forEach((r) => {
              const s = mark('civ_pool', { tournament_id: tid, player: r.player, civ: r.civ }, 'civ', r.civ, 'span');
              s.className = 'tt-civ' + (count.get(r.civ) === ps.length ? ' shared' : '');
              chips.appendChild(s);
            });
            group.append(head, chips);
            return group;
          }));
        }
      }
      const t = el('seed-table');
      if (st.status === 'ok') fillTable(t, strows, [
        { field: 'rank', label: 'Seed', num: true },
        { field: 'player', label: 'Player', node: (v) => who(v) },
        { field: 'wins', label: 'Wins', num: true },
        { field: 'losses', label: 'Losses', num: true },
      ], ['tournament_id', 'player']);
      else if (st.status === 'error') failed(t.tBodies[0]);
    }

    if (current === 'profiles') drawProfiles(names);
    if (current === 'review') drawReview(names);

    // data check badge in the header
    const dc = dash.data('data_check');
    const badge = el('check-badge');
    if (dc.status === 'ok' && dc.data.length) {
      const fails = dc.data.filter((x) => x.status === 'fail').length, warns = dc.data.filter((x) => x.status === 'warn').length;
      const at = dc.data[0].checked_at; const hrs = at ? Math.max(0, Math.round((Date.now() - new Date(at)) / 36e5)) : null;
      badge.hidden = false;
      const stale = hrs != null && hrs > 12;
      badge.textContent = stale ? `⚠ Not updated for ${hrs} h` : `${fails ? `⚠ ${fails} data check${fails > 1 ? 's' : ''} failed` : warns ? `${warns} data warning${warns > 1 ? 's' : ''}` : `✓ Data checked: all ${dc.data.length} checks passed`}${hrs != null ? ` · ${hrs} h ago` : ''}`;
      badge.className = 'tt-pill' + (fails || warns || stale ? '' : ' active');
      badge.style.color = fails || stale ? 'var(--color-bad)' : warns ? 'var(--color-warn)' : '';
      badge.style.borderColor = fails || stale ? 'var(--color-bad)' : warns ? 'var(--color-warn)' : '';
      badge.style.cursor = 'pointer';
    } else badge.hidden = true;

    if (current === 'check') {
      const t = el('check-table');
      if (dc.status === 'ok') {
        const order = { fail: 0, warn: 1, pass: 2 };
        fillTable(t, dc.data.slice().sort((x, y) => order[x.status] - order[y.status]), [
          { field: 'status', label: 'Result', fmt: (v) => (v === 'pass' ? '✓ Pass' : v === 'warn' ? '! Check' : '✕ Fail'), cls: (v) => (v === 'pass' ? 'win' : v === 'fail' ? 'loss' : '') },
          { field: 'check', label: 'Check', wrap: true },
          { field: 'area', label: 'Area' },
          { field: 'result', label: 'Found', wrap: true },
          { field: 'detail', label: 'Details', wrap: true },
        ], 'check', { emptyText: 'The first data check runs with the next update.' });
        const at = dc.data[0] && dc.data[0].checked_at;
        el('check-note').textContent = `After every update the job re-checks the dashboard against AoE2 Companion (a separate site that records the same games) and against itself.${at ? ` Last checked ${d3.utcFormat('%b %-d, %H:%M UTC')(new Date(at))}.` : ''}`;
      } else if (dc.status === 'error') failed(t.tBodies[0]);
      const h = dash.data('history');
      const st2 = el('spot-table');
      if (h.status === 'ok') {
        const rows = h.data.slice().sort((x, y) => (x.started < y.started ? 1 : -1)).slice(0, 12);
        const linkCell = (mid) => { const box = mk('span', 'tt-links'); [['AoE2 Companion', `https://www.aoe2companion.com/matches/${enc(mid)}`], ['AoE2 Insights', `https://www.aoe2insights.com/match/${enc(mid)}/`]].forEach(([n, u]) => { const a = mk('a', '', n); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.append(a); }); return [box]; };
        fillTable(st2, rows, [
          { field: 'started', label: 'Date', fmt: (v) => d3.utcFormat('%b %-d, %H:%M')(new Date(v)) },
          { field: 'player', label: 'Player', node: (v) => who(v) },
          { field: 'type', label: 'Type' },
          { field: 'civ', label: 'Civ' },
          { field: 'won', label: 'Result', fmt: (v) => (Number(v) === 1 ? 'Win' : 'Loss'), cls: (v) => (Number(v) === 1 ? 'win' : 'loss') },
          { field: 'rating_diff', label: 'Rating ±', num: true, fmt: (v) => (v == null ? '' : signed(v)) },
          { field: 'map', label: 'Map' },
          { field: 'match_id', label: 'Compare', node: (v) => linkCell(v) },
        ], ['player', 'match_id']);
      } else if (h.status === 'error') failed(st2.tBodies[0]);
    }

    if (current === 'all') {
      const ov = dash.data('t_overview');
      const t = el('all-table');
      if (ov.status === 'ok') fillTable(t, ov.data.slice().sort((a, b) => (a.start_date < b.start_date ? 1 : -1)), [
        { field: 'name', label: 'Tournament' },
        { field: 'status', label: 'Status' },
        { field: 'start_date', label: 'Start', fmt: (v) => (v ? d3.utcFormat('%b %-d, %Y')(new Date(v)) : '') },
        { field: 'end_date', label: 'End', fmt: (v) => (v ? d3.utcFormat('%b %-d, %Y')(new Date(v)) : '') },
        { field: 'players', label: 'Players', num: true },
        { field: 'played', label: 'Games played', num: true },
        { field: 'total', label: 'Pool games', num: true },
        { field: 'champion', label: 'Champion', node: (v) => who(v) },
        { field: 'leader', label: 'Pool leader', node: (v) => who(v) },
      ], 'tournament_id', { emptyText: 'No tournaments yet.', onClick: (r) => { dash.setParams({ t: r.tournament_id }); show('standings', true); }, selected: (r) => r.tournament_id === tid });
      else if (ov.status === 'error') failed(t.tBodies[0]);
      const pt = el('players-table');
      if (pl.status === 'ok') {
        fillTable(pt, pl.data, [
          { field: 'player', label: 'Player' },
          { field: 'steam_name', label: 'Steam name' },
          { field: 'profile_id', label: 'Profile ID' },
        ], 'player', { onClick: (r) => { dash.setParams({ pp: r.player }); show('profiles', true); } });
      } else if (pl.status === 'error') failed(pt.tBodies[0]);
    }
  }

  dash.onData(draw);
  const named = location.hash.slice(1);
  show(tabs.some((b) => b.dataset.tab === named) ? named : named === 'how' ? 'profiles' : 'home', false);
  if (named === 'how') el('how').scrollIntoView();
})();
