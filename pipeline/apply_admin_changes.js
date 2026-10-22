// Saves organizer changes made on the site (new or edited tournaments and players) into config/*.json.
//   node pipeline/apply_admin_changes.js          read the Supabase table admin_changes and write config/
//   node pipeline/apply_admin_changes.js --clear  delete the changes the first call saved (run once they are
//                                                 committed and published, so the site never shows a gap)
// Uses the site's own rules (site/js/admin-logic.js), so a change looks the same here as on the site.
// Exits 0 either way: a failed read just leaves the changes for the next run.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DONE = path.join(ROOT, '_admin_applied.json');
const FILES = { players: 'config/players.json', tournaments: 'config/tournaments.json', roster: 'config/roster.json', matches: 'config/matches.json' };
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
require(path.join(ROOT, 'site/js/admin-logic.js'));

async function main() {
  const cfg = read('config/supabase.json');
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!cfg.url || !key) { console.log('Supabase not set up yet: no organizer changes to apply'); return; }
  const url = `${cfg.url.replace(/\/$/, '')}/rest/v1/admin_changes`;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  if (process.argv.includes('--clear')) {
    if (!fs.existsSync(DONE)) return;
    const ids = JSON.parse(fs.readFileSync(DONE, 'utf8')).filter((x) => Number.isInteger(x));
    if (!ids.length) return;
    const res = await fetch(`${url}?id=in.(${ids.join(',')})`, { method: 'DELETE', headers });
    console.log(res.ok ? `Cleared ${ids.length} saved organizer change(s)` : `Couldn't clear organizer changes: ${res.status} ${await res.text()}`);
    return;
  }

  const res = await fetch(`${url}?select=*&order=id`, { headers });
  if (!res.ok) { console.log(`Couldn't read organizer changes: ${res.status} ${await res.text()}`); return; }
  const changes = await res.json();
  if (!changes.length) { console.log('No organizer changes'); return; }
  const before = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
  const out = TT_admin.apply(before, changes);
  Object.entries(FILES).forEach(([k, p]) => {
    if (JSON.stringify(out[k]) !== JSON.stringify(before[k])) fs.writeFileSync(path.join(ROOT, p), JSON.stringify(out[k], null, 1) + '\n');
  });
  fs.writeFileSync(DONE, JSON.stringify(changes.map((c) => c.id)));
  console.log(`Saved ${out.applied.length} organizer change(s) into config/ (${changes.length - out.applied.length} ignored as invalid)`);
}

main().catch((e) => { console.log(`apply_admin_changes: ${e.message}`); });
