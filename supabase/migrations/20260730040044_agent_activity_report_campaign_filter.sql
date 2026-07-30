-- 1) El reporte acepta un filtro de campaña que aplica solo a las métricas de
--    llamada. El tiempo conectado y las pausas son de la jornada completa y no
--    se pueden atribuir a una campaña, así que en ese caso se devuelven nulos
--    en vez de un número que no cuadra con el filtro visible en pantalla.
-- 2) La exclusión de adherencia deja de estar escrita a mano y pasa a leerse de
--    agent_status_reasons.excludes_from_adherence.
--
-- NOTA: la guarda de rol de esta versión se corrige en
-- 20260730042016_harden_call_metrics_report_guard.sql (NULL-segura).
create or replace function public.get_agent_activity_report(
  p_date_from date,
  p_date_to date,
  p_campaign_id uuid default null
)
returns table(
  profile_id uuid,
  full_name text,
  calls_handled integer,
  talk_seconds numeric,
  avg_handle_seconds numeric,
  logged_in_seconds numeric,
  productive_seconds numeric,
  occupancy_rate numeric,
  available_seconds numeric,
  paused_seconds numeric,
  adherence_rate numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from timestamptz := p_date_from;
  v_to timestamptz := p_date_to + 1;
  v_scoped boolean := p_campaign_id is not null;
begin
  if coalesce(current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'get_agent_activity_report solo puede ser llamada por admin o supervisor.';
  end if;

  return query
  with phone_segments as (
    select dash.profile_id as pid, dash.status, dash.started_at, dash.ended_at
    from public.dialer_agent_sessions_history dash
    where dash.started_at < v_to and dash.ended_at > v_from
    union all
    select das.profile_id as pid, das.status, das.last_state_change_at as started_at, now() as ended_at
    from public.dialer_agent_sessions das
    where das.last_state_change_at < v_to and now() > v_from
  ),
  phone_overlap as (
    select
      ps.pid,
      ps.status,
      extract(epoch from (least(ps.ended_at, v_to) - greatest(ps.started_at, v_from))) as overlap_seconds
    from phone_segments ps
    where least(ps.ended_at, v_to) > greatest(ps.started_at, v_from)
  ),
  phone_agg as (
    select
      po.pid,
      sum(po.overlap_seconds) as logged_in_seconds,
      sum(po.overlap_seconds) filter (where po.status in ('on_call', 'wrap_up')) as productive_seconds
    from phone_overlap po
    where po.status <> 'offline'
    group by po.pid
  ),
  reason_segments as (
    select h.profile_id as pid, coalesce(r.is_pause, false) as is_pause,
           coalesce(r.excludes_from_adherence, false) as excluded,
           h.since as started_at, h.until as ended_at
    from public.agent_current_status_history h
    join public.agent_status_reasons r on r.id = h.reason_id
    where h.since < v_to and h.until > v_from
    union all
    select s.profile_id as pid, coalesce(r.is_pause, false) as is_pause,
           coalesce(r.excludes_from_adherence, false) as excluded,
           s.since as started_at, now() as ended_at
    from public.agent_current_status s
    join public.agent_status_reasons r on r.id = s.reason_id
    where s.since < v_to and now() > v_from
  ),
  reason_overlap as (
    select
      rs.pid,
      rs.is_pause,
      rs.excluded,
      extract(epoch from (least(rs.ended_at, v_to) - greatest(rs.started_at, v_from))) as overlap_seconds
    from reason_segments rs
    where least(rs.ended_at, v_to) > greatest(rs.started_at, v_from)
  ),
  reason_agg as (
    select
      ro.pid,
      sum(ro.overlap_seconds) filter (where not ro.excluded and not ro.is_pause) as available_seconds,
      sum(ro.overlap_seconds) filter (where not ro.excluded and ro.is_pause) as paused_seconds,
      sum(ro.overlap_seconds) filter (where not ro.excluded) as scheduled_seconds
    from reason_overlap ro
    group by ro.pid
  ),
  calls_agg as (
    select
      da.agent_id as pid,
      count(*) filter (where da.status = 'completed') as calls_handled,
      sum(extract(epoch from (da.ended_at - da.bridged_at))) filter (where da.bridged_at is not null and da.ended_at is not null) as talk_seconds
    from public.dial_attempts da
    where da.agent_id is not null
      and da.originated_at >= v_from
      and da.originated_at < v_to
      and (p_campaign_id is null or da.campaign_id = p_campaign_id)
    group by da.agent_id
  )
  select
    p.id as profile_id,
    p.full_name,
    coalesce(ca.calls_handled, 0)::int as calls_handled,
    round(coalesce(ca.talk_seconds, 0), 1) as talk_seconds,
    round(coalesce(ca.talk_seconds, 0) / nullif(ca.calls_handled, 0), 1) as avg_handle_seconds,
    case when v_scoped then null else round(coalesce(pa.logged_in_seconds, 0), 1) end as logged_in_seconds,
    case when v_scoped then null else round(coalesce(pa.productive_seconds, 0), 1) end as productive_seconds,
    case when v_scoped then null else round(100.0 * coalesce(pa.productive_seconds, 0) / nullif(pa.logged_in_seconds, 0), 1) end as occupancy_rate,
    case when v_scoped then null else round(coalesce(ra.available_seconds, 0), 1) end as available_seconds,
    case when v_scoped then null else round(coalesce(ra.paused_seconds, 0), 1) end as paused_seconds,
    case when v_scoped then null else round(100.0 * coalesce(ra.available_seconds, 0) / nullif(ra.scheduled_seconds, 0), 1) end as adherence_rate
  from public.profiles p
  left join phone_agg pa on pa.pid = p.id
  left join reason_agg ra on ra.pid = p.id
  left join calls_agg ca on ca.pid = p.id
  where p.role = 'agente'
    and (
      case when v_scoped then ca.pid is not null
           else (pa.pid is not null or ra.pid is not null or ca.pid is not null)
      end
    )
  order by p.full_name;
end;
$function$;

comment on function public.get_agent_activity_report(date, date, uuid) is 'Actividad por ejecutivo. Con p_campaign_id solo se filtran las métricas de llamada; el tiempo de jornada se devuelve nulo porque no es atribuible a una campaña.';
