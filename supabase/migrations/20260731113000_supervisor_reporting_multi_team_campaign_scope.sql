-- El alcance del supervisor dejó de ser profiles.team_id: un supervisor puede
-- administrar varios equipos mediante teams.supervisor_id. La reportería debe
-- usar esa misma fuente de autorización y conservar la campaña hasta el
-- detalle, sin depender de los snapshots diarios agregados sin campaign_id.

create or replace function public.get_report_scope_campaigns()
returns table(id uuid, name text)
language sql
stable
security invoker
set search_path = public
as $function$
  select c.id, c.name
  from public.campaigns c
  where c.is_active
    and (
      (select public.current_role_name()) = 'admin'
      or (
        (select public.current_role_name()) = 'supervisor'
        and exists (
          select 1
          from public.leads l
          where l.campaign_id = c.id
        )
      )
      or (
        (select public.current_role_name()) = 'agente'
        and exists (
          select 1
          from public.campaign_agents ca
          where ca.campaign_id = c.id
            and ca.profile_id = (select auth.uid())
        )
      )
    )
  order by c.name;
$function$;

revoke all on function public.get_report_scope_campaigns() from public, anon;
grant execute on function public.get_report_scope_campaigns() to authenticated;

-- La política posterior del screen-pop volvió a usar current_team_id() para
-- call_events. Restituimos el mismo alcance multi-equipo de leads, calls e
-- interactions para que una supervisora no pierda eventos de su segundo
-- equipo al abrir el detalle de una gestión.
drop policy if exists call_events_select on public.call_events;
create policy call_events_select on public.call_events
for select to authenticated using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and (
      lead_id in (
        select l.id
        from public.leads l
        where l.assigned_to = (select auth.uid())
           or l.managed_by = (select auth.uid())
           or (l.assigned_to is null and l.managed_by is null and l.team_id = (select public.current_team_id()))
      )
      or public.has_active_dial_attempt(lead_id)
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and lead_id in (
      select l.id
      from public.leads l
      where l.team_id = any(public.supervised_team_ids())
    )
  )
);

drop policy if exists vocalcom_call_events_select on public.vocalcom_call_events;
create policy vocalcom_call_events_select
on public.vocalcom_call_events
for select to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and exists (
      select 1
      from public.leads l
      where l.id = lead_id
        and l.team_id = any(public.supervised_team_ids())
    )
  )
);

-- Los reportes filtrados se calculan desde los hechos (calls, interactions y
-- vocalcom_call_events). El cache anterior no contiene campaign_id y por eso
-- no puede contestar correctamente una selección de campaña.
create index if not exists leads_report_team_campaign_idx
  on public.leads (team_id, campaign_id, id);

create index if not exists calls_report_lead_activity_idx
  on public.calls (lead_id, (coalesce(ended_at, updated_at, created_at)))
  where discarded_reason is null;

create index if not exists interactions_report_lead_created_idx
  on public.interactions (lead_id, created_at);

create index if not exists campaign_agents_campaign_profile_idx
  on public.campaign_agents (campaign_id, profile_id);

drop function if exists public.get_supervisor_report_summary(timestamptz, timestamptz, uuid);

