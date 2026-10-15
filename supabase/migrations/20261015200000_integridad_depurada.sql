-- Integridad depurada: separa la alerta real del reagendamiento.
--
-- «Contacto sin llamada» marcaba 2.315 gestiones en 30 días (12,6 %). Al
-- revisarlas una por una contra la central:
--
--  * ~190 eran falsos positivos: la central sí conectó (respondió o hubo
--    puente) y el intento quedó con estado `failed` por la causa de corte. El
--    cruce miraba solo el estado y no `answered_at`/`bridged_at`.
--  * 1.785 eran «Volver a llamar» sin hablar con el cliente: el ejecutivo
--    reprogramó una agenda que no contestó y la única opción con fecha estaba
--    en CONTACTO. Es un problema del flujo, no de integridad.
--  * 344 eran otra tipificación de contacto sin ninguna conexión: esa es la
--    señal que hay que mirar.
--
-- Cambios:
--  * Conexión = intento vinculado a la gestión (`call_id`) o, para lo que no
--    quedó vinculado, del mismo ejecutivo con ese cliente en la ventana, que
--    respondió o hizo puente.
--  * «Volver a llamar» sin conexión se cuenta aparte (`reagendados_sin_contacto`)
--    y no entra en «para revisar».
--  * Cierre rápido solo cuenta contactos: cerrar en segundos un «no contesta»
--    es lo normal.
--  * La campaña suma sus hijas, como el resto de Reportes.
--  * Cada caso trae el último intento de la central para explicarlo en
--    palabras ("la central marcó: no contestó").
--  * `p_agent_id` acota la lista de casos a un ejecutivo; los totales no.

drop function if exists public.get_management_integrity_report(timestamptz, timestamptz, uuid, integer, integer);

