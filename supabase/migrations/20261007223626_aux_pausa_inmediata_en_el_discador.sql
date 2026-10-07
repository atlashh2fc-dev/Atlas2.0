-- El motor de discado escucha los cambios de estado del ejecutivo para
-- pausarlo en la cola apenas elige un AUX. Antes esperaba al sync periódico
-- (5 s) y en ese lapso la cola le entregaba el cliente que el predictivo ya
-- había marcado contando con él: elegía Baño y un segundo después le entraba
-- la llamada (24 casos en 7 días al 07-10-2026).
--
-- Realtime respeta RLS para los navegadores; el motor usa la service role.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_current_status'
  ) then
    alter publication supabase_realtime add table public.agent_current_status;
  end if;
end $$;
