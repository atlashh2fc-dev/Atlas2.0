-- Reportes de gestión y del discador: sin llamadas descartadas y con el día de Chile.
--
-- 1. Una llamada descartada (discarded_reason) es un registro anulado: una
--    gestión que nunca se completó, un duplicado o, desde hoy, las 6.052 llamadas
--    de Atlas 1 que quedaron abiertas sin tipificar. El reporte del supervisor y
--    su detalle ya las excluían; el tablero de admin, la contactabilidad por hora
--    y el desglose de tipificaciones no, así que Equifax mostraba ~11 % más de
--    gestiones y contactos en 30 días (74,2 % contra 71,0 %). En las demás
--    campañas hay 51 descartadas en total, casi todas sin motivo ni conexión.
--
-- 2. get_call_metrics_report y get_agent_activity_report reciben fechas de
--    calendario y las convertían con la zona de la sesión, que es UTC: «hoy» iba
--    de las 21:00 de ayer a las 21:00 de hoy en Chile, y lo discado después de las
--    21:00 aparecía al día siguiente. Ahora el día va de medianoche a medianoche
--    en America/Santiago, igual que el selector de período de la pantalla.
--
-- 3. Alcance del supervisor en las tres funciones SECURITY DEFINER que se
--    reescriben: hasta ahora solo miraban la empresa, así que un supervisor veía
--    el discador y los ejecutivos de equipos que no son suyos. Ahora ve lo mismo
--    que en el reporte de gestión: sus equipos (y las campañas que supervisa, en
--    el caso del discador). El admin no cambia.
--
-- 4. La contactabilidad por hora resuelve la frontera de empresa una vez y no
--    por llamada: con el historial de Equifax tardaba ~9 s, sobre el límite de
--    la API.
--
-- El historial de Atlas 1 sigue contando como gestión en estos reportes; lo que
-- sale es solo lo anulado.

