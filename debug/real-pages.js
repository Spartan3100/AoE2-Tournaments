// TEMPORARY: load every page, and Players > Profiles / Compare for every player x view x period, on the real data.
// Prints only page errors and counts (logs are public).
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const errs = new Map();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => { const k = String(e).slice(0, 160); errs.set(k, (errs.get(k) || 0) + 1); });
  await p.route('**/vendor/supabase.js', (r) => r.fulfill({ path: path.join(__dirname, 'stub.js'), contentType: 'text/javascript' }));
  await p.route('https://data.aoe2companion.com/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"matches":[]}' }));
  await p.goto('http://127.0.0.1:8000/'); await p.evaluate(() => { localStorage.setItem('stubrole', 'owner'); });
  for (const tab of ['home', 'standings', 'playoffs', 'schedule', 'civs-maps', 'format', 'all', 'profiles', 'rivals', 'review', 'check', 'admin']) {
    await p.goto(`http://127.0.0.1:8000/#${tab}`); await p.reload(); await p.waitForTimeout(4000);
    console.log(tab, 'svgs', await p.$$eval('svg', (x) => x.length));
  }
  const names = await p.evaluate(() => dash.data('players').data.map((r) => r.player));
  let n = 0;
  for (const pl of names) for (const ps of ['All games', 'Ranked 1v1', 'Ranked team', 'Unranked & other', 'Tournament']) for (const pr of ['', 'Last year', 'Last 6 months']) {
    await p.evaluate(([pl, ps, pr]) => dash.setParams({ pp: pl, ps, pr: pr || null }), [pl, ps, pr]); await p.waitForTimeout(150); n += 1;
  }
  await p.goto('http://127.0.0.1:8000/#profiles'); await p.reload(); await p.waitForTimeout(3000);
  for (const pl of names) for (const ps of ['All games', 'Ranked 1v1', 'Ranked team', 'Unranked & other', 'Tournament']) for (const pr of ['', 'Last year', 'Last 6 months']) {
    await p.evaluate(([pl, ps, pr]) => dash.setParams({ pp: pl, ps, pr: pr || null }), [pl, ps, pr]); await p.waitForTimeout(250);
  }
  console.log('profile combos', names.length * 15, 'sections with charts', await p.$$eval('#profiles svg', (x) => x.length));
  await p.goto('http://127.0.0.1:8000/#rivals'); await p.reload(); await p.waitForTimeout(3000);
  for (const a of names) for (const bb of names) if (a !== bb) for (const hp of ['', 'Last year', 'Last 6 months']) {
    await p.evaluate(([a, bb, hp]) => dash.setParams({ ha: a, hb: bb, hp: hp || null }), [a, bb, hp]); await p.waitForTimeout(250);
  }
  console.log('compare pairs', names.length * (names.length - 1) * 3, 'rows in everyone table', await p.$$eval('#cmp-all-body tr', (x) => x.length));
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.route('**/vendor/supabase.js', (r) => r.fulfill({ path: path.join(__dirname, 'stub.js'), contentType: 'text/javascript' }));
  await m.route('https://data.aoe2companion.com/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"matches":[]}' }));
  for (const tab of ['profiles', 'rivals']) { await m.goto(`http://127.0.0.1:8000/#${tab}`); await m.reload(); await m.waitForTimeout(4000); console.log('phone', tab, 'sideways scroll', await m.evaluate(() => document.documentElement.scrollWidth > innerWidth)); }
  console.log('page errors:', errs.size ? [...errs].map(([k, v]) => `${v}x ${k}`).join('\n') : 'none');
  await b.close();
})();
