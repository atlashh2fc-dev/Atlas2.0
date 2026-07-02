create or replace function public.get_supervisor_report_summary(
  p_from timestamptz default (now() - interval '30 days'),
  p_to timestamptz default now(),
  p_team_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_current_team_id uuid := (select public.current_team_id());
  v_team_id uuid;
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_from_date date := coalesce(p_from, now() - interval '30 days')::date;
  v_to_date date := coalesce(p_to, now())::date;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;

  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para ver este reporte.';
  end if;

  v_team_id := case
    when v_role = 'supervisor' then v_current_team_id
    else p_team_id
  end;

  if v_role = 'supervisor' and v_team_id is null then
    raise exception 'Tu supervisor no tiene equipo asignado.';
  end if;

  with
  team_leads as (
    select l.id, l.assigned_to, l.next_action_at
    from public.leads l
    where v_team_id is null or l.team_id = v_team_id
  ),
  metric_rows as (
    select m.*
    from public.supervisor_report_daily_agent_metrics m
    where m.metric_day >= v_from_date
      and m.metric_day <= v_to_date
      and (v_team_id is null or m.team_id = v_team_id)
  ),
  crm_touched_days as (
    select distinct i.created_at::date as day, i.lead_id
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where i.created_at >= v_from
      and i.created_at <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
    union
    select distinct coalesce(c.ended_at, c.updated_at, c.created_at)::date as day, c.lead_id
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.discarded_reason is null
      and c.ended_at is not null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
  ),
  vocalcom_events as (
    select
      coalesce(v.called_at, v.created_at)::date as day,
      v.lead_id,
      v.connection_status,
      v.duration_seconds
    from public.vocalcom_call_events v
    join public.leads l on l.id = v.lead_id
    where v.match_status = 'matched'
      and v.lead_id is not null
      and coalesce(v.called_at, v.created_at) >= v_from
      and coalesce(v.called_at, v.created_at) <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
  ),
  vocalcom_touched_days as (
    select distinct day, lead_id
    from vocalcom_events
  ),
  all_touched_days as (
    select day, lead_id from crm_touched_days
    union
    select day, lead_id from vocalcom_touched_days
  ),
  all_connected_days as (
    select distinct coalesce(c.ended_at, c.updated_at, c.created_at)::date as day, c.lead_id
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.discarded_reason is null
      and c.status = 'connected'
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
    union
    select distinct day, lead_id
    from vocalcom_events
    where connection_status = 'connected'
  ),
  all_no_contact_days as (
    select distinct coalesce(c.ended_at, c.updated_at, c.created_at)::date as day, c.lead_id
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.discarded_reason is null
      and c.status in ('no_answer', 'busy', 'voicemail', 'out_of_service')
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
    union
    select distinct day, lead_id
    from vocalcom_events
    where connection_status = 'not_connected'
  ),
  vocalcom_tmo as (
    select
      coalesce(sum(duration_seconds), 0)::numeric as tmo_sum_seconds,
      count(*)::int as tmo_count
    from vocalcom_events
    where connection_status = 'connected'
      and duration_seconds is not null
      and duration_seconds > 0
  ),
  agent_catalog as (
    select
      p.id::text as report_agent_key,
      p.id as profile_id,
      null::uuid as historical_agent_id,
      p.full_name,
      t.name as team_name,
      false as is_historical_only
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    where p.role = 'agente'
      and p.active
      and (v_team_id is null or p.team_id = v_team_id)
    union
    select distinct
      m.report_agent_key,
      m.profile_id,
      m.historical_agent_id,
      coalesce(p.full_name, ha.full_name, 'Ejecutivo histórico') as full_name,
      t.name as team_name,
      (m.profile_id is null and m.historical_agent_id is not null) as is_historical_only
    from metric_rows m
    left join public.profiles p on p.id = m.profile_id
    left join public.historical_agents ha on ha.id = m.historical_agent_id
    left join public.teams t on t.id = m.team_id
  ),
  agent_rows as (
    select
      a.report_agent_key,
      max(a.profile_id::text)::uuid as profile_id,
      max(a.historical_agent_id::text)::uuid as historical_agent_id,
      max(a.full_name) as full_name,
      max(a.team_name) as team_name,
      bool_or(a.is_historical_only) as is_historical_only,
      coalesce(sum(m.crm_gestiones), 0)::int as crm_gestiones,
      coalesce(sum(m.llamadas_cerradas), 0)::int as llamadas_cerradas,
      coalesce(sum(m.leads_gestionados), 0)::int as leads_gestionados,
      coalesce(sum(m.contactos_efectivos), 0)::int as contactos_efectivos,
      coalesce(sum(m.no_contacto), 0)::int as no_contacto,
      coalesce(sum(m.agendas), 0)::int as agendas,
      coalesce(sum(m.cotizaciones), 0)::int as cotizaciones,
      coalesce(sum(m.ventas), 0)::int as ventas,
      coalesce(sum(m.uf), 0)::numeric as uf,
      coalesce(sum(m.tmo_sum_seconds), 0)::numeric as tmo_sum_seconds,
      coalesce(sum(m.tmo_count), 0)::int as tmo_count
    from agent_catalog a
    left join metric_rows m on m.report_agent_key = a.report_agent_key
    group by a.report_agent_key
  ),
  daily_rows as (
    select
      d.day,
      coalesce(m.crm_gestiones, 0)::int as crm_gestiones,
      coalesce(c.contactos_efectivos, 0)::int as contactos_efectivos,
      coalesce(m.agendas, 0)::int as agendas
    from (
      select day from all_touched_days
      union
      select metric_day as day from metric_rows
    ) d
    left join (
      select
        metric_day as day,
        coalesce(sum(crm_gestiones), 0)::int as crm_gestiones,
        coalesce(sum(agendas), 0)::int as agendas
      from metric_rows
      group by metric_day
    ) m on m.day = d.day
    left join (
      select day, count(*)::int as contactos_efectivos
      from all_connected_days
      group by day
    ) c on c.day = d.day
    where coalesce(m.crm_gestiones, 0) > 0
       or coalesce(c.contactos_efectivos, 0) > 0
       or coalesce(m.agendas, 0) > 0
    order by d.day
  ),
  tipification_rows as (
    select t.label, sum(t.count)::int as count
    from public.supervisor_report_daily_agent_tipifications t
    where t.metric_day >= v_from_date
      and t.metric_day <= v_to_date
      and (v_team_id is null or t.team_id = v_team_id)
    group by t.label
    order by sum(t.count) desc, t.label
    limit 10
  ),
  totals as (
    select
      (select count(*)::int from team_leads) as base_total,
      (select count(*)::int from team_leads where assigned_to is not null) as asignados,
      (select count(*)::int from team_leads where assigned_to is null) as sin_asignar,
      coalesce(sum(crm_gestiones), 0)::int as crm_gestiones,
      (select count(*)::int from all_touched_days) as recorridos,
      (select count(*)::int from vocalcom_touched_days) as vocalcom_recorridos,
      coalesce(sum(llamadas_cerradas), 0)::int as llamadas_cerradas,
      (select count(*)::int from all_connected_days) as contactados,
      (select count(*)::int from vocalcom_events where connection_status = 'connected') as vocalcom_contactados,
      (select count(*)::int from all_no_contact_days) as no_contacto,
      coalesce(sum(agendas), 0)::int as agendas_creadas,
      (select count(*)::int from team_leads where next_action_at is not null and next_action_at < now()) as agendas_vencidas,
      (select count(*)::int from team_leads where next_action_at is not null and next_action_at >= now()) as agendas_pendientes,
      coalesce(sum(cotizaciones), 0)::int as cotizaciones,
      coalesce(sum(ventas), 0)::int as ventas,
      coalesce(sum(uf), 0)::numeric as uf,
      coalesce(sum(tmo_sum_seconds), 0)::numeric + (select tmo_sum_seconds from vocalcom_tmo) as tmo_sum_seconds,
      coalesce(sum(tmo_count), 0)::int + (select tmo_count from vocalcom_tmo) as tmo_count
    from metric_rows
  )
  select jsonb_build_object(
    'range', jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'team_id', v_team_id
    ),
    'kpis', jsonb_build_object(
      'base_total', totals.base_total,
      'asignados', totals.asignados,
      'sin_asignar', totals.sin_asignar,
      'recorridos', totals.recorridos,
      'vocalcom_recorridos', totals.vocalcom_recorridos,
      'contactados', totals.contactados,
      'vocalcom_contactados', totals.vocalcom_contactados,
      'contactabilidad', case when totals.recorridos > 0 then round((totals.contactados::numeric / totals.recorridos::numeric) * 100, 1) else null end,
      'crm_gestiones', totals.crm_gestiones,
      'llamadas_cerradas', totals.llamadas_cerradas,
      'no_contacto', totals.no_contacto,
      'agendas_creadas', totals.agendas_creadas,
      'agendas_vencidas', totals.agendas_vencidas,
      'agendas_pendientes', totals.agendas_pendientes,
      'cotizaciones', totals.cotizaciones,
      'ventas', totals.ventas,
      'uf', totals.uf,
      'tmo_seconds', case when totals.tmo_count > 0 then totals.tmo_sum_seconds / totals.tmo_count else null end
    ),
    'agents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agent_id', report_agent_key,
          'profile_id', profile_id,
          'historical_agent_id', historical_agent_id,
          'full_name', full_name,
          'team_name', team_name,
          'is_historical_only', is_historical_only,
          'crm_gestiones', crm_gestiones,
          'llamadas_cerradas', llamadas_cerradas,
          'leads_gestionados', leads_gestionados,
          'contactos_efectivos', contactos_efectivos,
          'contactabilidad', case when leads_gestionados > 0 then round((contactos_efectivos::numeric / leads_gestionados::numeric) * 100, 1) else null end,
          'no_contacto', no_contacto,
          'agendas', agendas,
          'cotizaciones', cotizaciones,
          'ventas', ventas,
          'uf', uf,
          'tmo_seconds', case when tmo_count > 0 then tmo_sum_seconds / tmo_count else null end
        )
        order by crm_gestiones desc, contactos_efectivos desc, full_name
      )
      from agent_rows
      where crm_gestiones > 0
         or llamadas_cerradas > 0
         or leads_gestionados > 0
         or contactos_efectivos > 0
         or agendas > 0
         or not is_historical_only
    ), '[]'::jsonb),
    'tipifications', coalesce((
      select jsonb_agg(
        jsonb_build_object('label', label, 'count', count)
        order by count desc, label
      )
      from tipification_rows
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day', day,
          'crm_gestiones', crm_gestiones,
          'contactos_efectivos', contactos_efectivos,
          'agendas', agendas
        )
        order by day
      )
      from daily_rows
    ), '[]'::jsonb)
  )
  into v_result
  from totals;

  return v_result;
end;
$function$;

revoke all on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid) to authenticated;
