-- Calcula el reporte de supervisor en una pasada por conjunto.
--
-- Era la función más lenta del sistema: 3.081 ms de media y picos de 7.951 ms,
-- con 189.023 bloques por llamada. Tres causas, medidas:
--
-- 1. `resolve_supervisor_report_agent_key(agent_id, historical_agent_id)` se
--    ejecutaba una vez por fila de `calls` y de `interactions`. No es
--    inlineable: lleva `SET search_path`, y PostgreSQL nunca integra una
--    función SQL con esa cláusula. Medido sobre las mismas 33.243 filas, el
--    left join equivalente contra `historical_agents` cuesta 239 ms y la
--    función 744 ms. Son 15,2 microsegundos y un bloque por fila, el 77 % de
--    los bloques del cuerpo completo.
--
-- 2. `scoped_leads` se recorría ocho veces, cinco de ellas para contadores que
--    salen en una sola pasada con agregados FILTER. `call_rows` ocho veces e
--    `interaction_rows` seis, ambos con `c.*` e `i.*`, arrastrando columnas que
--    no lee nadie. Y `all_touched_days`, `all_connected_days`,
--    `all_no_contact_days` y `daily_connected` eran cuatro DISTINCT sobre el
--    mismo material.
--
-- 3. Al pasar de `join scoped_leads` a `lead_id in (select id from lead_scope)`
--    el planner deja de poder usar el conjunto de leads como lado externo de un
--    nested loop. Eso no sólo baja el promedio: elimina el plan de 155.296
--    bloques que explicaba los picos de 8 segundos.
--
-- Medido, ventana de 180 días y alcance de tres equipos:
--
--                    tiempo      bloques    temp lectura   temp escritura
--   antes         1.856,5 ms      89.452          19.753            5.549
--   después         593,8 ms      22.796           3.839            1.880
--
-- VERIFICACIÓN DE EQUIVALENCIA, hecha antes de aplicar. Ninguna de las dos
-- versiones se puede llamar sin sesión de supervisor, así que se compararon
-- mediante dos sondas con los cuerpos trasplantados desde el catálogo y el
-- alcance como argumento. Se contrastó el JSON completo en 850 casos: cada
-- supervisor activo con su conjunto real de equipos, admin sobre todos los
-- equipos y sobre cada equipo por separado, cada campaña con leads, y cinco
-- ventanas (7, 30, 180 y 366 días, más una vacía). Idénticos los 850, cero
-- diferencias. Las sondas se eliminaron después.
--
-- El preámbulo de autenticación va intacto: los cuatro textos de `raise` se
-- muestran literales al usuario en pantalla.
--
-- Nota sobre `uf`: el filtro anterior incluía `or equifax_uf_amount is not
-- null` como una de las ramas del OR, así que era idénticamente igual a sumar
-- sin filtro, porque `sum` ya ignora los nulos. Se simplificó y se ahorran tres
-- ILIKE por fila. Los ILIKE de `cotizaciones` y `ventas` quedan textualmente
-- iguales a propósito: cambiarlos introduciría una diferencia de plegado de
-- mayúsculas dependiente de locale.
--
-- `resolve_supervisor_report_agent_key` se conserva: la usan otros tres
-- objetos de refresco de las tablas cache.

