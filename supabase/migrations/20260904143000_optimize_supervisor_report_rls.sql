-- El RPC ya aplica el alcance completo por sesión, rol, equipos y campaña
-- antes de leer hechos. Ejecutarlo como invoker vuelve a evaluar además las
-- políticas RLS por cada fila de leads/calls/interactions; en producción esa
-- duplicación llevó el mismo reporte de 12 agentes de ~220 ms a ~9,1 s.
-- SECURITY DEFINER elimina sólo esa segunda evaluación. Los guardas de acceso
-- dentro de get_supervisor_report_summary siguen siendo obligatorios.

alter function public.get_supervisor_report_summary(
  timestamptz,
  timestamptz,
  uuid,
  uuid
) security definer;

alter function public.get_supervisor_report_summary(
  timestamptz,
  timestamptz,
  uuid,
  uuid
) set search_path = pg_catalog, public;

revoke all on function public.get_supervisor_report_summary(
  timestamptz,
  timestamptz,
  uuid,
  uuid
) from public, anon;

grant execute on function public.get_supervisor_report_summary(
  timestamptz,
  timestamptz,
  uuid,
  uuid
) to authenticated;

comment on function public.get_supervisor_report_summary(
  timestamptz,
  timestamptz,
  uuid,
  uuid
) is 'Reporte supervisor multi-equipo/campaña. SECURITY DEFINER evita duplicar RLS; la función valida sesión, rol y equipos antes de leer datos.';
