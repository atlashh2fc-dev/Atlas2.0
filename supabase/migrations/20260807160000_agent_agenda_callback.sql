-- Rescate de compromisos agendados que el motor ya no puede entregar.
--
-- `claim_due_personal_callbacks` solo marca dentro de la ventana
-- (`next_action_at` entre now() y now() - personal_callback_window_minutes) y
-- solo si el ejecutivo está `available`. Si durante esos minutos estuvo en
-- llamada, en ACW o en AUX, la ventana se consume igual y el compromiso queda
-- en "Mi agenda" marcado como vencido, sin ninguna vía para llamarlo: el motor
-- ya no lo toma y `begin_agent_manual_call_management` rechaza el marcado
-- cuando la campaña es automática.
--
-- Esta función abre la gestión para ese caso concreto sin depender del modo de
-- discado, exigiendo que el compromiso sea del propio ejecutivo. Es el
-- equivalente al preview/manual dial que Genesys y Five9 mantienen siempre
-- disponible aunque el agente esté en una campaña automática.
--
-- No toca `dialer_agent_sessions`: la `call` abierta ya reserva al ejecutivo,
-- porque tanto `countAvailableAgents` (motor) como
-- `claim_due_personal_callbacks` descuentan a quien tiene una llamada sin
-- cerrar. Evita así dejar sesiones colgadas en un estado intermedio.
create or replace function public.begin_agent_agenda_callback(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  select *
  into v_actor
  from public.profiles
  where id = v_actor_id
    and role = 'agente'
    and active
  for update;

  if not found then
    raise exception 'Solo un ejecutivo activo puede llamar desde su agenda.';
  end if;

  if v_actor.team_id is null then
    raise exception 'Tu usuario no tiene equipo asignado. Pide a un supervisor que lo configure antes de llamar.';
  end if;

  if v_actor.intercall_break_until is not null and v_actor.intercall_break_until > v_now then
    raise exception 'La interrupción legal sigue en curso. Espera antes de realizar otra llamada.';
  end if;

  select *
  into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'El registro no existe.';
  end if;

  -- El compromiso es personal: solo lo llama quien lo tomó.
  if coalesce(v_lead.managed_by, v_lead.assigned_to) is distinct from v_actor_id then
    raise exception 'Este compromiso no está en tu agenda.';
  end if;

  if v_lead.next_action_at is null then
    raise exception 'Este registro no tiene un compromiso agendado.';
  end if;

  if not exists (
    select 1
    from public.campaigns c
    join public.dialer_campaign_configs dc
      on dc.campaign_id = c.id
     and dc.is_active
    where c.id = v_lead.campaign_id
      and c.is_active
  ) then
    raise exception 'La campaña no está activa o no tiene discado operativo configurado.';
  end if;

  -- Las bases llegan con el móvil en varios formatos (8 dígitos, 9XXXXXXXX o
  -- 569XXXXXXXX); el discado siempre necesita E.164.
  v_digits := regexp_replace(coalesce(v_lead.phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 8 then
    v_digits := '569' || v_digits;
  elsif length(v_digits) = 9 and left(v_digits, 1) = '9' then
    v_digits := '56' || v_digits;
  end if;

  if v_digits !~ '^569[0-9]{8}$' then
    raise exception 'El teléfono del registro no es un móvil chileno válido.';
  end if;

  v_phone := '+' || v_digits;
  v_subscriber := right(v_digits, 8);

  perform pg_advisory_xact_lock(hashtextextended(v_digits, 0));

  -- Invariante de capacidad: nunca dos gestiones abiertas del mismo ejecutivo,
  -- o una llamada nueva escondería una tipificación pendiente.
  select c.id
  into v_open_call_id
  from public.calls c
  where c.agent_id = v_actor_id
    and c.ended_at is null
    and c.started_at >= v_now - interval '4 hours'
  order by c.started_at desc
  limit 1
  for update;

  if v_open_call_id is not null then
    raise exception 'Tienes una gestión pendiente de tipificación. Ciérrala antes de llamar desde tu agenda.';
  end if;

  -- Comparación por los 8 dígitos del abonado: el mismo número convive en la
  -- base como 9XXXXXXXX y como 569XXXXXXXX.
  if exists (
    select 1
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.ended_at is null
      and c.started_at >= v_now - interval '4 hours'
      and right(public.normalize_lead_contact('phone', l.phone), 8) = v_subscriber
  ) or exists (
    select 1
    from public.dial_attempts da
    where da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      and right(regexp_replace(coalesce(da.phone, ''), '[^0-9]', '', 'g'), 8) = v_subscriber
  ) then
    raise exception 'Este número ya tiene una llamada en curso.';
  end if;

  update public.leads
  set
    callback_attempts = coalesce(callback_attempts, 0) + 1,
    callback_last_attempt_at = v_now,
    managed_by = coalesce(managed_by, v_actor_id),
    updated_at = v_now
  where id = p_lead_id;

  insert into public.calls (lead_id, agent_id)
  values (p_lead_id, v_actor_id)
  returning id into v_call_id;

  insert into public.call_events (
    call_id, lead_id, agent_id, event_type, payload
  )
  values (
    v_call_id, p_lead_id, v_actor_id, 'cti.agenda_callback_started',
    jsonb_build_object(
      'campaign_id', v_lead.campaign_id,
      'phone', v_phone,
      'source', 'agenda',
      'next_action_at', v_lead.next_action_at,
      'overdue', v_lead.next_action_at < v_now,
      'attempts', coalesce(v_lead.callback_attempts, 0) + 1
    )
  );

  insert into public.sensitive_access_log (
    actor_id, action, target_profile_id, metadata
  )
  values (
    v_actor_id, 'cti.agenda_callback', null,
    jsonb_build_object(
      'phone', v_phone,
      'lead_id', p_lead_id,
      'call_id', v_call_id,
      'campaign_id', v_lead.campaign_id
    )
  );

  insert into public.crm_audit_events (
    lead_id, crm_entity_id, actor_id, event_type, payload
  )
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'lead.agenda_callback_started',
    jsonb_build_object(
      'campaign_id', v_lead.campaign_id,
      'call_id', v_call_id,
      'phone', v_phone,
      'next_action_at', v_lead.next_action_at
    )
  );

  return jsonb_build_object(
    'lead_id', p_lead_id,
    'call_id', v_call_id,
    'campaign_id', v_lead.campaign_id,
    'phone', v_phone,
    'subscriber', v_subscriber,
    'full_name', v_lead.full_name
  );
end;
$function$;

revoke all on function public.begin_agent_agenda_callback(uuid) from public;
revoke all on function public.begin_agent_agenda_callback(uuid) from anon;
grant execute on function public.begin_agent_agenda_callback(uuid) to authenticated;
