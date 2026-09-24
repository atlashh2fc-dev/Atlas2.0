-- Gestión sin llamada: el ejecutivo tipifica un contacto que hizo por otro
-- canal (WhatsApp propio, correo, presencial) sin volver a llamar.
--
-- Pedido de operación (24-09-2026): muchos clientes de Equifax responden por
-- WhatsApp y ese WhatsApp todavía no está en Atlas. Sin esto, la única forma
-- de dejar registro era volver a llamar. La gestión usa la misma tabla calls
-- y el mismo formulario y reglas de tipificación; calls.management_channel
-- dice por dónde fue (null = llamada, como todas las anteriores).

alter table public.calls
  add column if not exists management_channel text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'calls_management_channel_check') then
    alter table public.calls
      add constraint calls_management_channel_check
      check (management_channel is null or management_channel in ('whatsapp', 'correo', 'presencial', 'otro'));
  end if;
end;
$$;

comment on column public.calls.management_channel is
  'Canal de una gestión sin llamada (whatsapp, correo, presencial, otro). null = gestión de una llamada.';

create or replace function public.begin_agent_offline_management(p_lead_id uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_call_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;
  if p_channel is null or p_channel not in ('whatsapp', 'correo', 'presencial', 'otro') then
    raise exception 'Elige por qué canal fue el contacto.';
  end if;

  select * into v_actor
  from public.profiles
  where id = v_actor_id and role = 'agente' and active
  for update;
  if not found then
    raise exception 'Solo un ejecutivo activo puede registrar una gestión.';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform public.assert_org_access(v_lead.organization_id);

  if v_actor_id is distinct from v_lead.managed_by and v_actor_id is distinct from v_lead.assigned_to then
    raise exception 'Este registro no está a tu nombre. Pide a tu supervisor que te lo asigne.';
  end if;

  if exists (
    select 1 from public.calls c
    where c.agent_id = v_actor_id
      and c.ended_at is null
      and c.started_at >= v_now - interval '4 hours'
  ) then
    raise exception 'Tienes una gestión pendiente de tipificación. Ciérrala antes de registrar otra.';
  end if;

  if exists (
    select 1 from public.calls c
    where c.lead_id = p_lead_id and c.ended_at is null and c.started_at >= v_now - interval '4 hours'
  ) then
    raise exception 'Este registro ya tiene una gestión abierta.';
  end if;

  insert into public.calls (lead_id, agent_id, management_channel)
  values (p_lead_id, v_actor_id, p_channel)
  returning id into v_call_id;

  update public.leads
  set managed_by = coalesce(managed_by, v_actor_id), updated_at = v_now
  where id = p_lead_id;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call_id, p_lead_id, v_actor_id, 'cti.offline_management_started',
    jsonb_build_object('channel', p_channel, 'campaign_id', v_lead.campaign_id)
  );

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'lead.offline_management_started',
    jsonb_build_object('call_id', v_call_id, 'channel', p_channel)
  );

  return jsonb_build_object('call_id', v_call_id, 'lead_id', p_lead_id, 'channel', p_channel);
end;
$function$;

revoke all on function public.begin_agent_offline_management(uuid, text) from public, anon;
grant execute on function public.begin_agent_offline_management(uuid, text) to authenticated;

-- Integridad de gestiones: una gestión sin llamada no tiene intento del
-- discador detrás a propósito; no es un "contacto sin respaldo". Misma
-- función que 20260924183200 con esa sola exclusión.
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
      and c.management_channel is null
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
