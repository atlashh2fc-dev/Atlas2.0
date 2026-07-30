-- Dos defectos de autorización en las funciones de reporte:
--
-- 1) get_agent_activity_report quedó con EXECUTE para PUBLIC y anon (sus
--    hermanas solo tenían authenticated), así que era invocable sin sesión.
-- 2) La guarda `current_role_name() not in ('admin','supervisor')` es
--    NULL-insegura: para un llamador sin perfil activo la función devuelve
--    NULL, `NULL not in (...)` es NULL, el if no entra y los datos salen.
--    Afecta a un usuario recién desactivado que aún tenga su token vigente.

revoke execute on function public.get_agent_activity_report(date, date, uuid) from public;
revoke execute on function public.get_agent_activity_report(date, date, uuid) from anon;
grant execute on function public.get_agent_activity_report(date, date, uuid) to authenticated, service_role;

create or replace function public.get_queue_health()
returns table(
  campaign_id uuid,
  campaign_name text,
  queue_name text,
  in_flight integer,
  answered_today integer,
  abandoned_today integer,
  completed_today integer,
  no_answer_today integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'get_queue_health solo puede ser llamada por admin o supervisor.';
  end if;

  return query
  select
    dc.campaign_id,
    camp.name as campaign_name,
    dc.queue_name,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
    ) as in_flight,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status in ('bridged', 'completed')
        and da.created_at >= current_date
    ) as answered_today,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status = 'abandoned'
        and da.created_at >= current_date
    ) as abandoned_today,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status = 'completed'
        and da.created_at >= current_date
    ) as completed_today,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status = 'no_answer'
        and da.created_at >= current_date
    ) as no_answer_today
  from public.dialer_campaign_configs dc
  join public.campaigns camp on camp.id = dc.campaign_id
  where dc.is_active = true;
end;
$function$;

revoke execute on function public.get_queue_health() from public, anon;
grant execute on function public.get_queue_health() to authenticated, service_role;
