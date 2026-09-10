-- Sincroniza el historial de migraciones con la realidad de la base.
--
-- Tres archivos del repositorio no figuraban como aplicados: los dos que se
-- recuperaron del build de Vercel el 2026-09-10, que su autor había corrido a
-- mano en producción sin publicarlos, y el de la agenda. Sus objetos sí existen
-- en la base; se verificaron uno por uno antes de registrarlos:
-- get_campaign_dashboard_summary con el desglose por origen,
-- get_secretaria_virtual_channel_funnel, y las cuatro funciones de la agenda.
--
-- Se registran SIN reejecutar el SQL, que es lo que hace `supabase migration
-- repair`. Reejecutarlos habría sido peor que dejarlos sin registrar: el
-- archivo del embudo por canal contiene la versión anterior de esa función, sin
-- el guardia de rol que se agregó después, así que aplicarlo ahora reabriría el
-- agujero. En una base nueva el orden por marca de tiempo lo resuelve solo.
--
-- Es idempotente y no hace nada en una base donde esas migraciones ya corrieron
-- normalmente.

insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20260910120000', 'campaign_funnel_origin_breakdown',
   array['-- registrada como aplicada: los objetos ya existian en la base (verificado)']),
  ('20260910170000', 'secretaria_virtual_channel_funnel',
   array['-- registrada como aplicada: los objetos ya existian en la base (verificado)']),
  ('20260910190000', 'unify_agenda_requirement_source_of_truth',
   array['-- registrada como aplicada: los objetos ya existian en la base (verificado)'])
on conflict (version) do nothing;

-- Andamiaje de verificación que no dejó ningún objeto en la base. Se usaron
-- para comparar la salida del reporte de supervisor antes y después de
-- reescribirlo, y se soltaron al terminar. No corresponden a ningún archivo del
-- repositorio, así que se quitan del historial para que deje de mentir.
delete from supabase_migrations.schema_migrations
where name in (
  'tmp_probe_supervisor_report_old',
  'tmp_probe_supervisor_report_new',
  'drop_supervisor_report_probes'
);
