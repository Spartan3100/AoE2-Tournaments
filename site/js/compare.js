// Players > Compare (head to head). render.js calls TT_COMPARE.draw(ctx) from its draw() while the page is open.
// Top: one player (A) against every other tracked player. Below: A and B side by side: their 1v1s, numbers, ratings,
// when they meet, team games together and against each other, and a scouting report on B from analysed replays.
// URL params: ha (A), hb (B), hp (period), hs (game type for the scouting report).
// Teammates and opponents are told apart the same way as the `rivals` calc: two tracked players' rows in the same
// game with the same result are teammates, opposite results opponents; a 1v1 is players_n === 2.
(() => {
  const PERIODS = window.TT_PERIODS || ['All time', 'Last year', 'Last 6 months'];
  const PERIOD_DAYS = { 'Last year': 365, 'Last 6 months': 183 };
  const SCOUT = [['All games', 'All games'], ['Ranked 1v1', '1v1 ranked'], ['Ranked team', 'Team ranked']]; // scope, label
  const pct = d3.format('.0%');
  const num = d3.format(',');
  const one = d3.format('.1f');
  const el = (id) => document.getElementById(id);
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs, parent) => { const n = document.createElementNS(SVG, tag); Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v)); if (parent) parent.appendChild(n); return n; };
  const won = (r) => Number(r.won) === 1;
  const is1v1 = (r) => Number(r.players_n) === 2;
  const inPeriod = (period, started) => period === 'All time' || (Date.now() - Date.parse(started)) / 864e5 <= PERIOD_DAYS[period];
  const suffix = (period) => (period === 'All time' ? '' : ' · ' + period);
  const mins = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : `${one(Number(v))} min`);
  const wl = (w, g) => `${num(w)}–${num(g - w)}`;
  let C = null; // what render.js passes in
  let Q = []; // chart draws, run once every block is in place (a grid measures its columns only then)
  const later = (fn) => Q.push(fn);

  const empty = (msg) => mk('p', 'tt-empty cmp-empty', msg);
  const bodyMsg = (msg) => { const tr = mk('tr'); const td = mk('td', 'tt-empty', msg); td.colSpan = 7; tr.appendChild(td); return tr; };
  const name = (n) => (C ? C.steamOr(n) : n);
  const dayOf = (v) => (C ? C.fmtDay(v) : String(v).slice(0, 10));
  const whoNodes = (n) => C.who(n).map((x) => (x.nodeType ? x : document.createTextNode(x)));

  // ---------------------------------------------------------------- indexes over history (rebuilt when the data changes)
  let IDX = { h: null };
  function index(h) {
    if (IDX.h === h) return IDX;
    const byPlayer = new Map(), byMatch = new Map();
    h.forEach((r) => {
      if (!byPlayer.has(r.player)) byPlayer.set(r.player, []);
      byPlayer.get(r.player).push(r);
      const k = String(r.match_id);
      if (!byMatch.has(k)) byMatch.set(k, []);
      byMatch.get(k).push(r);
    });
    byPlayer.forEach((rows) => rows.sort((x, y) => (x.started < y.started ? -1 : 1)));
    IDX = { h, byPlayer, byMatch };
    return IDX;
  }
  // every game two tracked players were both in, oldest first: { r: a's row, o: b's row, kind: '1v1' | 'vs' | 'with' }
  function together(a, b, period) {
    return (IDX.byPlayer.get(a) || []).filter((r) => inPeriod(period, r.started)).map((r) => {
      const o = (IDX.byMatch.get(String(r.match_id)) || []).find((x) => x.player === b);
      if (!o) return null;
      return { r, o, kind: Number(r.won) === Number(o.won) ? 'with' : is1v1(r) ? '1v1' : 'vs' };
    }).filter(Boolean);
  }
  const ratingNow = (p) => {
    const rated = (IDX.byPlayer.get(p) || []).filter((r) => r.type === '1v1 ranked' && r.rating != null && r.rating !== '' && !window.TT_QUICK_PLAY(r));
    return rated.length ? Number(rated[rated.length - 1].rating) : null;
  };

  // ---------------------------------------------------------------- tooltips: hover with a mouse, tap on a phone
  const tips = new Set();
  function tipFor(box) {
    let t = box.querySelector(':scope > .tt-tip');
    if (!t) { t = mk('div', 'tt-tip cmp-tip'); t.hidden = true; t.setAttribute('role', 'status'); box.appendChild(t); }
    tips.add(t);
    return t;
  }
  function showTip(box, evt, lines) {
    const t = tipFor(box);
    t.replaceChildren(...lines.map((l, i) => {
      const d = mk('div', i === 0 ? 'cmp-tip-h' : '');
      if (Array.isArray(l)) d.append(mk('span', 'k', l[0] + ' '), mk('b', '', l[1]));
      else d.textContent = l;
      return d;
    }));
    t.hidden = false;
    const br = box.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let x = evt.clientX - br.left + 12;
    if (x + tw > br.width) x = Math.max(0, evt.clientX - br.left - tw - 12);
    if (x + tw > br.width) x = Math.max(0, br.width - tw);
    let y = evt.clientY - br.top - th - 10;
    if (y < 0) y = evt.clientY - br.top + 16;
    t.style.left = `${x}px`; t.style.top = `${y}px`;
  }
  const hideTips = () => tips.forEach((t) => { t.hidden = true; });
  // bind a hit area: lines(evt) gives the tooltip text
  function hover(node, box, lines) {
    node.addEventListener('pointermove', (e) => { const l = lines(e); if (l) showTip(box, e, l); });
    node.addEventListener('pointerdown', (e) => { const l = lines(e); if (l) showTip(box, e, l); });
    node.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTips(); });
    node.addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', hideTips);

  // ---------------------------------------------------------------- charts (inline SVG)
  // Horizontal bars. rows: { label, segs: [{ v, cls }], text, tip: [lines] }. Bar length = sum of segs.
  function bars(box, rows, opt = {}) {
    box.replaceChildren();
    if (!rows.length) { box.appendChild(empty(opt.emptyText || 'Nothing in this view.')); return; }
    const W = box.clientWidth;
    if (!W) return;
    const narrow = W < 460;
    const rowH = narrow ? 40 : 32, H = rows.length * rowH + (opt.axis ? 22 : 4);
    const labW = Math.min(narrow ? W * 0.36 : W * 0.32, 170), txtW = opt.textW || (narrow ? 78 : 96);
    const x0 = labW + 8, x1 = Math.max(x0 + 30, W - txtW - 6);
    const max = opt.max || Math.max(1, ...rows.map((r) => r.segs.reduce((s, g) => s + g.v, 0)));
    const sx = (v) => ((x1 - x0) * v) / max;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': opt.aria || '' });
    const maxCh = Math.max(4, Math.floor(labW / 6.6));
    rows.forEach((r, i) => {
      const g = sv('g', { transform: `translate(0,${i * rowH})` }, svg);
      const lab = String(r.label);
      const lt = sv('text', { x: 0, y: rowH / 2 + 4, class: 'cmp-lab' }, g);
      lt.textContent = lab.length > maxCh ? lab.slice(0, maxCh - 1) + '…' : lab;
      sv('rect', { x: x0, y: rowH / 2 - 6, width: x1 - x0, height: 12, rx: 3, class: 'cmp-track' }, g);
      let x = x0;
      r.segs.forEach((s) => {
        const w = sx(s.v);
        if (w > 0) sv('rect', { x, y: rowH / 2 - 6, width: Math.max(1, w), height: 12, rx: 0, class: s.cls }, g);
        x += w;
      });
      const vt = sv('text', { x: W, y: rowH / 2 + 4, 'text-anchor': 'end', class: 'cmp-val' }, g);
      vt.textContent = r.text;
      const hit = sv('rect', { x: 0, y: 0, width: W, height: rowH, class: 'cmp-hit' }, g);
      hover(hit, box, () => r.tip);
    });
    if (opt.axis) {
      const y = rows.length * rowH + 4;
      sv('line', { x1: x0, x2: x1, y1: y, y2: y, class: 'cmp-axis' }, svg);
      [0, max / 2, max].forEach((v, i) => {
        const t = sv('text', { x: x0 + sx(v), y: y + 14, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle', class: 'cmp-ax' }, svg);
        t.textContent = opt.axis(v);
      });
    }
    box.appendChild(svg);
  }
  // wins (green) and losses (red) bars from { label, games, wins, extra: [[k, v]] }
  function wlBars(box, rows, opt = {}) {
    bars(box, rows.map((r) => ({
      label: r.label,
      segs: [{ v: r.wins, cls: 'cmp-w' }, { v: r.games - r.wins, cls: 'cmp-l' }],
      text: `${wl(r.wins, r.games)} · ${pct(r.wins / r.games)}`,
      tip: [r.label, ['Games', num(r.games)], ['Won', num(r.wins)], ['Lost', num(r.games - r.wins)], ['Win rate', pct(r.wins / r.games)], ...(r.extra || [])],
    })), { ...opt, aria: opt.aria || 'Games won and lost' });
  }

  // squares, one per game, oldest to newest; green = A won
  function formStrip(box, games, a, b) {
    box.replaceChildren();
    const W = box.clientWidth;
    if (!W || !games.length) return;
    const s = 18, gap = 4, per = Math.max(1, Math.floor((W + gap) / (s + gap)));
    const shown = games.slice(-per * 2);
    const rowsN = Math.ceil(shown.length / per);
    const H = rowsN * (s + gap);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `${shown.length} most recent 1v1s, oldest first` });
    shown.forEach((g, i) => {
      const x = (i % per) * (s + gap), y = Math.floor(i / per) * (s + gap);
      const w = won(g.r);
      sv('rect', { x, y, width: s, height: s, rx: 3, class: w ? 'cmp-w' : 'cmp-l' }, svg);
      const t = sv('text', { x: x + s / 2, y: y + s / 2 + 4, 'text-anchor': 'middle', class: 'cmp-sq' }, svg);
      t.textContent = w ? 'W' : 'L';
      const hit = sv('rect', { x: x - gap / 2, y: y - gap / 2, width: s + gap, height: s + gap, class: 'cmp-hit' }, svg);
      hover(hit, box, () => [dayOf(g.r.started), ['Winner', name(w ? a : b)], ['Map', g.r.map || '—'], [`${name(a)}`, g.r.civ || '—'], [`${name(b)}`, g.o.civ || '—'], ['Length', mins(g.r.duration_min)]]);
    });
    box.appendChild(svg);
  }

  // both players' 1v1 ranked rating over time, their 1v1s against each other marked (green/red = A won/lost)
  function ratingChart(box, a, b, sa, sb, meets) {
    box.replaceChildren();
    const W = box.clientWidth;
    if (!W) return;
    const pts = sa.concat(sb);
    if (!pts.length) { box.appendChild(empty('Neither player has a ranked 1v1 game in this period.')); return; }
    const H = W < 500 ? 230 : 290;
    const m = { l: 50, r: 12, t: 12, b: 34 };
    const times = pts.map((p) => p.t).concat(meets.map((g) => g.t));
    let [t0, t1] = d3.extent(times);
    if (+t0 === +t1) { t0 = new Date(+t0 - 864e5); t1 = new Date(+t1 + 864e5); }
    const x = d3.scaleUtc().domain([t0, t1]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain(d3.extent(pts, (p) => p.v)).nice(5).range([H - m.b, m.t]);
    if (y.domain()[0] === y.domain()[1]) y.domain([y.domain()[0] - 25, y.domain()[1] + 25]);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `1v1 rating over time for ${name(a)} and ${name(b)}` });
    y.ticks(5).forEach((v) => {
      sv('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'cmp-grid' }, svg);
      const t = sv('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'cmp-ax' }, svg);
      t.textContent = num(v);
    });
    sv('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'cmp-axis' }, svg);
    const spanDays = (t1 - t0) / 864e5;
    const tf = spanDays > 300 ? d3.utcFormat('%b %Y') : d3.utcFormat('%b %-d');
    x.ticks(W < 500 ? 3 : 6).forEach((t) => {
      sv('line', { x1: x(t), x2: x(t), y1: H - m.b, y2: H - m.b + 4, class: 'cmp-axis' }, svg);
      const tx = sv('text', { x: x(t), y: H - m.b + 17, 'text-anchor': 'middle', class: 'cmp-ax' }, svg);
      tx.textContent = tf(t);
    });
    const yl = sv('text', { x: -(m.t + (H - m.b - m.t) / 2), y: 11, transform: 'rotate(-90)', 'text-anchor': 'middle', class: 'cmp-ax' }, svg);
    yl.textContent = '1v1 rating';
    meets.forEach((g) => sv('line', { x1: x(g.t), x2: x(g.t), y1: m.t, y2: H - m.b, class: 'cmp-meetline' }, svg));
    const line = d3.line().x((p) => x(p.t)).y((p) => y(p.v)).curve(d3.curveMonotoneX);
    if (sb.length) sv('path', { d: line(sb), class: 'cmp-line cmp-line-b' }, svg);
    if (sa.length) sv('path', { d: line(sa), class: 'cmp-line cmp-line-a' }, svg);
    if (sb.length === 1) sv('circle', { cx: x(sb[0].t), cy: y(sb[0].v), r: 3, class: 'cmp-dot-b' }, svg);
    if (sa.length === 1) sv('circle', { cx: x(sa[0].t), cy: y(sa[0].v), r: 3, class: 'cmp-dot-a' }, svg);
    const asOf = (s, t) => { const i = d3.bisector((p) => p.t).right(s, t) - 1; return i >= 0 ? s[i] : null; };
    meets.forEach((g) => {
      const p = asOf(sa, g.t);
      const cy = g.v != null ? y(g.v) : p ? y(p.v) : H - m.b - 6;
      sv('circle', { cx: x(g.t), cy, r: 5, class: (g.w ? 'cmp-w' : 'cmp-l') + ' cmp-meet' }, svg);
    });
    const cross = sv('line', { x1: 0, x2: 0, y1: m.t, y2: H - m.b, class: 'cmp-cross', visibility: 'hidden' }, svg);
    const hit = sv('rect', { x: m.l, y: m.t, width: Math.max(1, W - m.l - m.r), height: H - m.t - m.b, class: 'cmp-hit cmp-pan' }, svg);
    const all = [...new Set(times.map((t) => +t))].sort((p, q) => p - q);
    hover(hit, box, (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const t = x.invert(px);
      const i = d3.bisectLeft(all, +t);
      const c = [all[i - 1], all[i]].filter((v) => v != null).sort((p, q) => Math.abs(p - t) - Math.abs(q - t))[0];
      if (c == null) return null;
      cross.setAttribute('x1', x(c)); cross.setAttribute('x2', x(c)); cross.setAttribute('visibility', 'visible');
      const pa = asOf(sa, new Date(c)), pb = asOf(sb, new Date(c));
      const lines = [d3.utcFormat('%b %-d, %Y')(new Date(c)), [name(a), pa ? num(pa.v) : '—'], [name(b), pb ? num(pb.v) : '—']];
      meets.filter((g) => +g.t === c).forEach((g) => lines.push(`They met: ${name(g.w ? a : b)} won (${g.r.civ || '?'} vs ${g.o.civ || '?'}, ${g.r.map || '?'})`));
      return lines;
    });
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') cross.setAttribute('visibility', 'hidden'); });
    box.appendChild(svg);
  }

  // grouped bars: one row per measure, a bar for B and a bar for A (minutes)
  function pairBars(box, rows, a, b) {
    box.replaceChildren();
    const ok = rows.filter((r) => r.va != null || r.vb != null);
    if (!ok.length) { box.appendChild(empty('No age-up times in the analysed games.')); return; }
    const W = box.clientWidth;
    if (!W) return;
    const rowH = 58, H = ok.length * rowH + 24;
    const x0 = 0, x1 = W - 70;
    const max = Math.max(1, ...ok.map((r) => Math.max(r.va || 0, r.vb || 0))) * 1.05;
    const sx = (v) => ((x1 - x0) * v) / max;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': 'Average age-up times in game minutes' });
    ok.forEach((r, i) => {
      const g = sv('g', { transform: `translate(0,${i * rowH})` }, svg);
      const lt = sv('text', { x: 0, y: 13, class: 'cmp-lab' }, g); lt.textContent = r.label;
      [[r.vb, 'cmp-bar-b', b], [r.va, 'cmp-bar-a', a]].forEach(([v, cls], j) => {
        const yy = 20 + j * 16;
        sv('rect', { x: x0, y: yy, width: x1 - x0, height: 12, rx: 3, class: 'cmp-track' }, g);
        if (v != null) sv('rect', { x: x0, y: yy, width: Math.max(1, sx(v)), height: 12, rx: 3, class: cls }, g);
        const t = sv('text', { x: W, y: yy + 10, 'text-anchor': 'end', class: 'cmp-val' }, g);
        t.textContent = v == null ? '—' : `${one(v)} min`;
      });
      const hit = sv('rect', { x: 0, y: 0, width: W, height: rowH, class: 'cmp-hit' }, g);
      hover(hit, box, () => [r.label, [name(b), r.vb == null ? '—' : `${one(r.vb)} min (${num(r.nb)} games)`], [name(a), r.va == null ? '—' : `${one(r.va)} min (${num(r.na)} games)`]]);
    });
    const y = ok.length * rowH + 2;
    sv('line', { x1: x0, x2: x1, y1: y, y2: y, class: 'cmp-axis' }, svg);
    [0, max / 2, max].forEach((v, i) => {
      const t = sv('text', { x: x0 + sx(v), y: y + 14, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle', class: 'cmp-ax' }, svg);
      t.textContent = i === 2 ? `${Math.round(v)} game min` : String(Math.round(v));
    });
    box.appendChild(svg);
  }

  // ---------------------------------------------------------------- small builders
  const pips = (list) => {
    const s = mk('span', 'cmp-pips');
    list.forEach((w) => { const i = mk('i', w ? 'w' : 'l', w ? 'W' : 'L'); s.appendChild(i); });
    s.setAttribute('aria-label', list.map((w) => (w ? 'won' : 'lost')).join(', '));
    return s;
  };
  const ratePill = (rate) => mk('span', 'cmp-rate' + (rate == null ? '' : rate >= 0.55 ? ' w' : rate <= 0.45 ? ' l' : ''), rate == null ? '—' : pct(rate));
  const card = (box) => { box.replaceChildren(); return box; };
  const block = (title, note) => {
    const d = mk('div', 'cmp-block');
    d.appendChild(mk('h3', 'cmp-h3', title));
    d.appendChild(mk('p', 'tt-note', note || ''));
    return d;
  };
  const chartBox = () => mk('div', 'cmp-chart');
  const nGames = (n, what = 'analysed games') => (n ? `Based on ${num(n)} ${what}.` : '');

  // ---------------------------------------------------------------- controls (wired once)
  const aSel = el('hh-a'), aSel2 = el('hh-a2'), bSel = el('hh-b'), perBox = el('hh-period');
  let S = { a: '', b: '' };
  const setA = (v) => { const p = { ha: v }; if (v === S.b) p.hb = S.a; dash.setParams(p); };
  if (aSel) {
    aSel.addEventListener('change', () => setA(aSel.value));
    aSel2.addEventListener('change', () => setA(aSel2.value));
    bSel.addEventListener('change', () => dash.setParams({ hb: bSel.value }));
    el('hh-swap').addEventListener('click', () => dash.setParams({ ha: S.b, hb: S.a }));
    perBox.replaceChildren(...PERIODS.map((p) => {
      const b = mk('button', 'cmp-segb', p);
      b.type = 'button'; b.dataset.period = p;
      b.addEventListener('click', () => dash.setParams({ hp: p === 'All time' ? null : p }));
      return b;
    }));
  }
  const openBO = new Set(), fullBO = new Set(); // build orders the viewer has opened / expanded, kept across redraws

  // ---------------------------------------------------------------- draw
  function draw(ctx) {
    C = ctx;
    Q = [];
    try { drawAll(ctx); } finally { const q = Q; Q = []; q.forEach((fn) => fn()); }
  }
  function drawAll(ctx) {
    const names = ctx.names;
    if (!aSel || !names.length) return;
    const P = dash.params();
    const a = names.includes(P.ha) ? P.ha : names.includes(ctx.ME.player) ? ctx.ME.player : names[0];
    const period = PERIODS.includes(P.hp) ? P.hp : 'All time';
    const others = names.filter((n) => n !== a);
    const rv = dash.data('rivals');
    const rvRow = (x, y, p) => (rv.status === 'ok' ? rv.data.find((r) => r.a === x && r.b === y && r.period === p) : null);
    let b = others.includes(P.hb) ? P.hb : null;
    if (!b) { // default B: whoever A has played most
      b = others.slice().sort((x, y) => {
        const gx = rvRow(a, x, 'All time'), gy = rvRow(a, y, 'All time');
        const n = (g) => (g ? g.games + g.team_vs_games + g.with_games : 0);
        return n(gy) - n(gx);
      })[0];
    }
    S = { a, b };
    const opt = (n) => new Option(ctx.steamOr(n) !== n ? `${ctx.steamOr(n)} (${n})` : n, n);
    [aSel, aSel2].forEach((s) => { if (document.activeElement !== s) { s.replaceChildren(...names.map(opt)); s.value = a; } });
    if (document.activeElement !== bSel) { bSel.replaceChildren(...others.map(opt)); bSel.value = b || ''; }
    perBox.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.period === period)));
    el('cmp-pair').hidden = !b;

    const h = dash.data('history');
    if (h.status !== 'ok') el('cmp-all-body').replaceChildren(bodyMsg(h.status === 'error' ? 'Failed to load the games.' : 'Loading…'));
    const ids = ['cmp-h2h', 'cmp-side', 'cmp-rating', 'cmp-meet', 'cmp-team', 'cmp-scout'];
    if (h.status === 'error') { ids.forEach((id) => el(id).replaceChildren(empty('Failed to load the games.'))); return; }
    if (h.status !== 'ok') { ids.forEach((id) => { if (!el(id).childElementCount) el(id).replaceChildren(empty('Loading…')); }); return; }
    index(h.data);

    drawEveryone(a, others, b, period, rvRow, rv);
    if (!b) return;
    const pg = together(a, b, period);
    drawH2H(a, b, period, pg, rvRow(a, b, period));
    drawSide(a, b, period);
    drawRating(a, b, period, pg);
    drawMeet(a, b, period);
    drawTeam(a, b, period, pg, rvRow(a, b, period));
    drawScout(a, b, period, P);
  }

  // ---- 1. A against everyone
  function drawEveryone(a, others, b, period, rvRow, rv) {
    el('cmp-all-title').replaceChildren(...whoNodes(a), document.createTextNode(' against everyone'));
    el('cmp-all-note').textContent = `${period}. 1v1s, team games on the same side and team games on opposite sides. Last 5: their most recent games against each other, oldest first. Tap a player to compare in full.`;
    const t = el('cmp-all-table');
    const head = mk('tr');
    [['Player', ''], ['1v1', 'num'], ['1v1 win %', 'num'], ['As teammates', 'num'], ['Against in team games', 'num'], ['Last game', ''], ['Last 5', '']].forEach(([x, c]) => head.appendChild(mk('th', c, x)));
    t.tHead.replaceChildren(head);
    const body = el('cmp-all-body');
    if (rv.status === 'error') { body.replaceChildren(bodyMsg('Failed to load.')); return; }
    const rows = others.map((x) => ({ x, r: rvRow(a, x, period) })).filter((o) => o.r)
      .sort((p, q) => (q.r.games - p.r.games) || (q.r.games + q.r.team_vs_games + q.r.with_games) - (p.r.games + p.r.team_vs_games + p.r.with_games));
    body.replaceChildren(...rows.map(({ x, r }) => {
      const w = { a, b: x, period };
      const tr = mk('tr', 'click cmp-row');
      tr.tabIndex = 0;
      tr.dataset.player = x;
      if (x === b) tr.classList.add('sel');
      const go = () => { dash.setParams({ hb: x }); requestAnimationFrame(() => el('cmp-pair').scrollIntoView({ behavior: 'smooth', block: 'start' })); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      const td = (cls, ...nodes) => { const c = mk('td', cls); c.append(...nodes); tr.appendChild(c); return c; };
      td('cmp-who', ...whoNodes(x));
      td('num', r.games ? C.mark('rivals', w, 'wins', num(r.wins), 'span') : '—', r.games ? '–' : '', r.games ? C.mark('rivals', w, 'losses', num(r.losses), 'span') : '');
      td('num', ratePill(r.win_rate));
      td('num', r.with_games ? `${wl(r.with_wins, r.with_games)}` : '—');
      td('num', r.team_vs_games ? `${wl(r.team_vs_wins, r.team_vs_games)}` : '—');
      td('', r.last_played ? C.mark('rivals', w, 'last_played', dayOf(r.last_played), 'span') : 'Never');
      const last = together(a, x, period).filter((g) => g.kind !== 'with').slice(-5).map((g) => won(g.r));
      td('', last.length ? pips(last) : '—');
      return tr;
    }));
    if (!rows.length) body.replaceChildren(bodyMsg(rv.status === 'ok' ? 'No other players yet.' : 'Loading…'));
  }

  // ---- 2a. head to head 1v1
  function drawH2H(a, b, period, pg, row) {
    const box = card(el('cmp-h2h'));
    const ones = pg.filter((g) => g.kind === '1v1');
    const wins = ones.filter((g) => won(g.r)).length;
    box.appendChild(mk('h2', '', 'Head to head (1v1)'));
    const hero = mk('div', 'cmp-hero');
    const side = (p, n, cls) => { const d = mk('div', 'cmp-side-' + cls); d.append(mk('div', 'cmp-hero-n', name(p)), mk('div', 'cmp-hero-v', num(n))); return d; };
    hero.append(side(a, wins, 'a'), mk('div', 'cmp-hero-dash', '–'), side(b, ones.length - wins, 'b'));
    box.appendChild(hero);
    const facts = mk('ul', 'cmp-facts');
    const li = (k, ...v) => { const l = mk('li'); l.append(mk('span', 'k', k)); const s = mk('span', 'v'); s.append(...v); l.appendChild(s); facts.appendChild(l); };
    if (ones.length) {
      li('Win rate', `${name(a)} `, row ? C.mark('rivals', { a, b, period }, 'win_rate', pct(wins / ones.length), 'b') : pct(wins / ones.length), ` of ${num(ones.length)}`);
      let n = 0; const lastW = won(ones[ones.length - 1].r);
      for (let i = ones.length - 1; i >= 0 && won(ones[i].r) === lastW; i -= 1) n += 1;
      li('Streak', n === 1 ? `${name(lastW ? a : b)} won the last one` : `${name(lastW ? a : b)} has won the last ${n}`);
      li('Last met', dayOf(ones[ones.length - 1].r.started));
    } else li('Record', 'No 1v1s against each other in this period');
    const ra = ratingNow(a), rb = ratingNow(b);
    if (ra != null && rb != null) {
      const d = ra - rb;
      li('Rating gap now', d === 0 ? 'Level' : `${name(d > 0 ? a : b)} is ${num(Math.abs(d))} higher`, mk('span', 'cmp-sub', ` (${num(ra)} v ${num(rb)})`));
    } else li('Rating gap now', `No ranked 1v1 rating for ${[ra == null ? name(a) : null, rb == null ? name(b) : null].filter(Boolean).join(' or ')}`);
    box.appendChild(facts);
    if (!ones.length) return;
    box.appendChild(mk('div', 'tt-label cmp-cap', `Form, oldest first${ones.length > 1 ? ' (green: ' + name(a) + ' won)' : ''}`));
    const fs = chartBox(); fs.classList.add('cmp-form');
    box.appendChild(fs);
    later(() => formStrip(fs, ones, a, b));
    const sc = mk('div', 'tt-scroll cmp-tall');
    const t = mk('table', 'cmp-games');
    const hr = mk('tr');
    [['Date', ''], ['Map', ''], [`${name(a)}`, ''], [`${name(b)}`, ''], ['Winner', ''], ['Length', 'num'], ['Links', '']].forEach(([x, c]) => hr.appendChild(mk('th', c, x)));
    t.append(mk('thead'), mk('tbody'));
    t.tHead.appendChild(hr);
    ones.slice().reverse().forEach((g) => {
      const tr = mk('tr');
      const w = won(g.r);
      tr.append(mk('td', '', dayOf(g.r.started)), mk('td', '', g.r.map || '—'), mk('td', '', g.r.civ || '—'), mk('td', '', g.o.civ || '—'),
        mk('td', w ? 'win' : 'loss', name(w ? a : b)), mk('td', 'num', mins(g.r.duration_min)));
      const lk = mk('td'); lk.appendChild(C.extLinks(g.r.match_id)); tr.appendChild(lk);
      t.tBodies[0].appendChild(tr);
    });
    sc.appendChild(t);
    box.appendChild(sc);
  }

  // ---- 2b. side by side numbers
  function drawSide(a, b, period) {
    const box = card(el('cmp-side'));
    box.appendChild(mk('h2', '', 'Side by side'));
    box.appendChild(mk('p', 'tt-note', `${period}, all their games (not only against each other).`));
    const ps = dash.data('p_summary'), pi = dash.data('p_identity');
    if (ps.status === 'error' || pi.status === 'error') { box.appendChild(empty('Failed to load.')); return; }
    const scope = 'All games' + suffix(period);
    const sm = (p) => (ps.data.find((r) => r.player === p && r.scope === scope) || null);
    const idn = (p) => (pi.data.find((r) => r.player === p && r.period === period) || null);
    const A = sm(a), B = sm(b), IA = idn(a), IB = idn(b);
    const g = mk('div', 'cmp-vs');
    const head = mk('div', 'cmp-vs-row cmp-vs-head');
    head.append(mk('span', 'a', name(a)), mk('span', 'k', ''), mk('span', 'b', name(b)));
    g.appendChild(head);
    const row = (label, va, vb, fmt, better) => {
      const r = mk('div', 'cmp-vs-row');
      const ca = mk('span', 'a', va == null || va === '' ? '—' : fmt(va)), cb = mk('span', 'b', vb == null || vb === '' ? '—' : fmt(vb));
      if (better && va != null && vb != null && va !== vb) ((better === 'high' ? va > vb : va < vb) ? ca : cb).classList.add('best');
      r.append(ca, mk('span', 'k', label), cb);
      g.appendChild(r);
    };
    const civTxt = (I, f) => (I && I[f] ? `${I[f]} (${pct(I[f + '_rate'])} of ${num(I[f + '_games'])})` : null);
    row('1v1 rating now', ratingNow(a), ratingNow(b), num, 'high');
    row(`Peak 1v1 rating${period === 'All time' ? '' : ' (' + period.toLowerCase() + ')'}`, A && A.rating_peak, B && B.rating_peak, num, 'high');
    row('Win rate', A && A.win_rate, B && B.win_rate, pct, 'high');
    row('Games', A && A.games, B && B.games, num);
    row('Average game', A && A.avg_minutes, B && B.avg_minutes, (v) => `${one(v)} min`);
    row('eAPM', A && A.eapm, B && B.eapm, num, 'high');
    row('Favourite civ (1v1)', civTxt(IA, 'fav_civ'), civTxt(IB, 'fav_civ'), (v) => v);
    row('Best map', civTxt(IA, 'best_map'), civTxt(IB, 'best_map'), (v) => v);
    box.appendChild(g);
    const an = [A && A.analyzed, B && B.analyzed];
    box.appendChild(mk('p', 'tt-note cmp-foot', `eAPM from analysed replays: ${name(a)} ${num(an[0] || 0)}, ${name(b)} ${num(an[1] || 0)}. Best map needs 5+ games. Ratings are from ranked 1v1s.`));
  }

  // ---- 2c. rating over time
  function drawRating(a, b, period, pg) {
    const box = card(el('cmp-rating'));
    box.appendChild(mk('h2', '', 'Rating over time'));
    const leg = mk('div', 'cmp-legend');
    const key = (cls, text) => { const s = mk('span'); s.append(mk('i', cls), text); leg.appendChild(s); };
    key('cmp-k-a', name(a)); key('cmp-k-b', name(b)); key('cmp-k-w', `They met: ${name(a)} won`); key('cmp-k-l', `They met: ${name(b)} won`);
    box.appendChild(leg);
    box.appendChild(mk('p', 'tt-note', `${period}. Ranked 1v1 ladder. Hover or tap the chart for exact ratings.`));
    const ser = (p) => (IDX.byPlayer.get(p) || []).filter((r) => r.type === '1v1 ranked' && r.rating != null && r.rating !== '' && !window.TT_QUICK_PLAY(r) && inPeriod(period, r.started))
      .map((r) => ({ t: new Date(r.started), v: Number(r.rating) }));
    const meets = pg.filter((g) => g.kind === '1v1').map((g) => ({ t: new Date(g.r.started), v: g.r.type === '1v1 ranked' && g.r.rating != null && g.r.rating !== '' && !window.TT_QUICK_PLAY(g.r) ? Number(g.r.rating) : null, w: won(g.r), r: g.r, o: g.o }));
    const cb = chartBox(); cb.classList.add('cmp-line-chart');
    box.appendChild(cb);
    later(() => ratingChart(cb, a, b, ser(a), ser(b), meets));
  }

  // ---- 2d. when they meet: civs and maps
  function drawMeet(a, b, period) {
    const box = card(el('cmp-meet'));
    box.appendChild(mk('h2', '', 'When they meet'));
    box.appendChild(mk('p', 'tt-note', `${period}, their 1v1s against each other. Green: games that player won.`));
    const grid = mk('div', 'cmp-grid3');
    box.appendChild(grid);
    const rc = dash.data('rival_civs'), rm = dash.data('rival_maps');
    const part = (title, d, x, y, key) => {
      const bl = block(title);
      const cb = chartBox(); bl.appendChild(cb); grid.appendChild(bl);
      if (d.status === 'error') { cb.appendChild(empty('Failed to load.')); return; }
      const rows = d.data.filter((r) => r.a === x && r.b === y && r.period === period).slice(0, 8);
      const more = d.data.filter((r) => r.a === x && r.b === y && r.period === period).length - rows.length;
      later(() => wlBars(cb, rows.map((r) => ({ label: r[key], games: r.games, wins: r.wins })), { emptyText: 'No 1v1s against each other in this period.' }));
      if (more > 0) bl.appendChild(mk('p', 'tt-note', `and ${more} more`));
    };
    part(`${name(a)}’s civs`, rc, a, b, 'civ');
    part(`${name(b)}’s civs`, rc, b, a, 'civ');
    part(`Maps (${name(a)}’s results)`, rm, a, b, 'map');
  }

  // ---- 2e. team games
  function drawTeam(a, b, period, pg, row) {
    const box = card(el('cmp-team'));
    box.appendChild(mk('h2', '', 'Team games'));
    const grid = mk('div', 'cmp-grid2');
    box.appendChild(grid);
    const withG = pg.filter((g) => g.kind === 'with'), vsG = pg.filter((g) => g.kind === 'vs');
    const rec = (list, who) => {
      const w = list.filter((g) => won(g.r)).length;
      const d = mk('div', 'cmp-rec');
      d.append(mk('span', 'cmp-rec-v', list.length ? wl(w, list.length) : '—'), mk('span', 'cmp-sub', list.length ? `${who} won ${pct(w / list.length)} of ${num(list.length)}` : 'None in this period'));
      return d;
    };
    const mates = block('As teammates');
    mates.appendChild(rec(withG, 'They'));
    const m = new Map();
    withG.forEach((g) => { const k = `${g.r.civ || '?'} + ${g.o.civ || '?'}`; const o = m.get(k) || { label: k, games: 0, wins: 0 }; o.games += 1; o.wins += won(g.r) ? 1 : 0; m.set(k, o); });
    const pairs = [...m.values()].sort((p, q) => q.wins / q.games - p.wins / p.games || q.games - p.games);
    const best = pairs.filter((p) => p.games >= 2).concat(pairs.filter((p) => p.games < 2)).slice(0, 6);
    if (withG.length) {
      mates.appendChild(mk('div', 'tt-label cmp-cap', `Best civ pairs together (${name(a)} + ${name(b)}), 2+ games first`));
      const cb = chartBox(); mates.appendChild(cb);
      grid.appendChild(mates);
      later(() => wlBars(cb, best, {}));
    } else grid.appendChild(mates);
    const vs = block('Against each other in team games');
    vs.appendChild(rec(vsG, `${name(a)}’s side`));
    if (vsG.length) {
      vs.appendChild(mk('div', 'tt-label cmp-cap', 'Most recent, newest first'));
      const ul = mk('ul', 'cmp-mini');
      vsG.slice(-6).reverse().forEach((g) => {
        const li = mk('li');
        li.append(mk('span', won(g.r) ? 'cmp-res w' : 'cmp-res l', won(g.r) ? `${name(a)}’s side won` : `${name(b)}’s side won`),
          mk('span', 'cmp-sub', `${dayOf(g.r.started)} · ${g.r.map || '—'} · ${g.r.civ || '?'} v ${g.o.civ || '?'}`));
        ul.appendChild(li);
      });
      vs.appendChild(ul);
    }
    grid.appendChild(vs);
    if (row) box.appendChild(mk('p', 'tt-note cmp-foot', `${period}. Same result in the same game means the same side.`));
  }

  // ---- 2f. scouting report on B
  function drawScout(a, b, period, P) {
    const box = card(el('cmp-scout'));
    const sk = SCOUT.find((s) => s[0] === P.hs) ? P.hs : 'All games';
    const scope = sk + suffix(period);
    const head = mk('div', 'cmp-scout-head');
    const h2 = mk('h2'); h2.append('Scouting report on ', ...whoNodes(b));
    const seg = mk('div', 'cmp-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Games in the report');
    SCOUT.forEach(([s, label]) => {
      const x = mk('button', 'cmp-segb', label); x.type = 'button';
      x.setAttribute('aria-pressed', String(s === sk));
      x.addEventListener('click', () => dash.setParams({ hs: s === 'All games' ? null : s }));
      seg.appendChild(x);
    });
    head.append(h2, seg);
    box.appendChild(head);
    const hs = dash.data('h_scoped'), ra = dash.data('replay_analysis');
    if (hs.status === 'error' || ra.status === 'error') { box.appendChild(empty('Failed to load.')); return; }
    if (hs.status !== 'ok' || ra.status !== 'ok') { box.appendChild(empty('Loading…')); return; }
    const tags = new Map(hs.data.filter((r) => r.player === a || r.player === b).map((r) => [r.player + '|' + r.match_id, r.scopes.split('|')]));
    const inScope = (p, mid) => (tags.get(p + '|' + String(mid)) || []).includes(scope);
    const played = (IDX.byPlayer.get(b) || []).filter((r) => inScope(b, r.match_id));
    const anB = ra.data.filter((r) => r.player === b && inScope(b, r.match_id));
    const anA = ra.data.filter((r) => r.player === a && inScope(a, r.match_id));
    const label = SCOUT.find((s) => s[0] === sk)[1];
    box.appendChild(mk('p', 'tt-note', `What ${name(b)} tends to do, to prepare a game against them. ${period}, ${label === 'All games' ? 'all games' : label + ' games'}: ${num(played.length)} played, ${num(anB.length)} with an analysed replay.`));
    const pick = (id) => { const d = dash.data(id); return d.status === 'ok' ? d.data.filter((r) => r.player === b && r.scope === scope) : []; };
    const grid = mk('div', 'cmp-grid2');
    box.appendChild(grid);

    // favourite civs (every game played, no replay needed)
    const civs = mk('div', 'cmp-block');
    civs.append(mk('h3', 'cmp-h3', 'Favourite civs'), mk('p', 'tt-note', played.length ? `Most played, with how it went. ${nGames(played.length, 'games played')}` : 'No games in this view.'));
    const cc = chartBox(); civs.appendChild(cc); grid.appendChild(civs);
    const pc = pick('p_civs').slice(0, 8);
    later(() => wlBars(cc, pc.map((r) => ({ label: r.civ, games: r.games, wins: r.wins, extra: [['Share of games', pct(r.games / Math.max(1, played.length))]] })), { emptyText: 'No games in this view.' }));

    if (!anB.length) {
      const n = mk('div', 'cmp-block cmp-none');
      n.append(mk('h3', 'cmp-h3', 'From replays'), empty(`None of ${name(b)}’s games in this view has an analysed replay, so there are no openings, plans, age-up times, army or build orders to show. Try All time or All games.`));
      grid.appendChild(n);
      return;
    }
    const strat = (title, id, key, note, extra) => {
      const bl = block(title, note);
      const rows = pick(id);
      const tot = rows.reduce((s, r) => s + r.games, 0);
      bl.lastChild.textContent = `${note} ${nGames(tot)}`.trim();
      const cb = chartBox(); bl.appendChild(cb); grid.appendChild(bl);
      later(() => wlBars(cb, rows.slice(0, 7).map((r) => ({ label: r[key], games: r.games, wins: r.wins, extra: [['How often', pct(r.games / Math.max(1, tot))], ...(extra ? extra(r) : [])] })), { emptyText: 'Not read from any analysed replay.' }));
    };
    strat('Openings', 's_openings', 'opening', 'How they open, how often, and how it went.', (r) => [['Avg Feudal', mins(r.feudal_min)], ['Avg Castle', mins(r.castle_min)]]);
    strat('Castle Age plans', 's_castle', 'castle_plan', 'What they go for in Castle Age.');
    strat('Attack style', 's_attack', 'attack_style', 'When and how they attack.', (r) => [['First attack', mins(r.first_attack_min)]]);
    strat('Defense style', 's_defense', 'defense_style', 'How they defend.');

    // age-up times vs A
    const tempo = dash.data('s_tempo');
    const tb = block('Age-up times', '');
    const tr = (p) => (tempo.status === 'ok' ? tempo.data.find((r) => r.player === p && r.scope === scope && r.result === 'All') : null);
    const TB = tr(b), TA = tr(a);
    tb.lastChild.textContent = `Average game minute, ${name(b)} against ${name(a)}. ${name(b)}: ${num(TB ? TB.games : 0)} analysed games, ${name(a)}: ${num(TA ? TA.games : 0)}.`;
    const lg = mk('div', 'cmp-legend');
    [[name(b), 'cmp-k-bb'], [name(a), 'cmp-k-ab']].forEach(([t, c]) => { const s = mk('span'); s.append(mk('i', c), t); lg.appendChild(s); });
    tb.appendChild(lg);
    const tc = chartBox(); tb.appendChild(tc); grid.appendChild(tb);
    const avgN = (rows, f) => rows.filter((r) => Number(r[f]) > 0).length;
    later(() => pairBars(tc, [['Feudal Age', 'feudal_min'], ['Castle Age', 'castle_min'], ['Imperial Age', 'imperial_min'], ['First attack', 'first_attack_min']].map(([l, f]) => ({
      label: l, vb: TB ? TB[f] : null, va: TA ? TA[f] : null, nb: avgN(anB, f), na: avgN(anA, f),
    })), a, b));

    // army composition
    const ub = block('Army composition', '');
    const units = pick('s_units');
    const withMix = anB.filter((r) => r.unit_mix).length;
    ub.lastChild.textContent = `Share of the military units they made. ${nGames(withMix)}`;
    const uc = chartBox(); ub.appendChild(uc); grid.appendChild(ub);
    later(() => bars(uc, units.slice(0, 8).map((r) => ({ label: r.unit_class, segs: [{ v: r.share, cls: 'cmp-bar-b' }], text: pct(r.share), tip: [r.unit_class, ['Share', pct(r.share)], ['Units made', num(r.units)], ['Analysed games', num(withMix)]] })),
      { max: Math.max(0.01, ...units.slice(0, 8).map((r) => r.share)), emptyText: 'No army data in the analysed games.', textW: 52, aria: 'Army composition' }));

    // build orders
    const bo = mk('div', 'cmp-block cmp-bo');
    box.appendChild(bo);
    drawBuilds(bo, b, anB);
  }

  // most common build order per opening: the game with the median Feudal time in that opening
  function drawBuilds(bo, b, an) {
    const withBo = an.filter((r) => r.build_order);
    bo.append(mk('h3', 'cmp-h3', 'Build orders'));
    if (!withBo.length) { bo.appendChild(empty('No build orders in the analysed games.')); return; }
    bo.appendChild(mk('p', 'tt-note', `The typical game for each opening: the one with the middle Feudal Age time. Times are game minutes. ${nGames(withBo.length, 'analysed games with a build order')}`));
    const by = new Map();
    withBo.forEach((r) => { const k = r.opening || 'Unknown opening'; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
    const groups = [...by.entries()].sort((p, q) => q[1].length - p[1].length);
    const steps = (s) => String(s).split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(' '); return { t: x.slice(0, i), item: x.slice(i + 1) }; });
    groups.forEach(([op, rows], gi) => {
      const timed = rows.filter((r) => Number(r.feudal_min) > 0).sort((p, q) => p.feudal_min - q.feudal_min);
      const pickRow = timed.length ? timed[Math.floor((timed.length - 1) / 2)] : rows[Math.floor((rows.length - 1) / 2)];
      const key = `${b}|${op}`;
      const d = mk('details', 'cmp-bo-item');
      d.open = openBO.has(key) || (gi === 0 && !openBO.has(key + '|closed'));
      d.addEventListener('toggle', () => { if (d.open) { openBO.add(key); openBO.delete(key + '|closed'); } else { openBO.delete(key); openBO.add(key + '|closed'); } });
      const sm = mk('summary');
      sm.append(mk('span', 'cmp-bo-op', op), mk('span', 'cmp-sub', `${num(rows.length)} game${rows.length === 1 ? '' : 's'} (${pct(rows.length / withBo.length)})${gi === 0 ? ' · most common' : ''}`));
      d.appendChild(sm);
      d.appendChild(mk('p', 'tt-note', `Typical game: ${dayOf(pickRow.started)}, ${pickRow.civ || '?'} on ${pickRow.map || '?'}, ${won(pickRow) ? 'won' : 'lost'}${Number(pickRow.feudal_min) > 0 ? `, Feudal Age at ${one(pickRow.feudal_min)} min` : ''}.`));
      const all = steps(pickRow.build_order);
      const full = fullBO.has(key);
      const ol = mk('ol', 'cmp-steps');
      (full ? all : all.slice(0, 12)).forEach((s) => { const li = mk('li'); li.append(mk('span', 't', s.t), mk('span', 'i', s.item)); ol.appendChild(li); });
      d.appendChild(ol);
      if (all.length > 12) {
        const btn = mk('button', 'tt-btn cmp-more', full ? 'Show the first 12 steps' : `Show all ${all.length} steps`);
        btn.type = 'button';
        btn.addEventListener('click', () => { if (fullBO.has(key)) fullBO.delete(key); else fullBO.add(key); bo.replaceChildren(); drawBuilds(bo, b, an); });
        d.appendChild(btn);
      }
      bo.appendChild(d);
    });
  }

  window.TT_COMPARE = { draw };
})();
