"""Replay analysis for the AoE2 tournament dashboard.

parse_replay(path) -> dict with:
  game:      one summary row for the match
  players:   one analysis row per player (opening, attack and defense style, timings, ...)
  units:     unit counts per player
  build:     first build-order steps per player
  playback:  compact event stream + terrain for the map playback viewer
Only depends on the `mgz` parser (pip install mgz).
"""
import math
import collections
import importlib.util
import os


def _patch_mgz():
    """Teach the mgz parser (1.8.51) the header fields added in AoE2 DE save version 67+ (2026 updates).
    Edits the installed mgz/fast/header.py once; no-op if already patched or if mgz adds support itself."""
    spec = importlib.util.find_spec('mgz')
    if not spec or not spec.submodule_search_locations:
        return
    path = os.path.join(list(spec.submodule_search_locations)[0], 'fast', 'header.py')
    s = open(path).read()
    if 'save >= 67' in s:
        return
    a_old = "        if save >= 64.3:\n            data.read(4)\n\n        players.append(dict("
    a_new = ("        if save >= 64.3:\n            data.read(4)\n        if save >= 67:\n            de_string(data)\n\n"
             "        players.append(dict(")
    b_old = "    if not skip:\n        de_string(data)\n        data.read(8)"
    b_new = ("    if not skip:\n        de_string(data)\n        if save >= 67:\n            de_string(data)\n"
             "            de_string(data)\n        data.read(8)")
    if a_old in s and b_old in s:
        s = s.replace(a_old, a_new).replace(b_old, b_new)
        with open(path, 'w') as f:
            f.write(s)


_patch_mgz()
from mgz.model import parse_match  # noqa: E402

# Bump when the reader (mgz or the patches here) learns to read more replays: games marked "Could not read" by an
# older reader are then tried once more (pipeline/run.py). Known unreadable on 1.8.51: games with AI players on save
# 68+ (the AI scripts are laid out differently, so the header's player list is not found).
READER = 'mgz-1.8.51+1'

# ---------------------------------------------------------------- reference sets
VILLAGER_ONLY = {'Build', 'Wall', 'Gather', 'Back To Work', 'Reseed', 'Repair'}
MILITARY_CMDS = {'Move', 'Order', 'Patrol', 'Formation', 'Follow', 'Attack Ground', 'Guard', 'Stance', 'Target'}
UNIT_CLASS = {}
def _cls(name, units):
    for u in units:
        UNIT_CLASS[u] = name
_cls('Villager', ['Villager'])
_cls('Scouts', ['Scout Cavalry', 'Light Cavalry', 'Hussar', 'Winged Hussar', 'Steppe Lancer', 'Elite Steppe Lancer', 'Shrivamsha Rider', 'Elite Shrivamsha Rider'])
_cls('Knights', ['Knight', 'Cavalier', 'Paladin', 'Savar', 'Hei Guang Cavalry', 'Heavy Hei Guang Cavalry'])
_cls('Camels', ['Camel Rider', 'Heavy Camel Rider', 'Imperial Camel Rider', 'Camel Scout'])
_cls('Battle elephants', ['Battle Elephant', 'Elite Battle Elephant'])
_cls('Cav archers', ['Cavalry Archer', 'Heavy Cavalry Archer', 'Elephant Archer', 'Elite Elephant Archer', 'Camel Archer', 'Elite Camel Archer'])
_cls('Archers', ['Archer', 'Crossbowman', 'Arbalester', 'Elite Skirmisher_x'])
_cls('Skirmishers', ['Skirmisher', 'Elite Skirmisher', 'Imperial Skirmisher'])
_cls('Gunpowder', ['Hand Cannoneer', 'Bombard Cannon', 'Organ Gun', 'Elite Organ Gun', 'Janissary', 'Elite Janissary', 'Conquistador', 'Elite Conquistador'])
_cls('Militia line', ['Militia', 'Man-at-Arms', 'Long Swordsman', 'Two-Handed Swordsman', 'Champion', 'Legionary'])
_cls('Spears', ['Spearman', 'Pikeman', 'Halberdier'])
_cls('Eagles', ['Eagle Scout', 'Eagle Warrior', 'Elite Eagle Warrior'])
_cls('Monks', ['Monk', 'Missionary'])
_cls('Siege', ['Mangonel', 'Onager', 'Siege Onager', 'Battering Ram', 'Capped Ram', 'Siege Ram', 'Scorpion', 'Heavy Scorpion',
               'Trebuchet', 'Trebuchet (Packed)', 'Siege Tower', 'Armored Elephant', 'Siege Elephant', 'Rocket Cart', 'Heavy Rocket Cart',
               'Mounted Trebuchet', 'Traction Trebuchet'])
