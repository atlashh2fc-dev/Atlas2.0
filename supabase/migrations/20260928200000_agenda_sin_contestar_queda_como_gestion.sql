-- Una agenda que el cliente no contestó queda como gestión del ejecutivo.
--
-- Reclamo del 28-09-2026: «te cae la llamada y te cae otra encima de otro
-- agendado, y cuando no contesta ninguna no aparece el registro y no sabemos
-- dónde queda».
--
-- En un compromiso agendado suena primero el ejecutivo (el teléfono contesta
-- solo y la ficha del cliente se abre) y después se marca al cliente. La
-- gestión (calls) nacía recién cuando el cliente contestaba. Si no contestaba,
-- el intento terminaba sin gestión: la ficha quedaba sin formulario, el
-- ejecutivo volvía a quedar libre al instante y el motor le entregaba lo
-- siguiente. El 28-09 hubo 104 agendas sin conexión: en 25 le sonó otra
-- agenda antes de 60 s y en 34 le entró un cliente del pool. La agenda
-- quedaba escondida esperando un reintento automático que el ejecutivo no veía.
--
-- Ahora, igual que una llamada manual sin respuesta (que se tipifica):
-- * Si el ejecutivo ya estaba en la línea (originated_at: en una agenda el
--   OriginateResponse Success es que contestó su teléfono) y el intento
--   termina sin puente (no contesta, ocupado, falla del número), se abre la
--   gestión del registro a su nombre y su sesión pasa a cierre.
-- * Con la gestión abierta el motor lo mantiene pausado en la cola y
--   claim_due_personal_callbacks no le entrega otra agenda: nada le cae
--   encima hasta que tipifique.
-- * La gestión cuenta como compromiso atendido (hay una llamada del lead desde
--   la hora comprometida), así que el discador no vuelve a marcarla a
--   escondidas: el ejecutivo tipifica «no contesta» y reagenda si corresponde.
-- * Si el teléfono del ejecutivo nunca contestó, no hubo nada en su pantalla:
--   no se abre gestión y la agenda sigue su reintento como antes.
-- * Si por alguna razón ya tiene otra gestión abierta, no se abre una segunda
--   (calls_one_open_per_agent_idx) y el evento se registra igual.

create or replace function public.register_dial_event(
  p_dial_attempt_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_agent_id uuid default null::uuid,
  p_ami_unique_id text default null::text,
  p_ami_channel text default null::text,
  p_hangup_cause text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_attempt public.dial_attempts;
  v_call_id uuid;
  v_current_rank integer;
  v_incoming_rank integer;
  v_normalized_unique_id text := public.normalize_ami_unique_id(p_ami_unique_id);
  v_unanswered_callback boolean := false;
begin
  if v_actor_id is not null then
    raise exception 'register_dial_event solo puede ser llamada por el motor de discado.';
  end if;

  select * into v_attempt
  from public.dial_attempts
  where id = p_dial_attempt_id
  for update;

  if not found then
    raise exception 'dial_attempt % no existe.', p_dial_attempt_id;
  end if;

  v_call_id := v_attempt.call_id;

  if v_attempt.status in ('no_answer', 'busy', 'failed', 'abandoned', 'voicemail', 'completed') then
    return v_call_id;
  end if;

  v_current_rank := case v_attempt.status
    when 'queued' then 0
    when 'originating' then 1
    when 'ringing' then 2
    when 'answered' then 3
    when 'bridged' then 4
    else 0
  end;
  v_incoming_rank := case p_event_type
    when 'queued' then 0
    when 'originating' then 1
    when 'ringing' then 2
    when 'answered' then 3
    when 'bridged' then 4
    else 100
  end;

  if v_incoming_rank < v_current_rank then
    return v_call_id;
  end if;

  update public.dial_attempts
  set
    status = p_event_type,
    agent_id = coalesce(p_agent_id, agent_id),
    ami_unique_id = coalesce(v_normalized_unique_id, ami_unique_id),
    ami_channel = coalesce(p_ami_channel, ami_channel),
    hangup_cause = coalesce(p_hangup_cause, hangup_cause),
    originated_at = case when p_event_type = 'originating' then now() else originated_at end,
    answered_at = case when p_event_type = 'answered' then now() else answered_at end,
    bridged_at = case when p_event_type = 'bridged' then now() else bridged_at end,
    ended_at = case
      when p_event_type in ('no_answer', 'busy', 'failed', 'abandoned', 'voicemail', 'completed')
      then now()
      else ended_at
    end,
    updated_at = now()
  where id = p_dial_attempt_id;

  if p_event_type = 'bridged'
    and p_agent_id is not null
    and v_call_id is null then
    insert into public.calls (lead_id, agent_id)
    values (v_attempt.lead_id, p_agent_id)
    returning id into v_call_id;

    update public.dial_attempts set call_id = v_call_id
    where id = p_dial_attempt_id;
  end if;

  -- Agenda que el ejecutivo alcanzó a tomar y el cliente no contestó: queda
  -- como su gestión para tipificarla (ver encabezado).
  if v_attempt.attempt_kind = 'personal_callback'
    and p_event_type in ('no_answer', 'busy', 'failed', 'completed')
    and v_attempt.originated_at is not null
    and v_attempt.bridged_at is null
    and v_attempt.agent_id is not null
    and v_call_id is null then
    begin
      insert into public.calls (lead_id, agent_id)
      values (v_attempt.lead_id, v_attempt.agent_id)
      returning id into v_call_id;
    exception when unique_violation then
      -- Ya tiene otra gestión abierta: esa manda y esta agenda sigue su curso.
      v_call_id := null;
    end;

    if v_call_id is not null then
      v_unanswered_callback := true;

      update public.dial_attempts set call_id = v_call_id
      where id = p_dial_attempt_id;

      update public.dialer_agent_sessions
      set status = 'wrap_up', last_state_change_at = now(), updated_at = now()
      where profile_id = v_attempt.agent_id
        and campaign_id = v_attempt.campaign_id
        and status <> 'offline';
    end if;
  end if;

  if p_event_type in ('completed', 'abandoned')
    and v_attempt.bridged_at is not null
    and v_attempt.agent_id is not null then
    update public.dialer_agent_sessions
    set status = 'wrap_up', last_state_change_at = now(), updated_at = now()
    where profile_id = v_attempt.agent_id
      and campaign_id = v_attempt.campaign_id
      and status <> 'offline';
  end if;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call_id,
    v_attempt.lead_id,
    coalesce(p_agent_id, v_attempt.agent_id),
    'dialer.' || p_event_type,
    coalesce(p_payload, '{}'::jsonb)
      || jsonb_build_object(
        'dial_attempt_id', p_dial_attempt_id,
        'source', 'asterisk_engine'
      )
      || case
        when v_unanswered_callback
        then jsonb_build_object('agenda_sin_contacto', true)
        else '{}'::jsonb
      end
  );

  return v_call_id;
end;
$function$;
