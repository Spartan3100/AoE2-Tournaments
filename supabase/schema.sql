-- AoE2 Tournaments: who can open the site (invites), sign-in, "I'm", and game confirmations.
-- Paste this whole file into Supabase > SQL Editor > New query, and click Run. Safe to run again.

-- Organizers: whoever signs in with one of these emails can invite people, approve or reject games,
-- and free up player names. Add yourself at the end of this file.
create table if not exists public.admins (
  email text primary key
);

-- People allowed to open the site (they joined with an invite link). Organizers are always allowed.
create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  invite_code text,
  added_at timestamptz not null default now()
);

-- Invite links: each code works once, for 14 days.
create table if not exists public.invite_codes (
  code text primary key,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);

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

-- One answer per game and side: side 'a' and 'b' are the two players, 'org' is the organizer.
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

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.members where user_id = auth.uid());
$$;

-- Organizer: make a new invite code (the site turns it into a link).
create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_admin() then raise exception 'Only organizers can invite people'; end if;
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  insert into public.invite_codes (code, created_by) values (c, auth.uid());
  return c;
end $$;

-- Invited person (signed in): use a code. Returns true when they can open the site.
create or replace function public.redeem_invite(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if public.is_member() then return true; end if;
  update public.invite_codes set used_by = auth.uid(), used_at = now()
    where code = p_code and used_by is null and expires_at > now();
  if not found then return false; end if;
  insert into public.members (user_id, invite_code) values (auth.uid(), p_code) on conflict do nothing;
  return true;
end $$;

-- Organizer: everyone who can open the site, with the player they chose.
create or replace function public.members_list() returns table (user_id uuid, player text, email text, added_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select m.user_id, c.player, u.email::text, m.added_at
    from public.members m
    left join public.players_claim c on c.user_id = m.user_id
    left join auth.users u on u.id = m.user_id
    order by m.added_at;
end $$;

-- Organizer: remove someone (they lose access and their "I'm" choice).
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only organizers can remove people'; end if;
  delete from public.players_claim where user_id = p_user;
  delete from public.members where user_id = p_user;
end $$;

grant execute on function public.is_admin(), public.is_member(), public.create_invite(), public.redeem_invite(text),
  public.members_list(), public.remove_member(uuid) to authenticated;

alter table public.admins enable row level security;
alter table public.members enable row level security;
alter table public.invite_codes enable row level security;
alter table public.site_secret enable row level security;
alter table public.players_claim enable row level security;
alter table public.confirmations enable row level security;

-- Only members can read the data key, who is who, and the answers. (The update job uses the service key.)
drop policy if exists "members read the key" on public.site_secret;
create policy "members read the key" on public.site_secret for select to authenticated using (public.is_member());
drop policy if exists "see yourself" on public.members;
create policy "see yourself" on public.members for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "organizers see invites" on public.invite_codes;
create policy "organizers see invites" on public.invite_codes for select to authenticated using (public.is_admin());

drop policy if exists "read claims" on public.players_claim;
create policy "read claims" on public.players_claim for select to authenticated using (public.is_member());
drop policy if exists "read confirmations" on public.confirmations;
create policy "read confirmations" on public.confirmations for select to authenticated using (public.is_member());

-- Members can set, change or remove which player they are; organizers can remove anyone's.
drop policy if exists "claim yourself" on public.players_claim;
create policy "claim yourself" on public.players_claim for insert to authenticated with check (user_id = auth.uid() and public.is_member());
drop policy if exists "change your claim" on public.players_claim;
create policy "change your claim" on public.players_claim for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists "remove a claim" on public.players_claim;
create policy "remove a claim" on public.players_claim for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- Players answer for themselves only; the organizer answers as 'org'.
drop policy if exists "answer" on public.confirmations;
create policy "answer" on public.confirmations for insert to authenticated with check (
  user_id = auth.uid() and public.is_member() and (
    (side = 'org' and public.is_admin())
    or (side in ('a', 'b') and exists (select 1 from public.players_claim c where c.user_id = auth.uid() and c.player = confirmations.player))
  )
);
drop policy if exists "change answer" on public.confirmations;
create policy "change answer" on public.confirmations for update to authenticated using (
  (side = 'org' and public.is_admin())
  or (side in ('a', 'b') and exists (select 1 from public.players_claim c where c.user_id = auth.uid() and c.player = confirmations.player))
) with check (
  user_id = auth.uid() and public.is_member() and (
    (side = 'org' and public.is_admin())
    or (side in ('a', 'b') and exists (select 1 from public.players_claim c where c.user_id = auth.uid() and c.player = confirmations.player))
  )
);

-- Last step: make yourself an organizer. Replace the address with the email on the account you'll sign in with
-- (for Discord, your Discord account's email), then run just this line.
-- insert into public.admins (email) values ('you@example.com') on conflict do nothing;