_cls('Navy', ['Fishing Ship', 'Transport Ship', 'Trade Cog', 'Galley', 'War Galley', 'Galleon', 'Fire Galley', 'Fire Ship', 'Fast Fire Ship',
              'Demolition Raft', 'Demolition Ship', 'Heavy Demolition Ship', 'Cannon Galleon', 'Elite Cannon Galleon', 'Longboat', 'Elite Longboat',
              'Turtle Ship', 'Elite Turtle Ship', 'Caravel', 'Elite Caravel', 'Thirisadai', 'Dromon', 'Lou Chuan', 'Catapult Galleon'])
_cls('Trade', ['Trade Cart'])
ECO_CLASSES = {'Villager', 'Trade'}
NON_FIGHT = {'Villager', 'Trade', 'Monks'}

TOWERS = {'Watch Tower', 'Guard Tower', 'Keep', 'Bombard Tower', 'Fortified Tower', 'Donjon', 'Harbor'}
PRODUCTION = {'Barracks', 'Archery Range', 'Stable', 'Siege Workshop', 'Castle', 'Monastery', 'Dock', 'Krepost', 'Town Center', 'Fortified Church'}
STONE_WALL = {'Stone Wall', 'Fortified Wall', 'Gate', 'Fortified Palisade Wall'}
WATER = {1, 4, 15, 22, 23, 28, 54, 57, 58, 59, 95, 96}
BEACH = {2, 52, 79, 80, 81, 82, 83, 107, 108, 109}
FOREST = {10, 13, 17, 18, 19, 20, 21, 44, 45, 48, 49, 50, 104, 105}
TREE_WORDS = ('Tree', 'Forest', 'Bamboo', 'Palm', 'Pine', 'Oak', 'Birch', 'Jungle', 'Cypress', 'Mangrove', 'Baobab', 'Acacia', 'Olive', 'Dragon')
RESOURCES = {'Gold Mine': 'g', 'Stone Mine': 's', 'Relic': 'r', 'Forage Bush': 'f', 'Fruit Bush': 'f'}


def mins(td):
    return None if td is None else round(td.total_seconds() / 60, 2)


def secs(td):
    return round(td.total_seconds(), 1)


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _pos(p):
    return None if p is None or p.x is None or p.y is None else (float(p.x), float(p.y))


