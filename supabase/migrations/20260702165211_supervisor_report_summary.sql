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
    select l.*
    from public.leads l
    where v_team_id is null or l.team_id = v_team_id
  ),
  team_agents as (
    select p.id, p.full_name, p.email, p.team_id, t.name as team_name
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    where p.role = 'agente'
      and p.active
      and (v_team_id is null or p.team_id = v_team_id)
  ),
  range_calls as (
    select c.*
    from public.calls c
    join team_leads l on l.id = c.lead_id
    where coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
      and c.discarded_reason is null
  ),
  range_interactions as (
    select i.*
    from public.interactions i
    join team_leads l on l.id = i.lead_id
    where i.created_at >= v_from
      and i.created_at <= v_to
  ),
  walked_leads as (
    select lead_id from range_calls where ended_at is not null
    union
    select lead_id from range_interactions
  ),
  contacted_leads as (
    select distinct lead_id
    from range_calls
    where status = 'connected'
  ),
  commercial_calls as (
    select *
    from range_calls
    where outcome = 'sale'
       or reason ilike '%VENTA%'
       or reason ilike '%COTIZACION%'
       or equifax_uf_amount is not null
       or cardinality(coalesce(equifax_products, array[]::text[])) > 0
  ),
  agent_interactions as (
    select
      agent_id,
      count(*)::int as crm_gestiones,
      count(distinct lead_id)::int as leads_gestionados
    from range_interactions
    group by agent_id
  ),
  agent_calls as (
    select
      agent_id,
      count(*) filter (where ended_at is not null)::int as llamadas_cerradas,
      count(distinct lead_id) filter (where status = 'connected')::int as contactos_efectivos,
      count(*) filter (where status in ('no_answer', 'busy', 'voicemail', 'out_of_service'))::int as no_contacto,
      count(*) filter (where next_action_at is not null)::int as agendas,
      count(*) filter (where reason ilike '%COTIZACION%')::int as cotizaciones,
      count(*) filter (where outcome = 'sale' or reason ilike '%VENTA%')::int as ventas,
      coalesce(sum(equifax_uf_amount), 0)::numeric as uf,
      avg(extract(epoch from (ended_at - started_at))) filter (where ended_at is not null and started_at is not null)::numeric as tmo_seconds
    from range_calls
    group by agent_id
  ),
  agent_rows as (
    select
      a.id as agent_id,
      a.full_name,
      a.team_name,
      coalesce(ai.crm_gestiones, 0) as crm_gestiones,
      coalesce(ac.llamadas_cerradas, 0) as llamadas_cerradas,
      coalesce(ai.leads_gestionados, 0) as leads_gestionados,
      coalesce(ac.contactos_efectivos, 0) as contactos_efectivos,
      coalesce(ac.no_contacto, 0) as no_contacto,
      coalesce(ac.agendas, 0) as agendas,
      coalesce(ac.cotizaciones, 0) as cotizaciones,
      coalesce(ac.ventas, 0) as ventas,
      coalesce(ac.uf, 0) as uf,
      ac.tmo_seconds
    from team_agents a
    left join agent_interactions ai on ai.agent_id = a.id
    left join agent_calls ac on ac.agent_id = a.id
  ),
  tipification_events as (
    select nullif(btrim(reason), '') as label
    from range_calls
    where nullif(btrim(reason), '') is not null
    union all
    select nullif(btrim(result), '') as label
    from range_interactions
    where nullif(btrim(result), '') is not null
  ),
  top_tipifications as (
    select
      label,
      count(*)::int as count
    from tipification_events
    group by label
    order by count(*) desc, label
    limit 10
  ),
  daily_rows as (
    select
      date_trunc('day', day_source.day_at)::date as day,
      count(*) filter (where day_source.kind = 'interaction')::int as crm_gestiones,
      count(*) filter (where day_source.kind = 'contact')::int as contactos_efectivos,
      count(*) filter (where day_source.kind = 'agenda')::int as agendas
    from (
      select created_at as day_at, 'interaction'::text as kind from range_interactions
      union all
      select coalesce(ended_at, updated_at, created_at), 'contact' from range_calls where status = 'connected'
      union all
      select coalesce(ended_at, updated_at, created_at), 'agenda' from range_calls where next_action_at is not null
    ) day_source
    group by date_trunc('day', day_source.day_at)::date
    order by day
  ),
  totals as (
    select
      (select count(*)::int from team_leads) as base_total,
      (select count(*)::int from team_leads where assigned_to is not null) as asignados,
      (select count(*)::int from team_leads where assigned_to is null) as sin_asignar,
      (select count(*)::int from walked_leads) as recorridos,
      (select count(*)::int from contacted_leads) as contactados,
      (select count(*)::int from range_interactions) as crm_gestiones,
      (select count(*)::int from range_calls where ended_at is not null) as llamadas_cerradas,
      (select count(*)::int from range_calls where status in ('no_answer', 'busy', 'voicemail', 'out_of_service')) as no_contacto,
      (select count(*)::int from range_calls where next_action_at is not null) as agendas_creadas,
      (select count(*)::int from team_leads where next_action_at is not null and next_action_at < now()) as agendas_vencidas,
      (select count(*)::int from team_leads where next_action_at is not null and next_action_at >= now()) as agendas_pendientes,
      (select count(*)::int from range_calls where reason ilike '%COTIZACION%') as cotizaciones,
      (select count(*)::int from range_calls where outcome = 'sale' or reason ilike '%VENTA%') as ventas,
      (select coalesce(sum(equifax_uf_amount), 0)::numeric from commercial_calls) as uf,
      (select avg(extract(epoch from (ended_at - started_at)))::numeric from range_calls where ended_at is not null and started_at is not null) as tmo_seconds
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
      'contactados', totals.contactados,
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
      'tmo_seconds', totals.tmo_seconds
    ),
    'agents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agent_id', agent_id,
          'full_name', full_name,
          'team_name', team_name,
          'crm_gestiones', crm_gestiones,
          'llamadas_cerradas', llamadas_cerradas,
          'leads_gestionados', leads_gestionados,
          'contactos_efectivos', contactos_efectivos,
          'contactabilidad', case when llamadas_cerradas > 0 then round((contactos_efectivos::numeric / llamadas_cerradas::numeric) * 100, 1) else null end,
          'no_contacto', no_contacto,
          'agendas', agendas,
          'cotizaciones', cotizaciones,
          'ventas', ventas,
          'uf', uf,
          'tmo_seconds', tmo_seconds
        )
        order by crm_gestiones desc, contactos_efectivos desc, full_name
      )
      from agent_rows
    ), '[]'::jsonb),
    'tipifications', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'label', label,
          'count', count
        )
        order by count desc, label
      )
      from top_tipifications
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
