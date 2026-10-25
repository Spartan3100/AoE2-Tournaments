// Small inline-SVG chart helpers shared by the Players pages (profile.js, compare.js): window.TT_CHARTS.
// No d3 needed. Every colour is a CSS token from app.css, so the charts follow the look (Classic AoE, Clean & light,
// Dark & gold). Each chart measures its host's width when drawn; the pages redraw on resize (dash.onData).
//
// Tooltips: any SVG/HTML element inside a chart (.tt-c) or an area marked .tt-c-tips, with a data-tip attribute, shows it on hover and on tap.
// The text is plain; lines are split on "\n" and the first line is bold.
//
//   C.line(host, pts, opts)       pts [{t: ms, y, won?: bool, tip}]; opts {area, dots, yFmt, height, ref, refLabel, yTitle, label}
//   C.hbars(host, rows, opts)     rows [{label, tip?, panels: [{segs: [{v, color, tip?}], txt}]}]; opts {panels: [{title, max, ticks, fmtT, ref}], rowH, label}
//   C.vbars(host, items, opts)    items [{label, sub, v, color, opacity, tip, txt}]; opts {max, ticks, fmtY, ref, height, yTitle, label}
//   C.heat(host, rows, cols, cell, opts)   cell(r, c) -> {fill, tip, empty?}; opts {labelW, cellH, every, label, xTitle}
//   C.donut(host, parts, opts)    parts [{v, color, tip}]; opts {size, center, centerSub, label}
//   C.spark(host, vals, opts)     opts {height, color}
//   C.strip(host, items, opts)    items [{color, txt, tip}]; opts {max (cell size), gap, label}
//   C.rateBar(rate, tip)          an HTML win-rate bar (green at or above 50%, red below) with a 50% tick
//   C.legend(items)               items [[color, text]]
//   C.winColor(rate), C.heatColor(rate), C.PAL (categorical colours made from the tokens)
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const STYLE_PROPS = new Set(['fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'opacity']);
  function S(tag, attrs, kids) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText += ';' + v; // keeps fills set through the style below
      else if (k === 'tip') { if (v) e.setAttribute('data-tip', v); }
      else if (STYLE_PROPS.has(k)) e.style.setProperty(k, String(v)); // var(--token) works in style, not in every attribute
      else e.setAttribute(k, v);
    });
    (kids || []).forEach((c) => c && e.appendChild(c));
    return e;
  }
  function H(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / ((d1 - d0) || 1)) * (r1 - r0);
  function niceTicks(lo, hi, n = 5) {
    const span = (hi - lo) || 1, mag = Math.pow(10, Math.floor(Math.log10(span / n)));
    const st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || mag * 10;
    const t = [];
    for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) t.push(+v.toFixed(6));
    return t;
  }
  const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  const pc = (x) => Math.round(x * 100) + '%';
  const winColor = (r) => (r >= 0.5 ? 'var(--color-ok)' : 'var(--color-bad)');
  // stronger colour the further from 50%
  const heatColor = (r) => `color-mix(in srgb, ${winColor(r)} ${Math.round(Math.min(100, 22 + Math.abs(r - 0.5) * 2 * 150))}%, var(--color-soft))`;
  // categorical colours (openings and the like): told apart by lightness as much as hue, so they work in all three looks;
  // win/loss green and red are left out on purpose
  const PAL = ['var(--color-accent)', 'var(--color-fg-muted)', 'color-mix(in srgb, var(--color-accent) 42%, var(--color-panel))', 'var(--color-fg)',
    'var(--cds-chart-axis)', 'color-mix(in srgb, var(--color-fg-muted) 40%, var(--color-panel))', 'var(--color-warn)'];

  // ---------------------------------------------------------------- styles (tokens only), injected once
  const css = `
#dash-root .tt-c { position: relative; width: 100%; min-width: 0; }
#dash-root .tt-c svg { display: block; max-width: 100%; overflow: visible; }
#dash-root .tt-c text { font-variant-numeric: tabular-nums; }
#dash-root .tt-c text.ax { fill: var(--color-fg-muted); font-size: 11px; }
#dash-root .tt-c text.lab { fill: var(--color-fg); font-size: 12px; }
#dash-root .tt-c text.ttl { fill: var(--color-fg-muted); font-size: 11px; font-weight: 600; }
#dash-root .tt-c .grid { stroke: var(--cds-chart-grid); stroke-width: 1; }
#dash-root .tt-c .axis { stroke: var(--cds-chart-axis); stroke-width: 1; }
#dash-root .tt-c [data-tip] { cursor: default; }
#dash-root .tt-c-bar { height: 8px; border-radius: 4px; background: var(--color-soft); overflow: hidden; position: relative; min-width: 60px; }
#dash-root .tt-c-bar i { display: block; height: 100%; border-radius: 4px; }
#dash-root .tt-c-bar b { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--color-fg-muted); opacity: .6; }
#dash-root .tt-c-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--color-fg-muted); margin-top: 8px; }
#dash-root .tt-c-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.tt-ctip { position: fixed; z-index: 90; pointer-events: none; background: var(--color-fg); color: var(--color-bg); padding: 6px 10px; border-radius: 6px;
  font: 12px/1.4 var(--font-anthropic-sans); max-width: 260px; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
.tt-ctip[hidden] { display: none; }
.tt-ctip b { display: block; font-weight: 600; }`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  // ---------------------------------------------------------------- tooltip (hover and tap)
  let tipEl = null;
  function tip() {
    if (!tipEl) { tipEl = H('div', 'tt-ctip'); tipEl.hidden = true; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    return tipEl;
  }
  function showTip(text, x, y) {
    const t = tip();
    t.replaceChildren();
    String(text).split('\n').forEach((l, i) => { if (i === 0) t.appendChild(H('b', '', l)); else { if (i > 1) t.appendChild(H('br')); t.appendChild(document.createTextNode(l)); } });
    t.hidden = false;
    const r = t.getBoundingClientRect();
    t.style.left = Math.max(6, Math.min(innerWidth - r.width - 6, x + 12)) + 'px';
    t.style.top = (y - r.height - 12 < 6 ? y + 18 : y - r.height - 12) + 'px';
  }
  function hideTip() { if (tipEl && !tipEl.hidden) tipEl.hidden = true; }
  function onPtr(e) {
    if (e.ttTip) return; // a chart overlay already placed it
    let t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t && !t.closest('.tt-c, .tt-c-bar, .tt-c-tips')) t = null; // only chart parts, bars and areas marked .tt-c-tips
    if (t) showTip(t.getAttribute('data-tip'), e.clientX, e.clientY); else hideTip();
  }
  document.addEventListener('pointermove', onPtr, { passive: true });
  document.addEventListener('pointerdown', onPtr, { passive: true });
  document.addEventListener('scroll', hideTip, { capture: true, passive: true });

  // ---------------------------------------------------------------- shared bits
  function box(host, cls) { const b = H('div', 'tt-c' + (cls ? ' ' + cls : '')); host.appendChild(b); return b; }
  const width = (el) => Math.max(240, Math.floor(el.clientWidth || el.parentNode?.clientWidth || 320));
  const svgOf = (w, h, label) => S('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label || 'chart' });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function timeFmt(t0, t1) {
    const long = t1 - t0 > 300 * 864e5;
    return (t) => { const d = new Date(t); return long ? `${MONTHS[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  }
  const fmtNum = (v) => Math.round(v).toLocaleString('en-US');

  // ---------------------------------------------------------------- line / area over time
  function line(host, pts, o = {}) {
    const b = box(host);
    const w = width(b), h = o.height || (w < 480 ? 230 : 290);
    let lo = Math.min(...pts.map((p) => p.y)), hi = Math.max(...pts.map((p) => p.y));
    if (o.yMin != null) lo = o.yMin; else { const pad = (hi - lo) * 0.08 || 10; lo -= pad; }
    if (o.yMax != null) hi = o.yMax; else { const pad = (hi - lo) * 0.06 || 10; hi += pad; }
    const ticks = niceTicks(lo, hi, 4), yFmt = o.yFmt || fmtNum;
    const lw = Math.max(...ticks.map((v) => yFmt(v).length)) * 6.6 + 10;
    const m = { l: lw, r: 12, t: o.yTitle ? 22 : 10, b: 26 };
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t === t0 ? t0 + 864e5 : pts[pts.length - 1].t;
    const X = lin(t0, t1, m.l, w - m.r), Y = lin(lo, hi, h - m.b, m.t);
    const svg = svgOf(w, h, o.label); b.appendChild(svg);
    if (o.yTitle) svg.appendChild(S('text', { x: 0, y: 11, class: 'ttl', text: o.yTitle }));
    ticks.forEach((v) => {
      svg.appendChild(S('line', { x1: m.l, x2: w - m.r, y1: Y(v), y2: Y(v), class: 'grid' }));
      svg.appendChild(S('text', { x: m.l - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end', text: yFmt(v) }));
    });
    svg.appendChild(S('line', { x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b, class: 'axis' }));
    const nx = w < 480 ? 4 : 6, xf = timeFmt(t0, t1);
    for (let i = 0; i < nx; i++) {
      const t = t0 + ((t1 - t0) * i) / (nx - 1);
      svg.appendChild(S('text', { x: X(t), y: h - 7, class: 'ax', 'text-anchor': i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle', text: xf(t) }));
    }
    if (o.ref != null) {
      svg.appendChild(S('line', { x1: m.l, x2: w - m.r, y1: Y(o.ref), y2: Y(o.ref), stroke: 'var(--color-fg-muted)', 'stroke-dasharray': '4 4' }));
      if (o.refLabel) svg.appendChild(S('text', { x: w - m.r - 2, y: Y(o.ref) - 4, class: 'ax', 'text-anchor': 'end', text: o.refLabel }));
    }
    const col = o.color || 'var(--color-accent)';
    const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join('');
    if (o.area) svg.appendChild(S('path', { d: `${d}L${X(pts[pts.length - 1].t).toFixed(1)} ${Y(lo)}L${X(t0).toFixed(1)} ${Y(lo)}Z`, fill: col, 'fill-opacity': 0.14 }));
    svg.appendChild(S('path', { d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    if (o.dots) {
      const r = pts.length > 250 ? 1.9 : pts.length > 100 ? 2.4 : 3;
      pts.forEach((p) => { if (p.won != null) svg.appendChild(S('circle', { cx: X(p.t).toFixed(1), cy: Y(p.y).toFixed(1), r, fill: p.won ? 'var(--color-ok)' : 'var(--color-bad)' })); });
    }
    const cross = S('line', { y1: m.t, y2: h - m.b, stroke: 'var(--color-fg-muted)', 'stroke-dasharray': '3 3', visibility: 'hidden' });
    const dot = S('circle', { r: 5, fill: col, stroke: 'var(--color-panel)', 'stroke-width': 2, visibility: 'hidden' });
    const ov = S('rect', { x: m.l, y: m.t, width: Math.max(1, w - m.l - m.r), height: h - m.t - m.b, fill: 'transparent', style: 'touch-action: pan-y', 'data-overlay': '1' });
    svg.append(cross, dot, ov);
    function mv(e) {
      e.ttTip = true;
      const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) * (w / r.width);
      const tx = t0 + ((sx - m.l) / (w - m.l - m.r)) * (t1 - t0);
      let a = 0, z = pts.length - 1;
      while (z - a > 1) { const c = (a + z) >> 1; if (pts[c].t < tx) a = c; else z = c; }
      const p = Math.abs(pts[a].t - tx) <= Math.abs(pts[z].t - tx) ? pts[a] : pts[z];
      cross.setAttribute('x1', X(p.t)); cross.setAttribute('x2', X(p.t)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X(p.t)); dot.setAttribute('cy', Y(p.y)); dot.setAttribute('visibility', 'visible');
      if (p.won != null) dot.style.fill = p.won ? 'var(--color-ok)' : 'var(--color-bad)';
      showTip(p.tip, e.clientX, e.clientY);
    }
    ov.addEventListener('pointermove', mv);
    ov.addEventListener('pointerdown', mv);
    ov.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); } });
    return b;
  }

  // ---------------------------------------------------------------- horizontal bars, one or more panels per row
  function hbars(host, rows, o = {}) {
    const b = box(host);
    const w = width(b), small = w < 460;
    const panels = o.panels || [{ max: 1 }];
    const rh = o.rowH || 28, lw = o.labelW || (small ? 92 : 132);
    const titled = panels.some((p) => p.title), ticked = panels.some((p) => p.ticks);
    const top = titled ? 20 : 4, h = rows.length * rh + top + (ticked ? 22 : 4);
    const gap = 14, pw = (w - lw - gap * (panels.length - 1)) / panels.length;
    const svg = svgOf(w, h, o.label); b.appendChild(svg);
    panels.forEach((p, k) => {
      const x0 = lw + k * (pw + gap), tw = p.txtW || (small ? 40 : 48), X = lin(0, p.max || 1, x0, x0 + pw - tw - 4);
      p._X = X; p._x0 = x0; p._tw = tw; p._end = x0 + pw - tw - 4;
      if (p.title) svg.appendChild(S('text', { x: x0, y: 12, class: 'ttl', text: p.title }));
      (p.ticks || []).forEach((v) => {
        svg.appendChild(S('line', { x1: X(v), x2: X(v), y1: top, y2: h - 20, class: 'grid' }));
        svg.appendChild(S('text', { x: X(v), y: h - 6, class: 'ax', 'text-anchor': 'middle', text: p.fmtT ? p.fmtT(v) : v }));
      });
    });
    rows.forEach((r, i) => {
      const y = top + i * rh;
      svg.appendChild(S('text', { x: lw - 8, y: y + rh / 2 + 4, class: 'lab', 'text-anchor': 'end', text: trunc(r.label, small ? 13 : 19), tip: r.tip || r.label }));
      panels.forEach((p, k) => {
        const pr = (r.panels || [])[k] || { segs: [] };
        svg.appendChild(S('rect', { x: p._x0, y: y + 5, width: Math.max(1, p._end - p._x0), height: rh - 10, rx: 3, fill: 'var(--color-soft)', tip: pr.tip || r.tip || '' }));
        let acc = 0;
        pr.segs.forEach((s) => {
          const a = p._X(acc), z = p._X(Math.min(p.max || 1, acc + s.v)); acc += s.v;
          if (z > a) svg.appendChild(S('rect', { x: a, y: y + 5, width: Math.max(1.5, z - a), height: rh - 10, rx: 3, fill: s.color, tip: s.tip || pr.tip || r.tip || '' }));
        });
        if (pr.txt != null) svg.appendChild(S('text', { x: p._end + 6, y: y + rh / 2 + 4, class: 'lab', text: pr.txt, tip: pr.tip || r.tip || '' }));
      });
    });
    panels.forEach((p) => {
      if (p.ref != null) svg.appendChild(S('line', { x1: p._X(p.ref), x2: p._X(p.ref), y1: top, y2: top + rows.length * rh, stroke: 'var(--color-fg)', 'stroke-dasharray': '3 3', 'stroke-opacity': 0.55 }));
    });
    return b;
  }

  // ---------------------------------------------------------------- vertical bars
  function vbars(host, items, o = {}) {
    const b = box(host);
    const w = width(b), h = o.height || 240, max = o.max || Math.max(1, ...items.map((i) => i.v));
    const ticks = o.ticks || niceTicks(0, max, 4), fmtY = o.fmtY || fmtNum;
    const m = { l: Math.max(...ticks.map((v) => String(fmtY(v)).length)) * 6.6 + 10, r: 6, t: o.yTitle ? 24 : 12, b: 40 };
    const Y = lin(0, max, h - m.b, m.t), bw = (w - m.l - m.r) / items.length;
    const svg = svgOf(w, h, o.label); b.appendChild(svg);
    if (o.yTitle) svg.appendChild(S('text', { x: 0, y: 11, class: 'ttl', text: o.yTitle }));
    ticks.forEach((v) => {
      const isRef = o.ref != null && v === o.ref;
      svg.appendChild(S('line', { x1: m.l, x2: w - m.r, y1: Y(v), y2: Y(v), class: isRef ? '' : 'grid', stroke: isRef ? 'var(--color-fg-muted)' : null, 'stroke-dasharray': isRef ? '4 4' : null }));
      svg.appendChild(S('text', { x: m.l - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end', text: fmtY(v) }));
    });
    items.forEach((it, i) => {
      const x = m.l + i * bw + bw * 0.16, ww = bw * 0.68, v = it.v || 0;
      svg.appendChild(S('rect', { x, y: m.t, width: ww, height: h - m.b - m.t, fill: 'transparent', tip: it.tip }));
      if (v > 0) svg.appendChild(S('rect', { x, y: Y(v), width: ww, height: Math.max(0, Y(0) - Y(v)), rx: 3, fill: it.color || 'var(--color-accent)', 'fill-opacity': it.opacity ?? 1, tip: it.tip }));
      if (it.txt) svg.appendChild(S('text', { x: x + ww / 2, y: Y(v) - 5, class: 'lab', 'text-anchor': 'middle', text: it.txt, tip: it.tip }));
      svg.appendChild(S('text', { x: x + ww / 2, y: h - 22, class: 'ax', 'text-anchor': 'middle', text: it.label }));
      if (it.sub) svg.appendChild(S('text', { x: x + ww / 2, y: h - 8, class: 'ax', 'text-anchor': 'middle', text: it.sub }));
    });
    return b;
  }

  // ---------------------------------------------------------------- heatmap / heat strip
  function heat(host, rows, cols, cell, o = {}) {
    const b = box(host);
    const w = width(b), small = w < 460;
    const lw = o.labelW || (small ? 80 : 110), ch = o.cellH || 20, gap = 2;
    const cw = (w - lw - 2) / cols.length;
    const stagger = cw < 16 && (o.every || 1) === 1; // too narrow for every label on one line: alternate two lines
    const h = rows.length * (ch + gap) + 20 + (stagger ? 10 : 0) + (o.xTitle ? 16 : 0);
    const svg = svgOf(w, h, o.label); b.appendChild(svg);
    rows.forEach((rl, r) => {
      svg.appendChild(S('text', { x: lw - 6, y: r * (ch + gap) + ch / 2 + 4, class: 'lab', 'text-anchor': 'end', text: trunc(rl, small ? 11 : 16) }));
      cols.forEach((cl, c) => {
        const k = cell(r, c);
        svg.appendChild(S('rect', { x: lw + c * cw + 1, y: r * (ch + gap), width: Math.max(2, cw - gap), height: ch, rx: 3, fill: k.fill,
          stroke: k.empty ? 'var(--color-border-line)' : null, tip: k.tip }));
      });
    });
    const every = o.every || 1, yl = rows.length * (ch + gap) + 12;
    // narrow columns (24 hours on a phone) get smaller labels rather than fewer
    const fs = cw < 18 ? 10 : null;
    cols.forEach((cl, c) => { if (c % every === 0) svg.appendChild(S('text', { x: lw + c * cw + cw / 2, y: yl + (stagger && c % 2 ? 10 : 0), class: 'ax', 'text-anchor': 'middle', 'font-size': fs, text: cl })); });
    if (o.xTitle) svg.appendChild(S('text', { x: lw + (w - lw) / 2, y: h - 2, class: 'ax', 'text-anchor': 'middle', text: o.xTitle }));
    return b;
  }

  // ---------------------------------------------------------------- donut
  function donut(host, parts, o = {}) {
    const b = box(host);
    const size = o.size || 180, svg = svgOf(size, size, o.label); b.appendChild(svg);
    b.style.width = size + 'px';
    const cx = size / 2, R1 = size / 2 - 8, R0 = R1 * 0.62, total = parts.reduce((s, p) => s + p.v, 0) || 1;
    const P = (r, t) => `${(cx + r * Math.cos(t)).toFixed(2)} ${(cx + r * Math.sin(t)).toFixed(2)}`;
    let a = -Math.PI / 2;
    parts.forEach((p) => {
      if (!p.v) return;
      const sweep = (p.v / total) * 2 * Math.PI;
      if (sweep >= 2 * Math.PI - 1e-6) {
        svg.appendChild(S('circle', { cx, cy: cx, r: (R0 + R1) / 2, fill: 'none', stroke: p.color, 'stroke-width': R1 - R0, tip: p.tip }));
      } else {
        const a1 = a + sweep - Math.min(0.02, sweep / 4), big = a1 - a > Math.PI ? 1 : 0;
        svg.appendChild(S('path', { d: `M${P(R1, a)}A${R1} ${R1} 0 ${big} 1 ${P(R1, a1)}L${P(R0, a1)}A${R0} ${R0} 0 ${big} 0 ${P(R0, a)}Z`, fill: p.color, tip: p.tip }));
      }
      a += sweep;
    });
    if (o.center != null) svg.appendChild(S('text', { x: cx, y: cx + 4, class: 'lab', 'text-anchor': 'middle', style: 'font-size: 22px; font-weight: 600', text: o.center }));
    if (o.centerSub) svg.appendChild(S('text', { x: cx, y: cx + 21, class: 'ax', 'text-anchor': 'middle', text: o.centerSub }));
    return b;
  }

  // ---------------------------------------------------------------- sparkline
  function spark(host, vals, o = {}) {
    const b = box(host);
    const w = width(b), h = o.height || 54, svg = svgOf(w, h, o.label || 'trend'); b.appendChild(svg);
    const lo = Math.min(...vals), hi = Math.max(...vals), X = lin(0, vals.length - 1, 2, w - 2), Y = lin(lo, hi === lo ? lo + 1 : hi, h - 4, 4);
    const d = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('');
    svg.appendChild(S('path', { d: `${d}L${X(vals.length - 1)} ${h}L2 ${h}Z`, fill: o.color || 'var(--color-accent)', 'fill-opacity': 0.12 }));
    svg.appendChild(S('path', { d, fill: 'none', stroke: o.color || 'var(--color-accent)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    svg.appendChild(S('circle', { cx: X(vals.length - 1), cy: Y(vals[vals.length - 1]), r: 3, fill: o.color || 'var(--color-accent)' }));
    if (o.tip) svg.appendChild(S('rect', { x: 0, y: 0, width: w, height: h, fill: 'transparent', tip: o.tip }));
    return b;
  }

  // ---------------------------------------------------------------- strip of squares (e.g. last 20 games)
  function strip(host, items, o = {}) {
    const b = box(host);
    const w = width(b), gap = o.gap ?? 4, n = Math.max(items.length, o.slots || 0);
    const sz = Math.max(8, Math.min(o.max || 34, (w - gap * (n - 1)) / n));
    const svg = svgOf(Math.ceil(n * sz + (n - 1) * gap), sz + 4, o.label); b.appendChild(svg);
    items.forEach((it, i) => {
      svg.appendChild(S('rect', { x: i * (sz + gap), y: 2, width: sz, height: sz, rx: Math.min(5, sz / 4), fill: it.color, tip: it.tip }));
      if (it.txt && sz > 15) svg.appendChild(S('text', { x: i * (sz + gap) + sz / 2, y: 2 + sz / 2 + 4, 'text-anchor': 'middle', style: 'fill: var(--color-panel); font-size: 12px; font-weight: 700; pointer-events: none', text: it.txt }));
    });
    return b;
  }

  function rateBar(rate, tipText) {
    const b = H('div', 'tt-c-bar'), i = H('i');
    i.style.width = Math.round(Math.max(0, Math.min(1, rate)) * 100) + '%';
    i.style.background = winColor(rate);
    b.append(i, H('b'));
    if (tipText) b.setAttribute('data-tip', tipText);
    return b;
  }
  function legend(items) {
    const l = H('div', 'tt-c-legend');
    items.forEach(([c, t]) => { const s = H('span'), i = H('i'); i.style.background = c; s.append(i, t); l.appendChild(s); });
    return l;
  }

  window.TT_CHARTS = Object.assign(window.TT_CHARTS || {}, { S, line, hbars, vbars, heat, donut, spark, strip, rateBar, legend, winColor, heatColor, PAL, niceTicks, showTip, hideTip, pc });
})();
