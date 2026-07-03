-- Vista de estado en vivo por agente para el "Monitor en vivo" de supervisión.
-- security_invoker=true: NO bypassa RLS — cada fila que devuelve ya pasó por
-- las políticas de profiles/agent_sip_credentials/dialer_agent_sessions/
-- agent_current_status para quien está consultando (solo admin/supervisor
-- ven todos los agentes; un agente común solo vería su propia fila, aunque
-- hoy no se expone esta vista en su UI).
create or replace view public.agent_live_status
with (security_invoker = true) as
select
  p.id as profile_id,
  p.full_name,
  p.email,
  c.extension,
  s.campaign_id,
  camp.name as campaign_name,
  coalesce(s.status, 'offline') as phone_status,
  s.last_state_change_at as phone_status_since,
  r.id as reason_id,
  r.code as reason_code,
  r.label as reason_label,
  coalesce(r.is_pause, false) as is_pause,
  st.since as reason_since
from public.profiles p
join public.agent_sip_credentials c on c.profile_id = p.id and c.is_active = true
left join lateral (
  select ds.*
  from public.dialer_agent_sessions ds
  join public.campaigns cc on cc.id = ds.campaign_id and cc.is_active = true
  where ds.profile_id = p.id
  order by ds.updated_at desc
  limit 1
) s on true
left join public.campaigns camp on camp.id = s.campaign_id
left join public.agent_current_status st on st.profile_id = p.id
left join public.agent_status_reasons r on r.id = st.reason_id
where p.role = 'agente';

-- Salud de cola por campaña activa: llamadas en curso ahora mismo y
-- contadores del día para nivel de servicio / abandono. SECURITY DEFINER
-- porque agrega sobre dial_attempts (sin política de select amplia para
-- supervisor todavía) — restringido a admin/supervisor dentro de la función.
create or replace function public.get_queue_health()
returns table (
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
set search_path = 'public'
as $$
begin
  if current_role_name() not in ('admin', 'supervisor') then
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
$$;

revoke all on function public.get_queue_health() from public;
revoke all on function public.get_queue_health() from anon;
grant execute on function public.get_queue_health() to authenticated;
