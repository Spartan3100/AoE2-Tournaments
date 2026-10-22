# AoE2 Tournaments

Tournament standings, player profiles, head to head, replay analysis and map playback for our group, updated automatically. The code is public; **the site itself only opens for people the organizer invites.**

- **Invite-only:** visitors sign in with Discord. Only organizers and people who joined with an invite link get in. Everyone else sees a sign-in screen. The site's data files are encrypted, so they can't be read by fetching them directly either.
- **Live games:** every time someone opens the site, it loads each player's newest games straight from [AoE2 Companion](https://www.aoe2companion.com).
- **Every 30 minutes**, GitHub runs the update job (`pipeline/`): new games for the all-time history, new replays read (strategies, map playback), confirmed tournament games saved, data re-checked. It runs free on public repositories, with no approvals and nothing to keep running.
- **Confirmations:** players say who they are under "I'm" and confirm their tournament games.

## One-time setup (about 30 minutes)

You'll use three free accounts: GitHub (hosting), Supabase (sign-in and invites) and Discord (the sign-in button).

### 1. Put the code on GitHub

1. Sign in to GitHub. Actions are free and unlimited for **public** repositories, so an account that's used up its monthly minutes on private repos still works.
2. **+** (top right) > **New repository**. Name it `aoe2-tournaments`, choose **Public**, leave "Add a README" **unticked**, and click **Create repository**.
3. Click **uploading an existing file**. Unzip `aoe2-tournaments.zip`, select **everything inside the unzipped folder** (including the `.github` folder) and drag it onto the page. Click **Commit changes**.
   - On a Mac, press **Cmd + Shift + .** in Finder to see the `.github` folder.
   - Check that the repository now shows a `.github` folder. If not: **Add file > Create new file**, name it `.github/workflows/update.yml`, paste that file's contents from the zip and commit.
4. **Settings > Pages**: under **Build and deployment > Source**, choose **GitHub Actions**.

Your site's address will be **https://YOUR-GITHUB-NAME.github.io/aoe2-tournaments/** (needed below). It won't publish anything until step 4 is done, so nothing is ever public by accident. The first runs will fail with "Finish setup first", which is expected.

### 2. Create the database (Supabase)

