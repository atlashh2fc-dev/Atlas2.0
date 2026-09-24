-- Turnos con colación y descanso para adherencia y productividad.
--
-- Operación (24-09-2026): los ejecutivos de Equifax trabajan de lunes a jueves
-- de 09:00 a 18:30 y el viernes de 09:00 a 16:00, fines de semana libres, con
-- 1 hora de almuerzo y 30 minutos de descanso dentro del turno. La adherencia
-- se calculaba como disponible / horas programadas, así que cumplir la
-- colación y el descanso bajaba la adherencia. Ahora:
--   * el turno guarda lunch_minutes y break_minutes;
--   * adherencia = disponible / (horas programadas - colación - descanso);
--   * planned_break_seconds, break_used_seconds (Almuerzo y Descanso dentro
--     del cupo) y excess_break_seconds (lo que se pasó del cupo).

alter table public.campaign_agent_schedules
  add column if not exists lunch_minutes integer not null default 0,
  add column if not exists break_minutes integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_agent_schedules_breaks_check') then
    alter table public.campaign_agent_schedules
      add constraint campaign_agent_schedules_breaks_check
      check (lunch_minutes between 0 and 240 and break_minutes between 0 and 240);
  end if;
end;
$$;

comment on column public.campaign_agent_schedules.lunch_minutes is 'Minutos de colación dentro del turno de ese día (no cuentan contra la adherencia).';
comment on column public.campaign_agent_schedules.break_minutes is 'Minutos de descanso dentro del turno de ese día (no cuentan contra la adherencia).';

drop function if exists public.get_agent_activity_report(date, date, uuid);

