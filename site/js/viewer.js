// The map playback viewer (Match review).
(() => {
  // In-game player colours (by colour id), so the playback matches what players see in the game.
  const PCOL = ['#2d63e6', '#e3342f', '#2fb344', '#f2c418', '#21c2c9', '#9b40d6', '#9a9a9a', '#f28a1e'];
  const TERR = { l: [122, 146, 82], f: [44, 78, 42], w: [52, 104, 168], b: [196, 178, 120] };
  const RES = { g: '#f5d142', s: '#c9c9c9', r: '#ffffff', f: '#d95e8f' };
  const TASK = { wood: '#8a5a2b', food: '#e0609a', gold: '#f2c418', stone: '#b8b8b8', build: '#ffffff', relic: '#ffffff', idle: '#555555', '': '#555555' };
  const SIZE = { 'Town Center': 4, Castle: 4, Krepost: 3, Wonder: 5, Market: 4, Farm: 3, House: 2, Mill: 2, 'Lumber Camp': 2, 'Mining Camp': 2,
    'Watch Tower': 1, 'Guard Tower': 1, Keep: 1, 'Bombard Tower': 2, Outpost: 1, 'Palisade Gate': 1, Gate: 1, 'Fish Trap': 2, Feitoria: 4, Caravanserai: 3 };
  const LETTER = { Villager: 'V', Scouts: 'S', Knights: 'K', Camels: 'C', 'Battle elephants': 'E', 'Cav archers': 'CA', Archers: 'A', Skirmishers: 'Sk',
    Gunpowder: 'G', 'Militia line': 'M', Spears: 'Sp', Eagles: 'Ea', Monks: '+', Siege: '⚙', Navy: 'N', Trade: 'T', 'Unique units': 'U' };
  const KEY_BUILDINGS = new Set(['Town Center', 'Castle', 'Krepost', 'Monastery', 'Siege Workshop', 'Stable', 'Archery Range', 'Barracks', 'Market', 'University', 'Dock', 'Wonder', 'Blacksmith']);
  // upgrades worth calling out, grouped so the panel can show what kind of edge each one gives
  const KEY_TECH = {
    Economy: ['Loom', 'Double-Bit Axe', 'Bow Saw', 'Two-Man Saw', 'Horse Collar', 'Heavy Plow', 'Crop Rotation', 'Gold Mining', 'Gold Shaft Mining', 'Stone Mining', 'Stone Shaft Mining', 'Wheelbarrow', 'Hand Cart', 'Town Watch', 'Town Patrol', 'Caravan', 'Guilds', 'Coinage', 'Banking'],
    Attack: ['Fletching', 'Bodkin Arrow', 'Bracer', 'Forging', 'Iron Casting', 'Blast Furnace', 'Ballistics', 'Chemistry', 'Thumb Ring', 'Parthian Tactics'],
    Armor: ['Scale Mail Armor', 'Chain Mail Armor', 'Plate Mail Armor', 'Scale Barding Armor', 'Chain Barding Armor', 'Plate Barding Armor', 'Padded Archer Armor', 'Leather Archer Armor', 'Ring Archer Armor'],
    Units: ['Man-at-Arms', 'Long Swordsman', 'Two-Handed Swordsman', 'Champion', 'Pikeman', 'Halberdier', 'Crossbowman', 'Arbalester', 'Elite Skirmisher', 'Light Cavalry', 'Hussar', 'Cavalier', 'Paladin', 'Heavy Camel Rider', 'Heavy Cavalry Archer', 'Elite Battle Elephant', 'Onager', 'Capped Ram', 'Siege Ram', 'Heavy Scorpion', 'Bloodlines', 'Husbandry', 'Squires', 'Arson', 'Conscription', 'Supplies', 'Gambesons'],
    Defense: ['Masonry', 'Architecture', 'Murder Holes', 'Hoardings', 'Fortified Wall', 'Guard Tower', 'Keep', 'Treadmill Crane', 'Sappers', 'Heated Shot'],
  };
  const TECH_GROUP = new Map(Object.entries(KEY_TECH).flatMap(([g, list]) => list.map((t) => [t, g])));
  const BUILD_TIME_FALLBACK = 40;
  const fmtT = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, title) => { const b = mk('button', 'tt-btn', text); b.type = 'button'; if (title) { b.title = title; b.setAttribute('aria-label', title); } return b; };
  const N = (v) => (v == null || v === '' ? null : Number(v));
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); return `rgb(${Math.min(255, (n >> 16) * f) | 0},${Math.min(255, ((n >> 8) & 255) * f) | 0},${Math.min(255, (n & 255) * f) | 0})`; };

  // Playback files are rows; put the game back together from them.
  function unpack(rows) {
    const meta = rows.find((r) => r.k === 'meta');
    if (!meta) return null;
    const units = rows.filter((r) => r.k === 'un').map((r) => ({
      id: N(r.id), p: N(r.p), type: r.ty, cls: r.c, spd: N(r.sp), born: N(r.b), end: N(r.e), x: N(r.x), y: N(r.y),
      w: String(r.w || '').split(';').filter(Boolean).map((s) => { const a = s.split(','); return [+a[0], +a[1], +a[2], +a[3], +a[4], a[5] || '', +a[6] || 0, a[7] || '']; }),
    }));
    if (!units.length && rows.some((r) => r.k === 'z')) return { old: true };
    return {
      dimension: N(meta.dimension), duration_s: N(meta.duration_s), terrain: String(meta.terrain), elevation: String(meta.elevation), map: meta.map,
      players: rows.filter((r) => r.k === 'player').map((r) => ({ number: N(r.number), name: String(r.name), civ: r.civ, color: N(r.color), team: N(r.team), x: N(r.x), y: N(r.y), won: N(r.won) })),
      resources: rows.filter((r) => r.k === 'res').map((r) => [r.r, N(r.x), N(r.y)]),
      build: rows.filter((r) => r.k === 'bo').map((r) => ({ number: N(r.number), step: N(r.step), min: N(r.min), kind: r.kind, item: r.item })),
      units: rows.filter((r) => r.k === 'uc').map((r) => ({ number: N(r.number), unit: r.unit, class: r.class, count: N(r.count) })),
      tracks: units,
      sites: rows.filter((r) => r.k === 'si').map((r) => ({ p: N(r.p), n: r.n, t: N(r.t), done: N(r.done), x: N(r.x), y: N(r.y) })),
      events: rows.filter((r) => r.k && r.k.length === 1 && 'bwruamx'.includes(r.k) && r.t != null)
        .map((r) => ({ ...r, t: N(r.t), p: N(r.p), x: N(r.x), y: N(r.y), x2: N(r.x2), y2: N(r.y2), c: N(r.c), s: N(r.s), a: N(r.a) })).sort((a, b) => a.t - b.t),
    };
  }

  // Where a unit is at time t: walked from its last order point toward that order's target.
  function unitAt(u, t) {
    if (t < u.born || t > u.end) return null;
    const w = u.w; let i = -1, lo = 0, hi = w.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (w[m][0] <= t) { i = m; lo = m + 1; } else hi = m - 1; }
    if (i < 0) return { x: u.x, y: u.y, task: '', att: 0, moving: false, hx: 1, hy: 0 };
    const o = w[i]; const dx = o[3] - o[1], dy = o[4] - o[2]; const d = Math.hypot(dx, dy); const f = d > 0 ? Math.min(1, (u.spd * (t - o[0])) / d) : 1;
    let task = o[5];
    if (!task && u.cls === 'Villager') for (let j = i - 1; j >= 0 && j > i - 6; j -= 1) if (w[j][5]) { task = w[j][5]; break; }
    if (task === 'build' && t - o[0] > 60) task = 'idle';
    // units sent to the same spot spread out around it, as they do in the game
    const h = ((u.id * 2654435761) >>> 0) / 4294967296; const rad = u.cls === 'Villager' ? 0.7 : 0.4 + Math.sqrt(((u.id * 40503) % 97) / 97) * 1.4;
    return { x: o[1] + dx * f + Math.cos(h * 6.283) * rad * f, y: o[2] + dy * f + Math.sin(h * 6.283) * rad * f, task, att: o[6] && t - o[0] < 20 ? 1 : 0, tgt: o[7], tx: o[3], ty: o[4], moving: f < 1, hx: dx, hy: dy };
  }

  function build(box, pb, nameFn) {
    const st = { t: 0, playing: false, speed: 8, dir: 1, raf: 0, last: 0, sideAt: -1, view: 'all', mode: 'map', heat: 'recent', zoom: 1, panX: 0, panY: 0, follow: true, cam: [pb.dimension / 2, pb.dimension / 2], hover: null };
    const D = pb.dimension;
    const players = pb.players.map((p, i) => ({ ...p, col: PCOL[p.color] || PCOL[i % 8] }));
    const byNum = new Map(players.map((p) => [p.number, p]));
    const colOf = (n) => (byNum.get(n) || {}).col || '#fff';
    const unitClass = new Map((pb.units || []).map((u) => [u.unit, u.class]));
    const ev = pb.events;
    const research = ev.filter((e) => e.k === 'r');
    const ages = ev.filter((e) => e.k === 'a');
    const walls = ev.filter((e) => e.k === 'w');
    const sites = pb.sites.length ? pb.sites : ev.filter((e) => e.k === 'b').map((b) => ({ p: b.p, n: b.n, t: b.t, done: b.t + BUILD_TIME_FALLBACK, x: b.x, y: b.y }));
    const tracks = pb.tracks;
    const alive = (t) => { const out = []; for (const u of tracks) { const p = unitAt(u, t); if (p) out.push({ u, ...p }); } return out; };

    // ---------- layout
    const wrap = mk('div', 'tt-viewer');
    const left = mk('div');
    const bar1 = mk('div', 'tt-play');
    const modeBox = mk('div', 'tt-chips'); modeBox.setAttribute('role', 'group'); modeBox.setAttribute('aria-label', 'Look');
    const modeBtns = [['map', 'Map'], ['detail', 'Detailed'], ['game', 'Game-style']].map(([m, label]) => {
      const b = mk('button', 'tt-chip', label); b.type = 'button'; b.dataset.mode = m; b.setAttribute('aria-pressed', String(m === st.mode));
      b.addEventListener('click', () => { st.mode = m; st.zoom = 1; st.panX = 0; st.panY = 0; modeBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); legendDraw(); drawOver(); });
      return b;
    });
    modeBox.append(...modeBtns);
    const heatSel = document.createElement('select'); heatSel.className = 'tt-btn'; heatSel.setAttribute('aria-label', 'Heatmap');
    [['recent', 'Heatmap: army, last 60 s'], ['game', 'Heatmap: army, whole game so far'], ['eco', 'Heatmap: villagers working'], ['off', 'Heatmap: off']].forEach(([v, l]) => heatSel.appendChild(new Option(l, v)));
    heatSel.addEventListener('change', () => { st.heat = heatSel.value; heatKey = ''; drawOver(); });
    const followLbl = mk('label', 'tt-label'); const followBox = document.createElement('input'); followBox.type = 'checkbox'; followBox.checked = true;
    followBox.addEventListener('change', () => { st.follow = followBox.checked; if (st.follow) { st.panX = 0; st.panY = 0; } drawOver(); });
    followLbl.append(followBox, ' camera follows the fighting');
    bar1.append(modeBox, heatSel, followLbl);
    const views = mk('div', 'tt-chips'); views.setAttribute('role', 'group'); views.setAttribute('aria-label', 'Whose view');
    const viewBtns = [['all', 'Spectator (everything)'], ...players.map((p) => [String(p.number), `${nameFn(p.name)}'s view`])].map(([v, label]) => {
      const b = mk('button', 'tt-chip', label); b.type = 'button'; b.dataset.view = v; b.setAttribute('aria-pressed', String(v === 'all'));
      b.addEventListener('click', () => { st.view = v; viewBtns.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === v))); st.sideAt = -1; drawOver(); });
      return b;
    });
    views.append(...viewBtns);
    const map = mk('div', 'tt-map'); map.style.cursor = 'grab'; map.style.touchAction = 'none'; map.style.aspectRatio = '16 / 9';
    const canvas = document.createElement('canvas');
    const miniC = document.createElement('canvas'); miniC.className = 'tt-mini';
    const clock = mk('div', 'tt-clock', '0:00');
    const tip = mk('div', 'tt-tip'); tip.style.display = 'none';
    const zoomBox = mk('div', 'tt-zoom');
    const zin = btn('+', 'Zoom in'), zout = btn('−', 'Zoom out'), zfit = btn('Fit', 'Reset the camera');
    zoomBox.append(zin, zout, zfit);
    map.append(canvas, miniC, clock, zoomBox, tip);
    const ctl = mk('div', 'tt-play');
    const bStart = btn('⏮', 'Back to the start'), bB30 = btn('−30s', 'Back 30 seconds'), bB10 = btn('−10s', 'Back 10 seconds');
    const bRev = btn('◀', 'Play backwards'), play = btn('▶', 'Play'), bF10 = btn('+10s', 'Forward 10 seconds'), bF30 = btn('+30s', 'Forward 30 seconds');
    const speed = document.createElement('select'); speed.className = 'tt-btn'; speed.setAttribute('aria-label', 'Speed');
    [0.5, 1, 2, 4, 8, 16, 32, 64].forEach((s) => speed.appendChild(new Option(`${s}×`, String(s)))); speed.value = '8';
    const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = String(Math.ceil(pb.duration_s)); range.step = '1'; range.value = '0'; range.setAttribute('aria-label', 'Game time');
    const tlabel = mk('span', 'tt-label', `0:00 / ${fmtT(pb.duration_s)}`);
    ctl.append(bStart, bB30, bB10, bRev, play, bF10, bF30, speed, range, tlabel);
    const strip = mk('div', 'tt-strip');
    const legend = mk('div', 'tt-legend');
    const hint = mk('div', 'tt-label', 'Scroll or + / − to zoom, drag to look around, hover a unit for details. Keys: space play/pause, ← → skip 10 s (shift: 30 s).');
    left.append(bar1, views, map, ctl, strip, legend, hint);
    const side = mk('div', 'tt-side');
    const pstats = mk('div', 'tt-side');
    const feedH = mk('div', 'tt-label', 'Key moments and upgrades (click to jump)');
    const feed = mk('div', 'tt-feed');
    side.append(pstats, feedH, feed);
    wrap.append(left, side);
    box.replaceChildren(wrap);

    // ---------- geometry
    let W = 0, H = 0, K = 0;
    const iso = (x, y) => [W / 2 + ((x - st.cam[0]) + (y - st.cam[1])) * K + st.panX, H / 2 + ((y - st.cam[1]) - (x - st.cam[0])) * K / 2 + st.panY];
    const unIso = (sx, sy) => { const X = (sx - W / 2 - st.panX) / K, Y = (sy - H / 2 - st.panY) / (K / 2); return [st.cam[0] + (X - Y) / 2, st.cam[1] + (X + Y) / 2]; };
    function setScale() {
      const base = st.mode === 'map' ? Math.min(W / (2 * D), H / D) : st.mode === 'detail' ? W / (2 * 40) : W / (2 * 26);
      K = base * st.zoom;
    }
    function size() {
      W = map.clientWidth; H = map.clientHeight;
      if (!W || !H) return false;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      miniC.width = Math.round(miniC.clientWidth * dpr); miniC.height = Math.round(miniC.clientHeight * dpr);
      makeTerrain();
      return true;
    }
    // terrain as one small image (one pixel per tile), drawn through the isometric transform
    const terrainImg = document.createElement('canvas');
    function makeTerrain() {
      terrainImg.width = D; terrainImg.height = D;
      const o = terrainImg.getContext('2d'); const img = o.createImageData(D, D);
      for (let i = 0; i < D * D; i += 1) {
        const c = TERR[pb.terrain[i]] || TERR.l; const e = Number(pb.elevation[i] || 0) * 6; const n = (((i % D) * 73856093) ^ (Math.floor(i / D) * 19349663)) % 9;
        img.data[i * 4] = Math.min(255, c[0] + e + n); img.data[i * 4 + 1] = Math.min(255, c[1] + e + n); img.data[i * 4 + 2] = Math.min(255, c[2] + e + n); img.data[i * 4 + 3] = 255;
      }
      o.putImageData(img, 0, 0);
    }
    function drawTerrain(ctx, dpr) {
      ctx.save();
      const [ox, oy] = iso(0, 0);
      ctx.setTransform(dpr * K, dpr * -K / 2, dpr * K, dpr * K / 2, dpr * ox, dpr * oy);
      ctx.imageSmoothingEnabled = st.mode === 'map' && st.zoom < 2;
      ctx.drawImage(terrainImg, 0, 0);
      ctx.restore();
    }

    // ---------- heatmap: where armies (or working villagers) have been, per player colour
    const heatC = document.createElement('canvas');
    let heatKey = '';
    function heat(T) {
      const key = `${st.heat}|${Math.floor(T / 3)}|${st.view}`;
      if (key === heatKey) return;
      heatKey = key;
      const G = 2, n = Math.ceil(D / G);
      heatC.width = n; heatC.height = n;
      const hc = heatC.getContext('2d');
      hc.clearRect(0, 0, n, n);
      if (st.heat === 'off') return;
      const from = st.heat === 'game' ? 0 : st.heat === 'eco' ? T - 30 : T - 60, step = st.heat === 'game' ? 15 : 5;
      const me = viewer(); const team = me ? players.filter((p) => p.team === me.team || p.number === me.number).map((p) => p.number) : null;
      const grids = new Map(players.filter((p) => !team || team.includes(p.number)).map((p) => [p.number, new Float32Array(n * n)]));
      const eco = st.heat === 'eco';
      for (let t = Math.max(0, from); t <= T; t += step) {
        for (const u of tracks) {
          const g = grids.get(u.p); if (!g) continue;
          if (eco !== (u.cls === 'Villager')) continue;
          if (t < u.born || t > u.end) continue;
          const a = unitAt(u, t); if (!a) continue;
          if (eco && (!a.task || a.task === 'idle')) continue;
          const gx = Math.floor(a.x / G), gy = Math.floor(a.y / G);
          if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
          g[gy * n + gx] += 1;
        }
      }
      const img = hc.createImageData(n, n);
      players.forEach((p) => {
        const grid = grids.get(p.number); if (!grid) return;
        let max = 0; for (let i = 0; i < grid.length; i += 1) if (grid[i] > max) max = grid[i];
        if (!max) return;
        const c = parseInt(p.col.slice(1), 16), r = c >> 16, g = (c >> 8) & 255, b = c & 255;
        for (let i = 0; i < n * n; i += 1) {
          if (!grid[i]) continue;
          const a = Math.min(1, 0.25 + Math.sqrt(grid[i] / max)) * 200;
          const j = i * 4;
          if (a > img.data[j + 3]) { img.data[j] = r; img.data[j + 1] = g; img.data[j + 2] = b; img.data[j + 3] = a; }
        }
      });
      hc.putImageData(img, 0, 0);
    }
    function drawHeat(ctx, dpr) {
      if (st.heat === 'off') return;
      ctx.save();
      const [ox, oy] = iso(0, 0);
      ctx.setTransform(dpr * K * 2, dpr * -K, dpr * K * 2, dpr * K, dpr * ox, dpr * oy);
      ctx.globalAlpha = st.mode === 'map' ? 0.9 : 0.5;
      ctx.filter = `blur(${Math.max(0.6, 1.4)}px)`;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(heatC, 0, 0);
      ctx.restore();
    }

    // ---------- what the chosen player can see (estimated: near their buildings and units)
    function viewer() { return st.view === 'all' ? null : byNum.get(Number(st.view)); }
    function sightSources(T, list, me) {
      const team = players.filter((p) => p.team === me.team || p.number === me.number).map((p) => p.number);
      const pts = [];
      players.forEach((p) => { if (team.includes(p.number) && p.x != null) pts.push([p.x, p.y, 14]); });
      sites.forEach((b) => { if (b.t <= T && team.includes(b.p)) pts.push([b.x, b.y, 9]); });
      list.forEach((a) => { if (team.includes(a.u.p)) pts.push([a.x, a.y, a.u.cls === 'Villager' ? 4 : 7]); });
      return { team, pts };
    }
    const seen = (pts, x, y) => pts.some(([a, b, r]) => (a - x) ** 2 + (b - y) ** 2 <= r * r);

    function poly(ctx, x, y, s) { const h = s / 2; const p = [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]].map(([a, b]) => iso(a, b)); ctx.beginPath(); ctx.moveTo(...p[0]); p.slice(1).forEach((q) => ctx.lineTo(...q)); ctx.closePath(); }
    function fightCentre(list) {
      const mil = list.filter((a) => a.u.cls !== 'Villager'); if (!mil.length) return null; let best = null, bs = -1;
      for (const a of mil) { let s = 0; for (const b of mil) { if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 14) s += (b.u.p !== a.u.p ? 3 : 1) + (b.att ? 1 : 0); } if (s > bs) { bs = s; best = a; } }
      return best ? [best.x, best.y] : null;
    }

    let list = [];
    function drawOver() {
      if (!W) return;
      const dpr = window.devicePixelRatio || 1;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const T = st.t;
      list = alive(T);
      if (st.mode === 'map') { st.cam = [D / 2, D / 2]; } else if (st.follow) { const c = fightCentre(list); if (c) { const k = st.playing ? 0.05 : 1; st.cam[0] += (c[0] - st.cam[0]) * k; st.cam[1] += (c[1] - st.cam[1]) * k; } }
      setScale();
      ctx.fillStyle = '#0d0d0c'; ctx.fillRect(0, 0, W, H);
      drawTerrain(ctx, dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const me = viewer();
      const vis = me ? sightSources(T, list, me) : null;
      const show = (p, x, y) => !vis || vis.team.includes(p) || seen(vis.pts, x, y);
      heat(T); drawHeat(ctx, dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.filter = 'none';
      if (st.mode === 'game') drawGame(ctx, T, show); else drawFlat(ctx, T, show);
      if (vis) drawFog(ctx, dpr, vis);
      drawMini(dpr, T, show);
      clock.textContent = `${fmtT(T)}${st.playing ? (st.dir < 0 ? ' ◀ ' : ' ▶ ') + speed.value + '×' : ''}`;
      tlabel.textContent = `${fmtT(T)} / ${fmtT(pb.duration_s)}`;
      if (document.activeElement !== range) range.value = String(Math.floor(T));
      if (playhead) playhead.attr('x1', sx(T)).attr('x2', sx(T));
      if (Math.abs(st.sideAt - T) >= 1 || !st.playing) { st.sideAt = T; drawSide(); }
    }
    const fogC = document.createElement('canvas');
    function drawFog(ctx, dpr, vis) {
      if (fogC.width !== canvas.width || fogC.height !== canvas.height) { fogC.width = canvas.width; fogC.height = canvas.height; }
      const g = fogC.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(0,0,0,.5)';
      g.beginPath(); [[0, 0], [D, 0], [D, D], [0, D]].map(([a, b]) => iso(a, b)).forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.fill();
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
      vis.pts.forEach(([x, y, r]) => { const [cx, cy] = iso(x, y); g.beginPath(); g.ellipse(cx, cy, r * K * 1.4, r * K * 0.7, 0, 0, Math.PI * 2); g.fill(); });
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fogC, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ---------- map and detailed looks
    function drawFlat(ctx, T, show) {
      const detail = st.mode === 'detail';
      if (detail && K > 9) { ctx.strokeStyle = 'rgba(0,0,0,.07)'; ctx.lineWidth = 1; for (let i = 0; i <= D; i += 1) { ctx.beginPath(); ctx.moveTo(...iso(i, 0)); ctx.lineTo(...iso(i, D)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(...iso(0, i)); ctx.lineTo(...iso(D, i)); ctx.stroke(); } }
      pb.resources.forEach(([t, x, y]) => { const [a, b] = iso(x, y); ctx.fillStyle = RES[t] || '#fff'; ctx.beginPath(); ctx.arc(a, b, Math.max(1.2, K * 0.42), 0, 7); ctx.fill(); });
      ctx.lineCap = 'round';
      walls.forEach((w) => { if (w.t > T || !show(w.p, w.x, w.y)) return; ctx.strokeStyle = colOf(w.p); ctx.lineWidth = Math.max(1.5, K * (String(w.n).includes('Stone') ? 0.8 : 0.55)); ctx.beginPath(); ctx.moveTo(...iso(w.x + 0.5, w.y + 0.5)); ctx.lineTo(...iso(w.x2 + 0.5, w.y2 + 0.5)); ctx.stroke(); });
      sites.forEach((b) => {
        if (b.t > T || !show(b.p, b.x, b.y)) return;
        const building = T < b.done;
        poly(ctx, b.x, b.y, SIZE[b.n] || 3); ctx.fillStyle = colOf(b.p); ctx.globalAlpha = b.n === 'Farm' ? 0.5 : building ? 0.35 : 0.95; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; if (building) ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
        if (detail && K > 10 && b.n !== 'Farm' && b.n !== 'House') {
          const [a, c] = iso(b.x, b.y); const label = building ? `${b.n} ${Math.floor(((T - b.t) / (b.done - b.t)) * 100)}%` : b.n;
          ctx.font = '600 11px sans-serif'; ctx.textAlign = 'center'; const tw = ctx.measureText(label).width + 8; ctx.fillStyle = 'rgba(0,0,0,.66)'; ctx.fillRect(a - tw / 2, c - 24, tw, 15); ctx.fillStyle = '#fff'; ctx.fillText(label, a, c - 13);
        }
      });
      // attack lines
      list.forEach((a) => { if (!a.att || !show(a.u.p, a.x, a.y)) return; const [x1, y1] = iso(a.x, a.y), [x2, y2] = iso(a.tx, a.ty); ctx.strokeStyle = colOf(a.u.p); ctx.globalAlpha = 0.5; ctx.lineWidth = detail ? 1.2 : 1; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; });
      // clashes where enemy soldiers meet
      const mil = list.filter((a) => a.u.cls !== 'Villager' && show(a.u.p, a.x, a.y));
      for (let i = 0; i < mil.length; i += 1) for (let j = i + 1; j < mil.length; j += 1) {
        const a = mil[i], b = mil[j]; if (a.u.p === b.u.p || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 2) continue;
        const [x, y] = iso((a.x + b.x) / 2, (a.y + b.y) / 2); ctx.fillStyle = '#fff6b0'; ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(T * 3 + i)); star(ctx, x, y, detail ? 5 : 3.5, detail ? 2.2 : 1.5); ctx.globalAlpha = 1;
      }
      list.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y)).forEach((a) => {
        if (!show(a.u.p, a.x, a.y)) return;
        const [x, y] = iso(a.x, a.y); const v = a.u.cls === 'Villager';
        if (!detail) { // map look: live soldier dots, small villager dots
          ctx.beginPath(); ctx.arc(x, y, v ? Math.max(1, K * 0.35) : Math.max(1.8, K * 0.55), 0, 7); ctx.fillStyle = colOf(a.u.p); ctx.globalAlpha = v ? 0.65 : 1; ctx.fill(); ctx.globalAlpha = 1;
          if (!v) { ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke(); }
          return;
        }
        const r = v ? 5.5 : 8;
        if (v) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = colOf(a.u.p); ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = TASK[a.task || '']; ctx.stroke(); }
        else {
          ctx.beginPath();
          if (/Knights|Scouts|Camels|elephants|Cav/.test(a.u.cls)) { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
          else if (/Archers|Skirm|Gunpowder/.test(a.u.cls)) { ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.95, y + r * 0.75); ctx.lineTo(x - r * 0.95, y + r * 0.75); ctx.closePath(); }
          else if (a.u.cls === 'Siege') ctx.rect(x - r, y - r * 0.8, r * 2, r * 1.6); else ctx.arc(x, y, r, 0, 7);
          ctx.fillStyle = colOf(a.u.p); ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = a.att ? '#fff' : 'rgba(0,0,0,.8)'; ctx.stroke();
        }
        if (K > 9) { ctx.fillStyle = '#fff'; ctx.font = `700 ${v ? 7 : 8}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(LETTER[a.u.cls] || 'U', x, y + 3); }
        if (st.hover && st.hover.u === a.u) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke(); }
      });
    }
    function star(ctx, x, y, R, r) { ctx.beginPath(); for (let i = 0; i < 10; i += 1) { const a = (i * Math.PI) / 5; const rr = i % 2 ? r : R; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }

    // ---------- game-style look (original simple art, not the game's graphics)
    function drawGame(ctx, T, show) {
      // grass texture and water movement over the terrain image
      const [c0x, c0y] = unIso(0, 0), [c1x, c1y] = unIso(W, H), [c2x, c2y] = unIso(W, 0), [c3x, c3y] = unIso(0, H);
      const x0 = Math.max(0, Math.floor(Math.min(c0x, c1x, c2x, c3x)) - 2), x1 = Math.min(D - 1, Math.ceil(Math.max(c0x, c1x, c2x, c3x)) + 2);
      const y0 = Math.max(0, Math.floor(Math.min(c0y, c1y, c2y, c3y)) - 2), y1 = Math.min(D - 1, Math.ceil(Math.max(c0y, c1y, c2y, c3y)) + 2);
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
        const c = pb.terrain[y * D + x];
        if (c === 'w') { const [a, b] = iso(x + 0.5, y + 0.5); const ph = Math.sin(x * 0.9 + y * 0.6 + T * 1.8); if (ph > 0.6) { ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a - K * 0.4, b); ctx.lineTo(a + K * 0.4, b); ctx.stroke(); } }
        else if (c === 'l' && ((x * 7 + y * 13) % 5 === 0)) { const [a, b] = iso(x + 0.3, y + 0.6); ctx.strokeStyle = 'rgba(40,70,20,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(a - 1, b - K * 0.25); ctx.moveTo(a + 2, b); ctx.lineTo(a + 3, b - K * 0.2); ctx.stroke(); }
      }
      const S = [];
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (pb.terrain[y * D + x] === 'f') { const [a, b] = iso(x + 0.5, y + 0.5); S.push({ d: x + y + 1, f: () => tree(ctx, a, b, (x * 31 + y * 17) % 5) }); }
      pb.resources.forEach(([t, x, y]) => { if (x < x0 || x > x1 || y < y0 || y > y1) return; const [a, b] = iso(x, y); S.push({ d: x + y, f: () => pile(ctx, a, b, t) }); });
      sites.forEach((b) => { if (b.t > T || !show(b.p, b.x, b.y)) return; S.push({ d: b.x + b.y, f: () => building(ctx, b, T) }); });
      walls.forEach((w) => { if (w.t > T || !show(w.p, w.x, w.y)) return; const n = Math.max(Math.abs(w.x2 - w.x), Math.abs(w.y2 - w.y)); for (let i = 0; i <= n; i += 1) { const x = w.x + (w.x2 - w.x) * (n ? i / n : 0) + 0.5, y = w.y + (w.y2 - w.y) * (n ? i / n : 0) + 0.5; S.push({ d: x + y, f: () => wallPost(ctx, x, y, colOf(w.p), String(w.n).includes('Stone')) }); } });
      list.forEach((a) => { if (!show(a.u.p, a.x, a.y)) return; const [x, y] = iso(a.x, a.y); if (x < -40 || x > W + 40 || y < -60 || y > H + 40) return; S.push({ d: a.x + a.y + 0.02, f: () => figure(ctx, x, y, a, T) }); });
      S.sort((a, b) => a.d - b.d).forEach((s) => s.f());
      list.forEach((a, i) => {
        if (!a.att || !/Archers|Skirm|Cav archers|Gunpowder/.test(a.u.cls) || !show(a.u.p, a.x, a.y)) return;
        const d = Math.hypot(a.tx - a.x, a.ty - a.y); if (d > 7 || d < 0.5) return;
        const ph = (T * 1.6 + i * 0.37) % 1; const [xa, ya] = iso(a.x, a.y), [xb, yb] = iso(a.tx, a.ty);
        const x = xa + (xb - xa) * ph, y = ya + (yb - ya) * ph - Math.sin(ph * Math.PI) * K * 1.2;
        ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y - K * 0.45); ctx.lineTo(x + ((xb - xa) / d) * 0.08, y - K * 0.45 + ((yb - ya) / d) * 0.08 + 3); ctx.stroke();
      });
    }
    function tree(ctx, sx, sy, v) { const h = K * 1.6, w = K * 0.7; ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(sx + w * 0.3, sy, w, w * 0.4, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#5a3b22'; ctx.fillRect(sx - K * 0.07, sy - h * 0.35, K * 0.14, h * 0.35); const g = ['#2f5a2a', '#355f2c', '#2a5226', '#3a6630', '#2c5528'][v]; ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx, sy - h * 1.35); ctx.lineTo(sx + w, sy - h * 0.3); ctx.lineTo(sx - w, sy - h * 0.3); ctx.closePath(); ctx.fill(); ctx.fillStyle = shade(g, 1.25); ctx.beginPath(); ctx.moveTo(sx, sy - h * 1.35); ctx.lineTo(sx + w * 0.8, sy - h * 0.6); ctx.lineTo(sx + w * 0.1, sy - h * 0.6); ctx.closePath(); ctx.fill(); }
    function pile(ctx, sx, sy, t) { const c = { g: ['#f0cc45', '#a8861c'], s: ['#c4c4c4', '#7d7d7d'], r: ['#fff8e0', '#c9b98a'], f: ['#3f7a34', '#d4507a'] }[t] || ['#fff', '#999']; ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(sx, sy + 2, K * 0.6, K * 0.25, 0, 0, 7); ctx.fill(); ctx.fillStyle = c[1]; ctx.beginPath(); ctx.ellipse(sx, sy, K * 0.55, K * 0.35, 0, 0, 7); ctx.fill(); ctx.fillStyle = c[0]; ctx.beginPath(); ctx.ellipse(sx - K * 0.1, sy - K * 0.12, K * 0.35, K * 0.22, 0, 0, 7); ctx.fill(); }
    function wallPost(ctx, x, y, col, stone) { const [sx, sy] = iso(x, y); const h = K * (stone ? 1.1 : 0.8), w = K * 0.45; const base = stone ? '#9c968a' : '#7a5534'; ctx.fillStyle = base; ctx.fillRect(sx - w / 2, sy - h, w, h); ctx.fillStyle = shade(base, 0.75); ctx.fillRect(sx, sy - h, w / 2, h); ctx.fillStyle = col; ctx.fillRect(sx - w / 2, sy - h, w, K * 0.15); }
    function building(ctx, b, T) {
      const s = SIZE[b.n] || 3, h = s / 2, x = b.x, y = b.y, col = colOf(b.p);
      const P = [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]].map(([a, c]) => iso(a, c));
      if (b.n === 'Farm') { const grow = Math.min(1, (T - b.t) / 60); ctx.fillStyle = '#8f7436'; ctx.beginPath(); ctx.moveTo(...P[0]); P.slice(1).forEach((q) => ctx.lineTo(...q)); ctx.closePath(); ctx.fill(); ctx.strokeStyle = shade('#d8c36a', 0.7 + grow * 0.4); ctx.lineWidth = Math.max(1, K * 0.18); for (let i = 1; i < 6; i += 1) { ctx.beginPath(); ctx.moveTo(...iso(x - h + (i * s) / 6, y - h + 0.2)); ctx.lineTo(...iso(x - h + (i * s) / 6, y + h - 0.2)); ctx.stroke(); } return; }
      const done = T >= b.done, f = done ? 1 : Math.max(0.08, (T - b.t) / (b.done - b.t));
      const tall = ({ 'Town Center': 2.2, Castle: 3, 'Watch Tower': 3.4, 'Guard Tower': 3.6, Keep: 3.8, House: 1.1, Market: 1.5, Krepost: 2.6 }[b.n] || 1.5) * K * (s > 2 ? 1 : 1.2) * f;
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.moveTo(P[0][0] + K * 0.7, P[0][1] + K * 0.35); P.slice(1).forEach((q) => ctx.lineTo(q[0] + K * 0.7, q[1] + K * 0.35)); ctx.closePath(); ctx.fill();
      const stoneB = /Castle|Tower|Keep|Krepost/.test(b.n); const wallC = stoneB ? '#a8a091' : '#cdb68b'; const up = (q) => [q[0], q[1] - tall];
      ctx.fillStyle = shade(wallC, 0.78); ctx.beginPath(); ctx.moveTo(...P[3]); ctx.lineTo(...P[2]); ctx.lineTo(...up(P[2])); ctx.lineTo(...up(P[3])); ctx.closePath(); ctx.fill();
      ctx.fillStyle = wallC; ctx.beginPath(); ctx.moveTo(...P[2]); ctx.lineTo(...P[1]); ctx.lineTo(...up(P[1])); ctx.lineTo(...up(P[2])); ctx.closePath(); ctx.fill();
      if (!done) {
        ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 1.5; [P[1], P[2], P[3]].forEach((q) => { ctx.beginPath(); ctx.moveTo(...q); ctx.lineTo(q[0], q[1] - K * 2.2); ctx.stroke(); });
        ctx.beginPath(); ctx.moveTo(P[3][0], P[3][1] - K * 1.2); ctx.lineTo(P[2][0], P[2][1] - K * 1.2); ctx.lineTo(P[1][0], P[1][1] - K * 1.2); ctx.stroke();
        const [cx, cy] = iso(x, y); ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(cx - K * 1.2, cy - K * 3, K * 2.4, 5); ctx.fillStyle = col; ctx.fillRect(cx - K * 1.2, cy - K * 3, K * 2.4 * f, 5); return;
      }
      if (stoneB) {
        const top = P.map(up); ctx.fillStyle = shade(wallC, 0.9); ctx.beginPath(); ctx.moveTo(...top[0]); top.slice(1).forEach((q) => ctx.lineTo(...q)); ctx.closePath(); ctx.fill();
        for (let i = 0; i < 4; i += 1) { const q = top[(i + 1) % 4], r = top[i]; for (let j = 1; j < 4; j += 2) { ctx.fillRect(r[0] + ((q[0] - r[0]) * j) / 4 - 2, r[1] + ((q[1] - r[1]) * j) / 4 - 5, 4, 5); } }
        const [cx, cy] = iso(x, y); ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, cy - tall); ctx.lineTo(cx, cy - tall - K * 1.2); ctx.stroke();
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx, cy - tall - K * 1.2); ctx.lineTo(cx + K * 0.7 + Math.sin(T * 4) * 2, cy - tall - K); ctx.lineTo(cx, cy - tall - K * 0.8); ctx.closePath(); ctx.fill(); return;
      }
      const top = P.map(up); const apex = [(top[0][0] + top[2][0]) / 2, (top[0][1] + top[2][1]) / 2 - K * s * 0.35];
      [[top[3], top[2], 0.82], [top[2], top[1], 1.05], [top[0], top[3], 0.9], [top[1], top[0], 0.95]].forEach(([a, c, l]) => { ctx.fillStyle = shade(col, l); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...c); ctx.lineTo(...apex); ctx.closePath(); ctx.fill(); });
      ctx.fillStyle = 'rgba(30,20,10,.75)'; const d = iso(x + h * 0.2, y + h); ctx.fillRect(d[0] - K * 0.15, d[1] - K * 0.55, K * 0.3, K * 0.5);
    }
    function figure(ctx, sx, sy, a, T) {
      const s = Math.max(0.8, K / 13), col = colOf(a.u.p), cls = a.u.cls; const face = a.hx - a.hy >= 0 ? 1 : -1; const bob = a.moving ? Math.abs(Math.sin(T * 9 + a.u.id)) * s : 0; const y = sy - bob;
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(sx, sy, 5 * s, 2 * s, 0, 0, 7); ctx.fill();
      if (/Knights|Scouts|Camels|Cav archers/.test(cls)) {
        const camel = cls === 'Camels'; ctx.fillStyle = camel ? '#c8a46a' : cls === 'Scouts' ? '#8a6a4a' : '#5b4030';
        ctx.fillRect(sx - 6 * s, y - 7 * s, 12 * s, 4 * s); ctx.fillRect(sx + face * 4 * s - (face < 0 ? 3 * s : 0), y - (camel ? 12 : 10) * s, 3 * s, (camel ? 6 : 4) * s);
        const leg = a.moving ? Math.sin(T * 12 + a.u.id) * 1.5 * s : 0; ctx.fillRect(sx - 5 * s + leg, y - 3 * s, 1.5 * s, 3 * s); ctx.fillRect(sx + 3.5 * s - leg, y - 3 * s, 1.5 * s, 3 * s);
        if (cls === 'Knights') { ctx.fillStyle = col; ctx.fillRect(sx - 6 * s, y - 6 * s, 12 * s, 2 * s); }
        ctx.fillStyle = cls === 'Knights' ? '#b9b9b9' : col; ctx.fillRect(sx - 2 * s, y - 13 * s, 4 * s, 6 * s); ctx.fillStyle = cls === 'Knights' ? '#9a9a9a' : '#e8c9a0'; ctx.beginPath(); ctx.arc(sx, y - 15 * s, 1.9 * s, 0, 7); ctx.fill(); ctx.fillStyle = col; ctx.fillRect(sx - 2 * s, y - 11 * s, 4 * s, 1.5 * s);
        if (cls === 'Knights' || cls === 'Scouts') { ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx + face * 2 * s, y - 10 * s); ctx.lineTo(sx + face * 8 * s, y - 16 * s); ctx.stroke(); }
        if (cls === 'Cav archers') { ctx.strokeStyle = '#5a3b22'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx + face * 3 * s, y - 11 * s, 3 * s, -1.3, 1.3); ctx.stroke(); }
      } else if (cls === 'Battle elephants') {
        ctx.fillStyle = '#8c8c8c'; ctx.beginPath(); ctx.ellipse(sx, y - 8 * s, 8 * s, 5.5 * s, 0, 0, 7); ctx.fill(); ctx.fillRect(sx - 6 * s, y - 4 * s, 2.5 * s, 4 * s); ctx.fillRect(sx + 3.5 * s, y - 4 * s, 2.5 * s, 4 * s); ctx.beginPath(); ctx.arc(sx + face * 8 * s, y - 9 * s, 3 * s, 0, 7); ctx.fill(); ctx.fillStyle = col; ctx.fillRect(sx - 4 * s, y - 14 * s, 8 * s, 3 * s);
      } else if (cls === 'Siege') {
        ctx.fillStyle = '#7a5534'; ctx.fillRect(sx - 7 * s, y - 7 * s, 14 * s, 5 * s); ctx.fillStyle = col; ctx.fillRect(sx - 7 * s, y - 9 * s, 14 * s, 2 * s); ctx.strokeStyle = '#5a3b22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx - face * 4 * s, y - 8 * s); ctx.lineTo(sx + face * 3 * s, y - 16 * s); ctx.stroke(); ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(sx - 5 * s, y - 1.5 * s, 2.2 * s, 0, 7); ctx.arc(sx + 5 * s, y - 1.5 * s, 2.2 * s, 0, 7); ctx.fill();
      } else {
        const v = cls === 'Villager', monk = cls === 'Monks';
        ctx.fillStyle = v ? '#c9b38a' : monk ? '#e9e2d2' : col; ctx.fillRect(sx - 2.2 * s, y - 9 * s, 4.4 * s, 7 * s); if (v || monk) { ctx.fillStyle = col; ctx.fillRect(sx - 2.2 * s, y - 9 * s, 4.4 * s, 1.8 * s); }
        const leg = a.moving ? Math.sin(T * 12 + a.u.id) * 1.2 * s : 0; ctx.fillStyle = '#3a2c20'; ctx.fillRect(sx - 2 * s + leg, y - 2 * s, 1.5 * s, 2 * s); ctx.fillRect(sx + 0.5 * s - leg, y - 2 * s, 1.5 * s, 2 * s);
        ctx.fillStyle = '#e8c9a0'; ctx.beginPath(); ctx.arc(sx, y - 11 * s, 1.9 * s, 0, 7); ctx.fill();
        if (cls === 'Militia line' || cls === 'Unique units') { ctx.fillStyle = '#9a9a9a'; ctx.beginPath(); ctx.arc(sx, y - 11.6 * s, 2 * s, Math.PI, 0); ctx.fill(); }
        const hand = [sx + face * 3 * s, y - 7 * s];
        if (v) { const tc = TASK[a.task || '']; ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(...hand); ctx.lineTo(hand[0] + face * 2 * s, hand[1] - 5 * s); ctx.stroke(); ctx.fillStyle = tc; ctx.fillRect(hand[0] + face * 2 * s - 1.2 * s, hand[1] - 6 * s, 2.4 * s, 2 * s); }
        else if (cls === 'Archers' || cls === 'Skirmishers' || cls === 'Gunpowder') { ctx.strokeStyle = cls === 'Gunpowder' ? '#333' : '#5a3b22'; ctx.lineWidth = 1.1; ctx.beginPath(); if (cls === 'Archers') ctx.arc(hand[0], hand[1] - 2 * s, 3.2 * s, face > 0 ? -1.3 : Math.PI - 1.3, face > 0 ? 1.3 : Math.PI + 1.3); else { ctx.moveTo(hand[0], hand[1]); ctx.lineTo(hand[0] + face * 5 * s, hand[1] - 4 * s); } ctx.stroke(); }
        else if (cls === 'Spears') { ctx.strokeStyle = '#cfcfcf'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hand[0], y - s); ctx.lineTo(hand[0], y - 17 * s); ctx.stroke(); }
        else if (monk) { ctx.strokeStyle = '#d9b44a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hand[0], y - 2 * s); ctx.lineTo(hand[0], y - 14 * s); ctx.moveTo(hand[0] - 1.8 * s, y - 12 * s); ctx.lineTo(hand[0] + 1.8 * s, y - 12 * s); ctx.stroke(); }
        else { ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(...hand); ctx.lineTo(hand[0] + face * 4 * s, hand[1] - 4 * s); ctx.stroke(); ctx.fillStyle = shade(col, 0.7); ctx.fillRect(sx - face * 3.5 * s - 1.2 * s, y - 9 * s, 2.4 * s, 4.5 * s); }
        if (a.att && !v && Math.sin(T * 10 + a.u.id) > 0.7) { ctx.fillStyle = '#fff6b0'; ctx.beginPath(); ctx.arc(hand[0] + face * 4 * s, hand[1] - 3 * s, 1.6 * s, 0, 7); ctx.fill(); }
      }
      if (st.hover && st.hover.u === a.u) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(sx, sy, 8 * s, 3.5 * s, 0, 0, 7); ctx.stroke(); }
    }

    // ---------- minimap (detailed and game-style looks)
    function drawMini(dpr, T, show) {
      miniC.style.display = st.mode === 'map' ? 'none' : 'block';
      if (st.mode === 'map') return;
      const w = miniC.clientWidth, h = miniC.clientHeight; if (!w) return;
      const m = miniC.getContext('2d'); m.setTransform(dpr, 0, 0, dpr, 0, 0); m.clearRect(0, 0, w, h);
      const k = w / (2 * D); const mp = (x, y) => [(x + y) * k, h / 2 + ((y - x) * k) / 2];
      m.save(); m.setTransform(dpr * k, dpr * -k / 2, dpr * k, dpr * k / 2, 0, dpr * h / 2); m.drawImage(terrainImg, 0, 0); m.restore();
      sites.forEach((b) => { if (b.t > T || b.n === 'Farm' || !show(b.p, b.x, b.y)) return; const [a, c] = mp(b.x, b.y); m.fillStyle = colOf(b.p); m.fillRect(a - 1.5, c - 1.5, 3, 3); });
      list.forEach((a) => { if (!show(a.u.p, a.x, a.y)) return; const [x, y] = mp(a.x, a.y); m.fillStyle = colOf(a.u.p); const z = a.u.cls === 'Villager' ? 1.2 : 2; m.fillRect(x - z / 2, y - z / 2, z, z); });
      const c = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => mp(...unIso(x, y)));
      m.strokeStyle = '#fff'; m.lineWidth = 1; m.beginPath(); c.forEach((p, i) => (i ? m.lineTo(...p) : m.moveTo(...p))); m.closePath(); m.stroke();
    }

    // ---------- side panel: each player now, with key upgrades so far
    function ageOf(p, T) {
      const a = ages.filter((e) => e.p === p && e.t <= T); const now = a.length ? String(a[a.length - 1].n).replace('Reached ', '') : 'Dark Age';
      const order = ['Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age']; const next = order[order.indexOf(now) + 1];
      if (!next) return [now, null];
      const click = research.filter((e) => e.p === p && e.n === next && e.t <= T).pop(); const reach = ages.find((e) => e.p === p && e.n === `Reached ${next}`);
      if (click && reach && T < reach.t) return [now, { to: next, f: (T - click.t) / (reach.t - click.t) }];
      return [now, null];
    }
    function drawSide() {
      const T = st.t; const me = viewer();
      pstats.replaceChildren(...players.map((p) => {
        const mine = list.filter((a) => a.u.p === p.number); const vil = mine.filter((a) => a.u.cls === 'Villager');
        const tasks = { food: 0, wood: 0, gold: 0, stone: 0, build: 0, idle: 0 }; vil.forEach((a) => { if (tasks[a.task] != null) tasks[a.task] += 1; else tasks.idle += 1; });
        const army = new Map(); mine.filter((a) => a.u.cls !== 'Villager').forEach((a) => army.set(a.u.type, (army.get(a.u.type) || 0) + 1));
        const [age, up] = ageOf(p.number, T);
        const c = mk('div', 'tt-pstat'); if (me && me.number === p.number) c.style.borderColor = p.col;
        const head = mk('div', 'who'); const s = mk('span', 'tt-sw'); s.style.background = p.col;
        const out = ev.some((e) => e.k === 'x' && e.p === p.number && e.t <= T);
        head.append(s, `${nameFn(p.name)} · ${p.civ}${out ? ' · resigned' : ''}`); c.append(head);
        c.title = 'Show the map from this player\'s view'; c.style.cursor = 'pointer';
        c.addEventListener('click', () => viewBtns.find((b) => b.dataset.view === String(p.number)).click());
        c.append(mk('div', '', `${age} · ${vil.length} villagers · ${mine.length - vil.length} soldiers on the map`));
        if (up) { const barW = mk('div', 'tt-bar'); const i = mk('i'); i.style.width = `${Math.round(up.f * 100)}%`; barW.append(i); c.append(mk('div', '', `Advancing to ${up.to}…`), barW); }
        const jobs = mk('div', 'tt-jobs'); Object.entries(tasks).forEach(([k, v]) => { const j = mk('span'); const d = mk('span', 'tt-dot'); d.style.background = TASK[k]; j.append(d, `${k === 'idle' ? 'other' : k} ${v}`); jobs.append(j); }); c.append(jobs);
        c.append(mk('div', '', `Army: ${[...army].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `${n} ${v}`).join(', ') || 'none'}`));
        const techs = research.filter((e) => e.p === p.number && e.t <= T && TECH_GROUP.has(e.n));
        if (techs.length) {
          const tl = mk('div', 'tt-techs');
          Object.keys(KEY_TECH).forEach((g) => {
            const got = techs.filter((e) => TECH_GROUP.get(e.n) === g); if (!got.length) return;
            const row = mk('div'); row.append(mk('span', 'tt-label', `${g}: `));
            got.forEach((e, i) => { const chip = mk('span', 'tt-tech' + (T - e.t < 30 ? ' new' : ''), `${e.n} ${fmtT(e.t)}`); chip.title = `Started ${fmtT(e.t)}`; row.append(chip); if (i < got.length - 1) row.append(' '); });
            tl.append(row);
          });
          c.append(tl);
        } else c.append(mk('div', 'tt-label', 'Key upgrades: none yet'));
        return c;
      }));
    }

    // ---------- key moments (incl. key upgrades) and the activity strip
    const moments = [];
    const seenKey = new Set();
    ev.forEach((e) => {
      if (e.k === 'a') moments.push({ t: e.t, p: e.p, text: e.n });
      else if (e.k === 'x') moments.push({ t: e.t, p: e.p, text: 'Resigned' });
      else if (e.k === 'r' && TECH_GROUP.has(e.n)) moments.push({ t: e.t, p: e.p, text: `Upgrade: ${e.n}`, tech: true });
      else if (e.k === 'b' && KEY_BUILDINGS.has(e.n)) { const key = e.p + '|b|' + e.n; if (!seenKey.has(key) || e.n === 'Town Center' || e.n === 'Castle') { seenKey.add(key); moments.push({ t: e.t, p: e.p, text: `Builds ${e.n}`, x: e.x, y: e.y }); } }
      else if (e.k === 'u' && (unitClass.get(e.n) || 'x') !== 'Villager') { const key = e.p + '|u|' + e.n; if (!seenKey.has(key)) { seenKey.add(key); moments.push({ t: e.t, p: e.p, text: `First ${e.n}` }); } }
    });
    moments.sort((a, b) => a.t - b.t);
    feed.replaceChildren(...moments.map((m) => {
      const r = mk('div'); r.style.cursor = 'pointer';
      const s = mk('span', 'tt-sw'); s.style.background = colOf(m.p); s.style.display = 'inline-block'; s.style.marginRight = '4px';
      r.append(mk('span', 't', fmtT(m.t)), s, `${nameFn((byNum.get(m.p) || {}).name || '')}: ${m.text}`);
      if (m.tech) r.style.opacity = '0.85';
      r.addEventListener('click', () => { if (m.x != null && st.mode !== 'map') { st.follow = false; followBox.checked = false; st.cam = [m.x, m.y]; st.panX = 0; st.panY = 0; } seek(m.t - 3); });
      return r;
    }));
    let playhead = null, sx = () => 0;
    function drawStrip() {
      strip.replaceChildren();
      const w = strip.clientWidth, h = strip.clientHeight; if (!w) return;
      const mins = Math.max(1, Math.ceil(pb.duration_s / 60));
      sx = d3.scaleLinear([0, pb.duration_s], [0, w]);
      const svg = d3.select(strip).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`);
      const rowH = (h - 6) / Math.max(1, players.length);
      players.forEach((p, i) => {
        const counts = new Array(mins).fill(0);
        for (let mI = 0; mI < mins; mI += 1) { const t = mI * 60 + 30; counts[mI] = tracks.reduce((s, u) => s + (u.p === p.number && u.cls !== 'Villager' && unitAt(u, t) ? 1 : 0), 0); }
        const y = d3.scaleLinear([0, d3.max(counts) || 1], [0, rowH - 2]);
        svg.append('g').selectAll('rect').data(counts).join('rect').attr('x', (d, j) => sx(j * 60) + 0.5).attr('width', Math.max(1, sx(60) - 1))
          .attr('y', (d) => 6 + i * rowH + rowH - 1 - y(d)).attr('height', (d) => y(d)).attr('fill', p.col).attr('opacity', 0.75);
      });
      // key upgrade ticks along the top
      svg.append('g').selectAll('line').data(research.filter((e) => TECH_GROUP.has(e.n) || /Age$/.test(e.n))).join('line')
        .attr('x1', (e) => sx(e.t)).attr('x2', (e) => sx(e.t)).attr('y1', 0).attr('y2', 5).attr('stroke', (e) => colOf(e.p)).attr('stroke-width', 1.5);
      playhead = svg.append('line').attr('y1', 0).attr('y2', h).attr('stroke', 'var(--color-fg)').attr('stroke-width', 1.5);
      svg.on('click', (event) => { const [mx] = d3.pointer(event); seek(sx.invert(mx)); });
    }
    function legendDraw() {
      const items = {
        map: [['●', 'Soldier (live)'], ['·', 'Villager'], ['▒', 'Heatmap: where armies have been (choose the window above)'], ['- - -', 'Attack order'], ['✦', 'Enemies meeting']],
        detail: [['◆', 'Cavalry'], ['▲', 'Archers, skirmishers'], ['●', 'Infantry, monks, unique units'], ['■', 'Siege'], ['○', 'Villager, ring = job (wood, food, gold, stone, building, idle)'], ['- - -', 'Attack order'], ['✦', 'Enemies meeting'], ['dashed', 'Building going up (%)']],
        game: [['Figures', 'Villagers carry their job colour; each soldier type has its own look'], ['Scaffolding', 'Building going up'], ['Arrows', 'Archers shooting at their target'], ['Flags', 'Castles and towers']],
      }[st.mode];
      legend.replaceChildren(...players.map((p) => { const s = mk('span'); const k = mk('span', 'tt-sw'); k.style.background = p.col; s.append(k, `${nameFn(p.name)} · ${p.civ}${p.won ? ' · won' : ''}`); return s; }),
        ...items.map(([a, b]) => { const s = mk('span'); s.append(mk('b', '', a), ` ${b}`); return s; }));
    }

    // ---------- transport and interaction
    function seek(t) { st.t = Math.max(0, Math.min(pb.duration_s, t)); st.sideAt = -1; drawOver(); }
    function setPlaying(on, dir) {
      st.playing = on; if (dir) st.dir = dir;
      play.textContent = on && st.dir > 0 ? '⏸' : '▶'; bRev.textContent = on && st.dir < 0 ? '⏸' : '◀';
      cancelAnimationFrame(st.raf); if (on) { st.last = 0; st.raf = requestAnimationFrame(tick); }
      drawOver();
    }
    function tick(now) {
      if (!st.playing) return;
      const dt = st.last ? Math.min(0.25, (now - st.last) / 1000) : 0; st.last = now;
      st.t += dt * st.speed * st.dir;
      if (st.t >= pb.duration_s || st.t <= 0) { st.t = Math.max(0, Math.min(pb.duration_s, st.t)); setPlaying(false); return; }
      drawOver(); st.raf = requestAnimationFrame(tick);
    }
    play.addEventListener('click', () => { if (st.playing && st.dir > 0) setPlaying(false); else { if (st.t >= pb.duration_s) st.t = 0; setPlaying(true, 1); } });
    bRev.addEventListener('click', () => { if (st.playing && st.dir < 0) setPlaying(false); else { if (st.t <= 0) st.t = pb.duration_s; setPlaying(true, -1); } });
    bStart.addEventListener('click', () => seek(0));
    bB30.addEventListener('click', () => seek(st.t - 30)); bB10.addEventListener('click', () => seek(st.t - 10));
    bF10.addEventListener('click', () => seek(st.t + 10)); bF30.addEventListener('click', () => seek(st.t + 30));
    speed.addEventListener('change', () => { st.speed = Number(speed.value); drawOver(); });
    range.addEventListener('input', () => seek(Number(range.value)));
    function zoomAt(f) { st.zoom = Math.max(st.mode === 'map' ? 1 : 0.5, Math.min(8, st.zoom * f)); if (st.mode === 'map' && st.zoom === 1) { st.panX = 0; st.panY = 0; } drawOver(); }
    map.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    zin.addEventListener('click', () => zoomAt(1.5)); zout.addEventListener('click', () => zoomAt(1 / 1.5));
    zfit.addEventListener('click', () => { st.zoom = 1; st.panX = 0; st.panY = 0; if (st.mode !== 'map') { st.follow = true; followBox.checked = true; } drawOver(); });
    let drag = null;
    map.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; drag = { x: e.clientX, y: e.clientY, px: st.panX, py: st.panY }; map.setPointerCapture(e.pointerId); map.style.cursor = 'grabbing'; });
    map.addEventListener('pointermove', (e) => {
      const r = map.getBoundingClientRect();
      if (drag) {
        st.panX = drag.px + e.clientX - drag.x; st.panY = drag.py + e.clientY - drag.y;
        if (st.follow && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4 && st.mode !== 'map') { st.follow = false; followBox.checked = false; }
        drawOver(); return;
      }
      const mx = e.clientX - r.left, my = e.clientY - r.top; let best = null, bd = st.mode === 'map' ? 8 : 14;
      for (const a of list) { const [x, y] = iso(a.x, a.y); const d = Math.hypot(x - mx, y - my - (st.mode === 'game' ? 8 : 0)); if (d < bd) { bd = d; best = a; } }
      st.hover = best;
      if (best) {
        const p = byNum.get(best.u.p);
        const what = best.u.cls === 'Villager' ? (best.task && best.task !== 'idle' ? { build: 'building', food: 'gathering food', wood: 'chopping wood', gold: 'mining gold', stone: 'mining stone', relic: 'carrying a relic' }[best.task] : 'idle or walking')
          : best.att ? `attacking${best.tgt ? ' a ' + best.tgt : ''}` : best.moving ? 'moving' : 'holding position';
        tip.textContent = `${nameFn(p.name)}'s ${best.u.type === 'Military unit' ? 'soldier' : best.u.type} · ${what}`;
        tip.style.display = 'block'; tip.style.left = `${Math.min(mx + 12, W - 260)}px`; tip.style.top = `${my + 12}px`;
      } else tip.style.display = 'none';
      if (!st.playing) drawOver();
    });
    const endDrag = () => { drag = null; map.style.cursor = 'grab'; };
    map.addEventListener('pointerup', endDrag); map.addEventListener('pointercancel', endDrag);
    map.addEventListener('pointerleave', () => { tip.style.display = 'none'; st.hover = null; });
    wrap.tabIndex = 0;
    wrap.addEventListener('keydown', (e) => {
      if (e.target.closest('select, input')) return;
      if (e.key === ' ') { e.preventDefault(); play.click(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(st.t + (e.shiftKey ? 30 : 10)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(st.t - (e.shiftKey ? 30 : 10)); }
      else if (e.key === '+' || e.key === '=') zoomAt(1.5); else if (e.key === '-') zoomAt(1 / 1.5);
    });

    st.resize = () => { if (W && map.clientWidth === W) return; if (size()) { drawStrip(); drawOver(); } };
    st.stop = () => { st.playing = false; cancelAnimationFrame(st.raf); };
    legendDraw();
    st.resize();
    return st;
  }

  window.TT_viewer = (box, pbId, nameFn) => {
    const d = dash.data(pbId);
    const note = (text) => {
      if (box._tt) { box._tt.stop(); box._tt = null; }
      box.classList.remove('dash-skeleton');
      box.replaceChildren(Object.assign(document.createElement('div'), { className: 'tt-empty', textContent: text }));
      box._ttId = null;
    };
    if (d.status === 'error' || d.status === 'missing') { note(d.status === 'missing' ? 'Playback for this game is no longer kept.' : 'Failed to load'); return; }
    if (d.status !== 'ok') { box.classList.add('dash-skeleton'); if (box._ttId !== pbId) box.replaceChildren(); return; }
    box.classList.remove('dash-skeleton');
    if (box._ttId === pbId && box._tt) { box._tt.resize(); return; }
    const pb = Array.isArray(d.data) ? unpack(d.data) : null;
    if (!pb || pb.old) { note('This playback was saved in an older format. It will be rebuilt on the next update.'); return; }
    if (box._tt) box._tt.stop();
    box._ttId = pbId;
    box._tt = build(box, pb, nameFn);
  };
  window.TT_unpack = unpack;
})();