# ---------------------------------------------------------------- main
def parse_replay(path, match_id='', keep_playback=True):
    with open(path, 'rb') as h:
        m = parse_match(h)
    dim = int(m.map.dimension or 120)
    players = [p for p in m.players]
    num = {p.number: p for p in players}
    start = {p.number: _pos(p.position) for p in players}
    for p in players:  # some replays carry no start position: use the starting Town Center, else the first building
        if start.get(p.number) is None:
            tc = next((_pos(o.position) for o in (p.objects or []) if o.name == 'Town Center' and _pos(o.position)), None)
            if tc is None:
                tc = next((_pos(i.position) for i in m.inputs if i.player and i.player.number == p.number and i.type == 'Build' and _pos(i.position)), None)
            start[p.number] = tc
    team = {p.number: (p.team_id[0] if isinstance(p.team_id, (list, tuple)) and p.team_id else p.team_id) for p in players}
    enemies = {p.number: [q.number for q in players if q.number != p.number and team[q.number] != team[p.number]] for p in players}
    for n in enemies:
        if not enemies[n]:
            enemies[n] = [q.number for q in players if q.number != n]

    def enemy_start(n, pt):
        es = [start[e] for e in enemies[n] if start.get(e)]
        return min(es, key=lambda s: dist(s, pt)) if es else None

    # age times
    age = collections.defaultdict(dict)
    for u in m.uptimes or []:
        pn = u.player.number if hasattr(u.player, 'number') else None
        name = str(u.age).split('.')[-1].split('_')[0].lower()  # feudal / castle / imperial
        if pn is not None and name not in age[pn]:
            age[pn][name] = u.timestamp

    # pass 1: classify object ids as villager / building / military
    vill = collections.defaultdict(set)
    bld = collections.defaultdict(set)
    for i in m.inputs:
        if not i.player or not i.payload:
            continue
        ids = i.payload.get('object_ids') or []
        if i.type in VILLAGER_ONLY:
            vill[i.player.number].update(ids)
        elif i.type in ('Queue', 'Research', 'Gather Point', 'Unqueue'):
            bld[i.player.number].update(ids)
    scout = collections.defaultdict(set)
    for p in players:
        for o in p.objects or []:
            if o.name == 'Villager':
                vill[p.number].add(o.instance_id)
            elif o.name in ('Scout Cavalry', 'Eagle Scout', 'Camel Scout'):
                scout[p.number].add(o.instance_id)

    queued = collections.defaultdict(list)       # pn -> [(t, unit, amount)]
    builds = collections.defaultdict(list)       # pn -> [(t, name, pos)]
    walls = collections.defaultdict(list)        # pn -> [(t, name, tiles, a, b)]
    research = collections.defaultdict(list)     # pn -> [(t, tech)]
    mil_cmds = collections.defaultdict(list)     # pn -> [(t, pos)]
    garrisons = collections.Counter()
    trades = collections.Counter()
    resign = {}
    events = []
    last_sample = {}
    moves = []                                    # (t_sec, pn, ids, pos, is_villager) for the army/villager simulation

    for i in m.inputs:
        if not i.player:
            continue
        pn = i.player.number
        t = i.timestamp
        pl = i.payload or {}
        pos = _pos(i.position)
        if keep_playback and pos and i.type in VILLAGER_ONLY | MILITARY_CMDS:
            ids = [x for x in (pl.get('object_ids') or []) if x not in bld[pn]]
            if ids:
                is_v = i.type in VILLAGER_ONLY or all(x in vill[pn] for x in ids)
                moves.append((secs(t), pn, ids, pos, is_v))
        if i.type == 'Queue':
            unit = pl.get('unit') or i.param
            if unit:
                amt = int(pl.get('amount') or 1)
                queued[pn].append((t, unit, amt))
                if keep_playback:
                    events.append({'k': 'u', 't': secs(t), 'p': pn, 'n': unit, 'c': amt})
        elif i.type == 'Build':
            name = pl.get('building') or i.param
            if name and pos:
                builds[pn].append((t, name, pos))
                if keep_playback:
                    events.append({'k': 'b', 't': secs(t), 'p': pn, 'n': name, 'x': round(pos[0], 1), 'y': round(pos[1], 1)})
        elif i.type == 'Wall':
            name = pl.get('building') or 'Wall'
            a = (pl.get('x', pos[0] if pos else 0), pl.get('y', pos[1] if pos else 0))
            b = (pl.get('x_end', a[0]), pl.get('y_end', a[1]))
            tiles = int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) + 1)
            walls[pn].append((t, name, tiles, a, b))
            if keep_playback:
                events.append({'k': 'w', 't': secs(t), 'p': pn, 'n': name, 'x': a[0], 'y': a[1], 'x2': b[0], 'y2': b[1]})
        elif i.type == 'Research':
            tech = pl.get('technology') or i.param
            if tech and not (research[pn] and research[pn][-1][1] == tech and (t - research[pn][-1][0]).total_seconds() < 5):
                research[pn].append((t, tech))
                if keep_playback:
                    events.append({'k': 'r', 't': secs(t), 'p': pn, 'n': tech})
        elif i.type == 'Garrison':
            garrisons[pn] += 1
        elif i.type in ('Buy', 'Sell'):
            trades[pn] += 1
        elif i.type == 'Resign':
            resign[pn] = t
            if keep_playback:
                events.append({'k': 'x', 't': secs(t), 'p': pn})
        elif i.type in MILITARY_CMDS and pos:
            ids = set(pl.get('object_ids') or [])
            if ids and not (ids & vill[pn]) and not (ids & bld[pn]):
                if not (ids <= scout[pn]):
                    mil_cmds[pn].append((t, pos, len(ids)))
                if keep_playback:
                    cell = (int(pos[0] // 6), int(pos[1] // 6))
                    key = (pn, cell)
                    if key not in last_sample or (t - last_sample[key]).total_seconds() >= 4:
                        last_sample[key] = t
                        events.append({'k': 'm', 't': secs(t), 'p': pn, 'x': round(pos[0], 1), 'y': round(pos[1], 1),
                                       'a': 1 if i.type in ('Order', 'Attack Ground', 'Target') else 0, 's': min(len(ids), 40)})

    for pn, a in age.items():
        for name, t in a.items():
            if keep_playback:
                events.append({'k': 'a', 't': secs(t), 'p': pn, 'n': 'Reached ' + name.capitalize() + ' Age'})

    has_units = any(queued.values())
    duration = m.duration
    rows, units_rows, build_rows = [], [], []

    for p in players:
        pn = p.number
        home = start.get(pn) or (dim / 2, dim / 2)
        feudal, castle, imp = age[pn].get('feudal'), age[pn].get('castle'), age[pn].get('imperial')
        q = queued[pn]

        def window(t0, t1):
            c = collections.Counter()
            for t, u, a in q:
                if (t0 is None or t >= t0) and (t1 is None or t < t1):
                    c[UNIT_CLASS.get(u, 'Unique units' if u not in UNIT_CLASS else u)] += a
            return c
        dark = window(None, feudal)
        feud = window(feudal, castle) if feudal else collections.Counter()
        cast = window(castle, imp) if castle else collections.Counter()
        late = window(imp, None) if imp else collections.Counter()
        total = window(None, None)
        fight = lambda c: {k: v for k, v in c.items() if k not in NON_FIGHT}
        fmil = fight(feud)
        cmil = fight(cast)
        lmil = fight(late)

        b = builds[pn]
        bcount = collections.Counter(n for _, n, _ in b)
        techs = {n for _, n in research[pn]}
        enemy_tc = enemy_start(pn, home) or (dim - home[0], dim - home[1])
        span = max(20.0, dist(home, enemy_tc))

        # ----- opening
        towers_fwd = [x for x in b if x[1] in TOWERS and dist(x[2], enemy_start(pn, x[2]) or enemy_tc) < span * 0.45 and (castle is None or x[0] < castle)]
        if dark.get('Militia line', 0) >= 3:
            opening = 'Drush'
        elif towers_fwd:
            opening = 'Tower rush'
        elif has_units and feudal and sum(fmil.values()) < 4 and castle and (castle - feudal).total_seconds() < 330:
            opening = 'Fast Castle'
        elif has_units and fmil:
            top = sorted(fmil.items(), key=lambda kv: -kv[1])
            k, v = top[0]
            second = top[1] if len(top) > 1 else (None, 0)
            if v < 4:
                opening = 'Light feudal'
            elif {k, second[0]} == {'Militia line', 'Archers'} and second[1] >= 3:
                opening = 'Men-at-Arms into archers'
            elif k in ('Skirmishers', 'Spears') and (fmil.get('Skirmishers', 0) + fmil.get('Spears', 0)) >= 0.6 * sum(fmil.values()):
                opening = 'Skirms & spears'
            else:
                opening = {'Scouts': 'Scouts', 'Archers': 'Archers', 'Militia line': 'Men-at-Arms', 'Eagles': 'Eagles',
                           'Skirmishers': 'Skirms & spears', 'Spears': 'Skirms & spears', 'Camels': 'Camels'}.get(k, k)
        elif not has_units:
            # no unit data in this replay version: infer from buildings and techs
            pre = [x for x in b if castle is None or x[0] < castle]
            pc = collections.Counter(n for _, n, _ in pre)
            if feudal and castle and (castle - feudal).total_seconds() < 330 and pc['Archery Range'] + pc['Stable'] + pc['Barracks'] <= 1:
                opening = 'Fast Castle'
            elif pc['Archery Range'] >= 2 or 'Fletching' in techs and pc['Archery Range']:
                opening = 'Archers'
            elif pc['Stable'] >= 1 and ('Bloodlines' in techs or pc['Stable'] >= 2):
                opening = 'Scouts'
            elif 'Man-at-Arms' in techs:
                opening = 'Men-at-Arms'
            else:
                opening = 'Unclear'
        else:
            opening = 'Unclear'

        # ----- castle-age plan
        tcs_castle = sum(1 for t, n, _ in b if n == 'Town Center' and castle and t >= castle and (imp is None or t < imp))
        if tcs_castle >= 2:
            castle_plan = 'Boom (%d TCs)' % (tcs_castle + 1)
        elif cmil:
            k = max(cmil.items(), key=lambda kv: kv[1])[0]
            castle_plan = {'Archers': 'Crossbows', 'Militia line': 'Infantry', 'Unique units': 'Unique units'}.get(k, k)
        elif castle:
            castle_plan = 'Unclear'
        else:
            castle_plan = ''
        late_comp = max(lmil.items(), key=lambda kv: kv[1])[0] if lmil else ''

        # ----- attack style
        cmds = mil_cmds[pn]
        def in_enemy(pt):
            e = enemy_start(pn, pt)
            return e is not None and dist(pt, e) < dist(pt, home)
        deep = [(t, pt) for t, pt, n in cmds if (enemy_start(pn, pt) and dist(pt, enemy_start(pn, pt)) < span * 0.35)
                and (feudal is not None and t >= feudal or opening == 'Drush' and n >= 3)]
        aggr = (sum(1 for _, pt, _ in cmds if in_enemy(pt)) / len(cmds)) if cmds else 0
        first_attack = deep[0][0] if deep else None
        raid_minutes = len({int(t.total_seconds() // 60) for t, _ in deep})
        dur_min = max(1.0, duration.total_seconds() / 60)
        fa = mins(first_attack)
        if fa is None:
            attack_style = 'Passive'
        elif fa < 12:
            attack_style = 'Early pressure'
        elif fa < 22:
            attack_style = 'Mid-game aggression'
        else:
            attack_style = 'Late attacker'
        if raid_minutes >= max(6, dur_min * 0.25) and aggr >= 0.35:
            attack_style += ', constant raids'
        siege_late = sum(v for k, v in total.items() if k == 'Siege')
        if siege_late >= 3 and aggr >= 0.3:
            attack_style += ', siege pushes'

        # ----- defense style
        pal = sum(x[2] for x in walls[pn] if 'Palisade' in x[1])
        stone = sum(x[2] for x in walls[pn] if x[1] in STONE_WALL or 'Stone' in x[1])
        wall_cut = feudal + _td(90) if feudal else _td(10 ** 6)
        early_walls = sum(x[2] for x in walls[pn] if x[0] < wall_cut)
        home_towers = sum(1 for t, n, pt in b if n in TOWERS and dist(pt, home) < span * 0.35)
        castles = sum(1 for t, n, pt in b if n in ('Castle', 'Krepost'))
        home_castles = sum(1 for t, n, pt in b if n in ('Castle', 'Krepost') and dist(pt, home) < span * 0.4)
        counter = fight(total)
        counter_share = (counter.get('Skirmishers', 0) + counter.get('Spears', 0)) / max(1, sum(counter.values()))
        parts = []
        if early_walls >= 15:
            parts.append('Walls up early')
        elif pal + stone >= 25:
            parts.append('Heavy walling')
        if home_towers + home_castles >= 3:
            parts.append('Towers & castles at home')
        if counter_share >= 0.35:
            parts.append('Counter units (skirms/spears)')
        if garrisons[pn] >= 40:
            parts.append('Garrisons often')
        defense_style = ', '.join(parts) if parts else 'Minimal defense'

        vills = total.get('Villager', 0)
        row = {
            'match_id': str(match_id), 'number': pn, 'name': p.name, 'profile_id': str(p.profile_id or ''),
            'civ': p.civilization, 'team': team.get(pn), 'won': 1 if p.winner else 0,
            'map': m.map.name, 'duration_min': round(dur_min, 1), 'eapm': p.eapm,
            'feudal_min': mins(feudal), 'castle_min': mins(castle), 'imperial_min': mins(imp),
            'opening': opening, 'castle_plan': castle_plan, 'late_army': late_comp,
            'attack_style': attack_style, 'defense_style': defense_style,
            'first_attack_min': fa, 'aggression': round(aggr, 3), 'raid_minutes': raid_minutes,
            'villagers': vills if has_units else None,
            'military_units': sum(counter.values()) if has_units else None,
            'palisade_tiles': pal, 'stone_wall_tiles': stone, 'towers': sum(v for k, v in bcount.items() if k in TOWERS),
            'castles': castles, 'town_centers': bcount.get('Town Center', 0) + 1, 'market_trades': trades[pn],
            'techs': len(research[pn]), 'unit_data': bool(has_units),
            'resigned_min': mins(resign.get(pn)),
        }
        rows.append(row)
        uc = collections.Counter()
        for t, u, a in q:
            uc[u] += a
        for u, c in uc.most_common():
            units_rows.append({'match_id': str(match_id), 'number': pn, 'name': p.name, 'unit': u,
                               'class': UNIT_CLASS.get(u, 'Unique units'), 'count': c})
        # build order: first 30 items (builds, techs, age ups, first of each unit)
        steps = []
        seen_units = set()
        for t, u, a in q:
            if u not in seen_units:
                seen_units.add(u)
                steps.append((t, 'Unit', u))
        steps += [(t, 'Building', n) for t, n, _ in b if n not in ('Farm', 'House')]
        steps += [(t, 'Tech', n) for t, n in research[pn]]
        steps += [(age[pn][k], 'Age', 'Reached ' + k.capitalize()) for k in age[pn]]
        steps.sort(key=lambda s: s[0])
        for idx, (t, kind, n) in enumerate(steps[:40]):
            build_rows.append({'match_id': str(match_id), 'number': pn, 'name': p.name, 'step': idx + 1,
                               'min': mins(t), 'kind': kind, 'item': n})

    game = {
        'match_id': str(match_id), 'map': m.map.name, 'map_size': m.map.size, 'dimension': dim,
        'duration_min': round(duration.total_seconds() / 60, 1), 'rated': bool(m.rated),
        'version': str(m.game_version), 'players': len(players),
    }
    out = {'game': game, 'players': rows, 'units': units_rows, 'build': build_rows}
    if keep_playback:
        out['playback'] = _playback(m, dim, players, events, start, team)
        tr_units, tr_sites = build_tracks(m, start, builds, out['playback']['resources'])
        out['playback']['tracks'] = tr_units
        out['playback']['sites'] = tr_sites
    return out


def _td(s):
    import datetime
    return datetime.timedelta(seconds=s)


def _playback(m, dim, players, events, start, team):
    # terrain: one char per tile, row-major y then x. l land, w water, b beach, f forest
    grid = [['l'] * dim for _ in range(dim)]
    elev = [['0'] * dim for _ in range(dim)]
    for t in m.map.tiles:
        x, y = int(t.position.x), int(t.position.y)
        if 0 <= x < dim and 0 <= y < dim:
            grid[y][x] = 'w' if t.terrain in WATER else 'b' if t.terrain in BEACH else 'f' if t.terrain in FOREST else 'l'
            elev[y][x] = str(max(0, min(9, int(t.elevation or 0))))
    res = []
    for o in m.gaia or []:
        if not o.name or not o.position:
            continue
        x, y = int(o.position.x), int(o.position.y)
        if not (0 <= x < dim and 0 <= y < dim):
            continue
        if any(w in o.name for w in TREE_WORDS) and 'Dead' not in o.name or o.name.startswith('Tree'):
            if grid[y][x] == 'l':
                grid[y][x] = 'f'
        elif o.name in RESOURCES:
            res.append([RESOURCES[o.name], round(o.position.x, 1), round(o.position.y, 1)])
    events.sort(key=lambda e: e['t'])
    return {
        'dimension': dim,
        'terrain': ''.join(''.join(r) for r in grid),
        'elevation': ''.join(''.join(r) for r in elev),
        'resources': res,
        'players': [{'number': p.number, 'name': p.name, 'civ': p.civilization, 'color': p.color_id,
                     'team': team.get(p.number), 'x': start[p.number][0] if start.get(p.number) else None,
                     'y': start[p.number][1] if start.get(p.number) else None, 'won': 1 if p.winner else 0}
                    for p in players],
        'duration_s': round(m.duration.total_seconds(), 1),
        'events': events,
    }


SPAWN = {'Barracks', 'Archery Range', 'Stable', 'Castle', 'Siege Workshop', 'Town Center', 'Monastery', 'Dock', 'Krepost'}


def _simulate(moves, builds, start, dur, step=5.0):
    """Estimate where each player's units are over time from the orders they were given.
    Each unit walks from where it was last sent toward its newest order (about 1.2 tiles/s for military,
    0.8 for villagers). Units with no order for a while are dropped, since deaths aren't in the replay.
    Returns rows {t, p, v, x, y, n}: n units of player p near (x, y) at game second t (v=1 villagers)."""
    moves = sorted(moves, key=lambda r: r[0])
    sites = {pn: [(secs(t), pos) for t, n, pos in b if n in SPAWN] for pn, b in builds.items()}
    def spawn(pn, ts, target, is_v):
        cand = [pos for t0, pos in sites.get(pn, []) if t0 <= ts and (not is_v or True)]
        home = start.get(pn)
        if home:
            cand.append(home)
        if not cand:
            return target
        return min(cand, key=lambda c: dist(c, target)) if not is_v else min(cand, key=lambda c: dist(c, target))
    units, out, i, t = {}, [], 0, 0.0
    while t <= dur + step:
        while i < len(moves) and moves[i][0] <= t:
            ts, pn, ids, (x, y), is_v = moves[i]
            i += 1
            for oid in ids:
                u = units.get(oid)
                if u is None:
                    sx, sy = spawn(pn, ts, (x, y), is_v)
                    units[oid] = [sx, sy, x, y, ts, pn, is_v]
                else:
                    u[2], u[3], u[4] = x, y, ts
                    u[6] = u[6] or is_v
        cells = {}
        for oid in list(units):
            u = units[oid]
            if t - u[4] > (900 if u[6] else 240):
                del units[oid]
                continue
            sp = (0.8 if u[6] else 1.2) * step
            dx, dy = u[2] - u[0], u[3] - u[1]
            d = math.hypot(dx, dy)
            if d <= sp:
                u[0], u[1] = u[2], u[3]
            else:
                u[0] += dx / d * sp
                u[1] += dy / d * sp
            g = 8 if u[6] else 5
            key = (u[5], 1 if u[6] else 0, int(u[0] // g), int(u[1] // g))
            c = cells.setdefault(key, [0.0, 0.0, 0])
            c[0] += u[0]; c[1] += u[1]; c[2] += 1
        for (pn, v, _, _), (sx, sy, n) in cells.items():
            out.append({'t': round(t), 'p': pn, 'v': v, 'x': round(sx / n, 1), 'y': round(sy / n, 1), 'n': n})
        t += step
    return out


def playback_rows(pb, build, units, match_id, map_name):
    """Flatten a playback into row objects (the dashboard reads files as rows)."""
    rows = [{'k': 'meta', 'match_id': str(match_id), 'map': map_name, 'dimension': pb['dimension'], 'duration_s': pb['duration_s'],
             'terrain': pb['terrain'], 'elevation': pb['elevation']}]
    rows += [{'k': 'player', **p} for p in pb['players']]
    rows += [{'k': 'res', 'r': r, 'x': x, 'y': y} for r, x, y in pb['resources']]
    rows += [{'k': 'bo', **b} for b in build]
    rows += [{'k': 'uc', **u} for u in units]
    # one row per unit; its waypoints packed as "t,x,y,tx,ty,task,attack,target;..." to keep the file small
    for u in pb.get('tracks', []):
        way = ';'.join(f"{w[0]:g},{w[1]:g},{w[2]:g},{w[3]:g},{w[4]:g},{w[5]},{w[6]},{str(w[7]).replace(',', ' ').replace(';', ' ')}" for w in u['w'])
        rows.append({'k': 'un', 'id': u['id'], 'p': u['p'], 'ty': u['type'], 'c': u['cls'], 'sp': u['spd'], 'b': u['born'],
                     'e': u['end'], 'x': u['x'], 'y': u['y'], 'w': way})
    rows += [{'k': 'si', **sdoc} for sdoc in pb.get('sites', [])]
    rows += pb['events']
    return rows


# ---------------------------------------------------------------- per-unit tracks
# Estimated from orders: the replay does not record unit positions, health or deaths.
SPEED = {'Villager': 0.8, 'Scouts': 1.55, 'Knights': 1.35, 'Camels': 1.45, 'Battle elephants': 0.85, 'Cav archers': 1.4,
         'Archers': 0.96, 'Skirmishers': 0.96, 'Gunpowder': 0.96, 'Militia line': 0.9, 'Spears': 1.0, 'Eagles': 1.3,
         'Monks': 0.7, 'Siege': 0.6, 'Navy': 1.35, 'Trade': 1.0, 'Unique units': 1.0}
MAKER = {'Villager': {'Town Center'}, 'Scouts': {'Stable'}, 'Knights': {'Stable'}, 'Camels': {'Stable'},
         'Battle elephants': {'Stable'}, 'Cav archers': {'Archery Range'}, 'Archers': {'Archery Range'},
         'Skirmishers': {'Archery Range'}, 'Gunpowder': {'Archery Range', 'Siege Workshop'},
         'Militia line': {'Barracks'}, 'Spears': {'Barracks'}, 'Eagles': {'Barracks'}, 'Monks': {'Monastery'},
         'Siege': {'Siege Workshop'}, 'Navy': {'Dock'}, 'Trade': {'Market'}, 'Unique units': {'Castle', 'Krepost'}}
BUILD_TIME = {'House': 25, 'Town Center': 150, 'Barracks': 50, 'Archery Range': 50, 'Stable': 50, 'Mill': 35,
              'Lumber Camp': 35, 'Mining Camp': 35, 'Farm': 15, 'Blacksmith': 40, 'Market': 60, 'Castle': 200,
              'Watch Tower': 80, 'Monastery': 40, 'University': 60, 'Siege Workshop': 40, 'Dock': 35,
              'Outpost': 15, 'Fish Trap': 40, 'Gate': 70, 'Palisade Gate': 30, 'Krepost': 120, 'Wonder': 3500}


def task_of(name):
    n = (name or '').lower()
    if not n:
        return ''
    if 'gold' in n:
        return 'gold'
    if 'stone' in n:
        return 'stone'
    if any(w in n for w in ('tree', 'forest', 'bamboo', 'palm', 'pine', 'oak', 'wood')):
        return 'wood'
    if any(w in n for w in ('farm', 'bush', 'berr', 'sheep', 'goat', 'cow', 'llama', 'turkey', 'goose', 'pig', 'deer',
                            'boar', 'javelina', 'elephant', 'zebra', 'ostrich', 'fish', 'shore', 'rhino', 'ibex', 'water buffalo')):
        return 'food'
    if 'relic' in n:
        return 'relic'
    return ''


def build_tracks(m, start, builds_by_player, resources=None):
    """Return (units, sites): units = list of dicts with waypoints; sites = building construction spans."""
    players = {p.number: p for p in m.players}
    # building object id -> (position, name): learned from any order that targets an own building
    bpos = {}
    for i in m.inputs:
        pl = i.payload or {}
        tid = pl.get('target_id')
        if tid and tid > 0 and i.param and i.position and _pos(i.position) and i.param in BUILD_TIME:
            bpos.setdefault(tid, (_pos(i.position), i.param))
    # queued units per player, in order, with the building that queued them
    queue = collections.defaultdict(list)
    for i in m.inputs:
        if i.type == 'Queue' and i.player:
            pl = i.payload or {}
            unit = pl.get('unit') or i.param
            if not unit:
                continue
            for _ in range(int(pl.get('amount') or 1)):
                queue[i.player.number].append([secs(i.timestamp), unit, (pl.get('object_ids') or [None])[0], False])
    vill_ids = collections.defaultdict(set)
    known = {}
    for p in m.players:
        for o in p.objects or []:
            if o.name in ('Villager', 'Scout Cavalry', 'Eagle Scout', 'Camel Scout') and _pos(o.position):
                known[o.instance_id] = {'p': p.number, 'type': o.name, 'born': 0.0, 'from': _pos(o.position)}
    for i in m.inputs:
        if i.type in VILLAGER_ONLY and i.player:
            vill_ids[i.player.number].update((i.payload or {}).get('object_ids') or [])

    units = {}
    def new_unit(oid, pn, t, target, is_v):
        if oid in known:
            k = known[oid]
            return {'id': oid, 'p': pn, 'type': k['type'], 'born': 0.0, 'x': k['from'][0], 'y': k['from'][1], 'orders': []}
        utype = 'Villager' if is_v else None
        q = queue.get(pn, [])
        pick = None
        for item in q:  # earliest queued unit of the right sort that isn't matched yet
            if item[3] or item[0] > t:
                continue
            is_vq = UNIT_CLASS.get(item[1]) == 'Villager'
            if is_vq == bool(is_v):
                pick = item
                break
        if pick:
            pick[3] = True
            utype = pick[1]
        utype = utype or ('Villager' if is_v else 'Military unit')
        cls = UNIT_CLASS.get(utype, 'Unique units')
        origin = None
        if pick and pick[2] in bpos:
            origin = bpos[pick[2]][0]
        if origin is None:
            makers = MAKER.get(cls, set())
            cand = [pos for bt, bn, pos in builds_by_player.get(pn, []) if bn in makers and secs(bt) <= t]
            if start.get(pn):
                cand.append(start[pn])
            origin = min(cand, key=lambda c: dist(c, target)) if cand else target
        born = max(pick[0] if pick else t, 0.0)
        return {'id': oid, 'p': pn, 'type': utype, 'born': round(min(born, t), 1), 'x': origin[0], 'y': origin[1], 'orders': []}

    for i in m.inputs:
        if not i.player or i.type not in (VILLAGER_ONLY | MILITARY_CMDS | {'Garrison', 'Delete'}):
            continue
        pl = i.payload or {}
        ids = pl.get('object_ids') or []
        pos = _pos(i.position)
        t = secs(i.timestamp)
        pn = i.player.number
        if i.type == 'Delete':
            for oid in ids:
                if oid in units:
                    units[oid]['dead'] = t
            continue
        if not pos or not ids:
            continue
        is_v = i.type in VILLAGER_ONLY or all(x in vill_ids[pn] for x in ids)
        # military ordered onto a unit or building is an attack; villagers ordered onto things are working
        kind = 'a' if (not is_v and i.type in ('Order', 'Target') and task_of(i.param) == '') else ''
        if kind and i.param in BUILD_TIME:
            own = [bp for bt, bn, bp in builds_by_player.get(pn, []) if bn == i.param and dist(bp, pos) < 3.5]
            if own or (i.param == 'Town Center' and start.get(pn) and dist(start[pn], pos) < 3.5):
                kind = ''  # their own building: garrisoning, not attacking
        task = 'build' if i.type in ('Build', 'Wall', 'Repair') else task_of(i.param) if i.type in ('Gather', 'Target', 'Order') else ''
        if i.type == 'Build':
            bn = pl.get('building') or i.param or ''
            # villagers usually start working at what they just built
            task = {'Farm': 'food', 'Mill': 'food', 'Fish Trap': 'food', 'Lumber Camp': 'wood'}.get(bn, 'build')
            if bn == 'Mining Camp' and resources:
                near = min(resources, key=lambda r: dist((r[1], r[2]), pos))
                task = 'stone' if near[0] == 's' else 'gold'
        if i.type == 'Reseed':
            task = 'food'
        for oid in ids:
            u = units.get(oid)
            if u is None:
                u = units[oid] = new_unit(oid, pn, t, pos, is_v)
            o = u['orders']
            if o and t - o[-1][0] < 1.5 and dist((o[-1][1], o[-1][2]), pos) < 1:
                continue
            o.append([t, round(pos[0], 1), round(pos[1], 1), task, 1 if kind == 'a' else 0, (i.param or '') if kind == 'a' else ''])

    # walk each unit along its orders to get where it is when each order is given
    out = []
    for u in units.values():
        cls = UNIT_CLASS.get(u['type'], 'Unique units' if u['type'] != 'Military unit' else 'Militia line')
        v = SPEED.get(cls, 1.0)
        x, y, t0 = u['x'], u['y'], u['born']
        tx, ty = x, y
        way = []
        for (t, ox, oy, task, att, tgt) in u['orders']:
            # position reached by time t moving toward the previous target
            d = math.hypot(tx - x, ty - y)
            step = v * max(0.0, t - t0)
            if d > 0:
                f = min(1.0, step / d)
                x, y = x + (tx - x) * f, y + (ty - y) * f
            way.append([round(t, 1), round(x, 2), round(y, 2), ox, oy, task, att, tgt])
            tx, ty, t0 = ox, oy, t
        last = u['orders'][-1][0] if u['orders'] else u['born']
        ttl = 900 if cls == 'Villager' else 240
        end = min(u.get('dead', 1e9), last + ttl)
        out.append({'id': u['id'], 'p': u['p'], 'type': u['type'], 'cls': cls, 'spd': v, 'born': u['born'],
                    'x': round(u['x'], 2), 'y': round(u['y'], 2), 'end': round(end, 1), 'w': way})
    sites = []
    for pn, b in builds_by_player.items():
        for t, n, pos in b:
            sites.append({'p': pn, 'n': n, 't': secs(t), 'done': secs(t) + BUILD_TIME.get(n, 40), 'x': pos[0], 'y': pos[1]})
    return out, sites


if __name__ == '__main__':
    import sys, json
    r = parse_replay(sys.argv[1], match_id=sys.argv[2] if len(sys.argv) > 2 else 'sample')
    pb = r.pop('playback', None)
    print(json.dumps(r['players'], indent=1, default=str))
    if pb:
        rows = playback_rows(pb, r['build'], r['units'], 'sample', r['game']['map'])
        print('playback rows', len(rows), 'units', len(pb['tracks']), 'bytes', len(json.dumps(rows, separators=(',', ':'))))
