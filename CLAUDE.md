# Notes for Claude Code

Static site on GitHub Pages plus a GitHub Actions job. No build step and no server: what's in `site/` is what's served.

The site is invite-only: the workflow encrypts every JSON file in `config/` (except `supabase.json`) and `data/` with `pipeline/crypt.py` (AES-GCM over gzip, files end in `.enc`), and `site/js/backend.js` gets the key from Supabase table `site_secret` only for signed-in members (`supabase/schema.sql`). Never publish or commit unencrypted data.

## Layout
- `site/index.html` - all page markup (pages are `<section class="tt-page" id="...">`). Main sections Home · Tournament · Players · Games · Admin (`data-section` buttons in the header, and the phone bottom bar with Upload in the middle); a section's pages are the `.tt-tabs` buttons with `data-in` = that section (render.js `show()` remembers the last page per section). Head to head is Players → Compare. Installable as a phone app: `manifest.webmanifest` + `icons/`.
- Looks: Classic AoE (default, `:root` tokens in app.css), Clean & light and Dark & gold (`html[data-theme]`); picked in the account menu (render.js `setTheme`), kept in localStorage and the account's Supabase user metadata (backend.js `saveTheme`), so it follows the person to every device they sign in on.
- `site/css/app.css` - design tokens (light/dark) at the top, then the page styles (`.tt-*` classes).
- `site/js/dash.js` - data layer. `dash.data(id)` returns `{status, data}` for a dataset (file in `config/` or `data/`, see `FILES`), a derived dataset (`DERIVED`) or a calc. Also loads each player's newest games live from `https://data.aoe2companion.com/api/matches` (CORS is open) and merges them into `history`.
- `site/js/calcs.js` - `dash.calc(id, {inputs, fn})`: pure functions from datasets to rows (standings, bracket, profiles, head to head, t_suggest...). Also run in Node by `pipeline/apply_confirmations.js`, so keep them free of DOM/window use (apart from `window.TT_*` constants).
- `site/js/render.js` - draws every tab inside `dash.onData(draw)`. `site/js/viewer.js` is the map playback viewer.
- Players pages: `site/js/profile.js` (`TT_PROFILE.draw`, called by render.js `drawProfiles`: scoreboard, rating area, civs table, maps overall/by month, matchups with show-all, length + 7x24 hour heatmap in local time, openings donut, recent form, team games, then Deeper analysis) and `site/js/compare.js` (`TT_COMPARE.draw`, from `drawRivals`: A against everyone, then the A vs B page with 1v1, side by side, both rating lines, when they meet, team games as mates and opponents, and a scouting report on B with build orders). Charts are inline SVG from `site/js/charts.js` (`TT_CHARTS`, tooltips on hover and tap; compare.js has its own small helpers). Each page has its own CSS (`css/profile.css`, `css/compare.css`), tokens only.
- Sync now (Home banner + account menu, render.js `syncNow`): Supabase `request_sync()` (schema.sql) posts a workflow_dispatch for update.yml through pg_net with a GitHub token from Vault (`github_sync_token`), at most once per 5 minutes; the page then follows the run on GitHub's public API and offers a reload. `sync_status()` reports GitHub's answer (401/403/404 = token problem).
- Live now (Home): dash.js `TT_LIVE.ongoing` holds games a tracked player is in right now (from the same AoE2 Companion fetch: no finish time, started under 3 hours ago; polled every minute while any are on). render.js `drawLive` lists them with a "Spectate in AoE2" link, `aoe2de://1/<match id>` (the game's own spectate link), flags a 1v1 between two players with an open tournament game between them, and puts a dot on the Home tab.
- `site/js/backend.js` - sign-in screen, the signed-in role, the data key, confirmations and organizer changes, exposed as a small `window.claude.use('db'|'user')` shim that render.js calls (plus `window.TT_ORG` for admin.js). `site/js/confirm-logic.js` decides when a detected game counts (shared with the pipeline).
- `site/js/admin.js` - the Admin tab (organizers only): set up a tournament, civ pools, manage tournaments, people/roles. Tournament data changes (kinds `tournament`, `player`, `rules`, `civ_pool`, and `result`: a game's result entered by hand in Manage > Schedule, for a game Microsoft has no record of or to correct one; a playoff game entered by hand carries `entered_id` so it is added once) go to Supabase table `admin_changes`; `site/js/admin-logic.js` overlays them on `config/` in dash.js (so they show at once) and `pipeline/apply_admin_changes.js` writes them into `config/` each run, clearing them only after the deploy step. Roles (owner = `admins` email, else `members.role` + `scope`) live only in Supabase; every permission is enforced by the policies/functions in `supabase/schema.sql`, the UI only hides what you can't do. `mockups/admin-prototype.html` is the layout prototype (not served).
- `config/*.json` - tournament setup edited by humans. `config/matches.json` also receives confirmed results from the workflow.
- `seed/` - starting data for the first workflow run only. Live generated data is on the `data` branch (force-pushed each run); locally, copy `seed/` to `data/` to work.
- `pipeline/update.py` -> `run.py` (match history + replays via `mgz`, patched in `analyze.py` for new game versions) -> `validate.py` (writes data/data_check.json).
- Added replays: Games offers "Add replay" for a game with no replay or missing from Microsoft's history (render.js `drawAdd`, backend.js `TT_UPLOAD`). Files go to the private Supabase bucket `replays`, rows to `replay_uploads`; `pipeline/uploads.py fetch` hands waiting ones to run.py, whose `check_upload` checks the player is in the replay and the time fits (a missing game must be one `rating_gaps` found, never the site's copy of it) and adds it as history row `up_<id>`; `uploads.py mark` records done/rejected after deploy. "Your replay folder" (Match review, `site/js/replay-folder.js` + render.js `drawFolder`): the player links AoE2's savegame folder once (File System Access API, Chrome/Edge; the handle is kept in IndexedDB); each visit it matches `.aoe2record` files to their games without a replay by the file's last-write time (= when the game ended) and adds them through `TT_UPLOAD`, never the same file for the same game twice.

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
