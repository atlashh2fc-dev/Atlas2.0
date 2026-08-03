-- PostgreSQL no define max(uuid). La función de reporte llegaba a este CTE
-- sólo para supervisores y abortaba toda la vista con un 500. Cada clave de
-- ejecutivo representa como máximo un perfil y un agente histórico; tomamos
-- explícitamente el primer UUID no nulo para conservar esa semántica.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.get_supervisor_report_summary(timestamptz, timestamptz, uuid, uuid)'::regprocedure
  ) into definition;

  if definition is null then
    raise exception 'No existe get_supervisor_report_summary para corregir.';
  end if;

  definition := replace(
    definition,
    'max(profile_id) as profile_id,',
    '(array_agg(profile_id order by profile_id) filter (where profile_id is not null))[1] as profile_id,'
  );
  definition := replace(
    definition,
    'max(historical_agent_id) as historical_agent_id,',
    '(array_agg(historical_agent_id order by historical_agent_id) filter (where historical_agent_id is not null))[1] as historical_agent_id,'
  );

  if position('max(profile_id) as profile_id,' in definition) > 0
    or position('max(historical_agent_id) as historical_agent_id,' in definition) > 0 then
    raise exception 'No se pudo actualizar la agregación UUID del reporte supervisor.';
  end if;

  execute definition;
end;
$migration$;

revoke all on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid, uuid)
  from public, anon;
grant execute on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid, uuid)
  to authenticated;
