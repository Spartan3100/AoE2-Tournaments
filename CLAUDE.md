# Notes for Claude Code

Static site on GitHub Pages plus a GitHub Actions job. No build step and no server: what's in `site/` is what's served.

The site is invite-only: the workflow encrypts every JSON file in `config/` (except `supabase.json`) and `data/` with `pipeline/crypt.py` (AES-GCM over gzip, files end in `.enc`), and `site/js/backend.js` gets the key from Supabase table `site_secret` only for signed-in members (`supabase/schema.sql`). Never publish or commit unencrypted data.

## Layout
- `site/index.html` - all page markup (tabs are `<section class="tt-page" id="...">`).
- `site/css/app.css` - design tokens (light/dark) at the top, then the page styles (`.tt-*` classes).
- `site/js/dash.js` - data layer. `dash.data(id)` returns `{status, data}` for a dataset (file in `config/` or `data/`, see `FILES`), a derived dataset (`DERIVED`) or a calc. Also loads each player's newest games live from `https://data.aoe2companion.com/api/matches` (CORS is open) and merges them into `history`.
- `site/js/calcs.js` - `dash.calc(id, {inputs, fn})`: pure functions from datasets to rows (standings, bracket, profiles, head to head, t_suggest...). Also run in Node by `pipeline/apply_confirmations.js`, so keep them free of DOM/window use (apart from `window.TT_*` constants).
- `site/js/render.js` - draws every tab inside `dash.onData(draw)`. `site/js/viewer.js` is the map playback viewer.
- `site/js/backend.js` - sign-in screen, the signed-in role, the data key, confirmations and organizer changes, exposed as a small `window.claude.use('db'|'user')` shim that render.js calls (plus `window.TT_ORG` for admin.js). `site/js/confirm-logic.js` decides when a detected game counts (shared with the pipeline).
- `site/js/admin.js` - the Admin tab (organizers only): set up a tournament, civ pools, manage tournaments, people/roles. Tournament data changes (kinds `tournament`, `player`, `rules`, `civ_pool`) go to Supabase table `admin_changes`; `site/js/admin-logic.js` overlays them on `config/` in dash.js (so they show at once) and `pipeline/apply_admin_changes.js` writes them into `config/` each run, clearing them only after the deploy step. Roles (owner = `admins` email, else `members.role` + `scope`) live only in Supabase; every permission is enforced by the policies/functions in `supabase/schema.sql`, the UI only hides what you can't do. `mockups/admin-prototype.html` is the layout prototype (not served).
- `config/*.json` - tournament setup edited by humans. `config/matches.json` also receives confirmed results from the workflow.
- `seed/` - starting data for the first workflow run only. Live generated data is on the `data` branch (force-pushed each run); locally, copy `seed/` to `data/` to work.
- `pipeline/update.py` -> `run.py` (match history + replays via `mgz`, patched in `analyze.py` for new game versions) -> `validate.py` (writes data/data_check.json).

## Conventions
- Rows are plain JSON arrays of objects. History rows: one per tracked player per game (`player, match_id, started, type, map, civ, opp_civ, won, rating, players_n, ...`).
- `data/unrecorded.json` holds games that are not in win rates: `kind: no_result` (a disconnect: kept, never trimmed) and `kind: not_in_records` (found each run by `rating_gaps` in run.py from a rating jump between two games on the same ladder: Microsoft counted it but left it out of its match history). They count in game totals (`p_summary.unknown`) and show in the Games list.
- Never trim history (it is all-time). Never commit generated data to `main`.
- Text shown to players is plain English; set user-supplied strings with `textContent`.

## Test locally
```
export SITE_KEY=$(python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())")   # or SUPABASE_SERVICE_KEY
cp -r seed data
python -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python pipeline/update.py --max-replays 5
mkdir -p _site && cp -r site/. _site/ && python pipeline/crypt.py encrypt config _site/config --skip supabase.json && python pipeline/crypt.py encrypt data _site/data
# serving it needs a Supabase project (or a stub of window.supabase) that hands out the same key
```
