-- Reporte del supervisor: el historial de Atlas 1 queda visible, pero ya no
-- distorsiona TMO, gestiones ni tipificaciones.
--
-- Cambios sobre la versión anterior (20260917184658, misma frontera de empresa
-- y mismo alcance del supervisor):
--   * TMO: solo con public.report_call_handle_seconds. Las llamadas migradas
--     siguen contando como llamadas cerradas, contactos y agendas; lo que se
--     deja de sumar es una duración que Atlas 1 nunca midió.
--   * Las interacciones de una llamada descartada ya no cuentan como gestión CRM
--     ni como recorrido. Eran las 6.056 «abiertas sin tipificar en Atlas 1»: la
--     migración escribe una interacción por llamada con metadata.call_id.
--   * Tipificaciones: cada gestión se cuenta una vez. Antes se sumaban
--     calls.reason y interactions.result de la misma gestión (NUMERO ERRONEO
--     salía 5.296 veces con 2.674 llamadas), y la interacción de una llamada sin
--     motivo aportaba la etiqueta técnica «connected». Ahora la interacción solo
--     aporta su resultado cuando no declara una llamada en metadata.call_id.
--   * Ventas y cotizaciones: la venta es outcome = 'sale' y la cotización el
--     motivo «COTIZACION ENVIADA» (public.report_call_is_quote). Buscar «VENTA»
--     en el motivo contaba las 206 «CLIENTE NO SUJETO A VENTA» de Atlas 1: en
--     septiembre Equifax mostraba 37 ventas y eran 5. El UF sigue siendo la
--     suma de equifax_uf_amount, igual que antes.
--   * kpis.llamadas_atlas1: cuántas de las llamadas cerradas del período son
--     historial migrado. El reporte las sigue contando (son gestiones reales
--     del equipo), pero el supervisor ve qué parte no se hizo en Atlas 2.0.
--   * El día del gráfico diario y de los recorridos se corta en hora Chile. En
--     UTC, lo hecho después de las 21:00 caía al día siguiente.
--   * La frontera de empresa se resuelve una vez y no por lead. Con la base de
--     Equifax cargada hoy (145 mil leads) el reporte tardaba más de un minuto y
--     la API lo cortaba por tiempo.
--
-- Efecto en otras campañas: solo el TMO (se descartan gestiones abiertas más de
-- 2 horas, 13 en toda la base), las tipificaciones (dejan de salir dobles) y el
-- corte del día. Ninguna llamada nativa descartada tiene interacción, así que las
-- gestiones CRM de las demás campañas no cambian. Ventas y cotizaciones tampoco:
-- toda llamada nativa con «VENTA» en el motivo ya tenía outcome 'sale', y toda
-- cotización nativa usa el motivo exacto.

-- Las interacciones se cruzan con las llamadas descartadas por el texto de
-- metadata.call_id. Son pocas (6.107 hoy), así que un índice parcial basta para
-- que el cruce no recorra calls: ni en el reporte ni en los recálculos que
-- disparan los triggers de cada llamada.
create index if not exists calls_discarded_id_text_idx
  on public.calls ((id::text))
  where discarded_reason is not null;

