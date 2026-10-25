// The Admin tab (organizers only): set up a tournament, civ pools, manage tournaments, people and roles.
// Tournament changes are saved in Supabase (backend.js TT_ORG.save), show for everyone straight away
// (site/js/admin-logic.js through dash.js), and the update job writes them into config/ on GitHub
// (pipeline/apply_admin_changes.js). People, roles and invites live in Supabase only (supabase/schema.sql),
// which checks every permission again; the checks here only decide what to show.
(() => {
  const el = (id) => document.getElementById(id);
  // h('div', {class, text, onclick, value, ...}, ...children): build DOM without HTML strings
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['value', 'checked', 'disabled', 'selected'].includes(k)) n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) n.append(c instanceof Node ? c : String(c)); });
    return n;
  }
  const btn = (text, onclick, cls, more) => h('button', { type: 'button', class: 'tt-btn' + (cls ? ' ' + cls : ''), onclick, ...(more || {}) }, text);
  const chip = (text, on, onclick, more) => h('button', { type: 'button', class: 'tt-chip', 'aria-pressed': String(!!on), onclick, ...(more || {}) }, text);
  const field = (label, control, cls) => h('label', { class: 'tt-field' + (cls ? ' ' + cls : '') }, h('span', { class: 'tt-label', text: label }), control);
  const group = (label, ...kids) => h('div', { class: 'tt-field wide' }, h('span', { class: 'tt-label', text: label }), ...kids);
  const select = (id, value, opts, onchange, more) => h('select', { id, onchange: (e) => onchange(e.target.value), ...(more || {}) },
    opts.map(([v, t]) => h('option', { value: String(v), selected: String(v) === String(value) }, t)));
  const input = (id, value, oninput, more) => h('input', { id, value: value == null ? '' : String(value), oninput: (e) => oninput(e.target.value), ...(more || {}) });
  const card = (title, ...kids) => h('section', { class: 'tt-card adm-stack' }, title ? h('h2', { text: title }) : null, ...kids);
  const note = (text, more) => h('p', { class: 'tt-note', text, ...(more || {}) });
  const rows = (id) => { const r = dash.data(id); return r.status === 'ok' ? r.data : []; };
  const ok = (...ids) => ids.every((id) => dash.data(id).status === 'ok');
  const day = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const errText = (e) => {
    const m = String((e && e.message) || e);
    if (/function .* does not exist|my_access|members_list|invites_list|set_member_role|admin_changes_kind_check|PGRST202/i.test(m)) return 'The database needs the newest supabase/schema.sql: run it in the Supabase SQL Editor (see the README).';
    if (/row-level security|permission/i.test(m)) return 'You don’t have permission to do that. Ask the owner.';
    return m;
  };
  const ORG = () => window.TT_ORG;
  const ME = () => window.TT_BACKEND || {};

  const FORMATS = { rrpo: 'Round robin pool play, then single-elimination playoffs', rr: 'Round robin pool play, no playoffs' };
  const MAPS = ['Arabia', 'Arena', 'Black Forest', 'Four Lakes', 'Gold Rush', 'Hideout', 'Islands', 'Megarandom', 'Nomad', 'Socotra', 'Valley'];
  const STYLE_FILTERS = ['All', 'Infantry', 'Cavalry', 'Archer', 'Cavalry archer', 'Gunpowder', 'Camel', 'Defensive', 'Other'];
  const MAIN_STYLES = STYLE_FILTERS.slice(1, -1);
  const ROLES = {
    owner: ['Owner', 'Everything, including roles. Set in Supabase (the admins table).'],
    organizer: ['Organizer', 'Runs the tournaments you give them, or all of them: settings, players, civ pools, rules, approving games, inviting players.'],
    player: ['Player', 'Chooses who they are under “I’m” and confirms their own games.'],
    viewer: ['Viewer', 'Can open the site and follow along. Not a player.'],
  };

  // ------------------------------------------------------------------ state (forms keep their drafts here, so a redraw never loses typing)
  const blankSetup = () => ({
    name: '', start: '', end: '', status: 'Upcoming', template: 'rrpo', players: null, bo: 3, advance: 0, mapPick: 'seeds', decider: 'Arabia',
    poolSize: 15, poolMethod: 'pick', copyFrom: '', organizers: [], rules: null, msg: '', busy: false, newPlayer: null,
  });
  const S = {
    page: 'manage', setup: blankSetup(),
    civs: { tid: '', player: '', filter: 'All', draft: null, size: 0, copyFrom: '', msg: '' },
    manage: { tid: '', drafts: {}, msg: {} },
    people: { list: null, invites: null, loading: false, msg: '', inviteRole: 'player', link: '' },
  };

  // ------------------------------------------------------------------ tournament helpers
  const tournaments = () => rows('tournaments');
  const mine = () => tournaments().filter((t) => ORG().canRun(t.tournament_id))
    .sort((a, b) => ['Active', 'Upcoming', 'Completed'].indexOf(a.status) - ['Active', 'Upcoming', 'Completed'].indexOf(b.status) || (a.start_date < b.start_date ? 1 : -1));
  const tOf = (tid) => tournaments().find((t) => t.tournament_id === tid);
  const rosterOf = (tid) => rows('roster').filter((r) => r.tournament_id === tid).map((r) => r.player);
  const gamesOf = (tid) => rows('matches').filter((m) => m.tournament_id === tid);
  const playedAny = (tid) => rows('matches_base').some((m) => m.tournament_id === tid && m.status === 'Final');
  const nextId = () => `t${Math.max(0, ...tournaments().map((t) => Number(String(t.tournament_id).replace(/^t/, '')) || 0)) + 1}`;
  // a tournament change always carries every field (admin-logic sets them all from the payload)
  const tPayload = (t, over) => ({
    tournament_id: t.tournament_id, name: t.name, status: t.status, start_date: t.start_date || '', end_date: t.end_date || '', format: t.format || '',
    best_of: Number(t.best_of) || 3, advance: Number(t.advance) || 0, game3_map: t.game3_map || '', playoffs: t.playoffs !== false,
    map_pick: t.map_pick || 'seeds', pool_size: Number(t.pool_size) || 0, ...(over || {}),
  });
  const civStyles = () => { const m = new Map(); rows('civ_styles').forEach((r) => m.set(r.civ, r.style)); return m; };
  const styleGroup = (style) => (MAIN_STYLES.includes(style) ? style : 'Other');

  // playoff bracket shape for n players (same seeding as calcs.js 'bracket')
  function bracketRounds(n) {
    if (n < 2) return [];
    let size = 1; while (size < n) size *= 2;
    let order = [1];
    while (order.length < size) { const s = order.length * 2 + 1; order = order.flatMap((x) => [x, s - x]); }
    let slots = order.map((s) => (s <= n ? `seed ${s}` : null));
    const out = [];
    for (let r = 1; slots.length > 1; r += 1) {
      const left = slots.length, real = [], next = [];
      for (let i = 0; i < slots.length; i += 2) {
        const a = slots[i], b = slots[i + 1];
        if (!a || !b) { next.push(a || b); continue; }
        real.push([a, b]); next.push(null);
      }
      const name = left === 2 ? 'Final' : left === 4 ? 'Semifinals' : left === 8 ? 'Quarterfinals' : r === 1 && real.length <= left / 4 ? 'Play-in' : `Round of ${left}`;
      out.push({ name, matches: real });
      const lab = name === 'Play-in' ? 'play-in' : name === 'Semifinals' ? 'semifinal' : name === 'Quarterfinals' ? 'quarterfinal' : `${name.toLowerCase()} match`;
      let k = 0;
      slots = next.map((x) => (x !== null ? x : `the ${lab}${real.length > 1 ? ` ${++k}` : ''} winner`));
    }
    return out;
  }
  // the rules text, written from a tournament's settings (organizers can edit it afterwards)
  function autoRules(c) {
    const out = [];
    const n = c.n, adv = c.playoffs ? Math.min(Number(c.advance) || n, n) : 0;
    out.push({ label: 'Pool play', text: 'Round robin. Everyone plays every other player once, one game each.' });
    out.push({ label: 'Pool standings', text: 'Wins, then fewest losses, then head-to-head result.' });
    if (!c.playoffs) out.push({ label: 'Winner', text: 'The pool play leader wins the tournament.' });
    else if (adv >= 2) {
      out.push({ label: 'Playoffs', text: `${adv >= n ? `All ${n} players advance` : `The top ${adv} advance`}, seeded by pool play standings. Every series is best of ${c.bo}.` });
      bracketRounds(adv).forEach((r) => {
        const ms = r.matches.map(([a, b]) => (/ \d+ winner$/.test(a) && / \d+ winner$/.test(b) && r.matches.length === 1 ? `the two ${a.replace(/^the /, '').replace(/ \d+ winner$/, '')} winners` : `${a} vs ${b}`));
        const t = ms.length > 1 ? `${ms.slice(0, -1).join(', ')} and ${ms[ms.length - 1]}` : ms[0];
        out.push({ label: r.name, text: t.charAt(0).toUpperCase() + t.slice(1) + '.' });
      });
    }
    if (c.mapPick === 'fixed') out.push({ label: 'Maps', text: `Every game is on ${c.decider || 'Arabia'}.` });
    else if (c.mapPick === 'loser') out.push({ label: 'Maps', text: `Game 1 is on ${c.decider || 'Arabia'}. After that, the loser of each game picks the next map.` });
    else {
      out.push({ label: 'Game 1', text: 'The higher seed picks the map.' });
      if (Number(c.bo) >= 2) out.push({ label: 'Game 2', text: 'The lower seed picks the map.' });
      if (Number(c.bo) >= 3) out.push({ label: `Game ${c.bo} (if needed)`, text: `${c.decider || 'Arabia'}.` });
      if (Number(c.bo) > 3) out.push({ label: 'Other games', text: 'The loser of the previous game picks the map.' });
    }
    if (Number(c.poolSize)) out.push({ label: 'Civs', text: `Each player plays from their own pool of ${c.poolSize} civs, listed on the Civs & maps tab.` });
    return out;
  }

  // civ pool presets
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  function presetPools(method, players, size, copyFrom) {
    const civs = rows('civ_styles').map((r) => r.civ);
    const styles = civStyles();
    const out = {};
    if (method === 'same') { const one = shuffle(civs).slice(0, size); players.forEach((p) => { out[p] = one.slice(); }); }
    else if (method === 'balanced') players.forEach((p) => {
      const pick = [];
      ['Infantry', 'Cavalry', 'Archer'].forEach((st) => pick.push(...shuffle(civs.filter((c) => styles.get(c) === st)).slice(0, Math.floor(size / 4))));
      out[p] = pick.concat(shuffle(civs.filter((c) => !pick.includes(c))).slice(0, size - pick.length));
    });
    else if (method === 'copy') {
      players.forEach((p) => { out[p] = rows('civ_pool').filter((r) => r.tournament_id === copyFrom && r.player === p).map((r) => r.civ).slice(0, size); });
    } else players.forEach((p) => { out[p] = shuffle(civs).slice(0, size); });
    return out;
  }
  const poolsOf = (tid) => { const o = {}; rows('civ_pool').filter((r) => r.tournament_id === tid).forEach((r) => { (o[r.player] = o[r.player] || []).push(r.civ); }); return o; };
  const hasPools = () => [...new Set(rows('civ_pool').map((r) => r.tournament_id))].map(tOf).filter(Boolean);

  // ------------------------------------------------------------------ shared pieces
  function playerPicker(prefix, chosen, onToggle, state, redrawNote) {
    const all = rows('players');
    const np = state.newPlayer;
    return h('div', { class: 'adm-stack' },
      h('div', { class: 'tt-row-between' },
        h('span', { class: 'tt-note adm-flat', text: `${chosen.length} players · ${(chosen.length * (chosen.length - 1)) / 2} pool games${redrawNote ? ' · ' + redrawNote : ''}` }),
        h('span', { class: 'tt-btns' },
          btn('Everyone', () => { onToggle(null, all.map((p) => p.player)); }, 'small'),
          btn('Nobody', () => { onToggle(null, []); }, 'small'),
          btn('+ New player', () => { state.newPlayer = { name: '', steam: '', id: '', msg: '' }; draw(); }, 'small'))),
      h('div', { class: 'tt-chips' }, all.map((p) => chip([p.player, ' ', h('small', { class: 'tt-label', text: p.steam_name || '' })], chosen.includes(p.player), () => onToggle(p.player), { id: `${prefix}-p-${p.player}` }))),
      np && h('div', { class: 'adm-inline' },
        field('Name shown on the site', input(`${prefix}-np-name`, np.name, (v) => { np.name = v; }, { maxlength: 40 })),
        field('Steam name', input(`${prefix}-np-steam`, np.steam, (v) => { np.steam = v; }, { maxlength: 60 })),
        field('AoE2 profile ID', input(`${prefix}-np-id`, np.id, (v) => { np.id = v; }, { maxlength: 20, inputmode: 'numeric' })),
        h('span', { class: 'tt-btns' },
          btn('Add player', async () => {
            const name = np.name.trim(), id = np.id.trim();
            if (!name) { np.msg = 'Type the player’s name.'; draw(); return; }
            if (rows('players').some((p) => p.player === name)) { np.msg = `${name} is already a player.`; draw(); return; }
            if (!/^\d+$/.test(id)) { np.msg = 'The profile ID is the number in the player’s AoE2 Companion or AoE2 Insights address.'; draw(); return; }
            try {
              await ORG().save('player', { player: name, steam_name: np.steam.trim(), profile_id: id });
              state.newPlayer = null; onToggle(name, null, true);
            } catch (e) { np.msg = errText(e); draw(); }
          }, 'primary small'),
          btn('Cancel', () => { state.newPlayer = null; draw(); }, 'small')),
        np.msg && note(np.msg, { class: 'tt-note wide err' })));
  }

  function rulesEditor(prefix, list, onChange, auto) {
    const set = (fn) => { const next = list.map((r) => ({ ...r })); fn(next); onChange(next); };
    return h('div', { class: 'adm-stack' },
      h('ol', { class: 'adm-rules' }, list.map((r, i) => h('li', {},
        input(`${prefix}-rl-${i}`, r.label, (v) => { list[i].label = v; onChange(list, true); }, { class: 'tt-input', 'aria-label': 'Rule heading', maxlength: 40 }),
        input(`${prefix}-rt-${i}`, r.text, (v) => { list[i].text = v; onChange(list, true); }, { class: 'tt-input', 'aria-label': 'Rule text', maxlength: 400 }),
        h('span', { class: 'tt-btns' },
          btn('↑', () => set((n) => { [n[i - 1], n[i]] = [n[i], n[i - 1]]; }), 'small', { 'aria-label': 'Move up', disabled: !i }),
          btn('✕', () => set((n) => { n.splice(i, 1); }), 'small', { 'aria-label': 'Remove rule' }))))),
      h('div', { class: 'tt-btns' },
        btn('+ Add a rule', () => set((n) => { n.push({ label: '', text: '' }); }), 'small'),
        auto && btn('Rewrite from settings', () => onChange(auto()), 'small')));
  }

  function pending() {
    const list = rows('admin_changes');
    if (!list.length) return null;
    const uid = (ME().session && ME().session.user.id) || '';
    const describe = (c) => {
      const p = c.payload || {}, t = tOf(p.tournament_id);
      const tn = (t && t.name) || p.name || p.tournament_id;
      if (c.kind === 'player') return `Player: ${p.player}`;
      if (c.kind === 'rules') return `Rules: ${tn}`;
      if (c.kind === 'civ_pool') return `Civ pools: ${tn}`;
      if (c.kind === 'result') return p.clear ? `Result taken back: ${tn} game ${p.game}` : `Result: ${tn}${p.game != null && p.game !== '' ? ` game ${p.game}` : ` ${p.series}`}, ${p.winner} won`;
      const known = rows('tournaments_file').some((x) => x.tournament_id === p.tournament_id);
      return `${known ? 'Changed' : 'New'} tournament: ${tn}`;
    };
    return h('details', { class: 'tt-card adm-pending' },
      h('summary', {}, `${list.length} change${list.length === 1 ? '' : 's'} waiting to be written to GitHub `, h('span', { class: 'tt-label', text: '(the next update, within 30 minutes). Everyone already sees them.' })),
      h('ul', { class: 'tt-rules' }, list.map((c) => h('li', {}, `${describe(c)} · ${new Date(c.created_at).toLocaleString()} `,
        (c.created_by === uid || ME().role === 'owner') && btn('Undo', async () => {
          if (!confirm(`Undo “${describe(c)}”?`)) return;
          try { await ORG().cancel(c.id); } catch (e) { alert(errText(e)); }
        }, 'small')))));
  }

  // ------------------------------------------------------------------ page: set up a tournament (one page with a live preview)
  function setupPage() {
    const d = S.setup;
    if (!ORG().canRunAll()) return card('Set up a tournament', note('Only the owner and organizers of every tournament can start a new one.'));
    if (d.players == null) d.players = rows('players').map((p) => p.player);
    const n = d.players.length;
    const adv = d.template === 'rr' ? 0 : Math.min(Number(d.advance) || n, n);
    const cfg = { n, playoffs: d.template !== 'rr', advance: adv, bo: d.bo, mapPick: d.mapPick, decider: d.decider, poolSize: d.poolSize };
    const rules = d.rules || autoRules(cfg);
    const touched = () => draw();
    const people = S.people.list || [];
    const limited = people.filter((p) => p.role === 'organizer' && p.scope != null);
    const problems = [];
    if (!d.name.trim()) problems.push('Give it a name.');
    else if (tournaments().some((t) => t.name.toLowerCase() === d.name.trim().toLowerCase())) problems.push('Another tournament already has that name.');
    if (n < 2) problems.push('Pick at least two players.');
    if (d.end && d.start && d.end < d.start) problems.push('The end date is before the start date.');
    if (d.poolMethod === 'copy' && Number(d.poolSize) && !d.copyFrom) problems.push('Choose which tournament to copy civ pools from.');

    const left = h('div', { class: 'adm-stack' },
      card('Basics',
        h('div', { class: 'tt-form' },
          field('Name', input('su-name', d.name, (v) => { d.name = v; }, { maxlength: 80, placeholder: 'e.g. Winter 2026', onchange: () => draw() })),
          field('Start date', input('su-start', d.start, (v) => { d.start = v; }, { type: 'date', onchange: () => draw() })),
          field('End date (optional)', input('su-end', d.end, (v) => { d.end = v; }, { type: 'date', onchange: () => draw() }))),
        ME().role === 'owner' && group('Who runs it',
          limited.length ? h('div', { class: 'tt-chips' }, limited.map((p) => chip(p.player || p.name || 'Organizer', d.organizers.includes(p.user_id), () => {
            d.organizers = d.organizers.includes(p.user_id) ? d.organizers.filter((x) => x !== p.user_id) : d.organizers.concat(p.user_id); draw();
          }, { id: `su-org-${p.user_id}` }))) : null,
          note(limited.length ? 'Pick organizers who should run this tournament too. You, and organizers of every tournament, always can.' : 'You, and organizers of every tournament, run it. Organizers limited to certain tournaments show up here once you have some (People page).'))),
      card('Players', playerPicker('su', d.players, (p, list, add) => {
        if (list) d.players = list; else if (add) d.players = d.players.concat(p); else d.players = d.players.includes(p) ? d.players.filter((x) => x !== p) : d.players.concat(p);
        draw();
      }, d)),
      card('Format & maps',
        h('div', { class: 'tt-form' },
          field('Format', select('su-template', d.template, [['rrpo', 'Round robin, then playoffs'], ['rr', 'Round robin only']], (v) => { d.template = v; touched(); })),
          field('Playoff series', select('su-bo', d.bo, [1, 3, 5, 7].map((x) => [x, `Best of ${x}`]), (v) => { d.bo = Number(v); touched(); }, { disabled: d.template === 'rr' })),
          field('Players who make the playoffs', select('su-adv', adv || n, Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 2).map((x) => [x, x === n ? `All ${x}` : `Top ${x}`]), (v) => { d.advance = Number(v); touched(); }, { disabled: d.template === 'rr' || n < 2 })),
          field('How maps are picked', select('su-mappick', d.mapPick, [['seeds', 'Seeds pick; fixed decider'], ['loser', 'Loser picks the next map'], ['fixed', 'One map for every game']], (v) => { d.mapPick = v; touched(); })),
          field(d.mapPick === 'seeds' ? 'Decider map' : d.mapPick === 'fixed' ? 'Map' : 'Game 1 map', input('su-map', d.decider, (v) => { d.decider = v; }, { list: 'adm-maps', maxlength: 60, onchange: touched }))),
        bracket(adv, d.template === 'rr')),
      card('Civ pools',
        h('div', { class: 'tt-form' },
          field('Civs per player', select('su-pool', d.poolSize, [[0, 'No pools: any civ'], ...[5, 8, 10, 12, 15, 20, 25].map((x) => [x, `${x} civs`])], (v) => { d.poolSize = Number(v); touched(); })),
          field('Fill the pools', select('su-poolm', d.poolMethod, [['pick', 'I’ll pick them on the Civ pools page'], ['random', 'Random draw for each player'], ['balanced', 'Balanced random (a mix of styles)'], ['same', 'Same random pool for everyone'], ['copy', 'Copy from another tournament']], (v) => { d.poolMethod = v; draw(); }, { disabled: !Number(d.poolSize) })),
          d.poolMethod === 'copy' && Number(d.poolSize) ? field('Copy from', select('su-copy', d.copyFrom, [['', 'Choose…'], ...hasPools().map((t) => [t.tournament_id, t.name])], (v) => { d.copyFrom = v; draw(); })) : null)),
      card('Rules',
        note(d.rules ? 'You’ve edited these, so they no longer follow your settings.' : 'Written from your settings and kept up to date while you change them. Edit any line to take over.', { class: 'tt-note adm-flat' }),
        rulesEditor('su', rules, (list, typing) => { d.rules = list; if (!typing) draw(); }, d.rules ? () => { d.rules = null; return null; } : null)));

    const summary = h('aside', { class: 'tt-card adm-stack adm-sticky' },
      h('h2', { class: 'adm-title', text: d.name.trim() || 'New tournament' }),
      note(`${d.start ? 'Starts ' + day(d.start) : 'No start date yet'}${d.end ? ' · ends ' + day(d.end) : ''} · ${d.template === 'rr' ? 'Round robin only' : 'Round robin, then playoffs'}`, { class: 'tt-note adm-flat' }),
      h('div', { class: 'adm-kpis' },
        h('div', {}, h('div', { class: 'tt-kpi-v', text: String(n) }), h('div', { class: 'tt-label', text: 'players' })),
        h('div', {}, h('div', { class: 'tt-kpi-v', text: String((n * (n - 1)) / 2) }), h('div', { class: 'tt-label', text: 'pool games' }))),
      adv >= 2 && note(`Playoffs: ${bracketRounds(adv).map((r) => r.name).join(' → ')}, best of ${d.bo}`, { class: 'tt-note adm-flat' }),
      note(`Civs: ${Number(d.poolSize) ? `${d.poolSize} per player` : 'any civ'} · ${rules.length} rules`, { class: 'tt-note adm-flat' }),
      field('Status when created', select('su-status', d.status, [['Upcoming', 'Upcoming'], ['Active', 'Active (games start counting)']], (v) => { d.status = v; })),
      problems.length ? h('ul', { class: 'adm-problems' }, problems.map((p) => h('li', { text: p }))) : null,
      btn(d.busy ? 'Creating…' : 'Create tournament', () => createTournament(cfg, rules), 'primary', { disabled: !!problems.length || d.busy }),
      d.msg && note(d.msg, { role: 'status' }));
    return h('div', { class: 'adm-split' }, left, summary);
  }

  function bracket(adv, none) {
    if (none) return note('No playoffs: the pool play leader wins.');
    const rs = bracketRounds(adv);
    if (!rs.length) return null;
    return group('Playoff bracket', h('div', { class: 'adm-bracket' }, rs.map((r) => h('div', { class: 'col' }, h('span', { class: 'tt-label', text: r.name }),
      r.matches.map(([a, b]) => h('div', { class: 'm' }, h('div', { text: a.charAt(0).toUpperCase() + a.slice(1) }), h('div', { text: b.charAt(0).toUpperCase() + b.slice(1) })))))));
  }

  async function createTournament(cfg, rules) {
    const d = S.setup;
    const tid = nextId();
    d.busy = true; d.msg = ''; draw();
    try {
      await ORG().save('tournament', {
        tournament_id: tid, name: d.name.trim(), status: d.status, start_date: d.start, end_date: d.end, format: FORMATS[d.template],
        best_of: d.template === 'rr' ? 1 : d.bo, advance: cfg.advance, game3_map: d.decider.trim(), playoffs: d.template !== 'rr',
        map_pick: d.mapPick, pool_size: Number(d.poolSize) || 0, players: d.players, schedule: true,
      });
      await ORG().save('rules', { tournament_id: tid, rules: rules.filter((r) => r.label.trim() || r.text.trim()) });
      if (Number(d.poolSize) && d.poolMethod !== 'pick') await ORG().save('civ_pool', { tournament_id: tid, pools: presetPools(d.poolMethod, d.players, Number(d.poolSize), d.copyFrom) });
      for (const uid of d.organizers) {
        const p = (S.people.list || []).find((x) => x.user_id === uid);
        if (p) await ORG().setRole(uid, 'organizer', (p.scope || []).concat(tid));
      }
      if (d.organizers.length) S.people.list = null;
      const name = d.name.trim();
      const pick = Number(d.poolSize) && d.poolMethod === 'pick';
      S.setup = blankSetup();
      if (pick) { S.page = 'civs'; S.civs = { ...S.civs, tid, draft: null, msg: `${name} is created. Now pick each player’s civs.` }; }
      else { S.page = 'manage'; S.manage.tid = tid; S.manage.msg[tid] = `${name} is created. Everyone sees it now; it’s written to GitHub with the next update.`; }
    } catch (e) {
      d.busy = false; d.msg = errText(e);
    }
    d.busy = false;
    draw();
  }

  // ------------------------------------------------------------------ page: civ pools (civ grid, one player at a time)
  function civsPage() {
    const c = S.civs;
    const ts = mine();
    if (!ts.length) return card('Civ pools', note('You don’t run any tournaments yet.'));
    if (!ts.some((t) => t.tournament_id === c.tid)) { c.tid = ts[0].tournament_id; c.draft = null; }
    const t = tOf(c.tid);
    const players = rosterOf(c.tid);
    if (!c.draft) { c.draft = poolsOf(c.tid); c.size = Number(t.pool_size) || Math.max(15, ...Object.values(c.draft).map((x) => x.length)); c.dirty = false; }
    players.forEach((p) => { c.draft[p] = c.draft[p] || []; });
    if (!players.includes(c.player)) c.player = players[0] || '';
    const styles = civStyles();
    const civs = rows('civ_styles').map((r) => r.civ);
    const size = c.size;
    const pool = c.draft[c.player] || [];
    const change = (fn) => { fn(); c.dirty = true; c.msg = ''; draw(); };
    const count = (k) => h('span', { class: 'adm-count' + (k === size ? ' full' : k > size ? ' over' : ''), text: `${k} / ${size}` });
    const shown = civs.filter((x) => c.filter === 'All' || styleGroup(styles.get(x)) === c.filter);
    const sources = hasPools().filter((x) => x.tournament_id !== c.tid);
    return card(null,
      h('div', { class: 'tt-row-between' },
        h('div', {}, h('h2', { text: 'Civ pools' }), note('Pick each player’s civs. Click a civ to add or take it out.', { class: 'tt-note adm-flat' })),
        h('div', { class: 'tt-form adm-narrow' },
          field('Tournament', select('cv-t', c.tid, ts.map((x) => [x.tournament_id, `${x.name} (${x.status})`]), (v) => {
            if (c.dirty && !confirm('Leave without saving these civ pools?')) { draw(); return; }
            c.tid = v; c.draft = null; c.msg = ''; draw();
          })),
          field('Civs per player', select('cv-size', size, [5, 8, 10, 12, 15, 20, 25, 30].map((x) => [x, String(x)]), (v) => change(() => { c.size = Number(v); }))))),
      !players.length ? note('This tournament has no players yet. Add them on the Manage page.') : [
        h('div', { class: 'tt-chips' }, players.map((p) => chip([p, ' ', count(c.draft[p].length)], p === c.player, () => { c.player = p; draw(); }, { id: `cv-p-${p}` }))),
        h('div', { class: 'tt-row-between' },
          h('span', {}, h('b', { text: c.player }), ' · ', count(pool.length)),
          h('span', { class: 'tt-btns' },
            btn('Random fill', () => change(() => { c.draft[c.player] = pool.concat(shuffle(civs.filter((x) => !pool.includes(x))).slice(0, Math.max(0, size - pool.length))); }), 'small'),
            btn('Copy to everyone', () => change(() => { players.forEach((p) => { c.draft[p] = pool.slice(); }); }), 'small'),
            btn('Clear', () => change(() => { c.draft[c.player] = []; }), 'small'))),
        h('div', { class: 'tt-row-between adm-presets' },
          h('span', { class: 'tt-label', text: 'Fill everyone:' }),
          h('span', { class: 'tt-btns' },
            btn('Random', () => change(() => { c.draft = presetPools('random', players, size); }), 'small'),
            btn('Balanced random', () => change(() => { c.draft = presetPools('balanced', players, size); }), 'small'),
            btn('Same pool for all', () => change(() => { c.draft = presetPools('same', players, size); }), 'small'),
            sources.length ? select('cv-copy', '', [['', 'Copy from…'], ...sources.map((x) => [x.tournament_id, x.name])], (v) => { if (v) change(() => { c.draft = presetPools('copy', players, size, v); }); }, { class: 'tt-btn small', 'aria-label': 'Copy civ pools from another tournament' }) : null)),
        h('div', { class: 'tt-chips' }, STYLE_FILTERS.map((f) => chip([f, f === 'All' ? '' : h('small', { class: 'tt-label', text: ' ' + civs.filter((x) => styleGroup(styles.get(x)) === f).length })], c.filter === f, () => { c.filter = f; draw(); }, { id: `cv-f-${f}` }))),
        h('div', { class: 'adm-civgrid' }, shown.map((x) => {
          const on = pool.includes(x);
          return h('button', { type: 'button', class: 'adm-civ', id: `cv-c-${x}`, 'aria-pressed': String(on), disabled: !on && pool.length >= size, onclick: () => change(() => { c.draft[c.player] = on ? pool.filter((y) => y !== x) : pool.concat(x); }) },
            x, h('small', { text: styles.get(x) || '' }));
        })),
      ],
      h('div', { class: 'tt-row-between adm-savebar' },
        h('span', { class: 'tt-note adm-flat', role: 'status', text: c.msg || (c.dirty ? 'You have unsaved changes.' : 'Saved pools show on the Civs & maps tab.') }),
        h('span', { class: 'tt-btns' },
          btn('Discard', () => { c.draft = null; c.msg = ''; draw(); }, '', { disabled: !c.dirty }),
          btn('Save civ pools', async () => {
            const over = players.filter((p) => c.draft[p].length > size);
            if (over.length && !confirm(`${over.join(', ')} ${over.length === 1 ? 'has' : 'have'} more than ${size} civs. Save anyway?`)) return;
            try {
              await ORG().save('civ_pool', { tournament_id: c.tid, pools: Object.fromEntries(players.map((p) => [p, c.draft[p]])) });
              if (Number(t.pool_size) !== size) await ORG().save('tournament', tPayload(t, { pool_size: size }));
              c.dirty = false; c.draft = null; c.msg = 'Saved. Everyone sees the new pools now.';
            } catch (e) { c.msg = errText(e); }
            draw();
          }, 'primary', { disabled: !c.dirty }))));
  }

  // ------------------------------------------------------------------ page: manage a tournament (list and detail)
  function managePage() {
    const m = S.manage;
    const ts = mine();
    if (!ts.length) return card('Manage tournaments', note('You don’t run any tournaments yet. Ask the owner to add you to one on the People page.'));
    if (!ts.some((t) => t.tournament_id === m.tid)) m.tid = ts[0].tournament_id;
    const list = h('div', { class: 'adm-stack' },
      h('div', { class: 'adm-tlist' }, ts.map((t) => {
        const pool = gamesOf(t.tournament_id).filter((g) => g.stage === 'Pool play');
        const done = pool.filter((g) => g.status === 'Final').length;
        return h('button', { type: 'button', id: `mg-t-${t.tournament_id}`, 'aria-current': String(t.tournament_id === m.tid), onclick: () => { m.tid = t.tournament_id; draw(); } },
          h('b', { text: t.name }), h('small', { text: `${t.status} · ${done}/${pool.length} pool games` }),
          h('span', { class: 'adm-bar' }, h('i', { style: `width:${pool.length ? Math.round((done / pool.length) * 100) : 0}%` })));
      })),
      ORG().canRunAll() && btn('+ New tournament', () => { S.page = 'setup'; draw(); }));
    return h('div', { class: 'adm-mlayout' }, list, manageDetail(tOf(m.tid)));
  }

  function manageDetail(t) {
    const m = S.manage, tid = t.tournament_id;
    const dr = m.drafts[tid] = m.drafts[tid] || {};
    const games = gamesOf(tid);
    const pool = games.filter((g) => g.stage === 'Pool play');
    const done = pool.filter((g) => g.status === 'Final').length;
    const roster = rosterOf(tid);
    const played = playedAny(tid);
    const say = (k, text) => { m.msg[`${tid}:${k}`] = text; draw(); };
    const msg = (k) => m.msg[`${tid}:${k}`] && note(m.msg[`${tid}:${k}`], { role: 'status' });
    const saveT = async (k, over, done2) => { try { await ORG().save('tournament', tPayload(t, over)); if (done2) done2(); say(k, 'Saved. Everyone sees it now.'); } catch (e) { say(k, errText(e)); } };

    // games waiting for an organizer
    const votes = TT_confirm.index(rows('votes'));
    const waiting = rows('t_suggest').filter((s) => s.tournament_id === tid).map((s) => ({ s, st: TT_confirm.status(votes[`${tid}_${s.match_id}`], s), v: votes[`${tid}_${s.match_id}`] || {} }))
      .filter((x) => x.st === 'waiting' || x.st === 'disputed');
    const ans = (v, k) => (v[k] ? (v[k].answer === 'yes' ? 'confirmed' : 'said no') : 'hasn’t answered');
    const vote = async (s, answer) => {
      try { await ORG().vote({ tournament_id: tid, match_id: String(s.match_id), side: 'org', player: 'organizer', answer }); } catch (e) { say('ov', errText(e)); }
    };
    // results entered by hand (admin-logic.js result())
    const openSeries = rows('bracket').filter((b) => b.tournament_id === tid && b.player_high && b.player_low && !b.winner);
    const today = new Date().toISOString().slice(0, 10);
    const resultDraft = (g) => ({ game: g.game ?? null, player_a: g.player_a, player_b: g.player_b, winner: g.status === 'Final' ? g.winner : '',
      civ_a: g.civ_a || '', civ_b: g.civ_b || '', map: g.map || '', played_at: g.played_at ? String(g.played_at).slice(0, 10) : today, byHand: /by hand/.test(g.confirmed_by || '') });
    const civOpts = (v) => [['', 'Unknown'], ...rows('civ_styles').map((r) => [r.civ, r.civ]), ...(v && !rows('civ_styles').some((r) => r.civ === v) ? [[v, v]] : [])];
    const resultForm = (g) => {
      const r = dr.result, k = `mg-${tid}-res`;
      const save = async (payload, done) => {
        try { await ORG().save('result', { tournament_id: tid, ...payload }); delete dr.result; say('res', done); } catch (e) { say('res', errText(e)); }
      };
      return h('div', { class: 'adm-result' },
        h('div', { class: 'tt-form' },
          field('Winner', select(`${k}-w`, r.winner, [['', 'Choose…'], [g.player_a, g.player_a], [g.player_b, g.player_b]], (v) => { r.winner = v; draw(); })),
          field(`${g.player_a}’s civ`, select(`${k}-ca`, r.civ_a, civOpts(r.civ_a), (v) => { r.civ_a = v; })),
          field(`${g.player_b}’s civ`, select(`${k}-cb`, r.civ_b, civOpts(r.civ_b), (v) => { r.civ_b = v; })),
          field('Map', input(`${k}-map`, r.map, (v) => { r.map = v; }, { list: 'adm-maps', maxlength: 60 })),
          field('Played on', input(`${k}-day`, r.played_at, (v) => { r.played_at = v; }, { type: 'date', max: today }))),
        h('div', { class: 'tt-btns' },
          btn('Save result', () => {
            if (!r.winner) { say('res', 'Choose who won.'); return; }
            save(r.series ? { series: r.series, stage: r.stage, player_a: g.player_a, player_b: g.player_b, winner: r.winner, civ_a: r.civ_a, civ_b: r.civ_b, map: r.map.trim(), played_at: r.played_at }
              : { game: g.game, winner: r.winner, civ_a: r.civ_a, civ_b: r.civ_b, map: r.map.trim(), played_at: r.played_at },
            `Saved: ${r.winner} won. Standings and the bracket show it now.`);
          }, 'primary', { disabled: !r.winner }),
          r.byHand && !r.series && btn('Take the result back', () => { if (confirm(`Take back the result of game ${g.game}?`)) save({ game: g.game, clear: true }, `Game ${g.game}'s result was taken back.`); }),
          btn('Cancel', () => { delete dr.result; draw(); })));
    };
    const status = t.status;
    const next = status === 'Upcoming' ? ['Active', 'Start it (make active)'] : status === 'Active' ? ['Completed', 'Mark completed'] : ['Active', 'Reopen'];

    // settings draft
    const sd = dr.settings = dr.settings || { name: t.name, status: t.status, start: t.start_date || '', end: t.end_date || '', bo: Number(t.best_of) || 3, advance: Number(t.advance) || roster.length, playoffs: t.playoffs !== false, mapPick: t.map_pick || 'seeds', decider: t.game3_map || '' };
    const pd = dr.players = dr.players || { list: roster.slice(), newPlayer: null };
    const rd = dr.rules = dr.rules || { list: rows('rules').filter((r) => r.tournament_id === tid).sort((a, b) => a.order - b.order).map((r) => ({ label: r.label, text: r.text })), dirty: false };
    const pools = poolsOf(tid);
    const organizers = (S.people.list || []).filter((p) => p.role === 'owner' || (p.role === 'organizer' && (p.scope == null || p.scope.includes(tid))));

    const sec = (title, ...kids) => h('div', { class: 'adm-sec' }, h('h3', { text: title }), ...kids);
    return h('div', { class: 'tt-card adm-stack' },
      h('div', { class: 'tt-row-between' },
        h('div', { class: 'tt-btns' }, h('h2', { class: 'adm-title', text: t.name }), h('span', { class: 'tt-pill' + (status === 'Active' ? ' active' : ''), text: status })),
        h('span', { class: 'tt-label', text: [t.start_date && `Starts ${day(t.start_date)}`, t.end_date && `ends ${day(t.end_date)}`].filter(Boolean).join(' · ') })),
      m.msg[tid] && note(m.msg[tid], { role: 'status' }),
      h('div', { class: 'adm-kpis' },
        h('div', {}, h('div', { class: 'tt-kpi-v', text: `${done} / ${pool.length}` }), h('div', { class: 'tt-label', text: 'pool games played' })),
        h('div', {}, h('div', { class: 'tt-kpi-v', text: String(roster.length) }), h('div', { class: 'tt-label', text: 'players' })),
        h('div', {}, h('div', { class: 'tt-kpi-v', text: String(waiting.length) }), h('div', { class: 'tt-label', text: 'games to approve' }))),
      h('span', { class: 'adm-bar' }, h('i', { style: `width:${pool.length ? Math.round((done / pool.length) * 100) : 0}%` })),
      waiting.length ? sec('Needs you', h('ul', { class: 'adm-attn' }, waiting.map(({ s, st, v }) => h('li', {},
        h('span', { text: `${s.player_a} vs ${s.player_b} · ${s.map || 'map unknown'} · ${Math.round(s.duration_min || 0)} min · ${s.player_a} ${ans(v, 'a')}, ${s.player_b} ${ans(v, 'b')}${st === 'disputed' ? ' (disputed)' : ''}` }),
        h('span', { class: 'tt-btns' }, btn('Approve', () => vote(s, 'yes'), 'primary small'), btn('Not a tournament game', () => vote(s, 'no'), 'small')))))) : null,
      msg('ov'),
      h('div', { class: 'tt-btns' },
        btn(next[1], () => saveT('ov', { status: next[0] }, () => { delete dr.settings; })),
        btn('Copy as a new tournament', () => {
          S.setup = { ...blankSetup(), name: '', template: t.playoffs === false ? 'rr' : 'rrpo', players: roster.slice(), bo: Number(t.best_of) || 3, advance: Number(t.advance) || 0, mapPick: t.map_pick || 'seeds', decider: t.game3_map || 'Arabia', poolSize: Number(t.pool_size) || (Object.keys(pools).length ? 15 : 0), poolMethod: Object.keys(pools).length ? 'copy' : 'pick', copyFrom: tid };
          S.page = 'setup'; draw();
        })),

      sec('Settings',
        h('div', { class: 'tt-form' },
          field('Name', input(`mg-${tid}-name`, sd.name, (v) => { sd.name = v; }, { maxlength: 80 })),
          field('Status', select(`mg-${tid}-status`, sd.status, TT_admin.STATUSES.map((x) => [x, x]), (v) => { sd.status = v; })),
          field('Start date', input(`mg-${tid}-start`, sd.start, (v) => { sd.start = v; }, { type: 'date' })),
          field('End date', input(`mg-${tid}-end`, sd.end, (v) => { sd.end = v; }, { type: 'date' })),
          field('Playoffs', select(`mg-${tid}-po`, sd.playoffs ? 'yes' : 'no', [['yes', 'Yes'], ['no', 'No, round robin only']], (v) => { sd.playoffs = v === 'yes'; draw(); })),
          field('Playoff series', select(`mg-${tid}-bo`, sd.bo, [1, 3, 5, 7].map((x) => [x, `Best of ${x}`]), (v) => { sd.bo = Number(v); }, { disabled: !sd.playoffs })),
          field('Players who make the playoffs', select(`mg-${tid}-adv`, Math.min(sd.advance || roster.length, roster.length), Array.from({ length: Math.max(0, roster.length - 1) }, (_, i) => i + 2).map((x) => [x, x === roster.length ? `All ${x}` : `Top ${x}`]), (v) => { sd.advance = Number(v); }, { disabled: !sd.playoffs })),
          field('How maps are picked', select(`mg-${tid}-mp`, sd.mapPick, [['seeds', 'Seeds pick; fixed decider'], ['loser', 'Loser picks the next map'], ['fixed', 'One map for every game']], (v) => { sd.mapPick = v; draw(); })),
          field(sd.mapPick === 'seeds' ? 'Decider map' : sd.mapPick === 'fixed' ? 'Map' : 'Game 1 map', input(`mg-${tid}-map`, sd.decider, (v) => { sd.decider = v; }, { list: 'adm-maps', maxlength: 60 }))),
        h('div', { class: 'tt-btns' }, btn('Save settings', () => {
          if (!sd.name.trim()) { say('set', 'Give the tournament a name.'); return; }
          if (sd.end && sd.start && sd.end < sd.start) { say('set', 'The end date is before the start date.'); return; }
          saveT('set', { name: sd.name.trim(), status: sd.status, start_date: sd.start, end_date: sd.end, best_of: sd.bo, advance: sd.advance, playoffs: sd.playoffs, map_pick: sd.mapPick, game3_map: sd.decider.trim(), format: FORMATS[sd.playoffs ? 'rrpo' : 'rr'] }, () => { delete dr.settings; });
        }, 'primary'), btn('Reset', () => { delete dr.settings; draw(); })),
        msg('set')),

      sec('Players',
        note(played ? 'Games have been played. Adding a player adds their pool games to the end of the schedule; removing one drops their unplayed games and keeps the played ones.'
          : 'No games played yet, so saving makes a fresh pool play schedule for these players.', { class: 'tt-note adm-flat' }),
        playerPicker(`mg-${tid}`, pd.list, (p, list, add) => {
          if (list) pd.list = list; else if (add) pd.list = pd.list.concat(p); else pd.list = pd.list.includes(p) ? pd.list.filter((x) => x !== p) : pd.list.concat(p);
          draw();
        }, pd),
        h('div', { class: 'tt-btns' }, btn('Save players', async () => {
          if (pd.list.length < 2) { say('pl', 'A tournament needs at least two players.'); return; }
          const gone = roster.filter((x) => !pd.list.includes(x));
          if (played && gone.length && !confirm(`Remove ${gone.join(', ')}? Their unplayed games are dropped.`)) return;
          await saveT('pl', { players: pd.list, schedule: true }, () => { delete dr.players; });
        }, 'primary', { disabled: pd.list.slice().sort().join() === roster.slice().sort().join() }), btn('Reset', () => { delete dr.players; draw(); })),
        msg('pl')),

      sec('Schedule',
        h('div', { class: 'tt-scroll adm-tall' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Game', 'Stage', 'Players', 'Result', ''].map((x) => h('th', { text: x })))),
          h('tbody', {}, games.length ? games.slice().sort((a, b) => Number(a.game) - Number(b.game)).flatMap((g) => [h('tr', {},
            h('td', { class: 'num', text: String(g.game) }), h('td', { text: g.stage + (g.series ? ` · ${g.series}` : '') }), h('td', { text: `${g.player_a} vs ${g.player_b}` }),
            h('td', {}, g.status === 'Final' ? h('span', { class: 'tt-pill active', text: `${g.winner} won${/by hand/.test(g.confirmed_by || '') ? ' · entered' : ''}` }) : h('span', { class: 'tt-pill', text: g.status || 'Scheduled' })),
            h('td', {}, g.player_a && g.player_b && btn(g.status === 'Final' ? 'Edit' : 'Enter result', () => { dr.result = resultDraft(g); draw(); }, 'small'))),
          dr.result && dr.result.game === g.game ? h('tr', {}, h('td', { colspan: '5' }, resultForm(g))) : null].filter(Boolean))
            : h('tr', {}, h('td', { colspan: '5', class: 'tt-empty', text: 'No games yet. Save the players to make the schedule.' }))))),
        openSeries.length ? h('div', { class: 'tt-btns' }, ...openSeries.map((b) => btn(`Enter a game: ${b.series} (${b.player_high} vs ${b.player_low})`, () => {
          dr.result = { ...resultDraft({ player_a: b.player_high, player_b: b.player_low }), series: b.series, stage: b.round || 'Playoffs' }; draw();
        }, 'small'))) : null,
        dr.result && dr.result.series ? resultForm({ player_a: dr.result.player_a, player_b: dr.result.player_b, series: dr.result.series }) : null,
        note('Games are filled in by themselves when both players (or an organizer) confirm a game the site found. Enter a result by hand for a game Microsoft has no record of, or to correct one.', { class: 'tt-note adm-flat' }),
        msg('res')),

      sec('Civ pools',
        note(Object.keys(pools).length ? `${Number(t.pool_size) || '?'} civs per player · pools set for ${roster.filter((p) => (pools[p] || []).length).length} of ${roster.length} players.` : 'No civ pools: any civ is allowed.', { class: 'tt-note adm-flat' }),
        h('div', { class: 'tt-btns' }, btn(Object.keys(pools).length ? 'Edit civ pools' : 'Set up civ pools', () => { S.civs.tid = tid; S.civs.draft = null; S.page = 'civs'; draw(); }))),

      sec('Rules',
        rulesEditor(`mg-${tid}`, rd.list, (list, typing) => { rd.list = list; rd.dirty = true; if (!typing) draw(); },
          () => autoRules({ n: roster.length, playoffs: t.playoffs !== false, advance: Number(t.advance) || roster.length, bo: Number(t.best_of) || 3, mapPick: t.map_pick || 'seeds', decider: t.game3_map, poolSize: Number(t.pool_size) || 0 })),
        h('div', { class: 'tt-btns' }, btn('Save rules', async () => {
          try { await ORG().save('rules', { tournament_id: tid, rules: rd.list.filter((r) => r.label.trim() || r.text.trim()) }); delete dr.rules; say('ru', 'Saved. Everyone sees the new rules now.'); } catch (e) { say('ru', errText(e)); }
        }, 'primary'), btn('Reset', () => { delete dr.rules; draw(); })),
        msg('ru')),

      sec('Organizers',
        S.people.list ? h('div', { class: 'tt-chips' }, organizers.map((p) => h('span', { class: 'tt-pill', text: `${p.player || p.name || 'Someone'} · ${p.role === 'owner' ? 'owner' : p.scope == null ? 'every tournament' : 'this tournament'}` })))
          : note('Open the People page to see who runs it.', { class: 'tt-note adm-flat' }),
        ME().role === 'owner' && h('div', { class: 'tt-btns' }, btn('Change on the People page', () => { S.page = 'people'; draw(); }))));
  }

  // ------------------------------------------------------------------ page: people (table)
  async function loadPeople(force) {
    const p = S.people;
    if (p.loading || (p.list && !force)) return;
    p.loading = true;
    try { [p.list, p.invites] = await Promise.all([ORG().people(), ORG().invites()]); p.msg = ''; } catch (e) { p.msg = errText(e); p.list = p.list || []; p.invites = p.invites || []; }
    p.loading = false;
    draw();
  }
  function peoplePage() {
    const p = S.people;
    const owner = ME().role === 'owner';
    if (!p.list) { loadPeople(); return card('People', note('Loading…')); }
    const ts = tournaments();
    const act = async (fn, done) => { try { await fn(); p.msg = done || ''; await loadPeople(true); } catch (e) { p.msg = errText(e); draw(); } };
    const copy = async (text) => { try { await navigator.clipboard.writeText(text); p.msg = 'Link copied.'; } catch (e) { p.msg = 'Select the link and copy it.'; } draw(); };
    const roleOpts = [['player', 'As a player'], ['viewer', 'As a viewer'], ...(owner ? [['organizer', 'As an organizer']] : [])];

    const invite = card(null,
      h('div', { class: 'tt-row-between' },
        h('div', {}, h('h2', { text: 'Invite someone' }), note('Each link works once, for 14 days. They join with the role you pick.', { class: 'tt-note adm-flat' })),
        h('span', { class: 'tt-btns' },
          select('pp-inv-role', p.inviteRole, roleOpts, (v) => { p.inviteRole = v; }, { class: 'tt-btn', 'aria-label': 'Role for the invite' }),
          btn('Create invite link', () => act(async () => { const code = await ORG().invite(p.inviteRole); p.link = ORG().link(code); }), 'primary'))),
      p.link && h('p', { class: 'adm-link' }, 'Send this link to one person: ', h('code', { text: p.link }), ' ', btn('Copy', () => copy(p.link), 'small')),
      (p.invites || []).length ? h('div', { class: 'tt-scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Waiting invites', 'Role', 'Made', 'Expires', ''].map((x) => h('th', { text: x })))),
        h('tbody', {}, p.invites.map((i) => h('tr', {},
          h('td', {}, h('code', { text: `…?invite=${i.code.slice(0, 6)}…` })), h('td', { text: ROLES[i.role] ? ROLES[i.role][0] : i.role }),
          h('td', { text: day(i.created_at) }), h('td', { text: day(i.expires_at) }),
          h('td', {}, h('span', { class: 'tt-btns' }, btn('Copy', () => copy(ORG().link(i.code)), 'small'), btn('Cancel', () => act(() => ORG().cancelInvite(i.code), 'Invite cancelled.'), 'small'))))))))
        : null);

    const scopeCell = (m) => {
      if (m.role === 'owner') return h('span', { class: 'tt-label', text: 'Everything' });
      if (m.role !== 'organizer') return h('span', { class: 'tt-label', text: '—' });
      if (!owner) return h('span', { text: m.scope == null ? 'Every tournament' : (m.scope.map((id) => (tOf(id) || {}).name || id).join(', ') || 'No tournaments yet') });
      const set = (scope) => act(() => ORG().setRole(m.user_id, 'organizer', scope));
      return h('div', { class: 'tt-chips' },
        chip('Every tournament', m.scope == null, () => set(m.scope == null ? [] : null), { id: `pp-s-${m.user_id}-all` }),
        m.scope != null && ts.map((t) => chip(t.name, m.scope.includes(t.tournament_id), () => set(m.scope.includes(t.tournament_id) ? m.scope.filter((x) => x !== t.tournament_id) : m.scope.concat(t.tournament_id)), { id: `pp-s-${m.user_id}-${t.tournament_id}` })),
        m.scope != null && !m.scope.length ? h('span', { class: 'tt-label', text: 'Pick the tournaments they run.' }) : null);
    };
    const table = card('People who can open the site',
      h('div', { class: 'adm-legend' }, Object.values(ROLES).map(([n, d]) => h('div', {}, h('b', { text: n }), d))),
      h('div', { class: 'tt-scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Player', 'Discord', ...(owner ? ['Email'] : []), 'Role', 'Runs', 'Joined', ''].map((x) => h('th', { text: x })))),
        h('tbody', {}, p.list.map((m) => h('tr', {},
          h('td', {}, m.player ? h('b', { text: m.player }) : h('span', { class: 'tt-label', text: m.role === 'viewer' ? '—' : 'Not chosen yet' })),
          h('td', { text: m.name || '' }),
          owner && h('td', { text: m.email || '' }),
          h('td', {}, m.role === 'owner' || !owner ? h('span', { class: 'tt-pill' + (m.role === 'owner' ? ' active' : ''), text: ROLES[m.role][0] })
            : select(`pp-r-${m.user_id}`, m.role, [['organizer', 'Organizer'], ['player', 'Player'], ['viewer', 'Viewer']], (v) => {
              if (v === 'viewer' && m.player && !confirm(`Make ${m.player} a viewer? They stop being linked to ${m.player}.`)) { draw(); return; }
              act(() => ORG().setRole(m.user_id, v, v === 'organizer' ? [] : null), v === 'organizer' ? 'Now pick which tournaments they run.' : 'Role changed.');
            }, { 'aria-label': `Role for ${m.player || m.name || 'this person'}` })),
          h('td', { class: 'wrap' }, scopeCell(m)),
          h('td', { text: day(m.added_at) }),
          h('td', {}, owner && m.role !== 'owner' && btn('Remove', () => {
            if (!confirm(`Remove ${m.player || m.name || 'this person'}? They won’t be able to open the site any more.`)) return;
            act(() => ORG().remove(m.user_id), 'Removed.');
          }, 'small'))))))),
      !owner && note('Only the owner can change roles or remove people.'));
    return h('div', { class: 'adm-stack' }, p.msg && note(p.msg, { role: 'status', class: 'tt-note adm-msg' }), invite, table);
  }

  // ------------------------------------------------------------------ drawing
  let lastSig = '';
  function draw() {
    const tab = el('tab-admin');
    const st = ME();
    const org = window.TT_ORG && TT_ORG.isOrganizer();
    if (tab) tab.hidden = !org;
    const page = el('admin');
    if (!org && st.role && page && !page.hidden && window.TT_show) { window.TT_show('home', true); return; } // not an organizer (once the role is known)
    if (!org || !page || page.hidden) return;
    if (!ok('tournaments', 'players', 'roster', 'matches', 'rules', 'civ_pool', 'civ_styles')) { el('admin-body').replaceChildren(note('Loading…')); return; }
    const pages = [['setup', 'Set up a tournament', TT_ORG.canRunAll()], ['civs', 'Civ pools', true], ['manage', 'Manage tournaments', true], ['people', 'People', true]];
    if (!pages.some(([k, , show]) => k === S.page && show)) S.page = 'manage';
    el('admin-nav').replaceChildren(...pages.filter((x) => x[2]).map(([k, l]) => h('button', { type: 'button', 'aria-current': S.page === k ? 'page' : null, onclick: () => { S.page = k; draw(); } }, l)));
    const scope = st.role === 'owner' ? 'You’re the owner.' : st.scope == null ? 'You run every tournament.' : `You run: ${st.scope.map((id) => (tOf(id) || {}).name || id).join(', ') || 'no tournaments yet'}.`;
    el('admin-who').textContent = scope;
    if (S.page === 'setup' || S.page === 'manage') loadPeople();
    // keep focus and the caret where they were, so typing survives a redraw
    const a = document.activeElement, id = a && a.id, sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    const y = window.scrollY;
    const body = { setup: setupPage, civs: civsPage, manage: managePage, people: peoplePage }[S.page]();
    el('admin-body').replaceChildren(...[pending(), body, h('datalist', { id: 'adm-maps' }, MAPS.map((x) => h('option', { value: x })))].filter(Boolean));
    if (id && el(id)) { const n = el(id); n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) try { n.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
    window.scrollTo(0, y);
  }
  // redraw when something the Admin tab shows has changed (live games and polling fire often; the data is small)
  dash.onData(() => {
    const sig = JSON.stringify([['tournaments', 'players', 'roster', 'matches', 'rules', 'civ_pool', 'civ_styles', 'admin_changes', 'votes', 't_suggest', 'bracket'].map((k) => [dash.data(k).status, rows(k)]),
      el('admin') && el('admin').hidden, window.TT_ORG && TT_ORG.isOrganizer()]);
    if (sig === lastSig) return;
    lastSig = sig;
    draw();
  });
  // render.js switches tabs without a data change
  if (el('tab-admin')) el('tab-admin').addEventListener('click', () => setTimeout(draw, 0));
})();