-- Tablero de admin (pestaña Gestión y tablero de campaña). Corre como quien
-- consulta; la única diferencia con 20260922142914 es el filtro de descartadas.
create or replace function public.get_crm_dashboard_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_previous_from timestamptz default null,
  p_previous_to timestamptz default null,
  p_campaign_id uuid default null
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with
  params as (
    select
      p_campaign_id as campaign_id,
      p_from as from_at,
      p_to as to_at,
      coalesce(p_previous_from, p_from - (p_to - p_from) - interval '1 millisecond') as previous_from_at,
      coalesce(p_previous_to, p_from - interval '1 millisecond') as previous_to_at
  ),
  -- Campañas visibles para quien consulta; sin filtro, todas las de su empresa.
  scope_campaigns as (
    select c.id
    from public.campaigns c
    join params p on p.campaign_id is null or c.id = p.campaign_id
  ),
  campaign_leads as (
    select
      l.id,
      public.lead_origin_name(
        source_catalog.name,
        l.external_last_source_code,
        l.extra,
        l.legacy_lead_id is not null
      ) as origin_name
    from public.leads l
    join scope_campaigns sc on sc.id = l.campaign_id
    left join public.integration_sources source_catalog
      on source_catalog.code = lower(btrim(l.external_last_source_code))
  ),
  -- Las llamadas del período buscan su lead por llave primaria. Cruzarlas contra
  -- campaign_leads llevaba al planificador a un nested loop sobre toda la base.
  current_calls as (
    select
      c.id,
      c.lead_id,
      l.full_name as lead_full_name,
      public.lead_origin_name(
        source_catalog.name,
        l.external_last_source_code,
        l.extra,
        l.legacy_lead_id is not null
      ) as origin_name,
      c.agent_id,
      coalesce(pr.full_name, 'Sin ejecutivo') as agent_name,
      c.status,
      c.reason,
      c.equifax_products,
      c.equifax_uf_amount,
      c.next_action_at,
      c.started_at
    from public.calls c
    join params p
      on c.started_at >= p.from_at
     and c.started_at <= p.to_at
    join public.leads l on l.id = c.lead_id
    join scope_campaigns sc on sc.id = l.campaign_id
    left join public.integration_sources source_catalog
      on source_catalog.code = lower(btrim(l.external_last_source_code))
    left join public.profiles pr on pr.id = c.agent_id
    where c.discarded_reason is null
  ),
  previous_calls as (
    select
      c.id,
      c.lead_id,
      c.agent_id,
      c.status,
      c.reason,
      c.equifax_uf_amount,
      c.started_at
    from public.calls c
    join params p
      on c.started_at >= p.previous_from_at
     and c.started_at <= p.previous_to_at
    join public.leads l on l.id = c.lead_id
    join scope_campaigns sc on sc.id = l.campaign_id
    where c.discarded_reason is null
  ),
  totals as (
    select count(*)::int as total_leads
    from campaign_leads
  ),
  kpi_current as (
    select
      count(*)::int as gestiones,
      count(*) filter (where status = 'connected')::int as contactadas,
      count(*) filter (where reason = 'VENTA EN VALIDACION')::int as ventas,
      coalesce(sum(equifax_uf_amount) filter (where reason = 'VENTA EN VALIDACION'), 0)::numeric as uf_total,
      count(*) filter (where reason = 'COTIZACION ENVIADA')::int as cotizaciones
    from current_calls
  ),
  kpi_previous as (
    select
      count(*)::int as gestiones,
      count(*) filter (where status = 'connected')::int as contactadas,
      count(*) filter (where reason = 'VENTA EN VALIDACION')::int as ventas,
      coalesce(sum(equifax_uf_amount) filter (where reason = 'VENTA EN VALIDACION'), 0)::numeric as uf_total
    from previous_calls
  ),
  funnel_origin_counts as (
    select 1 as stage_order, 'BBDD asignada'::text as stage_name, origin_name, count(*)::int as value
    from campaign_leads
    group by origin_name

    union all

    select 2, 'Gestionados', origin_name, count(distinct lead_id)::int
    from current_calls
    group by origin_name

    union all

    select 3, 'Contactados', origin_name, count(distinct lead_id)::int
    from current_calls
    where status = 'connected'
    group by origin_name

    union all

    select 4, 'Con resultado', origin_name, count(distinct lead_id)::int
    from current_calls
    where status = 'connected'
      and reason is not null
      and reason <> 'GESTION EN CURSO'
    group by origin_name

    union all

    select 5, 'Venta en validación', origin_name, count(distinct lead_id)::int
    from current_calls
    where reason = 'VENTA EN VALIDACION'
    group by origin_name
  ),
  funnel_origins as (
    select
      stage_order,
      stage_name,
      jsonb_agg(
        jsonb_build_object('name', origin_name, 'value', value)
        order by value desc, origin_name
      ) as data
    from funnel_origin_counts
    group by stage_order, stage_name
  ),
  funnel as (
    select jsonb_build_array(
      jsonb_build_object(
        'name', 'BBDD asignada',
        'value', (select total_leads from totals),
        'origins', coalesce((select data from funnel_origins where stage_order = 1), '[]'::jsonb)
      ),
      jsonb_build_object(
        'name', 'Gestionados',
        'value', count(distinct lead_id),
        'origins', coalesce((select data from funnel_origins where stage_order = 2), '[]'::jsonb)
      ),
      jsonb_build_object(
        'name', 'Contactados',
        'value', count(distinct lead_id) filter (where status = 'connected'),
        'origins', coalesce((select data from funnel_origins where stage_order = 3), '[]'::jsonb)
      ),
      jsonb_build_object(
        'name', 'Con resultado',
        'value', count(distinct lead_id) filter (
          where status = 'connected' and reason is not null and reason <> 'GESTION EN CURSO'
        ),
        'origins', coalesce((select data from funnel_origins where stage_order = 4), '[]'::jsonb)
      ),
      jsonb_build_object(
        'name', 'Venta en validación',
        'value', count(distinct lead_id) filter (where reason = 'VENTA EN VALIDACION'),
        'origins', coalesce((select data from funnel_origins where stage_order = 5), '[]'::jsonb)
      )
    ) as data
    from current_calls
  ),
  reasons as (
    select coalesce(
      jsonb_agg(jsonb_build_object('reason', reason, 'count', total) order by total desc, reason),
      '[]'::jsonb
    ) as data
    from (
      select reason, count(*)::int as total
      from current_calls
      where reason is not null
        and reason <> 'GESTION EN CURSO'
      group by reason
    ) r
  ),
  products as (
    select coalesce(
      jsonb_agg(jsonb_build_object('product', product, 'count', total, 'uf', uf_total) order by total desc, product),
      '[]'::jsonb
    ) as data
    from (
      select product, count(*)::int as total, coalesce(sum(equifax_uf_amount), 0)::numeric as uf_total
      from current_calls
      cross join lateral unnest(coalesce(equifax_products, array[]::text[])) as product
      group by product
    ) p
  ),
  series_days as (
    select generate_series(
      (select (from_at at time zone 'America/Santiago')::date from params),
      (select (to_at at time zone 'America/Santiago')::date from params),
      interval '1 day'
    )::date as day
  ),
  time_series as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(sd.day, 'YYYY-MM-DD'),
          'gestiones', coalesce(d.gestiones, 0),
          'ventas', coalesce(d.ventas, 0)
        )
        order by sd.day
      ),
      '[]'::jsonb
    ) as data
    from series_days sd
    left join (
      select
        (started_at at time zone 'America/Santiago')::date as day,
        count(*)::int as gestiones,
        count(*) filter (where reason = 'VENTA EN VALIDACION')::int as ventas
      from current_calls
      group by (started_at at time zone 'America/Santiago')::date
    ) d on d.day = sd.day
  ),
  agenda as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'lead_full_name', lead_full_name,
          'agent_name', agent_name,
          'reason', reason,
          'next_action_at', next_action_at,
          'overdue', next_action_at < now()
        )
        order by next_action_at, id
      ),
      '[]'::jsonb
    ) as data
    from (
      select *
      from current_calls
      where next_action_at is not null
      order by next_action_at, id
      limit 100
    ) a
  ),
  agents as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'agent_id', agent_id,
          'name', agent_name,
          'gestiones', gestiones,
          'contactos', contactos,
          'ventas', ventas,
          'uf', uf_total
        )
        order by ventas desc, gestiones desc, agent_name
      ),
      '[]'::jsonb
    ) as data
    from (
      select
        agent_id,
        agent_name,
        count(*)::int as gestiones,
        count(*) filter (where status = 'connected')::int as contactos,
        count(*) filter (where reason = 'VENTA EN VALIDACION')::int as ventas,
        coalesce(sum(equifax_uf_amount) filter (where reason = 'VENTA EN VALIDACION'), 0)::numeric as uf_total
      from current_calls
      group by agent_id, agent_name
    ) a
  )
  select jsonb_build_object(
    'total_leads', (select total_leads from totals),
    'range', jsonb_build_object(
      'from', (select from_at from params),
      'to', (select to_at from params),
      'previous_from', (select previous_from_at from params),
      'previous_to', (select previous_to_at from params)
    ),
    'kpis', jsonb_build_object(
      'gestionadas', jsonb_build_object('current', kc.gestiones, 'previous', kp.gestiones),
      'contactadas', jsonb_build_object('current', kc.contactadas, 'previous', kp.contactadas),
      'ventas', jsonb_build_object('current', kc.ventas, 'previous', kp.ventas),
      'uf_total', jsonb_build_object('current', kc.uf_total, 'previous', kp.uf_total),
      'cotizaciones', kc.cotizaciones
    ),
    'funnel', (select data from funnel),
    'reasons', (select data from reasons),
    'products', (select data from products),
    'time_series', (select data from time_series),
    'agenda', (select data from agenda),
    'agents', (select data from agents)
  )
  from kpi_current kc
  cross join kpi_previous kp;