1. Go to [supabase.com](https://supabase.com), sign up and create a **New project** (any name, a strong database password, the region nearest you). Wait about two minutes.
2. **SQL Editor > New query.** Paste all of `supabase/schema.sql` and click **Run**.
3. Make yourself the owner. In a new query, run this with your **Discord account's email**:
   `insert into public.admins (email) values ('you@example.com') on conflict do nothing;`
   (Everyone else gets their role on the site: **Admin** tab > **People**.)

### 3. Turn on "Sign in with Discord"

1. In Supabase: **Authentication > Sign In / Providers > Discord**. Turn it on and copy the **Callback URL** shown there.
2. Open the [Discord Developer Portal](https://discord.com/developers/applications) > **New Application** (name it "AoE2 Tournaments"). In **OAuth2**, click **Add Redirect**, paste the Callback URL and **Save Changes**. Copy the **Client ID**; click **Reset Secret** and copy the **Client Secret**.
3. Back in Supabase, paste both into the Discord provider and **Save**.
4. **Authentication > URL Configuration**: set **Site URL** to your site's address and add the same address under **Redirect URLs**.

### 4. Connect GitHub to the database

1. In Supabase: **Project Settings > API Keys** (or **API**). You need the **Project URL**, the **anon / publishable** key and the **service_role / secret** key.
2. In GitHub, open `config/supabase.json`, click the pencil, fill in `url` and `anon_key` (the public one) and **Commit changes**.
3. In GitHub: **Settings > Secrets and variables > Actions > New repository secret**. Name: `SUPABASE_SERVICE_KEY`, value: the **service_role** key. (This one is secret: only ever put it here, never in a file.)
4. **Actions** tab > **Update and publish** > **Run workflow**. The first run takes 15 to 30 minutes: it downloads everyone's full match history and reads the last 60 days of replays. After that, runs take a few minutes.

### 5. Invite your friends

1. Open the site and **Sign in with Discord**. As the owner, you're let straight in. Choose yourself under **I'm**.
2. **Admin** tab > **People** > **Invite someone**: pick the role they join with (player, viewer or organizer) and **Create invite link**. Send that link to one friend (each link works once, for 14 days). Repeat for each friend.
3. They open the link, sign in with Discord, choose themselves under **I'm** (viewers don't), and they're in for good on that account.

**Roles** (Admin > People, owner only):
- **Owner:** everything, including roles. Set by the `admins` table in Supabase (step 2.3).
- **Organizer:** runs the tournaments you give them, or every tournament (only those can start new ones): settings, players, civ pools, rules, approving games, inviting players and viewers.
- **Player:** chooses who they are under "I'm" and confirms their own games.
- **Viewer:** can open the site and follow along.

To remove someone: same page, **Remove**. They can't open the site any more. To also make sure any data they saved in their browser stops working, change the key: in Supabase run `update public.site_secret set key = encode(decode(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),'hex'),'base64');` and then run the workflow.

*Email links instead of Discord:* Supabase's built-in email only reaches members of your Supabase organization, so email sign-in needs your own mail server: **Authentication > Emails > SMTP Settings** (for example Gmail: host `smtp.gmail.com`, port 587, your address and an [app password](https://myaccount.google.com/apppasswords)). Then set `"email": true` in `config/supabase.json`.

## What is and isn't private

- **Private (encrypted; only signed-in invited people can read it):** everything the site shows, including match history, stats, replay analysis, playback and the tournament data as published on the site. The data on the `data` branch is encrypted the same way.
- **Public:** the code, and the tournament setup files in `config/` in this repository (player names, Steam names and profile IDs, the schedule and rules), because organizers edit them here. Match data is also public on AoE2 Companion itself.

## Running the tournament

**On the site:** the **Admin** tab (organizers only) has four pages:
- **Set up a tournament:** name, dates, players, format (round robin with or without playoffs), playoff size and series length, how maps are picked, civ pools (pick them yourself, random, balanced random, same for everyone, or copied from another tournament) and rules. The rules are written from those settings; edit any line. The summary on the right shows players, games and the bracket as you go.
- **Civ pools:** one player at a time on a grid of every civ, filterable by style, with presets.
- **Manage tournaments:** pick a tournament on the left: games waiting for approval, status, settings, players (adding one after games are played adds their games; removing one drops their unplayed games), schedule, civ pools, rules and who runs it.
- **People:** invites, roles, and which tournaments each organizer runs.

Everyone invited sees a change straight away; the next update writes it into `config/` on GitHub and it leaves the "waiting" list. **Undo** takes back a change that hasn't been written yet.

*Already set up before the Admin tab was added?* Run all of `supabase/schema.sql` again in the Supabase SQL Editor. It's safe to run again: everyone who already joined becomes a player, and you stay the owner.

Everything also lives in `config/` and is edited on GitHub (pencil icon), or by asking Claude Code to do it:

| File | What it holds |
|---|---|
| `players.json` | Each player's name, Steam name and AoE2 profile ID (a new player's full history is fetched on the next update) |
| `tournaments.json` | Tournaments: status (Active, Upcoming, Completed), dates, format, best of, how many advance |
| `roster.json` | Who is in which tournament |
| `matches.json` | The game schedule. Confirmed results are filled in automatically. |
| `rules.json`, `civ_pool.json` | Rules text and civ pools |
| `app.json` | The Windows app's current version (for update notices) |
| `supabase.json` | The database address and public key (not secret) |

- **A tournament game is detected** when two players in an active tournament play an online 1v1 that fills an open game in `matches.json` (or the next game of their playoff series). It appears on the Home tab.
- **It counts** once both players confirm it, or an organizer of that tournament approves it. The site shows it straight away, and the next update saves it into `config/matches.json`.
- **Fixing a result:** edit that game in `config/matches.json`.
- **Someone chose the wrong name under "I'm":** Supabase > **Table Editor > players_claim**, delete the row.

## How it works

```
site/        the website (index.html, js/, css/), served by GitHub Pages
config/      tournament setup, edited by the organizers
seed/        empty starting data for the very first run
pipeline/    update.py (games, replays, checks), apply_admin_changes.js, apply_confirmations.js, crypt.py (encryption)
supabase/    schema.sql: invites, sign-in, confirmations, organizer changes, and who may read what
.github/     the workflow that runs everything every 30 minutes
```

- **Run an update now:** Actions > Update and publish > Run workflow.
- **If updates stop:** the site's banner turns red after 12 hours; check the Actions tab for a failed run. GitHub also pauses scheduled runs after 60 days without a commit; the workflow commits once a month to prevent that.
- **Supabase free projects** pause after a week without use. The update job uses the database every 30 minutes, which keeps it awake.