create function public.get_supervisor_report_summary(
  p_from timestamptz default (now() - interval '30 days'),
  p_to timestamptz default now(),
  p_team_id uuid default null,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_team_ids uuid[];
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;

  if v_role = 'supervisor' then
    v_team_ids := public.supervised_team_ids();
    if coalesce(cardinality(v_team_ids), 0) = 0 then
      raise exception 'Tu supervisor no tiene equipos asignados.';
    end if;
    if p_team_id is not null then
      if not (p_team_id = any(v_team_ids)) then
        raise exception 'No puedes consultar un equipo fuera de tu alcance.';
      end if;
      v_team_ids := array[p_team_id];
    end if;
  elsif v_role = 'admin' then
    if p_team_id is not null then
      v_team_ids := array[p_team_id];
    end if;
  else
    raise exception 'No tienes permisos para ver este reporte.';
  end if;

  with
  scoped_leads as (
    select l.id, l.team_id, l.campaign_id, l.assigned_to, l.next_action_at
    from public.leads l
    where (v_team_ids is null or l.team_id = any(v_team_ids))
      and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  ),
  active_agents as (
    select p.id, p.full_name, t.name as team_name
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    where p.role = 'agente'
      and p.active
      and (v_team_ids is null or p.team_id = any(v_team_ids))
      and (
        p_campaign_id is null
        or exists (
          select 1
          from public.campaign_agents ca
          where ca.profile_id = p.id
            and ca.campaign_id = p_campaign_id
        )
      )
  ),
  call_rows as (
    select
      c.*,
      l.team_id,
      l.campaign_id,
      coalesce(c.ended_at, c.updated_at, c.created_at) as activity_at,
      public.resolve_supervisor_report_agent_key(c.agent_id, c.historical_agent_id) as report_agent_key
    from public.calls c
    join scoped_leads l on l.id = c.lead_id
    where c.discarded_reason is null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
  ),
  interaction_rows as (
    select
      i.*,
      l.team_id,
      l.campaign_id,
      public.resolve_supervisor_report_agent_key(i.agent_id, i.historical_agent_id) as report_agent_key
    from public.interactions i
    join scoped_leads l on l.id = i.lead_id
    where i.created_at >= v_from
      and i.created_at <= v_to
  ),
  vocalcom_rows as (
    select
      v.lead_id,
      coalesce(v.called_at, v.created_at) as activity_at,
      v.connection_status,
      v.duration_seconds
    from public.vocalcom_call_events v
    join scoped_leads l on l.id = v.lead_id
    where v.match_status = 'matched'
      and v.lead_id is not null
      and coalesce(v.called_at, v.created_at) >= v_from
      and coalesce(v.called_at, v.created_at) <= v_to
  ),
  event_agent_keys as (
    select distinct report_agent_key
    from (
      select report_agent_key from call_rows
      union
      select report_agent_key from interaction_rows
    ) keys
    where report_agent_key is not null
  ),
  agent_catalog_source as (
    select
      a.id::text as report_agent_key,
      a.id as profile_id,
      null::uuid as historical_agent_id,
      a.full_name,
      a.team_name,
      false as is_historical_only
    from active_agents a
    union all
    select
      e.report_agent_key,
      p.id as profile_id,
      ha.id as historical_agent_id,
      coalesce(p.full_name, ha.full_name, 'Ejecutivo histórico') as full_name,
      t.name as team_name,
      p.id is null as is_historical_only
    from event_agent_keys e
    left join public.profiles p on p.id::text = e.report_agent_key
    left join public.historical_agents ha on ha.id::text = e.report_agent_key
    left join public.teams t on t.id = p.team_id
  ),
  agent_catalog as (
    select
      report_agent_key,
      max(profile_id) as profile_id,
      max(historical_agent_id) as historical_agent_id,
      max(full_name) as full_name,
      max(team_name) as team_name,
      bool_and(is_historical_only) as is_historical_only
    from agent_catalog_source
    group by report_agent_key
  ),
  call_metrics as (
    select
      report_agent_key,
      count(*) filter (where ended_at is not null)::int as llamadas_cerradas,
      count(distinct lead_id) filter (where status = 'connected')::int as contactos_efectivos,
      count(*) filter (where status in ('no_answer', 'busy', 'voicemail', 'out_of_service'))::int as no_contacto,
      count(*) filter (where next_action_at is not null)::int as agendas,
      count(*) filter (where reason ilike '%COTIZACION%')::int as cotizaciones,
      count(*) filter (where outcome = 'sale' or reason ilike '%VENTA%')::int as ventas,
      coalesce(sum(equifax_uf_amount) filter (where outcome = 'sale' or reason ilike '%VENTA%' or reason ilike '%COTIZACION%' or equifax_uf_amount is not null), 0)::numeric as uf,
      coalesce(sum(extract(epoch from (ended_at - started_at))) filter (where ended_at is not null and started_at is not null), 0)::numeric as tmo_sum_seconds,
      count(*) filter (where ended_at is not null and started_at is not null)::int as tmo_count
    from call_rows
    where report_agent_key is not null
    group by report_agent_key
  ),
  interaction_metrics as (
    select report_agent_key, count(*)::int as crm_gestiones
    from interaction_rows
    where report_agent_key is not null
    group by report_agent_key
  ),
  agent_lead_metrics as (
    select report_agent_key, count(distinct lead_id)::int as leads_gestionados
    from (
      select report_agent_key, lead_id
      from interaction_rows
      where report_agent_key is not null
      union
      select report_agent_key, lead_id
      from call_rows
      where report_agent_key is not null
        and ended_at is not null
    ) touched
    group by report_agent_key
  ),
  agent_rows as (
    select
      a.report_agent_key as agent_id,
      a.profile_id,
      a.historical_agent_id,
      a.full_name,
      a.team_name,
      a.is_historical_only,
      coalesce(i.crm_gestiones, 0)::int as crm_gestiones,
      coalesce(c.llamadas_cerradas, 0)::int as llamadas_cerradas,
      coalesce(l.leads_gestionados, 0)::int as leads_gestionados,
      coalesce(c.contactos_efectivos, 0)::int as contactos_efectivos,
      coalesce(c.no_contacto, 0)::int as no_contacto,
      coalesce(c.agendas, 0)::int as agendas,
      coalesce(c.cotizaciones, 0)::int as cotizaciones,
      coalesce(c.ventas, 0)::int as ventas,
      coalesce(c.uf, 0)::numeric as uf,
      coalesce(c.tmo_sum_seconds, 0)::numeric as tmo_sum_seconds,
      coalesce(c.tmo_count, 0)::int as tmo_count
    from agent_catalog a
    left join call_metrics c on c.report_agent_key = a.report_agent_key
    left join interaction_metrics i on i.report_agent_key = a.report_agent_key
    left join agent_lead_metrics l on l.report_agent_key = a.report_agent_key
  ),
  all_touched_days as (
    select activity_at::date as day, lead_id from call_rows where ended_at is not null
    union
    select created_at::date as day, lead_id from interaction_rows
    union
    select activity_at::date as day, lead_id from vocalcom_rows
  ),
  all_connected_days as (
    select activity_at::date as day, lead_id from call_rows where status = 'connected'
    union
    select activity_at::date as day, lead_id from vocalcom_rows where connection_status = 'connected'
  ),
  all_no_contact_days as (
    select activity_at::date as day, lead_id
    from call_rows
    where status in ('no_answer', 'busy', 'voicemail', 'out_of_service')
    union
    select activity_at::date as day, lead_id
    from vocalcom_rows
    where connection_status = 'not_connected'
  ),
  daily_interactions as (
    select created_at::date as day, count(*)::int as crm_gestiones
    from interaction_rows
    group by created_at::date
  ),
  daily_calls as (
    select activity_at::date as day, count(*) filter (where next_action_at is not null)::int as agendas
    from call_rows
    group by activity_at::date
  ),
  daily_connected as (
    select day, count(*)::int as contactos_efectivos
    from all_connected_days
    group by day
  ),
  daily_rows as (
    select d.day, coalesce(i.crm_gestiones, 0)::int as crm_gestiones,
      coalesce(c.contactos_efectivos, 0)::int as contactos_efectivos,
      coalesce(a.agendas, 0)::int as agendas
    from (
      select day from all_touched_days
      union select day from daily_interactions
      union select day from daily_calls
    ) d
    left join daily_interactions i on i.day = d.day
    left join daily_connected c on c.day = d.day
    left join daily_calls a on a.day = d.day
  ),
  tipification_rows as (
    select label, count(*)::int as count
    from (
      select nullif(btrim(reason), '') as label from call_rows
      union all
      select nullif(btrim(result), '') as label from interaction_rows
    ) tipifications
    where label is not null
    group by label
    order by count(*) desc, label
    limit 10
  ),
  totals as (
    select
      (select count(*)::int from scoped_leads) as base_total,
      (select count(*)::int from scoped_leads where assigned_to is not null) as asignados,
      (select count(*)::int from scoped_leads where assigned_to is null) as sin_asignar,
      coalesce(sum(crm_gestiones), 0)::int as crm_gestiones,
      coalesce(sum(llamadas_cerradas), 0)::int as llamadas_cerradas,
      coalesce(sum(no_contacto), 0)::int as no_contacto,
      coalesce(sum(agendas), 0)::int as agendas_creadas,
      coalesce(sum(cotizaciones), 0)::int as cotizaciones,
      coalesce(sum(ventas), 0)::int as ventas,
      coalesce(sum(uf), 0)::numeric as uf,
      coalesce(sum(tmo_sum_seconds), 0)::numeric as crm_tmo_sum_seconds,
      coalesce(sum(tmo_count), 0)::int as crm_tmo_count
    from agent_rows
  ),
  vocalcom_totals as (
    select
      count(*)::int as vocalcom_recorridos,
      count(*) filter (where connection_status = 'connected')::int as vocalcom_contactados,
      coalesce(sum(duration_seconds) filter (where connection_status = 'connected' and duration_seconds > 0), 0)::numeric as tmo_sum_seconds,
      count(*) filter (where connection_status = 'connected' and duration_seconds > 0)::int as tmo_count
    from vocalcom_rows
  )
  select jsonb_build_object(
    'range', jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'team_id', case when cardinality(v_team_ids) = 1 then v_team_ids[1] else null end,
      'campaign_id', p_campaign_id
    ),
    'kpis', jsonb_build_object(
      'base_total', totals.base_total,
      'asignados', totals.asignados,
      'sin_asignar', totals.sin_asignar,
      'recorridos', (select count(*)::int from all_touched_days),
      'vocalcom_recorridos', vocalcom_totals.vocalcom_recorridos,
      'contactados', (select count(*)::int from all_connected_days),
      'vocalcom_contactados', vocalcom_totals.vocalcom_contactados,
      'contactabilidad', case when (select count(*) from all_touched_days) > 0
        then round(((select count(*) from all_connected_days)::numeric / (select count(*) from all_touched_days)::numeric) * 100, 1)
        else null end,
      'crm_gestiones', totals.crm_gestiones,
      'llamadas_cerradas', totals.llamadas_cerradas,
      'no_contacto', (select count(*)::int from all_no_contact_days),
      'agendas_creadas', totals.agendas_creadas,
      'agendas_vencidas', (select count(*)::int from scoped_leads where next_action_at is not null and next_action_at < now()),
      'agendas_pendientes', (select count(*)::int from scoped_leads where next_action_at is not null and next_action_at >= now()),
      'cotizaciones', totals.cotizaciones,
      'ventas', totals.ventas,
      'uf', totals.uf,
      'tmo_seconds', case when totals.crm_tmo_count + vocalcom_totals.tmo_count > 0
        then (totals.crm_tmo_sum_seconds + vocalcom_totals.tmo_sum_seconds) / (totals.crm_tmo_count + vocalcom_totals.tmo_count)
        else null end
    ),
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'agent_id', agent_id,
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
      ) order by crm_gestiones desc, contactos_efectivos desc, full_name)
      from agent_rows
    ), '[]'::jsonb),
    'tipifications', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', count) order by count desc, label)
      from tipification_rows
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', day,
        'crm_gestiones', crm_gestiones,
        'contactos_efectivos', contactos_efectivos,
        'agendas', agendas
      ) order by day)
      from daily_rows
      where crm_gestiones > 0 or contactos_efectivos > 0 or agendas > 0
    ), '[]'::jsonb)
  )
  into v_result
  from totals cross join vocalcom_totals;

  return v_result;