create or replace function public.get_supervisor_report_summary(
  p_from timestamptz default (now() - interval '30 days'),
  p_to timestamptz default now(),
  p_team_id uuid default null,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_team_ids uuid[];
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_org_ids uuid[];
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;

  -- Empresas visibles, resueltas una vez. can_access_org por fila de leads
  -- cuesta ~0,7 ms (consulta current_org_ids en cada llamada) y con los 145 mil
  -- leads de Equifax el reporte pasaba del minuto.
  v_org_ids := array(select o.id from public.organizations o where public.can_access_org(o.id));

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
  lead_scope as materialized (
    select l.id, l.assigned_to, l.next_action_at
    from public.leads l
    where l.organization_id = any(v_org_ids) and (v_team_ids is null or l.team_id = any(v_team_ids))
      and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  ),
  lead_totals as (
    select
      count(*)::int as base_total,
      count(*) filter (where assigned_to is not null)::int as asignados,
      count(*) filter (where assigned_to is null)::int as sin_asignar,
      count(*) filter (where next_action_at is not null and next_action_at < now())::int as agendas_vencidas,
      count(*) filter (where next_action_at is not null and next_action_at >= now())::int as agendas_pendientes
    from lead_scope
  ),
  active_agents as (
    select p.id, p.full_name, t.name as team_name
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    where p.role = 'agente'
      and p.active
      and (v_team_ids is null or p.team_id = any(v_team_ids))
      and (p_campaign_id is null or exists (
        select 1 from public.campaign_agents ca
        where ca.profile_id = p.id and ca.campaign_id = p_campaign_id))
  ),
  call_rows as materialized (
    select
      c.lead_id, c.status, c.reason, c.outcome, c.ended_at, c.started_at,
      c.next_action_at, c.equifax_uf_amount,
      public.report_call_handle_seconds(c.started_at, c.ended_at, c.legacy_call_id) as handle_seconds,
      c.legacy_call_id is not null as is_legacy,
      coalesce(c.ended_at, c.updated_at, c.created_at) as activity_at,
      coalesce(ha.linked_profile_id::text, c.historical_agent_id::text, c.agent_id::text) as report_agent_key
    from public.calls c
    left join public.historical_agents ha
      on ha.id = c.historical_agent_id and ha.linked_profile_id is not null
    where c.discarded_reason is null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
      and c.lead_id in (select id from lead_scope)
  ),
  interaction_rows as materialized (
    select
      i.lead_id, i.created_at, i.result,
      -- La interacción que acompaña a una llamada no es una segunda tipificación.
      i.metadata ? 'call_id' as has_call,
      coalesce(ha.linked_profile_id::text, i.historical_agent_id::text, i.agent_id::text) as report_agent_key
    from public.interactions i
    left join public.historical_agents ha
      on ha.id = i.historical_agent_id and ha.linked_profile_id is not null
    where i.created_at >= v_from and i.created_at <= v_to
      and i.lead_id in (select id from lead_scope)
      -- Se compara como texto contra las pocas llamadas descartadas: convertir
      -- metadata a uuid en cada fila costaba ~0,8 s en 180 días.
      and not exists (
        select 1 from public.calls discarded
        where discarded.discarded_reason is not null
          and discarded.id::text = i.metadata ->> 'call_id'
      )
  ),
  vocalcom_rows as materialized (
    select v.lead_id, coalesce(v.called_at, v.created_at) as activity_at,
           v.connection_status, v.duration_seconds
    from public.vocalcom_call_events v
    where v.match_status = 'matched' and v.lead_id is not null
      and coalesce(v.called_at, v.created_at) >= v_from
      and coalesce(v.called_at, v.created_at) <= v_to
      and v.lead_id in (select id from lead_scope)
  ),
  agent_events as (
    select report_agent_key, lead_id, true as is_call, status, reason, outcome,
           ended_at, started_at, next_action_at, equifax_uf_amount, handle_seconds, is_legacy
    from call_rows
    union all
    select report_agent_key, lead_id, false, null::text, null::text, null::text,
           null::timestamptz, null::timestamptz, null::timestamptz, null::numeric, null::numeric, false
    from interaction_rows
  ),
  agent_metrics as (
    select
      report_agent_key,
      count(*) filter (where not is_call)::int as crm_gestiones,
      count(*) filter (where is_call and ended_at is not null)::int as llamadas_cerradas,
      count(distinct lead_id) filter (where (not is_call) or ended_at is not null)::int as leads_gestionados,
      count(distinct lead_id) filter (where is_call and status = 'connected')::int as contactos_efectivos,
      count(*) filter (where is_call and status in ('no_answer','busy','voicemail','out_of_service'))::int as no_contacto,
      count(*) filter (where is_call and next_action_at is not null)::int as agendas,
      count(*) filter (where is_call and public.report_call_is_quote(reason))::int as cotizaciones,
      -- Venta es lo que se declaró venta; buscar «VENTA» en el motivo contaba
      -- «CLIENTE NO SUJETO A VENTA».
      count(*) filter (where is_call and outcome = 'sale')::int as ventas,
      count(*) filter (where is_call and is_legacy and ended_at is not null)::int as llamadas_atlas1,
      coalesce(sum(equifax_uf_amount) filter (where is_call), 0)::numeric as uf,
      coalesce(sum(handle_seconds) filter (where is_call and handle_seconds is not null), 0)::numeric as tmo_sum_seconds,
      count(*) filter (where is_call and handle_seconds is not null)::int as tmo_count
    from agent_events
    where report_agent_key is not null
    group by report_agent_key
  ),
  agent_catalog_source as (
    select a.id::text as report_agent_key, a.id as profile_id, null::uuid as historical_agent_id,
           a.full_name, a.team_name, false as is_historical_only
    from active_agents a
    union all
    select m.report_agent_key, p.id, ha.id,
           coalesce(p.full_name, ha.full_name, 'Ejecutivo histórico'), t.name, p.id is null
    from agent_metrics m
    left join public.profiles p on p.id::text = m.report_agent_key
    left join public.historical_agents ha on ha.id::text = m.report_agent_key
    left join public.teams t on t.id = p.team_id
  ),
  agent_catalog as (
    select report_agent_key,
      (array_agg(profile_id order by profile_id) filter (where profile_id is not null))[1] as profile_id,
      (array_agg(historical_agent_id order by historical_agent_id) filter (where historical_agent_id is not null))[1] as historical_agent_id,
      max(full_name) as full_name, max(team_name) as team_name,
      bool_and(is_historical_only) as is_historical_only
    from agent_catalog_source group by report_agent_key
  ),
  agent_rows as (
    select a.report_agent_key as agent_id, a.profile_id, a.historical_agent_id,
      a.full_name, a.team_name, a.is_historical_only,
      coalesce(m.crm_gestiones,0)::int as crm_gestiones,
      coalesce(m.llamadas_cerradas,0)::int as llamadas_cerradas,
      coalesce(m.leads_gestionados,0)::int as leads_gestionados,
      coalesce(m.contactos_efectivos,0)::int as contactos_efectivos,
      coalesce(m.no_contacto,0)::int as no_contacto,
      coalesce(m.agendas,0)::int as agendas,
      coalesce(m.cotizaciones,0)::int as cotizaciones,
      coalesce(m.ventas,0)::int as ventas,
      coalesce(m.uf,0)::numeric as uf,
      coalesce(m.tmo_sum_seconds,0)::numeric as tmo_sum_seconds,
      coalesce(m.tmo_count,0)::int as tmo_count
    from agent_catalog a left join agent_metrics m on m.report_agent_key = a.report_agent_key
  ),
  day_lead_flags as materialized (
    select day, lead_id, bool_or(touched) as touched, bool_or(connected) as connected,
           bool_or(no_contact) as no_contact
    from (
      select (activity_at at time zone 'America/Santiago')::date as day, lead_id, ended_at is not null as touched,
             status = 'connected' as connected,
             status in ('no_answer','busy','voicemail','out_of_service') as no_contact
      from call_rows
      union all
      select (created_at at time zone 'America/Santiago')::date, lead_id, true, false, false from interaction_rows
      union all
      select (activity_at at time zone 'America/Santiago')::date, lead_id, true, connection_status = 'connected',
             connection_status = 'not_connected'
      from vocalcom_rows
    ) e group by day, lead_id
  ),
  day_flag_totals as (
    select count(*) filter (where touched)::int as recorridos,
           count(*) filter (where connected)::int as contactados,
           count(*) filter (where no_contact)::int as no_contacto
    from day_lead_flags
  ),
  daily_raw as (
    select day, sum(crm)::int as crm_gestiones, sum(ag)::int as agendas
    from (
      select (created_at at time zone 'America/Santiago')::date as day, 1 as crm, 0 as ag from interaction_rows
      union all
      select (activity_at at time zone 'America/Santiago')::date, 0,
             case when next_action_at is not null then 1 else 0 end
      from call_rows
    ) x group by day
  ),
  daily_rows as (
    select f.day, coalesce(r.crm_gestiones,0)::int as crm_gestiones,
           f.contactos_efectivos, coalesce(r.agendas,0)::int as agendas
    from (select day, count(*) filter (where connected)::int as contactos_efectivos
          from day_lead_flags group by day) f
    left join daily_raw r on r.day = f.day
  ),
  tipification_rows as (
    select label, count(*)::int as count
    from (
      select nullif(btrim(reason),'') as label from call_rows
      union all
      select nullif(btrim(result),'') as label from interaction_rows where not has_call
    ) tipifications
    where label is not null group by label
    order by count(*) desc, label limit 10
  ),
  totals as (
    select coalesce(sum(crm_gestiones),0)::int as crm_gestiones,
      coalesce(sum(llamadas_cerradas),0)::int as llamadas_cerradas,
      coalesce(sum(llamadas_atlas1),0)::int as llamadas_atlas1,
      coalesce(sum(agendas),0)::int as agendas_creadas,
      coalesce(sum(cotizaciones),0)::int as cotizaciones,
      coalesce(sum(ventas),0)::int as ventas,
      coalesce(sum(uf),0)::numeric as uf,
      coalesce(sum(tmo_sum_seconds),0)::numeric as crm_tmo_sum_seconds,
      coalesce(sum(tmo_count),0)::int as crm_tmo_count
    from agent_metrics
  ),
  vocalcom_totals as (
    select count(*)::int as vocalcom_recorridos,
      count(*) filter (where connection_status = 'connected')::int as vocalcom_contactados,
      coalesce(sum(duration_seconds) filter (where connection_status = 'connected' and duration_seconds > 0),0)::numeric as tmo_sum_seconds,
      count(*) filter (where connection_status = 'connected' and duration_seconds > 0)::int as tmo_count
    from vocalcom_rows
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to,
      'team_id', case when cardinality(v_team_ids) = 1 then v_team_ids[1] else null end,
      'campaign_id', p_campaign_id),
    'kpis', jsonb_build_object(
      'base_total', lead_totals.base_total,
      'asignados', lead_totals.asignados,
      'sin_asignar', lead_totals.sin_asignar,
      'recorridos', day_flag_totals.recorridos,
      'vocalcom_recorridos', vocalcom_totals.vocalcom_recorridos,
      'contactados', day_flag_totals.contactados,
      'vocalcom_contactados', vocalcom_totals.vocalcom_contactados,
      'contactabilidad', case when day_flag_totals.recorridos > 0
        then round((day_flag_totals.contactados::numeric / day_flag_totals.recorridos::numeric) * 100, 1) else null end,
      'crm_gestiones', totals.crm_gestiones,
      'llamadas_cerradas', totals.llamadas_cerradas,
      -- Cuántas de esas llamadas vienen del historial de Atlas 1, para que el
      -- supervisor sepa qué parte del período no se hizo en Atlas 2.0.
      'llamadas_atlas1', totals.llamadas_atlas1,
      'no_contacto', day_flag_totals.no_contacto,
      'agendas_creadas', totals.agendas_creadas,
      'agendas_vencidas', lead_totals.agendas_vencidas,
      'agendas_pendientes', lead_totals.agendas_pendientes,
      'cotizaciones', totals.cotizaciones,
      'ventas', totals.ventas,
      'uf', totals.uf,
      'tmo_seconds', case when totals.crm_tmo_count + vocalcom_totals.tmo_count > 0
        then (totals.crm_tmo_sum_seconds + vocalcom_totals.tmo_sum_seconds) / (totals.crm_tmo_count + vocalcom_totals.tmo_count)
        else null end),
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'agent_id', agent_id, 'profile_id', profile_id, 'historical_agent_id', historical_agent_id,
        'full_name', full_name, 'team_name', team_name, 'is_historical_only', is_historical_only,
        'crm_gestiones', crm_gestiones, 'llamadas_cerradas', llamadas_cerradas,
        'leads_gestionados', leads_gestionados, 'contactos_efectivos', contactos_efectivos,
        'contactabilidad', case when leads_gestionados > 0
          then round((contactos_efectivos::numeric / leads_gestionados::numeric) * 100, 1) else null end,
        'no_contacto', no_contacto, 'agendas', agendas, 'cotizaciones', cotizaciones,
        'ventas', ventas, 'uf', uf,
        'tmo_seconds', case when tmo_count > 0 then tmo_sum_seconds / tmo_count else null end)
        order by crm_gestiones desc, contactos_efectivos desc, full_name)
      from agent_rows), '[]'::jsonb),
    'tipifications', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', count) order by count desc, label)
      from tipification_rows), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'crm_gestiones', crm_gestiones,
        'contactos_efectivos', contactos_efectivos, 'agendas', agendas) order by day)
      from daily_rows
      where crm_gestiones > 0 or contactos_efectivos > 0 or agendas > 0), '[]'::jsonb))
  into v_result
  from lead_totals cross join day_flag_totals cross join totals cross join vocalcom_totals;

  return v_result;
