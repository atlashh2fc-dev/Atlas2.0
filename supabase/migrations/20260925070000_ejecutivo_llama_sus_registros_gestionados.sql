-- El ejecutivo puede llamar desde la ficha a los clientes que él gestionó.
--
-- begin_agent_assigned_lead_call exigía assigned_to = ejecutivo. Los clientes
-- migrados de Atlas 1 quedaron con managed_by y assigned_to vacío (la migración
-- 20260924130451 no copia asignaciones), así que en campañas automáticas el
-- ejecutivo no tenía ninguna forma de marcar a sus propios clientes: ni botón en
-- la ficha ni teclado manual. Mismo criterio de dueño que ya usan las agendas.

create or replace function public.begin_agent_assigned_lead_call_sin_empresa(p_lead_id uuid, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_digits text;
  v_subscriber text;
  v_phone text;
  v_call_id uuid;
  v_open_call_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is null or not coalesce(public.is_current_app_session_valid(), false) then
    raise exception 'No autenticado.';
  end if;
  select * into v_actor
  from public.profiles actor
  where actor.id = v_actor_id
    and actor.role = 'agente'::public.app_role
    and actor.active
  for update;
  if not found then raise exception 'Solo un ejecutivo activo puede llamar este registro.'; end if;
  if v_actor.team_id is null then raise exception 'Tu usuario no tiene equipo asignado.'; end if;
  if v_actor.intercall_break_until is not null and v_actor.intercall_break_until > v_now then
    raise exception 'La interrupción legal sigue en curso. Espera antes de realizar otra llamada.';
  end if;

  select * into v_lead
  from public.leads lead
  where lead.id = p_lead_id
  for update;
  if not found then raise exception 'El registro no existe.'; end if;
  -- Dueño del registro: el asignado o, sin asignación, quien lo gestionó. Los
  -- clientes migrados de Atlas 1 llegaron con managed_by y sin assigned_to, y
  -- el ejecutivo se quedaba sin cómo llamar a sus propios clientes desde la
  -- ficha. Una asignación explícita a otro ejecutivo sigue mandando.
  if coalesce(v_lead.assigned_to, v_lead.managed_by) is distinct from v_actor_id then
    raise exception 'Solo el ejecutivo a cargo puede llamar este registro.';
  end if;
  -- Sin asignación, haberlo gestionado no basta: tiene que seguir en la campaña.
  if v_lead.assigned_to is null and not exists (
    select 1 from public.campaign_agents membership
    where membership.profile_id = v_actor_id
      and membership.campaign_id = v_lead.campaign_id
  ) then
    raise exception 'Ya no perteneces a la campaña de este registro.';
  end if;
  if not exists (
    select 1
    from public.campaigns campaign
    join public.dialer_campaign_configs config
      on config.campaign_id = campaign.id and config.is_active
    where campaign.id = v_lead.campaign_id and campaign.is_active
  ) then
    raise exception 'La campaña no está activa o no tiene discado operativo configurado.';
  end if;

  v_digits := private.agent_call_target_digits(v_lead, p_phone);
  v_phone := '+' || v_digits;
  v_subscriber := case when v_digits ~ '^569[0-9]{8}$' then right(v_digits, 8) else v_digits end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_digits, 0));

  select call.id into v_open_call_id
  from public.calls call
  where call.agent_id = v_actor_id
    and call.ended_at is null
    and call.started_at >= v_now - interval '4 hours'
  order by call.started_at desc
  limit 1
  for update;
  if v_open_call_id is not null then
    raise exception 'Tienes una gestión pendiente de tipificación. Ciérrala antes de llamar.';
  end if;
  if exists (
    select 1 from public.calls call
    join public.leads lead on lead.id = call.lead_id
    where call.ended_at is null
      and call.started_at >= v_now - interval '4 hours'
      and public.agent_dial_digits(lead.phone) = v_digits
  ) or exists (
    select 1 from public.dial_attempts attempt
    where attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      and public.agent_dial_digits(attempt.phone) = v_digits
  ) then
    raise exception 'Este número ya tiene una llamada en curso.';
  end if;

  update public.leads
  set managed_by = v_actor_id, updated_at = v_now
  where id = p_lead_id;
  insert into public.calls (lead_id, agent_id)
  values (p_lead_id, v_actor_id)
  returning id into v_call_id;
  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call_id, p_lead_id, v_actor_id, 'cti.assigned_lead_call_started',
    jsonb_build_object(
      'campaign_id', v_lead.campaign_id,
      'phone', v_phone,
      'phone_is_primary', v_digits is not distinct from public.agent_dial_digits(v_lead.phone),
      'source', 'assigned_lead'
    )
  );
  insert into public.sensitive_access_log (actor_id, action, target_profile_id, metadata)
  values (
    v_actor_id, 'cti.assigned_lead_call', null,
    jsonb_build_object('lead_id', p_lead_id, 'call_id', v_call_id, 'campaign_id', v_lead.campaign_id, 'phone', v_phone)
  );
  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'lead.assigned_call_started',
    jsonb_build_object('campaign_id', v_lead.campaign_id, 'call_id', v_call_id, 'phone', v_phone)
  );
  return jsonb_build_object(
    'lead_id', p_lead_id,
    'call_id', v_call_id,
    'campaign_id', v_lead.campaign_id,
    'phone', v_phone,
    'subscriber', v_subscriber,
    'dial_digits', v_digits,
    'full_name', v_lead.full_name
  );
end;
$function$;
