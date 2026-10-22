// Organizers: add or change tournaments and players from the site ("Manage tournaments" in All tournaments).
// A change is saved in Supabase (backend.js TT_ORG), shows for everyone straight away (site/js/admin-logic.js
// through dash.js), and the update job writes it into config/ on GitHub (pipeline/apply_admin_changes.js).
(() => {
  const el = (id) => document.getElementById(id);
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, fn, cls) => { const b = mk('button', 'tt-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const field = (label, input, cls) => { const l = mk('label', 'tt-field' + (cls ? ' ' + cls : '')); l.append(mk('span', 'tt-label', label), input); return l; };
  const group = (label, box) => { const d = mk('div', 'tt-field wide'); d.append(mk('span', 'tt-label', label), box); return d; };
  const input = (type, attrs) => { const i = mk('input'); i.type = type; Object.assign(i, attrs || {}); return i; };
  const select = (opts) => { const s = mk('select'); opts.forEach(([v, t]) => { const o = mk('option', '', t); o.value = v; s.append(o); }); return s; };
  const rows = (id) => { const r = dash.data(id); return r.status === 'ok' ? r.data : null; };
  const errText = (e) => (/admin_changes/.test(String(e && e.message)) ? 'The database isn’t ready for this yet: run the newest supabase/schema.sql in the Supabase SQL Editor (see the README).' : `Couldn’t save: ${e && e.message ? e.message : e}`);
  const NEW = '__new';
  const FORMAT = 'Round robin pool play, then single-elimination playoffs';

  const f = {};
  let built = false, dirty = false, shownFor = null, want = null; // want: a just-saved tournament to pick once it's listed

  function build() {
    built = true;
    const tForm = el('t-form');
    f.pick = select([[NEW, 'New tournament']]);
    f.name = input('text', { maxLength: 80, required: true });
    f.status = select(TT_admin.STATUSES.map((s) => [s, s]));
    f.start = input('date');
    f.end = input('date');
    f.format = input('text', { maxLength: 200 });
    f.best = select([1, 3, 5, 7].map((n) => [String(n), `Best of ${n}`]));
    f.advance = input('number', { min: 0, max: 64, step: 1 });
    f.map = input('text', { maxLength: 60, placeholder: 'e.g. Arabia' });
    f.players = mk('fieldset', 'tt-checks');
    f.schedule = input('checkbox');
    f.scheduleText = mk('span');
    const sched = mk('label', 'tt-check wide'); sched.append(f.schedule, f.scheduleText);
    f.tMsg = mk('p', 'tt-note wide'); f.tMsg.setAttribute('role', 'status');
    const save = mk('div', 'tt-btns wide'); save.append(btn('Save tournament', saveTournament, 'primary'));
    tForm.replaceChildren(
      field('Tournament', f.pick, 'wide'), field('Name', f.name), field('Status', f.status), field('Start date', f.start), field('End date (optional)', f.end),
      field('Format', f.format, 'wide'), field('Playoff series', f.best), field('Players who make the playoffs (0 = everyone)', f.advance),
      field('Decider map (last game of a series)', f.map), group('Players', f.players), sched, save, f.tMsg,
    );
    tForm.addEventListener('input', () => { dirty = true; });
    tForm.addEventListener('submit', (e) => e.preventDefault());
    f.pick.addEventListener('change', () => { dirty = false; f.tMsg.textContent = ''; fill(); });

    const pForm = el('p-form');
    f.pName = input('text', { maxLength: 40, required: true });
    f.pList = mk('datalist'); f.pList.id = 'p-form-names'; f.pName.setAttribute('list', f.pList.id);
    f.pSteam = input('text', { maxLength: 60 });
    f.pId = input('text', { maxLength: 20, inputMode: 'numeric', pattern: '[0-9]*' });
    f.pMsg = mk('p', 'tt-note wide'); f.pMsg.setAttribute('role', 'status');
    f.pSave = btn('Add player', savePlayer, 'primary');
    const pBtns = mk('div', 'tt-btns'); pBtns.append(f.pSave);
    pForm.replaceChildren(field('Name shown on the site', f.pName), f.pList, field('Steam name', f.pSteam), field('AoE2 profile ID', f.pId), pBtns, f.pMsg);
    pForm.addEventListener('submit', (e) => e.preventDefault());
    f.pName.addEventListener('input', () => {
      const p = (rows('players') || []).find((x) => x.player === f.pName.value.trim());
      f.pSave.textContent = p ? 'Update player' : 'Add player';
      if (p) { f.pSteam.value = p.steam_name || ''; f.pId.value = p.profile_id || ''; }
    });
  }

  const played = (tid) => (rows('matches_base') || []).some((m) => m.tournament_id === tid && m.status === 'Final');

  // put the chosen tournament (or a blank new one) into the form
  function fill() {
    const tid = f.pick.value;
    const t = (rows('tournaments') || []).find((x) => x.tournament_id === tid);
    const isNew = !t;
    f.name.value = t ? t.name || '' : '';
    f.status.value = t && TT_admin.STATUSES.includes(t.status) ? t.status : 'Upcoming';
    f.start.value = t ? t.start_date || '' : '';
    f.end.value = t ? t.end_date || '' : '';
    f.format.value = t ? t.format || '' : FORMAT;
    f.best.value = String(t ? Number(t.best_of) || 3 : 3);
    f.advance.value = t ? Number(t.advance) || 0 : 4;
    f.map.value = t ? t.game3_map || '' : 'Arabia';
    const inT = new Set((rows('roster') || []).filter((r) => r.tournament_id === tid).map((r) => r.player));
    drawPlayers(inT);
    const locked = !isNew && played(tid);
    f.schedule.checked = isNew;
    f.schedule.disabled = locked;
    f.scheduleText.textContent = isNew ? 'Make the pool play schedule (everyone plays everyone once)'
      : locked ? 'Games have been played, so the schedule stays as it is' : 'Remake the pool play schedule from these players (replaces the current one)';
    shownFor = tid;
  }

  function drawPlayers(checked) {
    const pl = rows('players') || [];
    f.players.replaceChildren(...pl.map((p) => {
      const c = input('checkbox', { value: p.player, checked: checked.has(p.player) });
      const l = mk('label', 'tt-check'); l.append(c, mk('span', '', p.player));
      return l;
    }));
    if (!pl.length) f.players.append(mk('span', 'tt-empty', 'No players yet. Add them below.'));
  }

  async function saveTournament() {
    const isNew = f.pick.value === NEW;
    const ts = rows('tournaments') || [];
    const players = [...f.players.querySelectorAll('input:checked')].map((c) => c.value);
    const msg = (t) => { f.tMsg.textContent = t; };
    if (!f.name.value.trim()) { msg('Give the tournament a name.'); f.name.focus(); return; }
    if (f.end.value && f.start.value && f.end.value < f.start.value) { msg('The end date is before the start date.'); return; }
    if (f.schedule.checked && players.length < 2) { msg('Tick at least two players to make a schedule.'); return; }
    if (!isNew && f.schedule.checked && !confirm('Replace this tournament’s pool play schedule with a new one?')) return;
    const n = Math.max(0, ...ts.map((t) => Number(String(t.tournament_id).replace(/^t/, '')) || 0)) + 1;
    const tid = isNew ? `t${n}` : f.pick.value;
    const payload = {
      tournament_id: tid, name: f.name.value.trim(), status: f.status.value, start_date: f.start.value, end_date: f.end.value,
      format: f.format.value.trim(), best_of: Number(f.best.value), advance: Number(f.advance.value) || 0, game3_map: f.map.value.trim(),
      players, schedule: f.schedule.checked && !f.schedule.disabled,
    };
    msg('Saving…');
    try {
      await window.TT_ORG.save('tournament', payload);
      dirty = false;
      shownFor = null;
      want = tid;
      msg(`Saved. Everyone sees ${payload.name} now; it’s written to GitHub with the next update.`);
    } catch (e) { msg(errText(e)); }
  }

  async function savePlayer() {
    const msg = (t) => { f.pMsg.textContent = t; };
    const name = f.pName.value.trim(), id = f.pId.value.trim();
    if (!name) { msg('Type the player’s name.'); f.pName.focus(); return; }
    if (!/^\d+$/.test(id)) { msg('The profile ID is the number in the player’s AoE2 Companion or AoE2 Insights address.'); f.pId.focus(); return; }
    msg('Saving…');
    try {
      await window.TT_ORG.save('player', { player: name, steam_name: f.pSteam.value.trim(), profile_id: id });
      f.pName.value = ''; f.pSteam.value = ''; f.pId.value = ''; f.pSave.textContent = 'Add player';
      msg(`Saved ${name}. Their games are fetched with the next update.`);
    } catch (e) { msg(errText(e)); }
  }

  function describe(c) {
    const p = c.payload || {};
    if (c.kind === 'player') return `Player: ${p.player || '?'}`;
    const same = (t) => t.tournament_id === p.tournament_id;
    const known = (rows('tournaments_file') || []).some(same)
      || (rows('admin_changes') || []).some((x) => x.kind === 'tournament' && x.id < c.id && same(x.payload || {}));
    return `${known ? 'Changed' : 'New'} tournament: ${p.name || p.tournament_id}${p.schedule ? ' (new schedule)' : ''}`;
  }

  function drawPending() {
    const box = el('manage-pending');
    const list = rows('admin_changes') || [];
    if (!list.length) { box.replaceChildren(); return; }
    const ul = mk('ul', 'tt-rules');
    list.forEach((c) => {
      const li = mk('li', '', `${describe(c)} · ${new Date(c.created_at).toLocaleString()} `);
      li.append(btn('Undo', async () => {
        if (!confirm(`Undo “${describe(c)}”?`)) return;
        try { await window.TT_ORG.cancel(c.id); } catch (e) { alert(`Couldn’t undo: ${e.message || e}`); }
      }));
      ul.append(li);
    });
    box.replaceChildren(mk('p', 'tt-note', 'Waiting to be written to GitHub (the next update, within 30 minutes). Everyone already sees these.'), ul);
  }

  function sync() {
    const card = el('manage-card');
    const st = window.TT_BACKEND || {};
    if (!card) return;
    card.hidden = !st.admin;
    if (!st.admin) return;
    const ts = rows('tournaments'), pl = rows('players');
    if (!ts || !pl) return;
    if (!built) build();
    const cur = want || f.pick.value;
    const opts = ts.slice().sort((a, b) => (a.start_date < b.start_date ? 1 : -1)).map((t) => [t.tournament_id, `${t.name} (${t.status})`]);
    f.pick.replaceChildren(...[[NEW, 'New tournament'], ...opts].map(([v, t]) => { const o = mk('option', '', t); o.value = v; return o; }));
    f.pick.value = [NEW, ...opts.map((o) => o[0])].includes(cur) ? cur : NEW;
    if (f.pick.value === want) want = null;
    if (!dirty || shownFor !== f.pick.value) fill();
    else drawPlayers(new Set([...f.players.querySelectorAll('input:checked')].map((c) => c.value)));
    f.pList.replaceChildren(...pl.map((p) => { const o = mk('option'); o.value = p.player; return o; }));
    drawPending();
  }

  dash.onData(sync);
})();