create or replace function public.get_management_integrity_report(
  p_from timestamptz,
  p_to timestamptz,
  p_campaign_id uuid default null,
  p_fast_close_seconds integer default 10,
  p_burst_seconds integer default 5,
  p_agent_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role text := coalesce(public.current_role_name()::text, '');
  v_team_ids uuid[];
  v_org_ids uuid[];
  v_campaign_ids uuid[];
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

  if p_campaign_id is not null then
    v_campaign_ids := public.campaign_family_ids(p_campaign_id);
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
      extract(epoch from (c.ended_at - c.started_at)) as handle_seconds,
      upper(coalesce(c.reason, '')) like '%VOLVER A LLAMAR%' as es_volver_a_llamar
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where l.organization_id = any(v_org_ids) and c.ended_at is not null
      and c.legacy_call_id is null
      and c.discarded_reason is null
      and c.management_channel is null
      and (v_team_ids is null or l.team_id = any(v_team_ids))
      and c.started_at >= p_from
      and c.started_at <= p_to
      and (v_campaign_ids is null or l.campaign_id = any(v_campaign_ids))
  ),
  con_evidencia as (
    select
      cerradas.*,
      -- Solo hace falta para los contactos: un «no contesta» no necesita
      -- probar que hubo conversación.
      cerradas.status = 'connected' and (
        exists (
          select 1
          from public.dial_attempts da
          where da.call_id = cerradas.id
            and (da.answered_at is not null or da.bridged_at is not null
                 or da.status in ('answered', 'bridged', 'completed'))
        )
        or exists (
          select 1
          from public.dial_attempts da
          where da.lead_id = cerradas.lead_id
            and da.agent_id = cerradas.agent_id
            and da.created_at between cerradas.started_at - interval '5 minutes' and cerradas.ended_at
            and (da.answered_at is not null or da.bridged_at is not null
                 or da.status in ('answered', 'bridged', 'completed'))
        )
      ) as hubo_conexion,
      extract(
        epoch from (
          cerradas.ended_at - lag(cerradas.ended_at) over (partition by cerradas.agent_id order by cerradas.ended_at)
        )
      ) as seconds_since_previous
    from cerradas
  ),
  marcadas as (
    select
      e.*,
      (e.status = 'connected' and not e.hubo_conexion and not e.es_volver_a_llamar) as es_contacto_sin_conexion,
      (e.status = 'connected' and not e.hubo_conexion and e.es_volver_a_llamar) as es_reagendado_sin_contacto,
      (e.status = 'connected' and e.handle_seconds < p_fast_close_seconds) as es_cierre_rapido,
      (e.seconds_since_previous is not null and e.seconds_since_previous < p_burst_seconds) as es_rafaga
    from con_evidencia e
  ),
  clasificadas as (
    select
      m.*,
      (m.es_contacto_sin_conexion or m.es_cierre_rapido or m.es_rafaga) as para_revisar
    from marcadas m
  ),
  por_agente as (
    select
      m.agent_id,
      p.full_name,
      count(*)::int as gestiones,
      count(*) filter (where m.para_revisar)::int as para_revisar,
      count(*) filter (where m.es_contacto_sin_conexion)::int as contacto_sin_conexion,
      count(*) filter (where m.es_cierre_rapido)::int as cierres_rapidos,
      count(*) filter (where m.es_rafaga)::int as rafagas,
      count(*) filter (where m.es_reagendado_sin_contacto)::int as reagendados_sin_contacto,
      round(percentile_cont(0.5) within group (order by m.handle_seconds)::numeric, 1) as mediana_segundos
    from clasificadas m
    join public.profiles p on p.id = m.agent_id
    group by m.agent_id, p.full_name
  ),
  casos as (
    select m.*
    from clasificadas m
    where m.para_revisar
      and (p_agent_id is null or m.agent_id = p_agent_id)
    order by m.ended_at desc
    limit 500
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
      m.ended_at,
      round(m.handle_seconds::numeric, 1) as handle_seconds,
      round(m.seconds_since_previous::numeric, 1) as seconds_since_previous,
      case
        when m.es_contacto_sin_conexion then 'contacto_sin_conexion'
        when m.es_cierre_rapido then 'cierre_rapido'
        else 'rafaga'
      end as motivo,
      -- Lo último que registró la central para esa gestión; null = no se
      -- llamó desde Atlas.
      coalesce(
        (select da.status from public.dial_attempts da
          where da.call_id = m.id order by da.created_at desc limit 1),
        (select da.status from public.dial_attempts da
          where da.lead_id = m.lead_id
            and da.agent_id = m.agent_id
            and da.created_at between m.started_at - interval '5 minutes' and m.ended_at
          order by da.created_at desc limit 1)
      ) as ultimo_intento
    from casos m
    join public.profiles p on p.id = m.agent_id
    join public.leads l on l.id = m.lead_id
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
        'para_revisar', coalesce(sum(para_revisar), 0),
        'contacto_sin_conexion', coalesce(sum(contacto_sin_conexion), 0),
        'cierres_rapidos', coalesce(sum(cierres_rapidos), 0),
        'rafagas', coalesce(sum(rafagas), 0),
        'reagendados_sin_contacto', coalesce(sum(reagendados_sin_contacto), 0)
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
            'para_revisar', para_revisar,
            'contacto_sin_conexion', contacto_sin_conexion,
            'cierres_rapidos', cierres_rapidos,
            'rafagas', rafagas,
            'reagendados_sin_contacto', reagendados_sin_contacto,
            'mediana_segundos', mediana_segundos
          )
          order by para_revisar desc, gestiones desc
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
            'ended_at', ended_at,
            'handle_seconds', handle_seconds,
            'seconds_since_previous', seconds_since_previous,
            'motivo', motivo,
            'ultimo_intento', ultimo_intento
          )
          order by ended_at desc
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

revoke all on function public.get_management_integrity_report(timestamptz, timestamptz, uuid, integer, integer, uuid) from public, anon;
grant execute on function public.get_management_integrity_report(timestamptz, timestamptz, uuid, integer, integer, uuid) to authenticated;
