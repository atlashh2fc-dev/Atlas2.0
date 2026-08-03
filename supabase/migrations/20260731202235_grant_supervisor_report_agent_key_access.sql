-- El reporte se ejecuta como SECURITY INVOKER. Esta auxiliar estaba reservada
-- para los triggers de caché, pero el nuevo reporte en línea también la usa;
-- sin EXECUTE, toda vista de Supervisor fallaba al evaluar sus llamadas e
-- interacciones. Como la función sólo resuelve una relación ya visible por
-- RLS, se ejecuta como invocador en vez de elevar privilegios.
create or replace function public.resolve_supervisor_report_agent_key(
  p_agent_id uuid,
  p_historical_agent_id uuid
)
returns text
language sql
stable
security invoker
set search_path = public
as $function$
  select coalesce(
    (
      select ha.linked_profile_id::text
      from public.historical_agents ha
      where ha.id = p_historical_agent_id
        and ha.linked_profile_id is not null
    ),
    p_historical_agent_id::text,
    p_agent_id::text
  );
$function$;

revoke all on function public.resolve_supervisor_report_agent_key(uuid, uuid)
  from public, anon;
grant execute on function public.resolve_supervisor_report_agent_key(uuid, uuid)
  to authenticated;