$function$;

revoke all on function public.get_crm_dashboard_summary(timestamptz, timestamptz, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_crm_dashboard_summary(timestamptz, timestamptz, timestamptz, timestamptz, uuid) to authenticated;

-- Contactabilidad por hora: sin descartadas y, para el supervisor, solo sus equipos.
create or replace function public.get_contactability_by_hour(
  p_from timestamptz,
  p_to timestamptz,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := coalesce(public.current_role_name()::text, '');
  v_team_ids uuid[];
  v_org_ids uuid[];
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;

  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permiso para revisar este reporte.';
  end if;

  perform public.assert_org_access(public.org_of_campaign(p_campaign_id));

  -- Empresas visibles, una vez: por fila eran ~9 s en 30 días de Equifax.
  v_org_ids := array(select o.id from public.organizations o where public.can_access_org(o.id));

  if v_role = 'supervisor' then
    v_team_ids := public.supervised_team_ids();
  end if;

  with gestiones as (
    select
      extract(hour from (c.started_at at time zone 'America/Santiago'))::int as hora,
      count(*)::int as gestiones,
      count(*) filter (where c.status = 'connected')::int as contactos,
      count(*) filter (where c.outcome = 'sale')::int as ventas
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.started_at >= p_from
      and c.started_at <= p_to
      and c.ended_at is not null
      and c.discarded_reason is null
      and l.organization_id = any(v_org_ids)
      and (v_team_ids is null or l.team_id = any(v_team_ids))
      and (p_campaign_id is null or l.campaign_id = p_campaign_id)
    group by 1
  ),
  franjas as (
    select generate_series(0, 23) as hora
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'hora', f.hora,
        'label', lpad(f.hora::text, 2, '0') || ':00',
        'gestiones', coalesce(g.gestiones, 0),
        'contactos', coalesce(g.contactos, 0),
        'ventas', coalesce(g.ventas, 0),
        'contactabilidad',
          case
            when coalesce(g.gestiones, 0) = 0 then null
            else round((g.contactos::numeric / g.gestiones) * 100, 1)
          end
      )
      order by f.hora
    ),
    '[]'::jsonb
  )
  into v_result
  from franjas f
  left join gestiones g on g.hora = f.hora;

  return v_result;
end;
$function$;