end
$function$;

revoke all on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- Tablas precalculadas supervisor_report_daily_*.
--
-- Ninguna pantalla las lee hoy (las mantienen los triggers de calls e
-- interactions), pero guardaban el TMO de ~17,7 h que detectó la auditoría. Se
-- alinean con la regla del reporte en vivo para que nadie las vuelva a usar con
-- cifras falsas. Su día sigue cortado en UTC: cambiarlo exige mover a la vez los
-- triggers y los recálculos por rango, y no vale la pena mientras nadie las lea.
-- Las tablas de tipificaciones se alinean en 20260924183400. Después de aplicar
-- hay que recalcular todos los equipos desde marzo (ver la nota de entrega): lo
-- ya guardado no se corrige solo.

create or replace function public.refresh_supervisor_report_agent_metric_row(p_day date, p_team_id uuid, p_report_agent_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_profile_id uuid;
  v_historical_agent_id uuid;
begin
  if p_day is null or p_team_id is null or nullif(btrim(p_report_agent_key), '') is null then
    return;
  end if;

  select p.id
  into v_profile_id
  from public.profiles p
  where p.id::text = p_report_agent_key;

  select ha.id
  into v_historical_agent_id
  from public.historical_agents ha
  where ha.id::text = p_report_agent_key
    and ha.linked_profile_id is null;

  if v_profile_id is null and v_historical_agent_id is null then
    delete from public.supervisor_report_daily_agent_metrics
    where metric_day = p_day
      and team_id = p_team_id
      and report_agent_key = p_report_agent_key;
    return;
  end if;

  v_from := p_day::timestamptz;
  v_to := (p_day + 1)::timestamptz;

  with
  linked_historical_agents as (
    select ha.id
    from public.historical_agents ha
    where ha.linked_profile_id = v_profile_id
  ),
  day_interactions as (
    select i.lead_id
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where l.team_id = p_team_id
      and i.created_at >= v_from
      and i.created_at < v_to
      and not exists (
        select 1 from public.calls discarded
        where discarded.discarded_reason is not null
          and discarded.id::text = i.metadata ->> 'call_id'
      )
      and (
        (
          v_profile_id is not null
          and (
            (i.agent_id = v_profile_id and i.historical_agent_id is null)
            or i.historical_agent_id in (select id from linked_historical_agents)
          )
        )
        or (
          v_historical_agent_id is not null
          and i.historical_agent_id = v_historical_agent_id
        )
      )
  ),
  day_calls as (
    select c.*, public.report_call_handle_seconds(c.started_at, c.ended_at, c.legacy_call_id) as handle_seconds
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where l.team_id = p_team_id
      and c.discarded_reason is null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) < v_to
      and (
        (
          v_profile_id is not null
          and (
            (c.agent_id = v_profile_id and c.historical_agent_id is null)
            or c.historical_agent_id in (select id from linked_historical_agents)
          )
        )
        or (
          v_historical_agent_id is not null
          and c.historical_agent_id = v_historical_agent_id
        )
      )
  ),
  touched_leads as (
    select lead_id from day_interactions
    union
    select lead_id from day_calls where ended_at is not null
  ),
  metrics as (
    select
      (select count(*)::int from day_interactions) as crm_gestiones,
      (select count(*)::int from touched_leads) as leads_gestionados,
      (select count(*)::int from day_calls where ended_at is not null) as llamadas_cerradas,
      (select count(distinct lead_id)::int from day_calls where status = 'connected') as contactos_efectivos,
      (select count(*)::int from day_calls where status in ('no_answer', 'busy', 'voicemail', 'out_of_service')) as no_contacto,
      (select count(*)::int from day_calls where next_action_at is not null) as agendas,
      (select count(*)::int from day_calls where public.report_call_is_quote(reason)) as cotizaciones,
      (select count(*)::int from day_calls where outcome = 'sale') as ventas,
      (select coalesce(sum(equifax_uf_amount), 0)::numeric from day_calls) as uf,
      (select coalesce(sum(handle_seconds), 0)::numeric from day_calls where handle_seconds is not null) as tmo_sum_seconds,
      (select count(*)::int from day_calls where handle_seconds is not null) as tmo_count
  )
  insert into public.supervisor_report_daily_agent_metrics (
    metric_day,
    team_id,
    report_agent_key,
    profile_id,
    historical_agent_id,
    crm_gestiones,
    leads_gestionados,
    llamadas_cerradas,
    contactos_efectivos,
    no_contacto,
    agendas,
    cotizaciones,
    ventas,
    uf,
    tmo_sum_seconds,
    tmo_count,
    refreshed_at
  )
  select
    p_day,
    p_team_id,
    p_report_agent_key,
    v_profile_id,
    v_historical_agent_id,
    crm_gestiones,
    leads_gestionados,
    llamadas_cerradas,
    contactos_efectivos,
    no_contacto,
    agendas,
    cotizaciones,
    ventas,
    uf,
    tmo_sum_seconds,
    tmo_count,
    now()
  from metrics
  where crm_gestiones > 0
     or leads_gestionados > 0
     or llamadas_cerradas > 0
     or contactos_efectivos > 0
     or no_contacto > 0
     or agendas > 0
     or cotizaciones > 0
     or ventas > 0
     or uf <> 0
     or tmo_count > 0
  on conflict (metric_day, team_id, report_agent_key) do update
  set
    profile_id = excluded.profile_id,
    historical_agent_id = excluded.historical_agent_id,
    crm_gestiones = excluded.crm_gestiones,
    leads_gestionados = excluded.leads_gestionados,
    llamadas_cerradas = excluded.llamadas_cerradas,
    contactos_efectivos = excluded.contactos_efectivos,
    no_contacto = excluded.no_contacto,
    agendas = excluded.agendas,
    cotizaciones = excluded.cotizaciones,
    ventas = excluded.ventas,
    uf = excluded.uf,
    tmo_sum_seconds = excluded.tmo_sum_seconds,
    tmo_count = excluded.tmo_count,
    refreshed_at = now();

  if not found then
    delete from public.supervisor_report_daily_agent_metrics
    where metric_day = p_day
      and team_id = p_team_id
      and report_agent_key = p_report_agent_key;
  end if;
