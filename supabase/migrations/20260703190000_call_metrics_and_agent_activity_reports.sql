-- Reporte histórico de métricas de llamadas por día/campaña: volumen por
-- resultado, tiempos promedio (ring/talk), tasa de abandono y nivel de
-- servicio (proxy saliente: % de llamadas contestadas por el cliente dentro
-- de 20s desde el origen de la marcación).
create or replace function public.get_call_metrics_report(
  p_date_from date,
  p_date_to date,
  p_campaign_id uuid default null
)
returns table (
  report_date date,
  campaign_id uuid,
  campaign_name text,
  total_attempts integer,
  answered integer,
  completed integer,
  no_answer integer,
  busy integer,
  failed integer,
  abandoned integer,
  voicemail integer,
  avg_ring_seconds numeric,
  avg_talk_seconds numeric,
  abandonment_rate numeric,
  service_level_20s numeric
)
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if current_role_name() not in ('admin', 'supervisor') then
    raise exception 'get_call_metrics_report solo puede ser llamada por admin o supervisor.';
  end if;

  return query
  select
    (da.originated_at at time zone 'utc')::date as report_date,
    da.campaign_id,
    camp.name as campaign_name,
    count(*)::int as total_attempts,
    count(*) filter (where da.status in ('answered', 'bridged', 'completed'))::int as answered,
    count(*) filter (where da.status = 'completed')::int as completed,
    count(*) filter (where da.status = 'no_answer')::int as no_answer,
    count(*) filter (where da.status = 'busy')::int as busy,
    count(*) filter (where da.status = 'failed')::int as failed,
    count(*) filter (where da.status = 'abandoned')::int as abandoned,
    count(*) filter (where da.status = 'voicemail')::int as voicemail,
    round(avg(extract(epoch from (da.answered_at - da.originated_at))) filter (where da.answered_at is not null), 1) as avg_ring_seconds,
    round(avg(extract(epoch from (da.ended_at - da.bridged_at))) filter (where da.bridged_at is not null and da.ended_at is not null), 1) as avg_talk_seconds,
    round(
      100.0 * count(*) filter (where da.status = 'abandoned')
      / nullif(count(*) filter (where da.answered_at is not null), 0),
      1
    ) as abandonment_rate,
    round(
      100.0 * count(*) filter (where da.answered_at is not null and da.answered_at - da.originated_at <= interval '20 seconds')
      / nullif(count(*) filter (where da.answered_at is not null), 0),
      1
    ) as service_level_20s
  from public.dial_attempts da
  join public.campaigns camp on camp.id = da.campaign_id
  where da.originated_at is not null
    and da.originated_at >= p_date_from
    and da.originated_at < (p_date_to + 1)
    and (p_campaign_id is null or da.campaign_id = p_campaign_id)
  group by report_date, da.campaign_id, camp.name
  order by report_date, campaign_name;
end;
$$;

revoke all on function public.get_call_metrics_report(date, date, uuid) from public;
revoke all on function public.get_call_metrics_report(date, date, uuid) from anon;
grant execute on function public.get_call_metrics_report(date, date, uuid) to authenticated;

-- Reporte histórico de actividad por agente: AHT, ocupación (tiempo
-- productivo en_llamada+wrap_up sobre tiempo conectado al softphone) y
-- adherencia (tiempo en "Disponible" sobre tiempo en motivos no-sistema,
-- excluyendo el tiempo ya desconectado). Combina los segmentos cerrados de
-- historial con el segmento abierto (en curso) recortado al rango pedido,
-- para que un agente que sigue conectado ahora mismo se calcule correcto.
--
-- Nota: "profile_id" es columna OUT de RETURNS TABLE, por lo que dentro del
-- cuerpo plpgsql es también una variable — cada CTE usa el alias "pid" para
-- no chocar con ella (evita el error 42702 "column reference is ambiguous").
create or replace function public.get_agent_activity_report(
  p_date_from date,
  p_date_to date
)
returns table (
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
set search_path = 'public'
as $$
declare
  v_from timestamptz := p_date_from;
  v_to timestamptz := p_date_to + 1;
begin
  if current_role_name() not in ('admin', 'supervisor') then
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
    select h.profile_id as pid, r.code as reason_code, coalesce(r.is_pause, false) as is_pause, h.since as started_at, h.until as ended_at
    from public.agent_current_status_history h
    join public.agent_status_reasons r on r.id = h.reason_id
    where h.since < v_to and h.until > v_from
    union all
    select s.profile_id as pid, r.code as reason_code, coalesce(r.is_pause, false) as is_pause, s.since as started_at, now() as ended_at
    from public.agent_current_status s
    join public.agent_status_reasons r on r.id = s.reason_id
    where s.since < v_to and now() > v_from
  ),
  reason_overlap as (
    select
      rs.pid,
      rs.is_pause,
      rs.reason_code,
      extract(epoch from (least(rs.ended_at, v_to) - greatest(rs.started_at, v_from))) as overlap_seconds
    from reason_segments rs
    where least(rs.ended_at, v_to) > greatest(rs.started_at, v_from)
  ),
  reason_agg as (
    select
      ro.pid,
      sum(ro.overlap_seconds) filter (where ro.reason_code <> 'desconectado' and not ro.is_pause) as available_seconds,
      sum(ro.overlap_seconds) filter (where ro.reason_code <> 'desconectado' and ro.is_pause) as paused_seconds,
      sum(ro.overlap_seconds) filter (where ro.reason_code <> 'desconectado') as scheduled_seconds
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
    group by da.agent_id
  )
  select
    p.id as profile_id,
    p.full_name,
    coalesce(ca.calls_handled, 0)::int as calls_handled,
    round(coalesce(ca.talk_seconds, 0), 1) as talk_seconds,
    round(coalesce(ca.talk_seconds, 0) / nullif(ca.calls_handled, 0), 1) as avg_handle_seconds,
    round(coalesce(pa.logged_in_seconds, 0), 1) as logged_in_seconds,
    round(coalesce(pa.productive_seconds, 0), 1) as productive_seconds,
    round(100.0 * coalesce(pa.productive_seconds, 0) / nullif(pa.logged_in_seconds, 0), 1) as occupancy_rate,
    round(coalesce(ra.available_seconds, 0), 1) as available_seconds,
    round(coalesce(ra.paused_seconds, 0), 1) as paused_seconds,
    round(100.0 * coalesce(ra.available_seconds, 0) / nullif(ra.scheduled_seconds, 0), 1) as adherence_rate
  from public.profiles p
  left join phone_agg pa on pa.pid = p.id
  left join reason_agg ra on ra.pid = p.id
  left join calls_agg ca on ca.pid = p.id
  where p.role = 'agente'
    and (pa.pid is not null or ra.pid is not null or ca.pid is not null)
  order by p.full_name;
end;
$$;

revoke all on function public.get_agent_activity_report(date, date) from public;
revoke all on function public.get_agent_activity_report(date, date) from anon;
grant execute on function public.get_agent_activity_report(date, date) to authenticated;

-- Las funciones de trigger de historial solo deben correr como trigger
-- (BEFORE UPDATE), nunca invocadas directamente por un usuario vía RPC.
revoke execute on function public.log_agent_current_status_change() from public, anon, authenticated;
revoke execute on function public.log_dialer_agent_session_change() from public, anon, authenticated;