create or replace function public.get_agent_activity_report(
  p_date_from date,
  p_date_to date,
  p_campaign_id uuid default null
)
returns table(
  profile_id uuid, full_name text, calls_handled integer, talk_seconds numeric,
  avg_handle_seconds numeric, logged_in_seconds numeric, productive_seconds numeric,
  occupancy_rate numeric, scheduled_seconds numeric, available_seconds numeric,
  paused_seconds numeric, disconnected_seconds numeric, adherence_rate numeric,
  planned_break_seconds numeric, break_used_seconds numeric, excess_break_seconds numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := coalesce(public.current_role_name()::text, '');
  v_from timestamptz := (p_date_from::timestamp at time zone 'America/Santiago');
  v_to timestamptz := ((p_date_to + 1)::timestamp at time zone 'America/Santiago');
  v_scoped boolean := p_campaign_id is not null;
  v_team_ids uuid[];
begin
  if v_role not in ('admin', 'supervisor') then
    raise exception 'get_agent_activity_report solo puede ser llamada por admin o supervisor.';
  end if;

  if v_role = 'supervisor' then
    v_team_ids := public.supervised_team_ids();
  end if;

  return query
  with phone_segments as (
    select h.profile_id as pid, h.status, h.started_at, h.ended_at
    from public.dialer_agent_sessions_history h
    where h.started_at < v_to and h.ended_at > v_from
    union all
    select s.profile_id, s.status, s.last_state_change_at, now()
    from public.dialer_agent_sessions s
    where s.last_state_change_at < v_to and now() > v_from
  ),
  phone_overlap as (
    select ps.pid, ps.status,
      extract(epoch from (least(ps.ended_at, v_to) - greatest(ps.started_at, v_from))) as seconds
    from phone_segments ps
    where least(ps.ended_at, v_to) > greatest(ps.started_at, v_from)
  ),
  phone_agg as (
    select po.pid,
      sum(po.seconds) filter (where po.status <> 'offline') as logged,
      sum(po.seconds) filter (where po.status in ('on_call', 'wrap_up')) as productive
    from phone_overlap po
    group by po.pid
  ),
  schedule_windows as (
    select ca.profile_id as pid,
      (sch.lunch_minutes + sch.break_minutes) * 60 as planned_break,
      sch.lunch_minutes * 60 as lunch_allowance,
      sch.break_minutes * 60 as break_allowance,
      ((day_value.day::date + sch.start_time) at time zone sch.timezone) as starts_at,
      ((day_value.day::date + sch.end_time) at time zone sch.timezone) as ends_at
    from public.campaign_agent_schedules sch
    join public.campaign_agents ca on ca.id = sch.campaign_agent_id
    cross join lateral generate_series(
      p_date_from::timestamp,
      p_date_to::timestamp,
      interval '1 day'
    ) day_value(day)
    where extract(dow from day_value.day)::smallint = any(sch.days_of_week)
  ),
  clipped_schedules as (
    select sw.pid, sw.planned_break, sw.lunch_allowance, sw.break_allowance,
      greatest(sw.starts_at, v_from) as starts_at,
      least(sw.ends_at, v_to) as ends_at
    from schedule_windows sw
    where least(sw.ends_at, v_to) > greatest(sw.starts_at, v_from)
  ),
  schedule_agg as (
    select cs.pid, sum(extract(epoch from (cs.ends_at - cs.starts_at))) as scheduled,
      sum(cs.planned_break) as planned_break,
      sum(cs.lunch_allowance) as lunch_allowance,
      sum(cs.break_allowance) as break_allowance
    from clipped_schedules cs
    group by cs.pid
  ),
  reason_segments as (
    select h.profile_id as pid, r.code, r.is_pause, h.since as starts_at, h.until as ends_at
    from public.agent_current_status_history h
    join public.agent_status_reasons r on r.id = h.reason_id
    where h.since < v_to and h.until > v_from
    union all
    select s.profile_id, r.code, r.is_pause, s.since, now()
    from public.agent_current_status s
    join public.agent_status_reasons r on r.id = s.reason_id
    where s.since < v_to and now() > v_from
  ),
  reason_in_schedule as (
    select rs.pid, rs.code, rs.is_pause,
      extract(epoch from (
        least(rs.ends_at, cs.ends_at) - greatest(rs.starts_at, cs.starts_at)
      )) as seconds
    from reason_segments rs
    join clipped_schedules cs on cs.pid = rs.pid
    where least(rs.ends_at, cs.ends_at) > greatest(rs.starts_at, cs.starts_at)
  ),
  reason_agg as (
    select ris.pid,
      sum(ris.seconds) filter (where ris.code <> 'desconectado' and not ris.is_pause) as available,
      sum(ris.seconds) filter (where ris.code <> 'desconectado' and ris.is_pause) as paused,
      sum(ris.seconds) filter (where ris.code = 'desconectado') as disconnected,
      sum(ris.seconds) filter (where ris.code = 'almuerzo') as lunch_used,
      sum(ris.seconds) filter (where ris.code = 'descanso') as break_used
    from reason_in_schedule ris
    group by ris.pid
  ),
  calls_agg as (
    select da.agent_id as pid,
      count(*) filter (where da.status = 'completed') as calls_handled,
      sum(extract(epoch from (da.ended_at - da.bridged_at)))
        filter (where da.bridged_at is not null and da.ended_at is not null) as talk
    from public.dial_attempts da
    where da.agent_id is not null
      and da.originated_at >= v_from and da.originated_at < v_to
      and (p_campaign_id is null or da.campaign_id = p_campaign_id)
    group by da.agent_id
  )
  select p.id, p.full_name,
    coalesce(ca.calls_handled, 0)::integer,
    round(coalesce(ca.talk, 0), 1),
    round(coalesce(ca.talk, 0) / nullif(ca.calls_handled, 0), 1),
    case when v_scoped then null else round(coalesce(pa.logged, 0), 1) end,
    case when v_scoped then null else round(coalesce(pa.productive, 0), 1) end,
    case when v_scoped then null else round(100.0 * coalesce(pa.productive, 0) / nullif(pa.logged, 0), 1) end,
    case when v_scoped or sa.pid is null then null else round(sa.scheduled, 1) end,
    case when v_scoped or sa.pid is null then null else round(coalesce(ra.available, 0), 1) end,
    case when v_scoped or sa.pid is null then null else round(coalesce(ra.paused, 0), 1) end,
    case when v_scoped or sa.pid is null then null else round(coalesce(ra.disconnected, 0), 1) end,
    -- Adherencia contra el tiempo de trabajo del turno: las horas programadas
    -- menos la colación y el descanso planificados.
    case when v_scoped or sa.pid is null then null
      else round(least(100.0, 100.0 * coalesce(ra.available, 0) / nullif(sa.scheduled - coalesce(sa.planned_break, 0), 0)), 1)
    end,
    case when v_scoped or sa.pid is null then null else round(coalesce(sa.planned_break, 0), 1) end,
    case when v_scoped or sa.pid is null then null
      else round(least(coalesce(ra.lunch_used, 0), coalesce(sa.lunch_allowance, 0))
        + least(coalesce(ra.break_used, 0), coalesce(sa.break_allowance, 0)), 1)
    end,
    case when v_scoped or sa.pid is null then null
      else round(greatest(coalesce(ra.lunch_used, 0) - coalesce(sa.lunch_allowance, 0), 0)
        + greatest(coalesce(ra.break_used, 0) - coalesce(sa.break_allowance, 0), 0), 1)
    end
  from public.profiles p
  left join phone_agg pa on pa.pid = p.id
  left join schedule_agg sa on sa.pid = p.id
  left join reason_agg ra on ra.pid = p.id
  left join calls_agg ca on ca.pid = p.id
  where public.can_access_org(p.organization_id) and p.role = 'agente'
    and (v_team_ids is null or p.team_id = any(v_team_ids))
    and (
      case when v_scoped then ca.pid is not null
      else (pa.pid is not null or sa.pid is not null or ra.pid is not null or ca.pid is not null)
      end
    )
  order by p.full_name;
end;
$function$;

revoke all on function public.get_agent_activity_report(date, date, uuid) from public, anon;
grant execute on function public.get_agent_activity_report(date, date, uuid) to authenticated, service_role;

-- Turno de Equifax para sus 12 ejecutivos. El horario viejo de Andrés en
-- Abogado Legal (L-V 09:00-18:30) se superpone y él ya opera en Equifax.
delete from public.campaign_agent_schedules schedule
using public.campaign_agents membership, public.campaigns campaign
where schedule.campaign_agent_id = membership.id
  and membership.campaign_id = campaign.id
  and campaign.name = 'Abogado Legal'
  and membership.profile_id in (
    select profile_id from public.campaign_agents where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd'
  );

insert into public.campaign_agent_schedules (campaign_agent_id, days_of_week, start_time, end_time, timezone, lunch_minutes, break_minutes)
select membership.id, turno.dias, turno.desde, turno.hasta, 'America/Santiago', 60, 30
from public.campaign_agents membership
cross join (values
  ('{1,2,3,4}'::smallint[], time '09:00', time '18:30'),
  ('{5}'::smallint[], time '09:00', time '16:00')
) as turno(dias, desde, hasta)
where membership.campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd'
  and not exists (
    select 1 from public.campaign_agent_schedules existing
    where existing.campaign_agent_id = membership.id
      and existing.days_of_week = turno.dias
  );
