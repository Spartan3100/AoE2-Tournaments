-- AoE2 Tournaments: who can open the site (invites, roles), sign-in, "I'm", game confirmations and organizer changes.
-- Paste this whole file into Supabase > SQL Editor > New query, and click Run. Safe to run again.
--
-- Roles: an Owner (email in public.admins) can do everything. Everyone else who joined with an invite link is in
-- public.members with a role: 'organizer' (runs the tournaments in scope, or all of them when scope is null),
-- 'player' (in standings, confirms their own games) or 'viewer' (can open the site only).

-- Owners: whoever signs in with one of these emails. Add yourself at the end of this file.
create table if not exists public.admins (
  email text primary key
);

-- People allowed to open the site (they joined with an invite link). Owners are always allowed.
create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  invite_code text,
  added_at timestamptz not null default now()
);
alter table public.members add column if not exists role text not null default 'player' check (role in ('organizer', 'player', 'viewer'));
-- organizers only: the tournament_ids they run; null means every tournament
alter table public.members add column if not exists scope text[];

-- Invite links: each code works once, for 14 days, and gives the role it was made with.
create table if not exists public.invite_codes (
  code text primary key,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);
alter table public.invite_codes add column if not exists role text not null default 'player' check (role in ('organizer', 'player', 'viewer'));

-- The key the site's data files are encrypted with. Only members can read it.
create table if not exists public.site_secret (
  id int primary key default 1 check (id = 1),
  key text not null default encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64')
);
insert into public.site_secret (id) values (1) on conflict do nothing;

-- Which player each signed-in person is (one account per player).
create table if not exists public.players_claim (
  user_id uuid primary key references auth.users (id) on delete cascade,
  player text not null unique,
  created_at timestamptz not null default now()
);

-- One answer per game and side: side 'a' and 'b' are the two players, 'org' is an organizer.
create table if not exists public.confirmations (
  tournament_id text not null,
  match_id text not null,
  side text not null check (side in ('a', 'b', 'org')),
  player text not null,
  answer text not null check (answer in ('yes', 'no')),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  primary key (tournament_id, match_id, side)
);

-- Organizer changes made on the site (tournaments, players, rules, civ pools, results entered by hand). Everyone invited sees them
-- straight away; the update job saves them into config/ on GitHub and then clears them (site/js/admin-logic.js).
create table if not exists public.admin_changes (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and length(payload::text) < 20000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.admin_changes drop constraint if exists admin_changes_kind_check;
alter table public.admin_changes add constraint admin_changes_kind_check check (kind in ('tournament', 'player', 'rules', 'civ_pool', 'result'));

-- ---------------------------------------------------------------- who may do what
-- is_admin() means Owner (the name is kept because older policies and the site use it).
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.members where user_id = auth.uid());
$$;

-- Owner, or an organizer of any tournament
create or replace function public.is_organizer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.members where user_id = auth.uid() and role = 'organizer');
$$;

-- may run this tournament (change it, approve its games)
create or replace function public.can_run(p_tid text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.members where user_id = auth.uid() and role = 'organizer' and (scope is null or p_tid = any (scope))
  );
$$;

-- may run every tournament, which includes starting new ones
create or replace function public.can_run_all() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.members where user_id = auth.uid() and role = 'organizer' and scope is null);
$$;

-- the signed-in person's role, for the site: {"role": "owner"|"organizer"|"player"|"viewer", "scope": [...]|null}
create or replace function public.my_access() returns json
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then json_build_object('role', 'owner', 'scope', null)
    else (select json_build_object('role', role, 'scope', scope) from public.members where user_id = auth.uid()) end;
$$;

-- Organizer: make a new invite code (the site turns it into a link). Only the owner can invite organizers.
drop function if exists public.create_invite();
create or replace function public.create_invite(p_role text default 'player') returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_organizer() then raise exception 'Only organizers can invite people'; end if;
  if p_role not in ('organizer', 'player', 'viewer') then raise exception 'Unknown role: %', p_role; end if;
  if p_role = 'organizer' and not public.is_admin() then raise exception 'Only the owner can invite organizers'; end if;
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  insert into public.invite_codes (code, created_by, role) values (c, auth.uid(), p_role);
  return c;
