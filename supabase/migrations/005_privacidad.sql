-- Privacidad: las inmersiones ocultas desde el panel dejan de poder leerse desde fuera.
-- Hasta ahora la web solo las ocultaba en pantalla, pero cualquiera podía pedirlas a la API.
-- Ejecútalo una vez en Supabase → SQL Editor.

drop policy if exists "dives are public" on public.dives;
create policy "dives are public" on public.dives for select
  using (not hidden or public.is_admin());

notify pgrst, 'reload schema';