create or replace function public.get_supervisor_report_summary(
  p_from timestamp with time zone default (now() - interval '30 days'),
  p_to timestamp with time zone default now(),
  p_team_id uuid default null,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
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
  -- Un solo recorrido de leads. Antes este conjunto se recorría ocho veces:
  -- cinco para contadores que salen con FILTER en una pasada, y tres como lado
  -- externo de joins que el planner podía convertir en nested loop.
  lead_scope as materialized (
    select l.id, l.assigned_to, l.next_action_at
    from public.leads l
    where (v_team_ids is null or l.team_id = any(v_team_ids))
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
  -- El left join contra historical_agents reemplaza a
  -- resolve_supervisor_report_agent_key(), que llevaba SET search_path y por eso
  -- PostgreSQL no podía integrarla: costaba una llamada y un bloque por fila.
  -- El "in (select ...)" en vez del join impide que el planner use el conjunto
  -- de leads como lado externo de un nested loop.
  call_rows as materialized (
    select
      c.lead_id, c.status, c.reason, c.outcome, c.ended_at, c.started_at,
      c.next_action_at, c.equifax_uf_amount,
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
      coalesce(ha.linked_profile_id::text, i.historical_agent_id::text, i.agent_id::text) as report_agent_key
    from public.interactions i
    left join public.historical_agents ha
      on ha.id = i.historical_agent_id and ha.linked_profile_id is not null
    where i.created_at >= v_from and i.created_at <= v_to
      and i.lead_id in (select id from lead_scope)
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
           ended_at, started_at, next_action_at, equifax_uf_amount
    from call_rows
    union all
    select report_agent_key, lead_id, false, null::text, null::text, null::text,
           null::timestamptz, null::timestamptz, null::timestamptz, null::numeric
    from interaction_rows
  ),
  -- Antes eran tres GROUP BY separados sobre los mismos CTE materializados.
  agent_metrics as (
    select
      report_agent_key,
      count(*) filter (where not is_call)::int as crm_gestiones,
      count(*) filter (where is_call and ended_at is not null)::int as llamadas_cerradas,
      count(distinct lead_id) filter (where (not is_call) or ended_at is not null)::int as leads_gestionados,
      count(distinct lead_id) filter (where is_call and status = 'connected')::int as contactos_efectivos,
      count(*) filter (where is_call and status in ('no_answer','busy','voicemail','out_of_service'))::int as no_contacto,
      count(*) filter (where is_call and next_action_at is not null)::int as agendas,
      count(*) filter (where is_call and reason ilike '%COTIZACION%')::int as cotizaciones,
      count(*) filter (where is_call and (outcome = 'sale' or reason ilike '%VENTA%'))::int as ventas,
      -- El filtro anterior incluía "or equifax_uf_amount is not null", así que
      -- era equivalente a sumar sin filtro: sum() ya ignora los nulos.
      coalesce(sum(equifax_uf_amount) filter (where is_call), 0)::numeric as uf,
      coalesce(sum(extract(epoch from (ended_at - started_at))) filter (where is_call and ended_at is not null and started_at is not null), 0)::numeric as tmo_sum_seconds,
      count(*) filter (where is_call and ended_at is not null and started_at is not null)::int as tmo_count
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
  -- Antes: all_touched_days, all_connected_days, all_no_contact_days y
  -- daily_connected eran cuatro DISTINCT sobre el mismo material. Un GROUP BY
  -- por (día, lead) con banderas da exactamente los mismos conjuntos.
  day_lead_flags as materialized (
    select day, lead_id, bool_or(touched) as touched, bool_or(connected) as connected,
           bool_or(no_contact) as no_contact
    from (
      select activity_at::date as day, lead_id, ended_at is not null as touched,
             status = 'connected' as connected,
             status in ('no_answer','busy','voicemail','out_of_service') as no_contact
      from call_rows
      union all
      select created_at::date, lead_id, true, false, false from interaction_rows
      union all
      select activity_at::date, lead_id, true, connection_status = 'connected',
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
      select created_at::date as day, 1 as crm, 0 as ag from interaction_rows
      union all
      select activity_at::date, 0, case when next_action_at is not null then 1 else 0 end from call_rows
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
      select nullif(btrim(result),'') as label from interaction_rows
    ) tipifications
    where label is not null group by label
    order by count(*) desc, label limit 10
  ),
  totals as (
    select coalesce(sum(crm_gestiones),0)::int as crm_gestiones,
      coalesce(sum(llamadas_cerradas),0)::int as llamadas_cerradas,
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
end;
$function$;