end $$;

-- Invited person (signed in): use a code. Returns true when they can open the site.
create or replace function public.redeem_invite(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return false; end if;
  if public.is_member() then return true; end if;
  update public.invite_codes set used_by = auth.uid(), used_at = now()
    where code = p_code and used_by is null and expires_at > now()
    returning role into r;
  if not found then return false; end if;
  -- a new organizer runs no tournament until the owner picks some
  insert into public.members (user_id, invite_code, role, scope)
    values (auth.uid(), p_code, r, case when r = 'organizer' then '{}'::text[] end) on conflict do nothing;
  return true;
end $$;

-- Organizer: links that haven't been used yet.
create or replace function public.invites_list() returns table (code text, role text, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_organizer() then return; end if;
  return query select i.code, i.role, i.created_at, i.expires_at from public.invite_codes i
    where i.used_by is null and i.expires_at > now() order by i.created_at desc;
end $$;

create or replace function public.cancel_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_organizer() then raise exception 'Only organizers can cancel invites'; end if;
  delete from public.invite_codes where code = p_code and used_by is null;
end $$;

-- Organizer: everyone who can open the site (owners first), with their role and the player they chose.
-- Only the owner sees email addresses.
drop function if exists public.members_list();
create or replace function public.members_list()
returns table (user_id uuid, player text, name text, email text, role text, scope text[], added_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare own boolean := public.is_admin();
begin
  if not public.is_organizer() then return; end if;
  return query
    select u.id, c.player,
      coalesce(u.raw_user_meta_data -> 'custom_claims' ->> 'global_name', u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')::text,
      case when own then u.email::text end, 'owner'::text, null::text[], u.created_at
    from auth.users u
    join public.admins a on lower(a.email) = lower(u.email)
    left join public.players_claim c on c.user_id = u.id
    union all
    select m.user_id, c.player,
      coalesce(u.raw_user_meta_data -> 'custom_claims' ->> 'global_name', u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')::text,
      case when own then u.email::text end, m.role, m.scope, m.added_at
    from public.members m
    left join auth.users u on u.id = m.user_id
    left join public.players_claim c on c.user_id = m.user_id
    where not exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(u.email, '')))
    order by 7;
end $$;

-- Owner: change someone's role. p_scope is for organizers: the tournament_ids they run, or null for all.
create or replace function public.set_member_role(p_user uuid, p_role text, p_scope text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the owner can change roles'; end if;
  if p_role not in ('organizer', 'player', 'viewer') then raise exception 'Unknown role: %', p_role; end if;
  update public.members set role = p_role, scope = case when p_role = 'organizer' then p_scope end where user_id = p_user;
  if not found then raise exception 'That person isn''t a member, so their role can''t be changed here'; end if;
  if p_role = 'viewer' then delete from public.players_claim where user_id = p_user; end if;
end $$;

-- Owner: remove someone (they lose access and their "I'm" choice).
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the owner can remove people'; end if;
  delete from public.players_claim where user_id = p_user;
  delete from public.members where user_id = p_user;
end $$;

grant execute on function public.is_admin(), public.is_member(), public.is_organizer(), public.can_run(text), public.can_run_all(),
  public.my_access(), public.create_invite(text), public.redeem_invite(text), public.invites_list(), public.cancel_invite(text),
  public.members_list(), public.set_member_role(uuid, text, text[]), public.remove_member(uuid) to authenticated;

-- ---------------------------------------------------------------- table rules
alter table public.admins enable row level security;
alter table public.members enable row level security;
alter table public.invite_codes enable row level security;
alter table public.site_secret enable row level security;
alter table public.players_claim enable row level security;
alter table public.confirmations enable row level security;
alter table public.admin_changes enable row level security;

-- Only members can read the data key, who is who, the answers and pending changes. (The update job uses the service key.)
drop policy if exists "members read the key" on public.site_secret;
create policy "members read the key" on public.site_secret for select to authenticated using (public.is_member());
drop policy if exists "see yourself" on public.members;
create policy "see yourself" on public.members for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "organizers see invites" on public.invite_codes;
create policy "organizers see invites" on public.invite_codes for select to authenticated using (public.is_organizer());

drop policy if exists "read claims" on public.players_claim;
create policy "read claims" on public.players_claim for select to authenticated using (public.is_member());
drop policy if exists "read confirmations" on public.confirmations;
create policy "read confirmations" on public.confirmations for select to authenticated using (public.is_member());

-- Members (not viewers) can set, change or remove which player they are; the owner can remove anyone's.
drop policy if exists "claim yourself" on public.players_claim;
create policy "claim yourself" on public.players_claim for insert to authenticated with check (
  user_id = auth.uid() and public.is_member()
  and not exists (select 1 from public.members m where m.user_id = auth.uid() and m.role = 'viewer')
);
drop policy if exists "change your claim" on public.players_claim;
create policy "change your claim" on public.players_claim for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid() and public.is_member()
  and not exists (select 1 from public.members m where m.user_id = auth.uid() and m.role = 'viewer')
);
drop policy if exists "remove a claim" on public.players_claim;
create policy "remove a claim" on public.players_claim for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- Players answer for themselves only; an organizer of that tournament answers as 'org'.
drop policy if exists "answer" on public.confirmations;
create policy "answer" on public.confirmations for insert to authenticated with check (
  user_id = auth.uid() and public.is_member() and (
    (side = 'org' and public.can_run(tournament_id))
    or (side in ('a', 'b') and exists (select 1 from public.players_claim c where c.user_id = auth.uid() and c.player = confirmations.player))
  )
);
drop policy if exists "change answer" on public.confirmations;
create policy "change answer" on public.confirmations for update to authenticated using (
  (side = 'org' and public.can_run(tournament_id))
  or (side in ('a', 'b') and exists (select 1 from public.players_claim c where c.user_id = auth.uid() and c.player = confirmations.player))
) with check (
  user_id = auth.uid() and public.is_member() and (
    (side = 'org' and public.can_run(tournament_id))
    or (side in ('a', 'b') and exists (select 1 from public.players_claim c where c.user_id = auth.uid() and c.player = confirmations.player))
  )
);

-- Organizers change the tournaments they run (organizers of every tournament can also start new ones), and any
-- organizer can add or change players. They can undo their own changes; the owner can undo anyone's.
drop policy if exists "read changes" on public.admin_changes;
create policy "read changes" on public.admin_changes for select to authenticated using (public.is_member());
drop policy if exists "organizers add changes" on public.admin_changes;
create policy "organizers add changes" on public.admin_changes for insert to authenticated with check (
  created_by = auth.uid() and (
    (kind = 'player' and public.is_organizer())
    or (kind in ('tournament', 'rules', 'civ_pool', 'result') and (public.can_run(payload ->> 'tournament_id') or public.can_run_all()))
  )
);
drop policy if exists "organizers cancel changes" on public.admin_changes;
create policy "organizers cancel changes" on public.admin_changes for delete to authenticated using (
  public.is_organizer() and (created_by = auth.uid() or public.is_admin())
);

-- ---------------------------------------------------------------- replays added on the site
-- For games Microsoft has no replay of, or left out of its match history: a member (not a viewer) adds their own copy
-- of the replay. The file goes to the private storage bucket "replays", in a folder named after the person who added
-- it; the update job (pipeline/uploads.py, with the service key) reads it, checks it is that game, analyses it and
-- sets status to 'done' or 'rejected' with the reason in message.
create table if not exists public.replay_uploads (
  id bigint generated always as identity primary key,
  match_id text not null check (length(match_id) <= 80),
  player text not null check (length(player) <= 40),
  -- for a game missing from Microsoft's history: what the site knows about it (time window, rating change)
  game jsonb not null default '{}'::jsonb check (jsonb_typeof(game) = 'object' and length(game::text) < 2000),
  path text not null check (length(path) <= 200),
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'waiting' check (status in ('waiting', 'done', 'rejected')),
  message text not null default ''
);
alter table public.replay_uploads enable row level security;

-- a member who is not a viewer
create or replace function public.can_add_replays() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.members where user_id = auth.uid() and role <> 'viewer');
$$;
grant execute on function public.can_add_replays() to authenticated;

drop policy if exists "read added replays" on public.replay_uploads;
create policy "read added replays" on public.replay_uploads for select to authenticated using (public.is_member());
drop policy if exists "add a replay" on public.replay_uploads;
create policy "add a replay" on public.replay_uploads for insert to authenticated with check (
  uploaded_by = auth.uid() and status = 'waiting' and message = '' and public.can_add_replays()
  and path like auth.uid()::text || '/%'
);
drop policy if exists "take back a replay" on public.replay_uploads;
create policy "take back a replay" on public.replay_uploads for delete to authenticated using (
  (uploaded_by = auth.uid() and status <> 'done') or public.is_admin()
);

insert into storage.buckets (id, name, public, file_size_limit)
values ('replays', 'replays', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
drop policy if exists "add replay files" on storage.objects;
create policy "add replay files" on storage.objects for insert to authenticated with check (
  bucket_id = 'replays' and (storage.foldername(name))[1] = auth.uid()::text and public.can_add_replays()
);
-- (removing a file also needs to see it)
drop policy if exists "see own replay files" on storage.objects;
create policy "see own replay files" on storage.objects for select to authenticated using (
  bucket_id = 'replays' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "remove own replay files" on storage.objects;
create policy "remove own replay files" on storage.objects for delete to authenticated using (
  bucket_id = 'replays' and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------- "Sync now"
-- A player or organizer can start the update job (new games, replays, the site) without waiting for the next half
-- hour. The site calls request_sync(); it asks GitHub to run .github/workflows/update.yml, using a GitHub token kept
-- in Supabase Vault (never in the site). One sync at most every 5 minutes, for everyone together.
-- Setup, once (the owner): see README "Sync now". In short: make a fine-grained GitHub token for this repository with
-- "Actions: Read and write", then run, with the token pasted in place of the placeholder:
--   select vault.create_secret('github_pat_...', 'github_sync_token');
-- (to replace it later: select vault.update_secret((select id from vault.secrets where name = 'github_sync_token'), 'github_pat_...');)
create extension if not exists pg_net;
create table if not exists public.sync_requests (
  id bigint generated always as identity primary key,
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  net_id bigint
);
alter table public.sync_requests enable row level security;
drop policy if exists "read syncs" on public.sync_requests;
create policy "read syncs" on public.sync_requests for select to authenticated using (public.is_member());

create or replace function public.request_sync() returns json
language plpgsql security definer set search_path = public, extensions as $$
declare last timestamptz; tok text; rid bigint;
begin
  if not public.can_add_replays() then raise exception 'Players and organizers can start a sync'; end if;
  select max(requested_at) into last from public.sync_requests;
  if last > now() - interval '5 minutes' then
    return json_build_object('ok', false, 'at', last, 'message', 'A sync was started less than 5 minutes ago. It''s running now.');
  end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_sync_token';
  if tok is null then raise exception 'Sync isn''t set up yet: the owner needs to add the GitHub token (README, "Sync now")'; end if;
  select net.http_post(
    url := 'https://api.github.com/repos/Spartan3100/AoE2-Tournaments/actions/workflows/update.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'aoe2-tournaments', 'Content-Type', 'application/json')
  ) into rid;
  insert into public.sync_requests (requested_by, net_id) values (auth.uid(), rid);
  return json_build_object('ok', true, 'at', now());
end $$;

-- what GitHub answered to the latest request (204 = started; 401/403/404 = the token is wrong or lacks Actions access)
create or replace function public.sync_status() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare r record; code int; msg text;
begin
  if not public.is_member() then return null; end if;
  select * into r from public.sync_requests order by id desc limit 1;
  if r is null then return json_build_object('at', null); end if;
  select status_code, coalesce(error_msg, left(content, 200)) into code, msg from net._http_response where id = r.net_id;
  return json_build_object('at', r.requested_at, 'code', code, 'message', msg);
end $$;
grant execute on function public.request_sync(), public.sync_status() to authenticated;

-- Last step: make yourself the owner. Replace the address with the email on the account you'll sign in with
-- (for Discord, your Discord account's email), then run just this line.
-- insert into public.admins (email) values ('you@example.com') on conflict do nothing;
