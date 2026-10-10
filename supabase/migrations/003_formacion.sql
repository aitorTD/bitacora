-- Titulaciones de buceo, editables desde el panel. Ejecútalo una vez en Supabase → SQL Editor.

create table if not exists public.certifications (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,                      -- e.g. Advanced Open Water Diver
  agency      text,                               -- PADI, SSI, PSS, CMAS...
  center      text,                               -- dive centre where it was done
  obtained_on date,                               -- empty while planned
  status      text not null default 'done' check (status in ('done', 'planned')),
  created_at  timestamptz not null default now()
);
alter table public.certifications enable row level security;
drop policy if exists "certifications are public" on public.certifications;
drop policy if exists "admins add certifications" on public.certifications;
drop policy if exists "admins change certifications" on public.certifications;
drop policy if exists "admins delete certifications" on public.certifications;
create policy "certifications are public"    on public.certifications for select using (true);
create policy "admins add certifications"    on public.certifications for insert to authenticated with check (public.is_admin());
create policy "admins change certifications" on public.certifications for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete certifications" on public.certifications for delete to authenticated using (public.is_admin());

-- a first list to start from (only if the table is empty); fill in or correct dates in the panel
insert into public.certifications (title, agency, center, obtained_on, status)
select * from (values
  ('Open Water Diver', 'PSS', null, null::date, 'done'),
  ('Advanced Open Water Diver', 'PADI', 'Open Water La Herradura', date '2026-09-13', 'done'),
  ('Peak Performance Buoyancy', null, null, null::date, 'planned'),
  ('Rescue Diver', null, null, null::date, 'planned')
) as v(title, agency, center, obtained_on, status)
where not exists (select 1 from public.certifications);

notify pgrst, 'reload schema';
