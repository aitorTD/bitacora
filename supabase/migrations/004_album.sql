-- Álbum de especies: qué especies he visto. Ejecútalo una vez en Supabase → SQL Editor.
-- El catálogo vive en la web (src/album/species.js); aquí solo se guarda lo desbloqueado.

create table if not exists public.species_seen (
  species_id  text primary key,                   -- id del catálogo, p. ej. 'mero'
  seen_on     date,                               -- primera vez que la vi (opcional)
  site        text,                               -- dónde (opcional)
  created_at  timestamptz not null default now()
);
alter table public.species_seen enable row level security;
drop policy if exists "seen species are public" on public.species_seen;
drop policy if exists "admins add seen species" on public.species_seen;
drop policy if exists "admins change seen species" on public.species_seen;
drop policy if exists "admins delete seen species" on public.species_seen;
create policy "seen species are public"    on public.species_seen for select using (true);
create policy "admins add seen species"    on public.species_seen for insert to authenticated with check (public.is_admin());
create policy "admins change seen species" on public.species_seen for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete seen species" on public.species_seen for delete to authenticated using (public.is_admin());

notify pgrst, 'reload schema';
