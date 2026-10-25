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
  // main sections (header, and the bottom bar on phones); each holds the pages whose tab has data-in = that section
  const sectionOf = (id) => (tabs.find((b) => b.dataset.tab === id) || {}).dataset?.in || 'home';
  const lastIn = {};
  function show(id, link) {
    current = id;
    const sec = sectionOf(id);
    lastIn[sec] = id;
    tabs.forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.tab === id)); b.hidden = b.dataset.in !== sec; });
    el('tab-home').closest('.tt-tabs').classList.toggle('single', tabs.filter((b) => !b.hidden).length < 2);
    document.querySelectorAll('[data-section]').forEach((b) => b.setAttribute('aria-current', b.dataset.section === sec ? 'page' : 'false'));
    document.querySelectorAll('.tt-page').forEach((p) => { p.hidden = p.id !== id; });
    el('t-bar').hidden = !['home', 'tournament'].includes(sec);
    el('headline').hidden = sec !== 'tournament';
    el('account').open = false;
    if (link) { dash.setLink(id); window.scrollTo(0, 0); }
    draw();
  }
  // admin.js says whether the signed-in person is an organizer; only then is there an Admin section
  window.TT_syncAdmin = (org) => { el('section-admin').hidden = !org; el('account-admin').hidden = !org; };
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab, true)));
  document.querySelectorAll('[data-section]').forEach((b) => b.addEventListener('click', () => {
    const sec = b.dataset.section;
    show(lastIn[sec] || (tabs.find((t) => t.dataset.in === sec) || {}).dataset?.tab || 'home', true);
  }));
  el('brand').addEventListener('click', (e) => { e.preventDefault(); show('home', true); });
  el('account-admin').addEventListener('click', () => show('admin', true));
  window.TT_show = show;

  // ---------------------------------------------------------------- the look (Classic AoE, Clean & light, Dark & gold)
  // index.html applies the saved one before drawing; backend.js keeps it with the account, so it follows you when you sign in
  const THEMES = ['classic', 'clean', 'dark'];
  function setTheme(t, save) {
    if (!THEMES.includes(t)) return;
    if (t === 'classic') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    try { localStorage.setItem('tt-theme', t); } catch (e) { /* storage blocked */ }
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#8c2f1f';
    el('theme-pick').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === t)));
    if (save && window.TT_BACKEND && window.TT_BACKEND.saveTheme) window.TT_BACKEND.saveTheme(t);
  }
  window.TT_THEME = { set: setTheme, get: () => document.documentElement.dataset.theme || 'classic' };
  el('theme-pick').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.theme, true)));
  setTheme(window.TT_THEME.get(), false);

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

  // the page itself is site/js/profile.js (loaded after this file); it gets the helpers it shares with the other pages
  function drawProfiles(names) {
    if (!window.TT_PROFILE) return;
    window.TT_PROFILE.draw({
      names, me: ME.player, steam, steamOr, who, mark, fillTable, failed, show, ratePill,
      drawCompare: typeof drawCompare === 'function' ? drawCompare : null,
    });
  }

  // ---------------------------------------------------------------- match review
  const rvPlayer = el('rv-player'), rvType = el('rv-type'), rvReplay = el('rv-replay');
  // players shown in Games: all by default, or any set of them (?rp=A,B)
  const rvPicked = () => String(P().rp || '').split(',').filter(Boolean);
  rvType.addEventListener('change', () => dash.setParams({ rt: rvType.value || null }));
  rvReplay.addEventListener('change', () => dash.setParams({ rr: rvReplay.value || null }));
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

  const REPLAY_LABEL = { analysed: 'Analysed', waiting: '⚠ Waiting for replay', missing: '⚠ No replay', unreadable: '⚠ Couldn’t read', scenario: 'Custom scenario', noresult: '⚠ No result', norecord: '⚠ Not in Microsoft’s records' };
  const REPLAY_WHY = {
    waiting: 'the replay isn’t on Microsoft’s server yet (it’s tried again every update for 3 days), so the openings, age-up times, army and build orders are unknown for now. The result and civs above are from the match list.',
    missing: 'no player’s copy of the replay is on Microsoft’s server, so the openings, age-up times, army and build orders are unknown. The result and civs above are from the match list.',
    unreadable: 'the replay downloaded but couldn’t be read (usually a game update the replay reader doesn’t support yet), so the strategy details are unknown. It’s tried again whenever the reader is improved. The result and civs above are from the match list.',
    scenario: 'this was a custom scenario, which has no standard openings or age-ups to analyse. The result and civs above are from the match list.',
    noresult: 'Microsoft recorded this game without a result (usually a disconnect), so it counts as a game played but not as a win or a loss.',
    norecord: 'Microsoft counted this on the ladder but left it out of its match history, so no site can list it. It was found from a jump in rating between the games before and after it, so its time is approximate, it may be more than one game, and its map, civs and replay are unknown. It counts as a game played but not in win rates.',
  };
  // "Add your replay": for a game with no replay on Microsoft's server, or missing from its match history. The next
  // update checks it is this game (pipeline/run.py check_upload) and reads it like a downloaded replay.
  let addFor = '';
  function drawAdd(g) {
    const box = el('rv-add'), up = window.TT_UPLOAD;
    if (!g || !up || !['missing', 'norecord'].includes(g.replay)) { box.hidden = true; box.replaceChildren(); addFor = ''; return; }
    if (addFor === g.match_id) return; // a redraw keeps the chosen file
    addFor = g.match_id;
    box.hidden = false;
    const players = g.players.split(', ');
    const list = mk('ul', 'tt-add-list');
    const msg = mk('p', 'tt-note');
    const refresh = () => up.list(g.match_id).then((rows) => {
      list.replaceChildren(...rows.map((r) => {
        const li = mk('li', r.status === 'rejected' ? 'tt-warn' : '',
          `${r.player}: ${r.status === 'waiting' ? 'added, read at the next update (every 30 minutes)' : r.status === 'done' ? 'read' : `not used: ${r.message}`}`);
        if (r.mine && r.status !== 'done') {
          const b = mk('button', 'tt-btn tt-small', r.status === 'waiting' ? 'Take back' : 'Remove'); b.type = 'button';
          b.addEventListener('click', () => up.cancel(r).then(refresh, (e) => { msg.textContent = `Couldn’t remove it: ${e.message}`; }));
          li.append(' ', b);
        }
        return li;
      }));
    }, () => list.replaceChildren());
    box.replaceChildren(mk('h4', '', 'Have the replay?'),
      mk('p', 'tt-note', `${g.replay === 'norecord' ? 'Microsoft has no record of this game, but your own copy of the replay has everything: map, civs, result and the full analysis.' : 'Microsoft’s server has no copy of this replay, but yours can be read instead.'} AoE2 saves replays as .aoe2record files in Games\\Age of Empires 2 DE\\<your id>\\savegame in your user folder. The next update checks it is this game, then reads it.`));
    if (!up.can()) {
      box.append(mk('p', 'tt-note', 'Players and organizers can add one.'));
    } else {
      const form = mk('div', 'tt-form tt-add-form');
      const who = mk('select', 'tt-input');
      players.forEach((p) => who.append(new Option(steamOr(p), p)));
      const file = mk('input', 'tt-input'); file.type = 'file'; file.accept = '.aoe2record,.zip';
      const send = mk('button', 'tt-btn', 'Add replay'); send.type = 'button';
      send.addEventListener('click', () => {
        const f = file.files && file.files[0];
        if (!f) { msg.textContent = 'Choose the replay file first.'; return; }
        send.disabled = true; msg.textContent = 'Adding…';
        up.send(f, { match_id: g.match_id, player: who.value, game: g.info || {} })
          .then(() => { msg.textContent = 'Added. It’s read at the next update (every 30 minutes).'; file.value = ''; refresh(); },
            (e) => { msg.textContent = `Couldn’t add it: ${e.message}`; })
          .finally(() => { send.disabled = false; });
      });
      if (players.length > 1) form.append(mk('label', 'tt-label', 'Whose replay'), who);
      form.append(file, send);
      box.append(form);
    }
    box.append(msg, list);
    refresh();
  }
  // "Your replay folder" (site/js/replay-folder.js): looks in the linked savegame folder for replays of the signed-in
  // player's games that have none here, and adds them. Runs by itself once per visit when the browser still allows it.
  const folderState = { dir: undefined, perm: '', autoDone: false, msg: '' };
  function folderWanted(list) {
    const me = ME.player;
    const min = 60e3;
    return list.filter((r) => r.players.split(', ').includes(me) && (r.replay === 'missing' || r.replay === 'norecord')).map((r) => {
      if (r.replay === 'norecord') {
        const lo = Date.parse(r.info.started), hi = Date.parse(r.info.before);
        return { match_id: r.match_id, player: me, game: r.info, lo: lo + 3 * min, hi: hi + 5 * min, target: hi };
      }
      const start = Date.parse(r.started), end = start + Number(r.duration_min || 0) * min;
      // the replay file is written when you leave the game, so just after the match list's end time
      return { match_id: r.match_id, player: me, game: {}, lo: end - 5 * min, hi: end + 20 * min, target: end };
    });
  }
  async function folderRun(ask) {
    const F = window.TT_FOLDER, up = window.TT_UPLOAD, msg = el('rv-folder-msg');
    const list = dash.data('review_list');
    if (!folderState.dir || list.status !== 'ok') return;
    folderState.perm = await F.permission(folderState.dir, ask).catch(() => 'denied');
    if (folderState.perm !== 'granted') { drawFolder(true); return; }
    const wanted = folderWanted(list.data);
    if (!wanted.length) { msg.textContent = 'None of your games are missing a replay right now.'; return; }
    msg.textContent = 'Looking in your replay folder…';
    try {
      const claimed = await up.claimed();
      const res = await F.sync(folderState.dir, wanted, (id) => claimed.has(id),
        (file, w) => up.send(file, { match_id: w.match_id, player: w.player, game: w.game }), (t) => { msg.textContent = t; });
      if (res) msg.textContent = folderSummary(res);
    } catch (e) { msg.textContent = `Couldn’t read the folder: ${e.message || e}`; }
  }
  function folderSummary(r) {
    if (!r.wanted) return `Checked ${num(r.files)} replay files: every game of yours that had no replay now has one added (read at the next update, or already read).`;
    return `Checked ${num(r.files)} replay files for ${num(r.wanted)} of your games without a replay: ${r.added ? `added ${num(r.added)}, read at the next update (every 30 minutes)` : 'no new matches'}.`
      + (r.errors.length ? ` ${r.errors.length} couldn’t be added: ${r.errors.slice(0, 3).join('; ')}` : '');
  }
  async function drawFolder(force) {
    const card = el('rv-folder-card'), F = window.TT_FOLDER, up = window.TT_UPLOAD;
    const show = !!(F && up && up.can() && ME.player);
    card.hidden = !show;
    if (!show) return;
    const box = el('rv-folder'), msg = el('rv-folder-msg');
    if (!F.supported) { box.replaceChildren(); msg.textContent = 'This works in Chrome or Edge on a computer. In other browsers, use “Add replay” on each game.'; return; }
    if (folderState.dir === undefined) folderState.dir = (await F.folder()) || null;
    if (box.dataset.state === `${!!folderState.dir}|${folderState.perm}` && !force) return;
    box.dataset.state = `${!!folderState.dir}|${folderState.perm}`;
    if (!folderState.dir) {
      box.replaceChildren(btn('Link my replay folder', async () => {
        try { folderState.dir = await F.link(); folderState.perm = 'granted'; drawFolder(true); folderRun(true); } catch (e) { if (e.name !== 'AbortError') msg.textContent = `Couldn’t link it: ${e.message}`; }
      }, 'primary'));
      return;
    }
    box.replaceChildren(mk('span', 'tt-label', `Linked: ${folderState.dir.name}`),
      btn(folderState.perm === 'granted' ? 'Check now' : 'Check my replay folder', () => folderRun(true), folderState.perm === 'granted' ? '' : 'primary'),
      btn('Unlink', async () => { await F.unlink(); folderState.dir = null; folderState.perm = ''; msg.textContent = ''; drawFolder(true); }));
    if (folderState.perm !== 'granted' && !msg.textContent) {
      const r = await F.last();
      msg.textContent = r ? `Last checked ${d3.timeFormat('%b %-d, %H:%M')(new Date(r.at))}: ${folderSummary(r)}` : 'Click to let the site look in the folder (your browser asks once per visit).';
    }
    // once per visit, without a click, when the browser still allows reading the folder
    if (!folderState.autoDone && dash.data('review_list').status === 'ok') {
      folderState.autoDone = true;
      const p = await F.permission(folderState.dir, false).catch(() => 'denied');
      if (p === 'granted') { folderState.perm = p; drawFolder(true); folderRun(false); }
    }
  }
  // "Upload a game" (header, and Upload in the phone's bottom bar): any replays, each matched to the signed-in player's
  // game without a replay by when the file was saved (= when the game ended), like the replay folder
  const upSheet = el('upload-sheet'), upFiles = el('upload-files'), upList = el('upload-list'), upMsg = el('upload-msg'), upSend = el('upload-send');
  let upPairs = [];
  // datasets load when first asked for; the sheet can open before Games ever has
  const loaded = async (id) => { const t0 = Date.now(); while (dash.data(id).status === 'loading' && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 200)); return dash.data(id); };
  function openUpload() {
    dash.data('review_list');
    upSheet.hidden = false; upFiles.value = ''; upList.replaceChildren(); upPairs = []; upSend.disabled = true;
    const up = window.TT_UPLOAD;
    upMsg.textContent = !up || !up.can() ? 'Players and organizers can upload games.' : !ME.player ? 'First choose who you are (your account menu, top right).' : '';
    upFiles.disabled = !up || !up.can() || !ME.player;
    el('upload-folder').hidden = !(window.TT_FOLDER && TT_FOLDER.supported);
    upFiles.focus();
  }
  const closeUpload = () => { upSheet.hidden = true; };
  el('upload-open').addEventListener('click', openUpload);
  el('upload-open-2').addEventListener('click', openUpload);
  el('upload-close').addEventListener('click', closeUpload);
  upSheet.addEventListener('click', (e) => { if (e.target === upSheet) closeUpload(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !upSheet.hidden) closeUpload(); });
  el('upload-folder').addEventListener('click', () => { closeUpload(); show('review', true); setTimeout(() => el('rv-folder-card').scrollIntoView({ behavior: 'smooth' }), 50); });
  upFiles.addEventListener('change', async () => {
    upMsg.textContent = 'Matching to your games…';
    const list = await loaded('review_list');
    if (list.status !== 'ok') { upMsg.textContent = 'Couldn’t load your games to match against. Try again in a moment.'; return; }
    const files = [...upFiles.files].map((f) => ({ name: f.name, lastModified: f.lastModified, handle: f }));
    const wanted = list.status === 'ok' ? folderWanted(list.data) : [];
    let claimed = new Set();
    try { claimed = await window.TT_UPLOAD.claimed(); } catch (e) { /* shown as unmatched below */ }
    upPairs = window.TT_FOLDER.match(files, wanted.filter((w) => !claimed.has(w.match_id)));
    const byName = new Map(upPairs.map((p) => [p.file.name, p.want]));
    const games = new Map(list.status === 'ok' ? list.data.map((r) => [r.match_id, r]) : []);
    upList.replaceChildren(...files.map((f) => {
      const w = byName.get(f.name), g = w && games.get(w.match_id);
      const li = mk('li', w ? '' : 'tt-warn');
      li.append(mk('b', '', f.name), mk('div', 'sub', w ? `${g ? `${d3.utcFormat('%b %-d')(new Date(g.started))} · ${g.type} · ${g.map}` : 'a game of yours'}: ${g && g.replay === 'norecord' ? 'missing from Microsoft’s records' : 'no replay on the site yet'}`
        : 'No game of yours without a replay matches when this was played (it may already have one).'));
      return li;
    }));
    upSend.disabled = !upPairs.length;
    upMsg.textContent = files.length ? `${upPairs.length} of ${files.length} matched to a game.` : '';
  });
  upSend.addEventListener('click', async () => {
    upSend.disabled = true;
    let ok = 0;
    const errs = [];
    for (const p of upPairs) {
      upMsg.textContent = `Uploading ${ok + 1} of ${upPairs.length}…`;
      try { await window.TT_UPLOAD.send(p.file.handle, { match_id: p.want.match_id, player: p.want.player, game: p.want.game }); ok += 1; } catch (e) { errs.push(`${p.file.name}: ${e.message || e}`); }
    }
    upMsg.textContent = `${ok ? `Uploaded ${ok}. They’re read at the next update (within 30 minutes).` : 'Nothing was uploaded.'}${errs.length ? ` Couldn’t upload: ${errs.join('; ')}` : ''}`;
    upPairs = [];
  });

  function drawReview(names) {
    drawFolder();
    {
      const picked = rvPicked().filter((n) => names.includes(n));
      const chip = (label, on, click) => { const b = mk('button', 'tt-chip', label); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); b.addEventListener('click', click); return b; };
      rvPlayer.replaceChildren(chip('All players', !picked.length, () => dash.setParams({ rp: null })),
        ...names.map((n) => chip(steamOr(n), picked.includes(n), () => {
          const next = picked.includes(n) ? picked.filter((x) => x !== n) : picked.concat(n);
          dash.setParams({ rp: next.length && next.length < names.length ? next.join(',') : null });
        })));
    }
    rvType.value = P().rt || '';
    rvReplay.value = P().rr || '';
    const list = dash.data('review_list');
    const tbl = el('rv-list');
    let rows = [];
    if (list.status === 'error') failed(tbl.tBodies[0]);
    else if (list.status === 'ok') {
      const pick = rvPicked();
      rows = list.data.filter((r) => (!pick.length || r.players.split(', ').some((x) => pick.includes(x))) && (!P().rt || r.views.split('|').includes(P().rt))
        && (!P().rr || (P().rr === 'analysed' ? r.replay === 'analysed' : r.replay !== 'analysed')));
      fillTable(tbl, rows, [
        { field: 'started', label: 'Date', fmt: (v) => d3.utcFormat('%b %-d, %Y')(new Date(v)) },
        { field: 'type', label: 'Type', fmt: (v, r) => (r.tournament ? `Tournament · ${v}` : v) },
        { field: 'map', label: 'Map' },
        { field: 'result', label: 'Result', wrap: true },
        { field: 'duration_min', label: 'Min', num: true, fmt: (v) => (v == null ? '—' : d3.format('.0f')(v)) },
        { field: 'replay', label: 'Replay', fmt: (v) => REPLAY_LABEL[v] || v, cls: (v) => (v === 'analysed' || v === 'scenario' ? '' : 'warn') },
        { field: 'has_playback', label: 'Playback', fmt: (v, r) => (Number(v) === 1 ? 'Yes' : r.replay === 'analysed' ? 'Not yet' : '—') },
      ], 'match_id', {
        emptyText: 'No games match these filters.',
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
      drawAdd(null);
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
      if (g) note.append(mark('review_list', { match_id: mid }, 'result', g.result, 'span'), `${g.duration_min == null ? '' : ` · ${d3.format('.0f')(g.duration_min)} min`} · ${g.tournament ? 'Tournament game · ' : ''}${g.type}`);
      else note.textContent = 'This game isn’t in the match list.';
      if (g && g.replay === 'scenario') note.append(` · Not analysed: ${REPLAY_WHY.scenario}`);
      else if (g && g.replay !== 'analysed') note.append(mk('span', 'tt-warn', ` · ⚠ ${REPLAY_WHY[g.replay]}`));
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
      drawAdd(g);
      const s = mk('button', 'tt-btn', 'Try the sample game'); s.type = 'button';
      s.addEventListener('click', () => dash.setParams({ m: 'sample' }));
      if (dash.data('pb_sample').status === 'ok') lk.appendChild(s); // the sample game is optional (data/playback/pb_sample.json)
    }

    // viewer
    const vbox = el('rv-viewer');
    const pbId = isSample ? 'pb_sample' : g && g.has_playback ? g.playback_id : '';
    if (!pbId) {
      vbox.removeAttribute('data-source');
      vbox.replaceChildren(empty(!g ? 'Pick a game above.' : g.replay === 'noresult' || g.replay === 'norecord' ? 'No map playback for this game (see the note above).' : g.replay === 'scenario' ? 'No map playback for custom scenarios.' : g.replay !== 'analysed' ? 'No map playback for this game: its replay isn’t available (see the note above).' : 'This game’s map playback hasn’t been rebuilt yet (older games are redone a few at a time with each update). The analysis below is complete.'));
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

  // ---------------------------------------------------------------- live now (Home), and a dot on the Home tab
  // games a tracked player is in right now (dash.js TT_LIVE.ongoing, from AoE2 Companion). "Spectate in AoE2" uses the
  // game's own link, aoe2de://1/<match id>, which opens Age of Empires II: DE spectating that match.
  function drawLive() {
    const games = (window.TT_LIVE && TT_LIVE.ongoing) || [];
    el('tab-home').classList.toggle('tt-live-dot', games.length > 0);
    el('tab-home').title = games.length ? `${games.length} game${games.length > 1 ? 's' : ''} live now` : '';
    const card = el('home-live-card');
    card.hidden = !games.length;
    if (!games.length) return;
    const md = dash.data('matches'), td = dash.data('tournaments');
    const open = md.status === 'ok' ? md.data.filter((m) => m.status !== 'Final' && m.player_a && m.player_b) : [];
    const tname = new Map(td.status === 'ok' ? td.data.map((t) => [t.tournament_id, t.name || t.tournament_id]) : []);
    const items = games.map((g) => {
      const ours = g.players.filter((p) => p.player).map((p) => p.player);
      // two tournament players against each other in a 1v1 with a game still to play between them: likely that game
      const tour = g.players.length === 2 && ours.length === 2
        ? open.find((m) => (m.player_a === ours[0] && m.player_b === ours[1]) || (m.player_a === ours[1] && m.player_b === ours[0])) : null;
      return { g, ours, tour };
    }).sort((a, b) => (b.tour ? 1 : 0) - (a.tour ? 1 : 0) || b.ours.length - a.ours.length);
    el('home-live').replaceChildren(...items.map(({ g, ours, tour }) => {
      const li = mk('li', 'tt-live-game' + (tour ? ' tour' : ''));
      const line = mk('div', 'row');
      const teams = [...new Set(g.players.map((p) => String(p.team)))];
      const who = mk('div');
      teams.forEach((t, i) => {
        if (i) who.append(mk('span', 'tt-vs', ' vs '));
        g.players.filter((p) => String(p.team) === t).forEach((p, j) => {
          if (j) who.append(' & ');
          who.append(mk(p.player ? 'b' : 'span', '', p.player ? steamOr(p.player) : p.name || 'Unknown'), mk('span', 'tt-muted', p.civ ? ` (${p.civ})` : ''));
        });
      });
      const watch = mk('a', 'tt-btn primary', 'Spectate in AoE2');
      watch.href = `aoe2de://1/${encodeURIComponent(g.match_id)}`;
      line.append(who, watch);
      const mins = Math.max(0, Math.round((Date.now() - new Date(g.started)) / 60000));
      const sub = mk('div', 'sub', `${g.type} · ${g.map || 'Unknown map'} · started ${mins < 1 ? 'just now' : `${mins} min ago`}`);
      if (tour) sub.prepend(mk('span', 'tt-pill', `Tournament: ${tname.get(tour.tournament_id) || tour.tournament_id} · game ${tour.game}`), ' ');
      else if (ours.length > 1) sub.prepend(mk('span', 'tt-pill', `${ours.length} of ours`), ' ');
      li.append(line, sub);
      return li;
    }));
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

  // ---------------------------------------------------------------- head to head (Players > Compare): drawn by compare.js
  function drawRivals(names) {
    if (window.TT_COMPARE) window.TT_COMPARE.draw({ names, ME, steamOr, who, mark, fmtDay, extLinks });
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
    drawLive();
    el('account-avatar').textContent = (ME.player ? steamOr(ME.player) : '?').slice(0, 1).toUpperCase();
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
