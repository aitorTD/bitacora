-- Ajustes de la web desde el panel. Ejecútalo una vez en Supabase → SQL Editor.

-- per dive: hide it from the web, or leave it out of the air consumption (training dives)
alter table public.dives add column if not exists hidden boolean not null default false;
alter table public.dives add column if not exists no_sac boolean not null default false;

-- one row with what the web shows: each statistic on or off, and the dive cards on or off
create table if not exists public.settings (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "settings are public" on public.settings;
drop policy if exists "admins add settings" on public.settings;
drop policy if exists "admins change settings" on public.settings;
create policy "settings are public"    on public.settings for select using (true);
create policy "admins add settings"    on public.settings for insert to authenticated with check (public.is_admin());
create policy "admins change settings" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.settings (id) values (1) on conflict (id) do nothing;

notify pgrst, 'reload schema';