end;
$function$;

revoke all on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid, uuid) to authenticated;

drop function if exists public.get_team_agent_load();

create function public.get_team_agent_load(p_campaign_id uuid default null)
returns table(
  profile_id uuid,
  full_name text,
  assigned bigint,
  unmanaged bigint,
  today bigint,
  overdue bigint
)
language sql
stable
security invoker
set search_path = public
as $function$
  select
    p.id as profile_id,
    p.full_name,
    count(l.id) as assigned,
    count(l.id) filter (where l.managed_at is null) as unmanaged,
    count(l.id) filter (
      where l.next_action_at > now()
        and l.next_action_at < date_trunc('day', now()) + interval '1 day'
    ) as today,
    count(l.id) filter (where l.next_action_at <= now()) as overdue
  from public.profiles p
  left join public.leads l
    on l.assigned_to = p.id
    and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  where p.role = 'agente'
    and p.active = true
    and (
      p_campaign_id is null
      or exists (
        select 1 from public.campaign_agents ca
        where ca.profile_id = p.id and ca.campaign_id = p_campaign_id
      )
    )
  group by p.id, p.full_name
  order by p.full_name;
$function$;

revoke execute on function public.get_team_agent_load(uuid) from public, anon;
grant execute on function public.get_team_agent_load(uuid) to authenticated, service_role;

