// Coaching: what a player did in a game, what went well and what to do better, and their strengths and weaknesses
// across games. Pure functions of replay_analysis rows (pipeline/analyze.py + run.py) and, when it is loaded, the
// game's map playback (viewer.js TT_unpack), which fills in what older analysis rows don't have. No DOM here.
//   TT_COACH.facts(row, pb)            one player's game: timings, army by age, units made, upgrades, Dark Age villagers
//   TT_COACH.fromPlayback(pb, number)  the same from the playback alone (players without an analysis row)
//   TT_COACH.game(me, opps, n)         { strategy: [sentences], well: [{code, text}], better: [{code, text}] }
//   TT_COACH.player(rows, others, games)  { n, strengths: [{title, detail}], weaknesses: [...] }
// Unit counts are units queued (a cancelled one still counts), and all times are game time.
(() => {
  // unit -> class, as pipeline/analyze.py UNIT_CLASS (anything else is a unique unit)
  const CLASS = {};
  const cls = (name, units) => units.forEach((u) => { CLASS[u] = name; });
  cls('Villager', ['Villager']);
  cls('Scouts', ['Scout Cavalry', 'Light Cavalry', 'Hussar', 'Winged Hussar', 'Steppe Lancer', 'Elite Steppe Lancer', 'Shrivamsha Rider', 'Elite Shrivamsha Rider']);
  cls('Knights', ['Knight', 'Cavalier', 'Paladin', 'Savar', 'Hei Guang Cavalry', 'Heavy Hei Guang Cavalry']);
  cls('Camels', ['Camel Rider', 'Heavy Camel Rider', 'Imperial Camel Rider', 'Camel Scout']);
  cls('Battle elephants', ['Battle Elephant', 'Elite Battle Elephant']);
  cls('Cav archers', ['Cavalry Archer', 'Heavy Cavalry Archer', 'Elephant Archer', 'Elite Elephant Archer', 'Camel Archer', 'Elite Camel Archer']);
  cls('Archers', ['Archer', 'Crossbowman', 'Arbalester']);
  cls('Skirmishers', ['Skirmisher', 'Elite Skirmisher', 'Imperial Skirmisher']);
  cls('Gunpowder', ['Hand Cannoneer', 'Bombard Cannon', 'Organ Gun', 'Elite Organ Gun', 'Janissary', 'Elite Janissary', 'Conquistador', 'Elite Conquistador']);
  cls('Militia line', ['Militia', 'Man-at-Arms', 'Long Swordsman', 'Two-Handed Swordsman', 'Champion', 'Legionary']);
  cls('Spears', ['Spearman', 'Pikeman', 'Halberdier']);
  cls('Eagles', ['Eagle Scout', 'Eagle Warrior', 'Elite Eagle Warrior']);
  cls('Monks', ['Monk', 'Missionary']);
  cls('Siege', ['Mangonel', 'Onager', 'Siege Onager', 'Battering Ram', 'Capped Ram', 'Siege Ram', 'Scorpion', 'Heavy Scorpion', 'Trebuchet', 'Trebuchet (Packed)',
    'Siege Tower', 'Armored Elephant', 'Siege Elephant', 'Rocket Cart', 'Heavy Rocket Cart', 'Mounted Trebuchet', 'Traction Trebuchet']);
  cls('Navy', ['Fishing Ship', 'Transport Ship', 'Trade Cog', 'Galley', 'War Galley', 'Galleon', 'Fire Galley', 'Fire Ship', 'Fast Fire Ship', 'Demolition Raft',
    'Demolition Ship', 'Heavy Demolition Ship', 'Cannon Galleon', 'Elite Cannon Galleon', 'Longboat', 'Elite Longboat', 'Turtle Ship', 'Elite Turtle Ship',
    'Caravel', 'Elite Caravel', 'Thirisadai', 'Dromon', 'Lou Chuan', 'Catapult Galleon']);
  cls('Trade', ['Trade Cart']);
  const classOf = (u) => CLASS[u] || 'Unique units';
  const NON_FIGHT = new Set(['Villager', 'Trade', 'Monks']);
  const NOT_PRODUCTION = new Set(['House', 'Farm', 'Palisade Wall', 'Palisade Gate', 'Stone Wall', 'Gate', 'Fortified Wall', 'Outpost', 'Fish Trap',
    'Watch Tower', 'Guard Tower', 'Keep', 'Bombard Tower', 'Fortified Tower', 'Donjon', 'Harbor']);

  // what beats each kind of army, and what to say about it
  const COUNTERS = {
    Archers: [['Skirmishers', 'Knights', 'Scouts', 'Siege', 'Eagles'], 'Skirmishers, Knights, Mangonels or Eagles beat archers.'],
    Skirmishers: [['Knights', 'Scouts', 'Militia line', 'Eagles', 'Siege'], 'Cavalry, Men-at-Arms or Eagles beat skirmishers.'],
    Knights: [['Spears', 'Camels', 'Monks'], 'Pikemen, Camels or Monks beat Knights.'],
    Scouts: [['Spears', 'Camels', 'Knights'], 'Spearmen or Camels beat light cavalry.'],
    Camels: [['Militia line', 'Archers', 'Spears'], 'Swordsmen and archers beat Camels.'],
    'Battle elephants': [['Spears', 'Monks', 'Camels', 'Militia line'], 'Pikemen and Monks beat elephants.'],
    'Cav archers': [['Skirmishers', 'Knights', 'Camels', 'Siege'], 'Skirmishers, Knights or Camels beat cavalry archers.'],
    'Militia line': [['Archers', 'Cav archers', 'Gunpowder', 'Siege'], 'Archers, Hand Cannoneers or Onagers beat swordsmen.'],
    Spears: [['Archers', 'Militia line', 'Cav archers', 'Gunpowder'], 'Archers and swordsmen beat spearmen.'],
    Eagles: [['Militia line', 'Knights', 'Scouts'], 'Swordsmen and cavalry beat Eagles.'],
    Gunpowder: [['Skirmishers', 'Siege', 'Knights', 'Militia line'], 'Skirmishers, Mangonels and cavalry beat Hand Cannoneers.'],
    Siege: [['Knights', 'Scouts', 'Militia line', 'Eagles', 'Camels'], 'Fast melee units (cavalry, Eagles, swordsmen) kill siege.'],
    Monks: [['Scouts', 'Eagles', 'Cav archers'], 'Light cavalry and Eagles hunt Monks.'],
  };
  const KIND = { Archers: 'archers', Skirmishers: 'skirmishers', Knights: 'Knights', Scouts: 'light cavalry', Camels: 'Camels', 'Battle elephants': 'elephants',
    'Cav archers': 'cavalry archers', 'Militia line': 'swordsmen', Spears: 'spearmen', Eagles: 'Eagles', Gunpowder: 'gunpowder units', Siege: 'siege', Monks: 'Monks',
    'Unique units': 'unique units', Navy: 'ships' };
  const kind = (c) => KIND[c] || c.toLowerCase();
  const AGGRESSIVE = new Set(['Drush', 'Men-at-Arms', 'Scouts', 'Tower rush', 'Men-at-Arms into archers', 'Eagles']);
  // upgrades some civs get free (so missing it isn't a mistake): pipeline names
  const FREE = {
    Franks: ['Horse Collar', 'Heavy Plow', 'Crop Rotation'], Vikings: ['Wheelbarrow', 'Hand Cart'], Burmese: ['Double-Bit Axe', 'Bow Saw', 'Two-Man Saw'],
    Turks: ['Light Cavalry', 'Hussar'], Bulgarians: ['Man-at-Arms', 'Long Swordsman', 'Two-Handed Swordsman'], Ethiopians: ['Pikeman', 'Halberdier'],
    Magyars: ['Forging', 'Iron Casting', 'Blast Furnace'],
  };
  // the next unit upgrade for an army of this class, in Castle Age and in Imperial Age
  const LINE_UP = {
    castle: { Archers: 'Crossbowman', Scouts: 'Light Cavalry', 'Militia line': 'Long Swordsman', Spears: 'Pikeman', Skirmishers: 'Elite Skirmisher' },
    imperial: { Archers: 'Arbalester', Knights: 'Cavalier', 'Militia line': 'Two-Handed Swordsman', Spears: 'Halberdier', Scouts: 'Hussar', Camels: 'Heavy Camel Rider', 'Cav archers': 'Heavy Cavalry Archer' },
  };

  // ---------------------------------------------------------------- small helpers
  const N = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const mmss = (m) => { if (m == null) return '?'; const s = Math.round(m * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const dur = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : `${Math.round(sec)} second${Math.round(sec) === 1 ? '' : 's'}`);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const listText = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  // "Knight 12; Archer 30" or "Archers 12, Scouts 3" -> [[name, count]]
  function pairs(s, sep) {
    return String(s || '').split(sep).map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.lastIndexOf(' ');
      return i < 0 ? null : [x.slice(0, i), Number(x.slice(i + 1))];
    }).filter((p) => p && Number.isFinite(p[1]));
  }
  const toObj = (ps) => { const o = {}; ps.forEach(([k, v]) => { o[k] = (o[k] || 0) + v; }); return o; };
  const sum = (o) => Object.values(o || {}).reduce((s, v) => s + v, 0);
  const sorted = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
  const fight = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !NON_FIGHT.has(k)));
  const median = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  function addArmy(into, o) { Object.entries(o || {}).forEach(([k, v]) => { into[k] = (into[k] || 0) + v; }); return into; }

  // ---------------------------------------------------------------- facts about one player's game
  function fromPlayback(pb, number) {
    if (!pb || !pb.players) return null;
    const p = pb.players.find((x) => x.number === number);
    if (!p) return null;
    const ev = (pb.events || []).filter((e) => e.p === number);
    const ageAt = (name) => { const e = ev.find((x) => x.k === 'a' && x.n === `Reached ${name} Age`); return e ? e.t / 60 : null; };
    const f = { number, name: p.name, civ: p.civ, won: N(p.won), team: p.team, dur: pb.duration_s ? pb.duration_s / 60 : null,
      feudal: ageAt('Feudal'), castle: ageAt('Castle'), imperial: ageAt('Imperial') };
    fillFromPlayback(f, pb);
    return f;
  }
  // what the playback adds: units made, army by age, upgrades, buildings, Dark Age villagers (as pipeline/analyze.py)
  function fillFromPlayback(f, pb) {
    const ev = (pb.events || []).filter((e) => e.p === f.number);
    const q = ev.filter((e) => e.k === 'u');
    const uc = (pb.units || []).filter((u) => u.number === f.number);
    if (!f.units && uc.length) f.units = uc.map((u) => ({ unit: u.unit, cls: u.class || classOf(u.unit), count: u.count })).sort((a, b) => b.count - a.count);
    if (!f.army && q.length) {
      const win = (a, b) => { const o = {}; q.forEach((e) => { const m = e.t / 60; if ((a == null || m >= a) && (b == null || m < b)) { const c = classOf(e.n); o[c] = (o[c] || 0) + (e.c || 1); } }); return fight(o); };
      f.army = { feudal: f.feudal != null ? win(f.feudal, f.castle) : {}, castle: f.castle != null ? win(f.castle, f.imperial) : {}, imperial: f.imperial != null ? win(f.imperial, null) : {} };
    }
    if (!f.key) {
      const r = ev.filter((e) => e.k === 'r');
      if (r.length) { f.key = new Map(); r.forEach((e) => { if (!f.key.has(e.n)) f.key.set(e.n, e.t / 60); }); }
    }
    const b = ev.filter((e) => e.k === 'b');
    if (f.farms == null && b.length) f.farms = b.filter((e) => e.n === 'Farm').length;
    if (!f.production && b.length) { f.production = {}; b.filter((e) => !NOT_PRODUCTION.has(e.n)).forEach((e) => { f.production[e.n] = (f.production[e.n] || 0) + 1; }); }
    if (f.tcs == null && b.length) f.tcs = 1 + b.filter((e) => e.n === 'Town Center').length;
    if (f.villagers == null && f.units) f.villagers = f.units.filter((u) => u.unit === 'Villager').reduce((s, u) => s + u.count, 0) || null;
    if (f.military == null && f.units) f.military = f.units.filter((u) => !NON_FIGHT.has(u.cls)).reduce((s, u) => s + u.count, 0);
    if (f.dark_vills == null && f.feudal != null && q.length) {
      // the Town Center's queue up to the start of Feudal Age research (130 s before reaching it)
      const end = f.feudal * 60 - 130;
      const jobs = q.filter((e) => e.n === 'Villager' && e.t < end).map((e) => [e.t, e.c || 1, true]);
      const loom = ev.find((e) => e.k === 'r' && e.n === 'Loom' && e.t < end);
      if (loom) jobs.push([loom.t, 1, false]);
      jobs.sort((x, y) => x[0] - y[0]);
      let free = 0, idle = 0, made = 0;
      jobs.forEach(([t0, n, isVill]) => {
        if (t0 > free) { idle += t0 - free; free = t0; }
        for (let i = 0; i < n && free < end; i += 1) { free += 25; if (isVill) made += 1; }
      });
      idle += Math.max(0, end - free);
      f.dark_vills = made; f.dark_idle = Math.round(idle);
    }
    if (f.vills_castle == null && f.castle != null && q.length) f.vills_castle = q.filter((e) => e.n === 'Villager' && e.t / 60 < f.castle).reduce((s, e) => s + (e.c || 1), 0);
    return f;
  }
  function facts(row, pb) {
    if (!row) return null;
    const unitPairs = pairs(row.units, ';');
    const keyPairs = pairs(row.key_techs, ';');
    const f = {
      number: N(row.number), name: row.player || row.name, civ: row.civ, won: N(row.won), dur: N(row.duration_min), eapm: N(row.eapm),
      feudal: N(row.feudal_min), castle: N(row.castle_min), imperial: N(row.imperial_min),
      opening: row.opening || '', castle_plan: row.castle_plan || '', late_army: row.late_army || '', attack_style: row.attack_style || '', defense_style: row.defense_style || '',
      first_attack: N(row.first_attack_min), aggression: N(row.aggression), raid_minutes: N(row.raid_minutes),
      villagers: N(row.villagers), military: N(row.military_units), palisade: N(row.palisade_tiles) || 0, stone: N(row.stone_wall_tiles) || 0,
      towers: N(row.towers) || 0, castles: N(row.castles) || 0, tcs: N(row.town_centers), techs_n: N(row.techs),
      units: unitPairs.length ? unitPairs.map(([u, c]) => ({ unit: u, cls: classOf(u), count: c })) : null,
      army: row.feudal_army != null && row.units ? { feudal: toObj(pairs(row.feudal_army, ',')), castle: toObj(pairs(row.castle_army, ',')), imperial: toObj(pairs(row.imp_army, ',')) } : null,
      key: keyPairs.length ? new Map(keyPairs) : null,
      dark_vills: N(row.dark_vills), dark_idle: N(row.dark_idle_s), vills_castle: N(row.vills_castle), farms: N(row.farms),
      production: row.production ? toObj(pairs(row.production, ',')) : null,
      opp: {
        openings: String(row.opp_openings || '').split(', ').filter(Boolean), civs: String(row.opp_civs || '').split(', ').filter(Boolean),
        army: row.opp_army ? toObj(pairs(row.opp_army, ',')) : null, military: N(row.opp_military), villagers: N(row.opp_villagers), eapm: N(row.opp_eapm),
        feudal: N(row.opp_feudal_min), castle: N(row.opp_castle_min), imperial: N(row.opp_imperial_min),
      },
    };
    if (pb && f.number != null && pb.players && pb.players.some((p) => p.number === f.number)) {
      f.team = pb.players.find((p) => p.number === f.number).team;
      fillFromPlayback(f, pb);
    }
    return f;
  }
  // the other side of a game, put together from their own facts (playback or analysis rows), else from the opp_ fields
  function opponents(me, opps) {
    const o = { ...(me.opp || {}) };
    if (opps && opps.length) {
      const avg = (k) => { const v = opps.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      ['feudal', 'castle', 'imperial', 'eapm'].forEach((k) => { if (avg(k) != null) o[k] = avg(k); });
      const mil = opps.map((x) => x.military).filter((x) => x != null);
      if (mil.length) o.military = mil.reduce((s, x) => s + x, 0) / mil.length;
      const vil = opps.map((x) => x.villagers).filter((x) => x != null);
      if (vil.length) o.villagers = vil.reduce((s, x) => s + x, 0) / vil.length;
      const army = {};
      opps.forEach((x) => { if (x.units) x.units.forEach((u) => { if (u.cls !== 'Villager' && u.cls !== 'Trade') army[u.cls] = (army[u.cls] || 0) + u.count; }); });
      if (Object.keys(army).length) o.army = army;
      const op = opps.map((x) => x.opening).filter(Boolean);
      if (op.length) o.openings = op;
      o.civs = opps.map((x) => x.civ).filter(Boolean);
    }
    return o;
  }

  // ---------------------------------------------------------------- one game
  function myArmy(f) {
    if (f.army) return addArmy(addArmy(addArmy({}, f.army.feudal), f.army.castle), f.army.imperial);
    if (f.units) { const o = {}; f.units.forEach((u) => { if (!NON_FIGHT.has(u.cls)) o[u.cls] = (o[u.cls] || 0) + u.count; }); return o; }
    return null;
  }
  // a class's name with the actual unique unit, when it is one
  function armyText(o, f, n = 3) {
    return sorted(o).slice(0, n).map(([k, v]) => {
      if (k === 'Unique units' && f.units) { const uu = f.units.filter((u) => u.cls === 'Unique units').map((u) => u.unit); if (uu.length) return `${listText(uu.slice(0, 2))} ${v}`; }
      return `${k} ${v}`;
    }).join(', ');
  }
  function strategy(f) {
    const out = [];
    const op = f.opening;
    if (op && op !== 'Unclear') {
      const what = { 'Fast Castle': 'went for a Fast Castle', Drush: 'opened with a Drush (Dark Age militia)', 'Tower rush': 'opened with a tower rush',
        'Light feudal': 'played a light Feudal Age (few soldiers)', 'Skirms & spears': 'opened with skirmishers and spearmen' }[op] || `opened with ${op}`;
      out.push(`${what[0].toUpperCase()}${what.slice(1)}${f.feudal != null ? `, reaching Feudal Age at ${mmss(f.feudal)}` : ''}.`);
    } else if (f.feudal != null) out.push(`Reached Feudal Age at ${mmss(f.feudal)}.`);
    if (f.army && sum(f.army.feudal) && op !== 'Fast Castle') out.push(`Feudal Age army: ${armyText(f.army.feudal, f)}.`);
    if (f.castle != null) {
      const plan = f.castle_plan;
      const p = /^Boom/.test(plan) ? `, then boomed to ${f.tcs || plan.replace(/\D/g, '')} Town Centers` : plan && plan !== 'Unclear' ? `, then mainly ${kind(plan)}` : '';
      out.push(`Castle Age at ${mmss(f.castle)}${p}.${f.army && sum(f.army.castle) ? ` Castle Age army: ${armyText(f.army.castle, f)}.` : ''}`);
    }
    if (f.imperial != null) out.push(`Imperial Age at ${mmss(f.imperial)}${f.army && sum(f.army.imperial) ? `, then ${armyText(f.army.imperial, f)}` : f.late_army ? `, finishing with mostly ${f.late_army.toLowerCase()}` : ''}.`);
    if (f.attack_style) out.push(`Attacking: ${f.attack_style.toLowerCase()}${f.first_attack != null ? ` (first attack at ${mmss(f.first_attack)})` : ''}. Defending: ${(f.defense_style || 'minimal defense').toLowerCase()}.`);
    const eco = [];
    if (f.tcs) eco.push(`${f.tcs} Town Center${f.tcs > 1 ? 's' : ''}`);
    if (f.villagers) eco.push(`about ${f.villagers} villagers`);
    if (f.farms) eco.push(`${f.farms} farms`);
    if (eco.length) out.push(`Economy: ${listText(eco)}.`);
    return out;
  }

  function game(me, opps, nPlayers) {
    const well = [], better = [];
    if (!me) return { strategy: [], well, better };
    const o = opponents(me, opps);
    const say = (list, code, text) => { if (!list.some((x) => x.code === code)) list.push({ code, text }); };
    const free = new Set(FREE[me.civ] || []);
    const has = (t) => free.has(t) || (me.key && me.key.has(t));
    const hadBy = (t, m) => free.has(t) || (me.key && me.key.has(t) && me.key.get(t) <= m);
    const lasted = (m) => me.dur != null && me.dur >= m;
    const fc = me.opening === 'Fast Castle', drush = me.opening === 'Drush';
    const oneVone = !nPlayers || nPlayers <= 2;

    // ----- Dark Age
    if (me.feudal != null) {
      const aim = fc ? '11:30 for a Fast Castle' : drush ? '11:30 with a Drush' : '10:00';
      if (me.feudal <= 10 && !drush && !fc) say(well, 'fast_feudal', `Quick Feudal Age at ${mmss(me.feudal)}.`);
      else if (me.feudal > (fc ? 12.75 : drush ? 12.5 : 11.5)) say(better, 'slow_feudal', `Feudal Age at ${mmss(me.feudal)} is slow. Aim for about ${aim}: keep the Town Center making villagers non-stop and research Loom just before clicking up.`);
    } else if (lasted(16)) say(better, 'no_feudal', 'Never reached Feudal Age in a game that lasted over 15 minutes.');
    if (me.dark_idle != null && me.feudal != null) {
      if (me.dark_idle >= 60) say(better, 'tc_idle', `The Town Center stood idle for about ${dur(me.dark_idle)} in the Dark Age (${me.dark_vills} villagers made before Feudal Age). Keep one or two villagers queued at all times.`);
      else if (me.dark_idle <= 15 && me.feudal <= 11) say(well, 'tc_busy', `Kept the Town Center busy in the Dark Age: ${me.dark_vills} villagers before clicking up to Feudal Age.`);
    }

    // ----- Castle and Imperial Age
    if (me.castle != null) {
      if (fc) {
        if (me.castle <= 16.5) say(well, 'fast_castle', `Fast Castle Age at ${mmss(me.castle)}.`);
        else if (me.castle > 19) say(better, 'slow_castle', `Castle Age at ${mmss(me.castle)} is slow for a Fast Castle. About 16:30 is the aim: more villagers on food and gold, fewer on wood, and no units in Feudal Age.`);
      } else if (me.castle <= 19) say(well, 'fast_castle', `Castle Age at ${mmss(me.castle)}, right on time.`);
      else if (me.castle > 23) say(better, 'slow_castle', `Castle Age at ${mmss(me.castle)} is late. Around 20:00 is the aim: keep making villagers through Feudal Age and add farms early.`);
    } else if (lasted(26) && me.feudal != null) say(better, 'no_castle', 'Never reached Castle Age in a game of more than 25 minutes, so the strongest units and upgrades were never available.');
    if (me.imperial != null && me.imperial <= 33) say(well, 'fast_imp', `Imperial Age at ${mmss(me.imperial)}.`);
    else if (me.castle != null && lasted(45) && (me.imperial == null || me.imperial > 42)) say(better, 'slow_imp', `${me.imperial == null ? 'Never reached Imperial Age' : `Imperial Age only at ${mmss(me.imperial)}`} in a ${Math.round(me.dur)}-minute game. Late-game upgrades (and Trebuchets) need it.`);
    // against the opponent
    if (me.castle != null && o.castle != null) {
      const d = me.castle - o.castle;
      if (d >= 2 && !better.some((x) => x.code === 'slow_castle')) say(better, 'behind_castle', `Reached Castle Age ${mmss(d)} after ${oneVone ? 'the opponent' : 'the other team (on average)'}, so they had the stronger units first.`);
      else if (d <= -2 && !well.some((x) => x.code === 'fast_castle')) say(well, 'ahead_castle', `Reached Castle Age ${mmss(-d)} before ${oneVone ? 'the opponent' : 'the other team (on average)'}.`);
    }

    // ----- economy
    if (me.villagers != null && lasted(22)) {
      const target = Math.min(me.dur, 40) * 2.6;
      if (me.villagers < 0.7 * target) say(better, 'few_vills', `Only about ${me.villagers} villagers in a ${Math.round(me.dur)}-minute game. Keep making them until 100–120, and more if you lose some to raids.`);
      else if (me.villagers >= target) say(well, 'eco', `Kept making villagers: about ${me.villagers} in all.`);
      if (o.villagers != null && me.villagers < 0.8 * o.villagers && !better.some((x) => x.code === 'few_vills')) say(better, 'fewer_vills', `Made about ${me.villagers} villagers against ${Math.round(o.villagers)} for ${oneVone ? 'the opponent' : 'each opponent'}, so their economy was bigger.`);
    }
    if (me.tcs != null) {
      if (me.tcs >= 3) say(well, 'boom', `Built up to ${me.tcs} Town Centers for a strong economy.`);
      else if (me.tcs === 1 && me.castle != null && lasted(Math.max(30, me.castle + 10)) && !fc) say(better, 'one_tc', 'Played the whole game on one Town Center. One or two more in Castle Age, once it’s safe, grow the economy much faster.');
    }
    if (me.key) {
      const missing = [];
      let checked = 0;
      const want = (t, by) => { if (by != null && lasted(by)) { checked += 1; if (!hadBy(t, me.dur)) missing.push(t); } };
      if (me.feudal != null) { want('Double-Bit Axe', me.feudal + 6); want('Horse Collar', me.feudal + 8); want('Wheelbarrow', me.castle != null ? me.castle + 6 : me.feudal + 14); }
      if (me.castle != null) { want('Bow Saw', me.castle + 10); want('Heavy Plow', me.castle + 10); want('Hand Cart', me.castle + 14); }
      if (missing.length) say(better, 'eco_upgrades', `Never got ${listText(missing)}${missing.length > 1 ? ', economy upgrades that pay for themselves' : ', an economy upgrade that pays for itself'} within a few minutes.`);
      else if (checked >= 4) say(well, 'eco_upgrades_ok', 'Got every key economy upgrade (axes, farming and Wheelbarrow / Hand Cart).');
      if (lasted(14) && !has('Loom') && !free.has('Loom')) say(better, 'no_loom', 'Never researched Loom, so villagers die fast to raids, boars and wolves.');
    }

    // ----- army
    const mine = myArmy(me);
    const milN = mine ? sum(mine) : 0;
    if (me.key && mine && milN >= 20) {
      const share = (cs) => cs.reduce((s, c) => s + (mine[c] || 0), 0) / milN;
      const miss = [];
      const castleOn = me.castle != null && lasted(me.castle + 6);
      if (share(['Archers', 'Skirmishers', 'Cav archers']) >= 0.4) { if (!has('Fletching')) miss.push('Fletching'); if (castleOn && !has('Bodkin Arrow')) miss.push('Bodkin Arrow'); if (castleOn && !has('Leather Archer Armor') && !has('Padded Archer Armor')) miss.push('archer armor'); }
      if (share(['Scouts', 'Knights', 'Camels', 'Battle elephants', 'Militia line', 'Spears', 'Eagles']) >= 0.4) { if (!has('Forging')) miss.push('Forging'); }
      if (share(['Scouts', 'Knights', 'Camels', 'Battle elephants', 'Cav archers']) >= 0.4 && castleOn && !has('Scale Barding Armor')) miss.push('Scale Barding Armor');
      if (share(['Militia line', 'Spears', 'Eagles']) >= 0.4 && castleOn && !has('Scale Mail Armor')) miss.push('Scale Mail Armor');
      if (miss.length) say(better, 'blacksmith', `Missing Blacksmith upgrades for the army they made: ${listText(miss)}. Each one is worth several extra units.`);
      else if (['Fletching', 'Bodkin Arrow', 'Forging', 'Iron Casting', 'Scale Barding Armor', 'Chain Barding Armor', 'Scale Mail Armor', 'Padded Archer Armor', 'Leather Archer Armor'].filter(has).length >= 4) say(well, 'blacksmith_ok', 'Kept the army upgraded at the Blacksmith.');
      // unit lines
      const lineMiss = [];
      [['castle', me.castle, me.army ? me.army.castle : mine], ['imperial', me.imperial, me.army ? me.army.imperial : null]].forEach(([age, at, army]) => {
        if (at == null || !army || !lasted(at + 5)) return;
        Object.entries(LINE_UP[age]).forEach(([c, up]) => { if ((army[c] || 0) >= 10 && !has(up)) lineMiss.push(`${up} (for ${army[c]} ${kind(c)})`); });
      });
      if (lineMiss.length) say(better, 'unit_upgrades', `Didn’t upgrade the main units: ${listText(lineMiss.slice(0, 3))}, if your civ has it.`);
    }
    // counters
    if (mine && milN >= 8 && o.army) {
      const theirs = fight(o.army), tN = sum(theirs);
      const top = sorted(theirs).find(([c]) => COUNTERS[c]);
      if (top && top[1] >= 12 && top[1] / tN >= 0.35) {
        const [c, n] = top, [answers, advice] = COUNTERS[c];
        const share = answers.reduce((s, x) => s + (mine[x] || 0), 0) / milN;
        const used = answers.filter((x) => (mine[x] || 0) >= 3).map(kind);
        if (share < 0.15) say(better, 'no_counter', `${oneVone ? 'The opponent' : 'The other team'} massed ${kind(c)} (about ${n}), but only ${pct(share)} of the army made answers them. ${advice}`);
        else if (share >= 0.35 && used.length) say(well, 'countered', `Answered their ${kind(c)} with ${listText(used)}.`);
      }
      // were their own units countered?
      const mTop = sorted(mine).find(([c]) => COUNTERS[c]);
      if (mTop && mTop[1] >= 12 && Number(me.won) !== 1) {
        const [answers] = COUNTERS[mTop[0]];
        const theirShare = answers.reduce((s, x) => s + (theirs[x] || 0), 0) / Math.max(1, tN);
        const what = answers.filter((x) => (theirs[x] || 0) >= 5).map(kind);
        if (theirShare >= 0.4 && what.length) say(better, 'got_countered', `Their ${listText(what)} countered the ${kind(mTop[0])}; switching to a unit that beats ${what[0]} sooner would have helped.`);
      }
    }
    if (me.military != null && o.military != null && o.military >= 20) {
      if (Number(me.won) !== 1 && me.military < 0.6 * o.military) say(better, 'small_army', `Made far fewer soldiers: about ${me.military} against ${Math.round(o.military)}${oneVone ? '' : ' for each opponent'}. Production buildings working non-stop matter as much as the economy behind them.`);
      else if (me.military >= 1.3 * o.military) say(well, 'big_army', `Out-produced ${oneVone ? 'the opponent' : 'the other team'}: about ${me.military} soldiers against ${Math.round(o.military)}.`);
    }

    // ----- attacking and defending
    if (me.first_attack != null && me.first_attack <= 12 && (Number(me.won) === 1 || (me.aggression || 0) >= 0.35)) say(well, 'early_pressure', `Put pressure on early (first attack at ${mmss(me.first_attack)}).`);
    if (/constant raids/.test(me.attack_style)) say(well, 'raids', 'Kept raiding all game, so the opponent was always reacting.');
    if (/^Passive/.test(me.attack_style) && lasted(20)) say(better, 'passive', 'Never really attacked. Even a few raiding units make the opponent stop and react, which slows their economy.');
    const aggro = (o.openings || []).find((x) => AGGRESSIVE.has(x));
    if (aggro && (me.palisade + me.stone) < 10 && Number(me.won) !== 1) say(better, 'no_walls', `No walls against an early ${aggro.toLowerCase()} opening. A few palisades and houses around the wood line and gold buy time against raids.`);
    else if (aggro && (me.palisade + me.stone) >= 20 && Number(me.won) === 1) say(well, 'walled', `Walled up against their ${aggro.toLowerCase()} opening.`);
    if (me.eapm != null && o.eapm != null && o.eapm >= 30) {
      if (me.eapm < 0.75 * o.eapm) say(better, 'slow_hands', `eAPM ${me.eapm} against ${Math.round(o.eapm)}: hotkeys and queuing several villagers or units at once free up time for both army and economy.`);
      else if (me.eapm >= 1.25 * o.eapm) say(well, 'fast_hands', `Faster hands: eAPM ${me.eapm} against ${Math.round(o.eapm)}.`);
    }
    return { strategy: strategy(me), well, better };
  }

  // ---------------------------------------------------------------- a player across games
  // what each recurring tip is about, for the profile (and so it isn't repeated next to the same figure)
  const TIP = {
    slow_feudal: ['feudal', 'Slow to Feudal Age'], no_feudal: ['feudal', 'Not reaching Feudal Age'], tc_idle: ['idle', 'Town Center idle in the Dark Age'],
    slow_castle: ['castle', 'Late to Castle Age'], no_castle: ['castle', 'Not reaching Castle Age'], behind_castle: ['castle', 'Behind the opponent to Castle Age'],
    slow_imp: ['imperial', 'Late to Imperial Age'], few_vills: ['vills', 'Too few villagers'], fewer_vills: ['vills', 'Smaller economy than the opponent'],
    one_tc: ['tcs', 'Staying on one Town Center'], eco_upgrades: ['eco', 'Skipping economy upgrades'], no_loom: ['loom', 'Skipping Loom'],
    blacksmith: ['smith', 'Skipping Blacksmith upgrades'], unit_upgrades: ['lines', 'Not upgrading the main units'], no_counter: ['counter', 'Not countering the opponent’s army'],
    got_countered: ['counter', 'Staying on a unit that’s being countered'], small_army: ['army', 'Smaller army than the opponent'], passive: ['attack', 'Rarely attacking'],
    no_walls: ['walls', 'No walls against early aggression'], slow_hands: ['eapm', 'Slower hands than opponents'],
    fast_feudal: ['feudal', 'Quick to Feudal Age'], tc_busy: ['idle', 'Town Center always busy in the Dark Age'], fast_castle: ['castle', 'On time to Castle Age'],
    ahead_castle: ['castle', 'Ahead of the opponent to Castle Age'], fast_imp: ['imperial', 'Quick to Imperial Age'], eco: ['vills', 'Strong villager production'],
    boom: ['tcs', 'Booms with extra Town Centers'], eco_upgrades_ok: ['eco', 'Gets the economy upgrades'], blacksmith_ok: ['smith', 'Keeps the army upgraded'],
    countered: ['counter', 'Counters the opponent’s army'], big_army: ['army', 'Out-produces opponents'], early_pressure: ['attack', 'Early pressure'],
    raids: ['attack', 'Constant raiding'], walled: ['walls', 'Walls up against early aggression'], fast_hands: ['eapm', 'Faster hands than opponents'],
  };

  function player(rows, others, games) {
    const out = { n: rows.length, strengths: [], weaknesses: [] };
    if (rows.length < 3) return out;
    const fs = rows.map((r) => facts(r)).filter(Boolean);
    const os = others.map((r) => facts(r)).filter(Boolean);
    const seen = new Set();
    const add = (list, area, weight, title, detail) => { if (seen.has(`${list === out.strengths ? 's' : 'w'}:${area}`)) return; seen.add(`${list === out.strengths ? 's' : 'w'}:${area}`); list.push({ area, weight, title, detail }); };
    const others3 = (vals) => vals.filter((v) => v != null).length >= 5;

    // ----- timings and habits, against the other players here
    const cmp = (area, pick, lowGood, goodAbs, badAbs, gapGood, gapBad, fmt, what) => {
      const mine = fs.map(pick).filter((v) => v != null), theirs = os.map(pick).filter((v) => v != null);
      if (mine.length < 3) return;
      const m = median(mine), g = others3(theirs) ? median(theirs) : null;
      const vs = g != null ? ` (the other players here: ${fmt(g)})` : '';
      const good = lowGood ? (m <= goodAbs || (g != null && m <= g - gapGood)) : (m >= goodAbs || (g != null && m >= g + gapGood));
      const bad = lowGood ? (m >= badAbs || (g != null && m >= g + gapBad)) : (m <= badAbs || (g != null && m <= g - gapBad));
      if (good && !bad) add(out.strengths, area, 2, what[0], `${what[2]} ${fmt(m)} over ${mine.length} games${vs}.`);
      else if (bad) add(out.weaknesses, area, 2, what[1], `${what[2]} ${fmt(m)} over ${mine.length} games${vs}.`);
    };
    const notRush = (f) => (f.opening === 'Drush' || f.opening === 'Fast Castle' ? null : f.feudal);
    cmp('feudal', notRush, true, 10, 11.5, 0.5, 0.75, mmss, ['Quick to Feudal Age', 'Slow to Feudal Age', 'Typical Feudal Age time:']);
    cmp('castle', (f) => (f.opening === 'Fast Castle' ? null : f.castle), true, 19, 22.5, 1, 1.5, mmss, ['On time to Castle Age', 'Late to Castle Age', 'Typical Castle Age time (not counting Fast Castles):']);
    cmp('fc', (f) => (f.opening === 'Fast Castle' ? f.castle : null), true, 16.5, 19, 0.75, 1, mmss, ['Fast Castles on time', 'Slow Fast Castles', 'Typical Fast Castle time:']);
    cmp('imperial', (f) => f.imperial, true, 33, 40, 2, 3, mmss, ['Quick to Imperial Age', 'Late to Imperial Age', 'Typical Imperial Age time:']);
    cmp('idle', (f) => f.dark_idle, true, 15, 45, 10, 20, (v) => dur(v), ['Town Center always busy in the Dark Age', 'Town Center idle in the Dark Age', 'Typical Dark Age idle time:']);
    const vpm = (f) => (f.villagers != null && f.dur != null && f.dur >= 20 ? f.villagers / Math.min(f.dur, 40) : null);
    cmp('vills', vpm, false, 2.8, 1.9, 0.35, 0.35, (v) => `${v.toFixed(1)} a minute`, ['Strong villager production', 'Too few villagers', 'Villagers made:']);
    cmp('eapm', (f) => f.eapm, false, 1e9, -1, 8, 8, (v) => String(Math.round(v)), ['Fast hands', 'Slower hands than the others', 'Typical eAPM:']);
    // attacking
    const firsts = fs.map((f) => f.first_attack).filter((v) => v != null);
    const passive = fs.filter((f) => /^Passive/.test(f.attack_style) && f.dur >= 20).length;
    if (firsts.length >= 3 && median(firsts) <= 12) add(out.strengths, 'attack', 1, 'Early pressure', `First attack typically at ${mmss(median(firsts))}.`);
    if (passive >= 3 && passive / fs.length >= 0.4) add(out.weaknesses, 'attack', 1, 'Rarely attacking', `Never really attacked in ${passive} of ${fs.length} analysed games.`);

    // ----- what wins and loses (results, so every game with a replay counts)
    const wr = (xs) => xs.filter((f) => Number(f.won) === 1).length / xs.length;
    const all = wr(fs);
    const by = (keyFn) => { const m = new Map(); fs.forEach((f) => { const k = keyFn(f); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(f); }); return [...m].filter(([, xs]) => xs.length >= 4); };
    const won = (xs) => `${xs.filter((f) => Number(f.won) === 1).length} of ${xs.length} won`;
    by((f) => (f.opening && f.opening !== 'Unclear' ? f.opening : '')).forEach(([k, xs]) => {
      const r = wr(xs);
      if (r >= all + 0.15 && r >= 0.5) add(out.strengths, `open:${k}`, 1.5, `Wins with ${k}`, `${pct(r)} won when opening ${k} (${won(xs)}), against ${pct(all)} overall.`);
      else if (r <= all - 0.15 && r < 0.5) add(out.weaknesses, `open:${k}`, 1.5, `Loses with ${k}`, `${pct(r)} won when opening ${k} (${won(xs)}), against ${pct(all)} overall.`);
    });
    by((f) => (f.opp.openings.length === 1 && f.opp.openings[0] !== 'Unclear' ? f.opp.openings[0] : '')).forEach(([k, xs]) => {
      const r = wr(xs);
      if (r >= all + 0.15 && r >= 0.5) add(out.strengths, `vs:${k}`, 1.5, `Handles ${k} openings`, `${pct(r)} won against ${k} (${won(xs)}).`);
      else if (r <= all - 0.15 && r < 0.5) add(out.weaknesses, `vs:${k}`, 1.75, `Struggles against ${k}`, `Only ${pct(r)} won against a ${k} opening (${won(xs)}).`);
    });
    // game length, from every game in view (not only those with a replay)
    const g = (games || []).filter((r) => r.duration_min != null && r.duration_min !== '');
    const len = [['short games (under 20 minutes)', (m) => m < 20], ['mid-length games (20–35 minutes)', (m) => m >= 20 && m <= 35], ['long games (over 35 minutes)', (m) => m > 35]]
      .map(([k, f]) => { const xs = g.filter((r) => f(Number(r.duration_min))); return { k, n: xs.length, r: xs.length ? xs.filter((r) => Number(r.won) === 1).length / xs.length : 0 }; })
      .filter((x) => x.n >= 5);
    if (len.length >= 2) {
      const s = [...len].sort((a, b) => b.r - a.r), best = s[0], worst = s[s.length - 1];
      if (best.r - worst.r >= 0.15) {
        add(out.strengths, 'length', 1, `Strong in ${best.k.split(' (')[0]}`, `${pct(best.r)} won in ${best.k}, over ${best.n} games.`);
        add(out.weaknesses, 'length', 1, `Weaker in ${worst.k.split(' (')[0]}`, `${pct(worst.r)} won in ${worst.k}, over ${worst.n} games.`);
      }
    }

    // ----- the same tips the game breakdown gives, when they keep coming up
    const tally = { well: new Map(), better: new Map() };
    fs.forEach((f) => { const t = game(f, null, 2); ['well', 'better'].forEach((k) => t[k].forEach((x) => tally[k].set(x.code, (tally[k].get(x.code) || 0) + 1))); });
    // an area that comes up both ways (upgrades got in some games, skipped in others) counts on the side it came up more
    const areaN = { well: new Map(), better: new Map() };
    ['well', 'better'].forEach((k) => tally[k].forEach((n, code) => { const a = (TIP[code] || [code])[0]; areaN[k].set(a, (areaN[k].get(a) || 0) + n); }));
    [['better', out.weaknesses, 'well'], ['well', out.strengths, 'better']].forEach(([k, list, other]) => {
      [...tally[k]].filter(([, n]) => n >= 3 && n / fs.length >= 0.3).sort((a, b) => b[1] - a[1]).forEach(([code, n]) => {
        const [area, title] = TIP[code] || [code, code];
        if ((areaN[other].get(area) || 0) >= areaN[k].get(area)) return;
        add(list, area, 1.25 + n / fs.length, title, `In ${n} of ${fs.length} analysed games.`);
      });
    });
    out.strengths.sort((a, b) => b.weight - a.weight);
    out.weaknesses.sort((a, b) => b.weight - a.weight);
    out.strengths = out.strengths.slice(0, 6);
    out.weaknesses = out.weaknesses.slice(0, 6);
    return out;
  }

  window.TT_COACH = { facts, fromPlayback, game, player, classOf, mmss };
})();
