-- Bitácora: tables and access rules. Run it once in Supabase → SQL Editor.
-- Anyone can read the dives (the landing shows them); only admins can add or delete them.

create table if not exists public.dives (
  id         text primary key,              -- Pro Dive's id for the dive
  start_at   timestamptz not null,
  data       jsonb not null,                -- the parsed dive, as the web uses it
  created_at timestamptz not null default now()
);
-- the same dive exported by another app gets another id: also refuse two dives starting the same minute
create unique index if not exists dives_start_minute on public.dives (date_trunc('minute', start_at at time zone 'utc'));

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;   -- no policies: not readable from the web

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.dives enable row level security;
drop policy if exists "dives are public" on public.dives;
drop policy if exists "admins add dives" on public.dives;
drop policy if exists "admins change dives" on public.dives;
drop policy if exists "admins delete dives" on public.dives;
create policy "dives are public"    on public.dives for select using (true);
create policy "admins add dives"    on public.dives for insert to authenticated with check (public.is_admin());
create policy "admins change dives" on public.dives for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete dives" on public.dives for delete to authenticated using (public.is_admin());

-- for the settings set from the admin (hidden dives, SAC, statistics), also run migrations/002_ajustes.sql

-- make the API see the new tables straight away
notify pgrst, 'reload schema';

-- After creating your user in Authentication → Users, make it the admin (change the email):
-- insert into public.admins (user_id) select id from auth.users where email = 'tu@email.com';