end;
$function$;

create or replace function public.refresh_supervisor_report_metric_row(p_day date, p_team_id uuid, p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_agent_exists boolean;
begin
  if p_day is null or p_team_id is null or p_agent_id is null then
    return;
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = p_agent_id
      and p.team_id = p_team_id
      and p.role = 'agente'
  )
  into v_agent_exists;

  if not v_agent_exists then
    delete from public.supervisor_report_daily_metrics
    where metric_day = p_day
      and team_id = p_team_id
      and agent_id = p_agent_id;
    return;
  end if;

  v_from := p_day::timestamptz;
  v_to := (p_day + 1)::timestamptz;

  with
  day_interactions as (
    select i.lead_id
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where i.agent_id = p_agent_id
      and l.team_id = p_team_id
      and i.created_at >= v_from
      and i.created_at < v_to
      and not exists (
        select 1 from public.calls discarded
        where discarded.discarded_reason is not null
          and discarded.id::text = i.metadata ->> 'call_id'
      )
  ),
  day_calls as (
    select c.*, public.report_call_handle_seconds(c.started_at, c.ended_at, c.legacy_call_id) as handle_seconds
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.agent_id = p_agent_id
      and l.team_id = p_team_id
      and c.discarded_reason is null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) < v_to
  ),
  touched_leads as (
    select lead_id from day_interactions
    union
    select lead_id from day_calls where ended_at is not null
  ),
  metrics as (
    select
      (select count(*)::int from day_interactions) as crm_gestiones,
      (select count(*)::int from touched_leads) as leads_gestionados,
      (select count(*)::int from day_calls where ended_at is not null) as llamadas_cerradas,
      (select count(distinct lead_id)::int from day_calls where status = 'connected') as contactos_efectivos,
      (select count(*)::int from day_calls where status in ('no_answer', 'busy', 'voicemail', 'out_of_service')) as no_contacto,
      (select count(*)::int from day_calls where next_action_at is not null) as agendas,
      (select count(*)::int from day_calls where public.report_call_is_quote(reason)) as cotizaciones,
      (select count(*)::int from day_calls where outcome = 'sale') as ventas,
      (select coalesce(sum(equifax_uf_amount), 0)::numeric from day_calls) as uf,
      (select coalesce(sum(handle_seconds), 0)::numeric from day_calls where handle_seconds is not null) as tmo_sum_seconds,
      (select count(*)::int from day_calls where handle_seconds is not null) as tmo_count
  )
  insert into public.supervisor_report_daily_metrics (
    metric_day,
    team_id,
    agent_id,
    crm_gestiones,
    leads_gestionados,
    llamadas_cerradas,
    contactos_efectivos,
    no_contacto,
    agendas,
    cotizaciones,
    ventas,
    uf,
    tmo_sum_seconds,
    tmo_count,
    refreshed_at
  )
  select
    p_day,
    p_team_id,
    p_agent_id,
    crm_gestiones,
    leads_gestionados,
    llamadas_cerradas,
    contactos_efectivos,
    no_contacto,
    agendas,
    cotizaciones,
    ventas,
    uf,
    tmo_sum_seconds,
    tmo_count,
    now()
  from metrics
  on conflict (metric_day, team_id, agent_id) do update
  set
    crm_gestiones = excluded.crm_gestiones,
    leads_gestionados = excluded.leads_gestionados,
    llamadas_cerradas = excluded.llamadas_cerradas,
    contactos_efectivos = excluded.contactos_efectivos,
    no_contacto = excluded.no_contacto,
    agendas = excluded.agendas,
    cotizaciones = excluded.cotizaciones,
    ventas = excluded.ventas,
    uf = excluded.uf,
    tmo_sum_seconds = excluded.tmo_sum_seconds,
    tmo_count = excluded.tmo_count,
    refreshed_at = now();
end;
$function$;