-- Desglose de tipificaciones (corre como quien consulta).
create or replace function public.get_campaign_tipification_breakdown(
  p_from timestamptz,
  p_to timestamptz,
  p_campaign_id uuid default null
)
returns table(reason text, status text, outcome text, declared_result text, total integer)
language sql
stable
set search_path to 'public'
as $function$
  with nodos as (
    select s.workflow_id,
           upper(translate(opcion, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU')) as motivo,
           s.result_kind
    from public.workflow_steps s
    cross join lateral unnest(s.allowed_results) as opcion
    where s.result_kind is not null
  )
  select c.reason, c.status, c.outcome, n.result_kind, count(*)::integer as total
  from public.calls c
  join public.leads l on l.id = c.lead_id
  left join public.campaigns cm on cm.id = l.campaign_id
  left join nodos n
    on n.workflow_id = cm.workflow_id
   and n.motivo = upper(translate(c.reason, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'))
  where c.started_at >= p_from
    and c.started_at <= p_to
    and (p_campaign_id is null or l.campaign_id = p_campaign_id)
    and c.discarded_reason is null
    and c.reason is not null
    and c.reason <> 'GESTION EN CURSO'
  group by c.reason, c.status, c.outcome, n.result_kind
  order by count(*) desc, c.reason;
$function$;

-- Pestaña Discador: días de Chile y alcance del supervisor por campaña.
create or replace function public.get_call_metrics_report(
  p_date_from date,
  p_date_to date,
  p_campaign_id uuid default null
)
returns table(
  report_date date, campaign_id uuid, campaign_name text, total_attempts integer,
  answered integer, completed integer, no_answer integer, busy integer, failed integer,
  abandoned integer, voicemail integer, avg_ring_seconds numeric, avg_talk_seconds numeric,
  abandonment_rate numeric, service_level_20s numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := coalesce(public.current_role_name()::text, '');
  v_from timestamptz := (p_date_from::timestamp at time zone 'America/Santiago');
  v_to timestamptz := ((p_date_to + 1)::timestamp at time zone 'America/Santiago');
begin
  if v_role not in ('admin', 'supervisor') then
    raise exception 'get_call_metrics_report solo puede ser llamada por admin o supervisor.';
  end if;

  return query
  -- Se decide primero qué campañas se pueden ver (son pocas) y recién después
  -- se recorren sus intentos: la guardia no se evalúa fila por fila.
  with campanas as (
    select camp.id, camp.name
    from public.campaigns camp
    where public.can_access_org(camp.organization_id)
      and (p_campaign_id is null or camp.id = p_campaign_id)
      and (v_role = 'admin' or public.can_supervise_campaign(camp.id))
  )
  select
    (da.originated_at at time zone 'America/Santiago')::date as report_date,
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
  join campanas camp on camp.id = da.campaign_id
  where da.originated_at is not null
    and da.originated_at >= v_from
    and da.originated_at < v_to
  group by 1, da.campaign_id, camp.name
  order by 1, 3;
end;
$function$;

-- Actividad por ejecutivo: días de Chile y, para el supervisor, solo sus equipos.
create or replace function public.get_agent_activity_report(
  p_date_from date,
  p_date_to date,
  p_campaign_id uuid default null
)
returns table(
  profile_id uuid, full_name text, calls_handled integer, talk_seconds numeric,
  avg_handle_seconds numeric, logged_in_seconds numeric, productive_seconds numeric,
  occupancy_rate numeric, scheduled_seconds numeric, available_seconds numeric,
  paused_seconds numeric, disconnected_seconds numeric, adherence_rate numeric
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
    select sw.pid, greatest(sw.starts_at, v_from) as starts_at,
      least(sw.ends_at, v_to) as ends_at
    from schedule_windows sw
    where least(sw.ends_at, v_to) > greatest(sw.starts_at, v_from)
  ),
  schedule_agg as (
    select cs.pid, sum(extract(epoch from (cs.ends_at - cs.starts_at))) as scheduled
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
      sum(ris.seconds) filter (where ris.code = 'desconectado') as disconnected
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
    case when v_scoped or sa.pid is null then null else round(100.0 * coalesce(ra.available, 0) / nullif(sa.scheduled, 0), 1) end
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

-- Las funciones de la frontera de empresa deben seguir filtrando después de
-- reescribirlas (ver 20260917184658): si alguna perdió can_access_org, se aborta.
do $$
declare
  v_faltan text;
begin
  select string_agg(p.proname, ', ')
    into v_faltan
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'get_management_integrity_report', 'get_supervisor_report_summary',
       'get_call_metrics_report', 'get_agent_activity_report', 'get_contactability_by_hour'
     )
     and pg_get_functiondef(p.oid) !~ 'can_access_org';

  if v_faltan is not null then
    raise exception 'Informes sin filtro de empresa: %', v_faltan;
  end if;
end
$$;