drop function if exists public.get_supervisor_report_drilldown(timestamptz, timestamptz, uuid, uuid, text, int);

create function public.get_supervisor_report_drilldown(
  p_from timestamptz,
  p_to timestamptz,
  p_profile_id uuid default null,
  p_historical_agent_id uuid default null,
  p_metric text default 'agendas',
  p_limit int default 100,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_team_ids uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_result jsonb;
begin
  if v_role = 'supervisor' then
    v_team_ids := public.supervised_team_ids();
    if coalesce(cardinality(v_team_ids), 0) = 0 then
      raise exception 'Tu supervisor no tiene equipos asignados.';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'No autorizado';
  end if;

  if p_metric not in ('agendas', 'cotizaciones', 'ventas') then
    raise exception 'Métrica no soportada: %', p_metric;
  end if;

  with linked_historical_agents as (
    select ha.id
    from public.historical_agents ha
    where p_profile_id is not null and ha.linked_profile_id = p_profile_id
  ), base_calls as (
    select c.*, coalesce(c.ended_at, c.updated_at, c.created_at) as activity_at,
      l.full_name, l.rut, l.phone, l.email, l.status as lead_status,
      l.tipificacion_actual, l.observacion_actual, l.next_action_at as lead_next_action_at,
      l.managed_at, camp.name as campaign_name,
      coalesce(p.full_name, ha.full_name, '—') as agent_name
    from public.calls c
    join public.leads l on l.id = c.lead_id
    left join public.campaigns camp on camp.id = l.campaign_id
    left join public.profiles p on p.id = c.agent_id
    left join public.historical_agents ha on ha.id = c.historical_agent_id
    where c.discarded_reason is null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= p_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= p_to
      and (v_team_ids is null or l.team_id = any(v_team_ids))
      and (p_campaign_id is null or l.campaign_id = p_campaign_id)
      and (
        (p_profile_id is not null and (
          (c.agent_id = p_profile_id and c.historical_agent_id is null)
          or c.historical_agent_id in (select id from linked_historical_agents)
        ))
        or (p_historical_agent_id is not null and c.historical_agent_id = p_historical_agent_id)
      )
      and (
        (p_metric = 'agendas' and c.next_action_at is not null)
        or (p_metric = 'cotizaciones' and c.reason ilike '%COTIZACION%')
        or (p_metric = 'ventas' and (c.outcome = 'sale' or c.reason ilike '%VENTA%'))
      )
  ), limited_calls as (
    select * from base_calls order by activity_at desc limit v_limit
  )
  select jsonb_build_object(
    'metric', p_metric,
    'limit', v_limit,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'call_id', lc.id,
      'lead_id', lc.lead_id,
      'activity_at', lc.activity_at,
      'started_at', lc.started_at,
      'ended_at', lc.ended_at,
      'status', lc.status,
      'outcome', lc.outcome,
      'reason', lc.reason,
      'notes', lc.notes,
      'next_action_at', lc.next_action_at,
      'equifax_products', lc.equifax_products,
      'equifax_uf_amount', lc.equifax_uf_amount,
      'equifax_recipient_email', lc.equifax_recipient_email,
      'agent_name', lc.agent_name,
      'lead', jsonb_build_object(
        'id', lc.lead_id,
        'full_name', lc.full_name,
        'rut', lc.rut,
        'phone', lc.phone,
        'email', lc.email,
        'status', lc.lead_status,
        'tipificacion_actual', lc.tipificacion_actual,
        'observacion_actual', lc.observacion_actual,
        'next_action_at', lc.lead_next_action_at,
        'managed_at', lc.managed_at,
        'campaign_name', lc.campaign_name
      ),
      'contacts', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ct.id, 'contact_type', ct.contact_type, 'value', ct.value,
          'label', ct.label, 'is_primary', ct.is_primary, 'is_valid', ct.is_valid
        ) order by ct.is_primary desc, ct.contact_type, ct.created_at), '[]'::jsonb)
        from public.lead_contacts ct
        where ct.lead_id = lc.lead_id
      )
    ) order by lc.activity_at desc), '[]'::jsonb)
  ) into v_result
  from limited_calls lc;

  return coalesce(v_result, jsonb_build_object('metric', p_metric, 'limit', v_limit, 'items', '[]'::jsonb));
end;
$function$;

revoke all on function public.get_supervisor_report_drilldown(timestamptz, timestamptz, uuid, uuid, text, int, uuid) from public, anon;
grant execute on function public.get_supervisor_report_drilldown(timestamptz, timestamptz, uuid, uuid, text, int, uuid) to authenticated;
