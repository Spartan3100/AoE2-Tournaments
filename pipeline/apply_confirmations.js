// Saves confirmed tournament games into config/matches.json.
//   node pipeline/apply_confirmations.js
// Uses the site's own calcs (site/js/calcs.js) and rules (site/js/confirm-logic.js), so a game counts here
// exactly when it counts on the site. Prints how many games were added; exits 0 either way.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p, d) => { try { const x = JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); return Array.isArray(x) ? x : (x.rows || x); } catch (e) { return d; } };

global.window = global;
const calcs = {};
global.dash = { calc: (id, def) => { calcs[id] = def; }, loader() {}, data: () => ({ status: 'loading', data: [] }), onData() {} };
require(path.join(ROOT, 'site/js/confirm-logic.js'));
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(ROOT, 'site/js/calcs.js'), 'utf8'));

async function main() {
  const cfg = read('config/supabase.json', {});
  if (!cfg.url || !cfg.anon_key) { console.log('Supabase not set up yet: nothing to apply'); return; }
  // the confirmations table is members-only, so the job reads it with the service key (a GitHub secret)
  const key = process.env.SUPABASE_SERVICE_KEY || cfg.anon_key;
  const res = await fetch(`${cfg.url.replace(/\/$/, '')}/rest/v1/confirmations?select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) { console.log(`Couldn't read confirmations: ${res.status} ${await res.text()}`); return; }
  const votes = TT_confirm.index(await res.json());

  const data = {
    history: read('data/history.json', []), tournaments: read('config/tournaments.json', []), roster: read('config/roster.json', []),
  };
  let matches = read('config/matches.json', []);
  const added = [];
  // apply, then work the bracket out again: a finished series puts its winner into the next round
  for (let round = 0; round < 12; round += 1) {
    const cache = { ...data, matches };
    const run = (id) => { if (!(id in cache)) cache[id] = calcs[id].fn(...calcs[id].inputs.map(run)); return cache[id]; };
    const out = TT_confirm.applyConfirmed(matches, run('t_suggest'), votes, data.tournaments);
    if (!out.applied.length) break;
    added.push(...out.applied);
    matches = out.rows;
  }
  if (added.length) {
    fs.writeFileSync(path.join(ROOT, 'config/matches.json'), JSON.stringify(matches, null, 1) + '\n');
    console.log(`Saved ${added.length} confirmed game(s): ${added.join(', ')}`);
  } else console.log('No newly confirmed games');
}

main().catch((e) => { console.log(`apply_confirmations: ${e.message}`); });
