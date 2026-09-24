-- Integridad de gestiones: solo se juzga lo que se gestionó en Atlas 2.0.
--
-- Las señales de esta pestaña salen del servidor: el intento del discador que
-- respalda un «conectado», la duración entre abrir y cerrar la gestión y la
-- cadencia entre cierres. Las llamadas migradas de Atlas 1 no tienen ninguna de
-- las tres: no hubo discador de Atlas 2.0 detrás (Vocalcom marcaba aparte), y sus
-- horas son las del formulario antiguo. Por eso cada una salía como «contacto
-- sin llamada»: 12.090 falsos positivos en 30 días sobre los 12 ejecutivos de
-- Equifax, en la pantalla que presenta esa señal como el indicio más fuerte.
--
-- Cambios sobre la versión anterior (20260917184658):
--   * Fuera las llamadas migradas (legacy_call_id) y las descartadas
--     (discarded_reason): una llamada anulada tampoco es una gestión que evaluar.
--     El historial sigue completo en la ficha del cliente.
--   * El supervisor ve solo a sus equipos, igual que en el reporte de gestión.
--     Antes veía a toda la empresa.
--   * La frontera de empresa se resuelve una vez y no por llamada (10 s en 30
--     días de Equifax, por encima del límite de la API).

create or replace function public.get_management_integrity_report(
  p_from timestamptz,
  p_to timestamptz,
  p_campaign_id uuid default null,
  p_fast_close_seconds integer default 10,
  p_burst_seconds integer default 5
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
    raise exception 'No tienes permiso para revisar la integridad de las gestiones.';
  end if;

  -- Empresas visibles, una vez: por fila eran ~10 s en 30 días de Equifax.
  v_org_ids := array(select o.id from public.organizations o where public.can_access_org(o.id));

  if v_role = 'supervisor' then
    v_team_ids := public.supervised_team_ids();
    if coalesce(cardinality(v_team_ids), 0) = 0 then
      raise exception 'Tu supervisor no tiene equipos asignados.';
    end if;
  end if;

  with cerradas as (
    select
      c.id,
      c.agent_id,
      c.lead_id,
      c.status,
      c.reason,
      c.started_at,
      c.ended_at,
      l.campaign_id,
      extract(epoch from (c.ended_at - c.started_at)) as handle_seconds,
      exists (
        select 1
        from public.dial_attempts da
        where da.lead_id = c.lead_id
          and da.agent_id = c.agent_id
          and da.status in ('answered', 'bridged', 'completed')
          and da.created_at between c.started_at - interval '5 minutes' and coalesce(c.ended_at, now())
      ) as tuvo_conexion
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where l.organization_id = any(v_org_ids) and c.ended_at is not null
      and c.legacy_call_id is null
      and c.discarded_reason is null
      and (v_team_ids is null or l.team_id = any(v_team_ids))
      and c.started_at >= p_from
      and c.started_at <= p_to
      and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  ),
  con_cadencia as (
    select
      cerradas.*,
      extract(
        epoch from (
          ended_at - lag(ended_at) over (partition by agent_id order by ended_at)
        )
      ) as seconds_since_previous
    from cerradas
  ),
  marcadas as (
    select
      con_cadencia.*,
      (handle_seconds < p_fast_close_seconds) as es_cierre_instantaneo,
      (status = 'connected' and not tuvo_conexion) as es_contacto_sin_respaldo,
      (seconds_since_previous is not null and seconds_since_previous < p_burst_seconds) as es_rafaga
    from con_cadencia
  ),
  por_agente as (
    select
      m.agent_id,
      p.full_name,
      count(*)::int as gestiones,
      count(*) filter (where m.es_cierre_instantaneo)::int as cierres_instantaneos,
      count(*) filter (where m.es_contacto_sin_respaldo)::int as contactos_sin_respaldo,
      count(*) filter (where m.es_rafaga)::int as rafagas,
      round(
        percentile_cont(0.5) within group (order by m.handle_seconds)::numeric,
        1
      ) as mediana_segundos,
      round(min(m.handle_seconds)::numeric, 1) as minimo_segundos,
      count(*) filter (
        where m.es_cierre_instantaneo or m.es_contacto_sin_respaldo or m.es_rafaga
      )::int as sospechosas
    from marcadas m
    join public.profiles p on p.id = m.agent_id
    group by m.agent_id, p.full_name
  ),
  detalle as (
    select
      m.id,
      m.agent_id,
      p.full_name,
      m.lead_id,
      l.full_name as lead_name,
      m.status,
      m.reason,
      m.started_at,
      m.ended_at,
      round(m.handle_seconds::numeric, 1) as handle_seconds,
      round(m.seconds_since_previous::numeric, 1) as seconds_since_previous,
      m.tuvo_conexion,
      m.es_cierre_instantaneo,
      m.es_contacto_sin_respaldo,
      m.es_rafaga
    from marcadas m
    join public.profiles p on p.id = m.agent_id
    join public.leads l on l.id = m.lead_id
    where m.es_cierre_instantaneo or m.es_contacto_sin_respaldo or m.es_rafaga
    order by m.ended_at desc
    limit 500
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'thresholds', jsonb_build_object(
      'fast_close_seconds', p_fast_close_seconds,
      'burst_seconds', p_burst_seconds
    ),
    'totals', (
      select jsonb_build_object(
        'gestiones', coalesce(sum(gestiones), 0),
        'sospechosas', coalesce(sum(sospechosas), 0),
        'cierres_instantaneos', coalesce(sum(cierres_instantaneos), 0),
        'contactos_sin_respaldo', coalesce(sum(contactos_sin_respaldo), 0),
        'rafagas', coalesce(sum(rafagas), 0)
      )
      from por_agente
    ),
    'agents', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'agent_id', agent_id,
            'full_name', full_name,
            'gestiones', gestiones,
            'sospechosas', sospechosas,
            'cierres_instantaneos', cierres_instantaneos,
            'contactos_sin_respaldo', contactos_sin_respaldo,
            'rafagas', rafagas,
            'mediana_segundos', mediana_segundos,
            'minimo_segundos', minimo_segundos
          )
          order by sospechosas desc, gestiones desc
        )
        from por_agente
      ),
      '[]'::jsonb
    ),
    'detail', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'call_id', id,
            'agent_id', agent_id,
            'full_name', full_name,
            'lead_id', lead_id,
            'lead_name', lead_name,
            'status', status,
            'reason', reason,
            'started_at', started_at,
            'ended_at', ended_at,
            'handle_seconds', handle_seconds,
            'seconds_since_previous', seconds_since_previous,
            'tuvo_conexion', tuvo_conexion,
            'cierre_instantaneo', es_cierre_instantaneo,
            'contacto_sin_respaldo', es_contacto_sin_respaldo,
            'rafaga', es_rafaga
          )
        )
        from detalle
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$function$;
