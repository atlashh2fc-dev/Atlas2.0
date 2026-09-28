-- Un corte tardío de Asterisk no deja al ejecutivo en cierre sin gestión.
--
-- 28-09-2026, Claudia Peña. Su conversación del pool terminó a las 16:52 y
-- la tipificó, pero la troncal nunca mandó el corte: Asterisk mantuvo el
-- puente en silencio hasta las 17:03 (disconnect_party = caller, 910 s). Entre
-- medio su sesión figuraba 'on_call' sin llamada en el navegador y el teléfono
-- mostraba «Conectando con el discador…». A las 17:03 register_dial_event
-- recibió 'completed' y la dejó en wrap_up, aunque ya no había nada que
-- tipificar. «Completar» tampoco la soltaba, porque encontraba un intento
-- 'bridged' de las 09:43 que quedó sin Hangup tras el reinicio del motor.
--
-- 1. register_dial_event: si al terminar un intento conectado su gestión ya
--    está cerrada, la sesión vuelve a lo que el ejecutivo tiene elegido
--    ('paused' con un motivo AUX, si no 'available') en vez de pasar a cierre.
--    update_agent_dialer_status aplica la misma regla al 'wrap_up' que pide
--    el AgentComplete del motor.
-- 2. dialer_close_orphaned_bridges(): cada 5 minutos cierra los intentos que
--    siguen 'bridged' 2 horas después de la última novedad y cuya gestión ya
--    se tipificó. Son puentes que el motor perdió (reinicio, Hangup sin
--    correlación) y bloqueaban el número y la liberación del cierre.

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
  v_management_closed boolean := false;
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
  -- como su gestión para tipificarla (20260928200000).
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
    v_management_closed := v_call_id is not null and exists (
      select 1 from public.calls c
      where c.id = v_call_id
        and c.ended_at is not null
    );

    if v_management_closed then
      -- Ya tipificó mientras el puente seguía arriba: no hay cierre que hacer.
      update public.dialer_agent_sessions s
      set status = case
            when exists (
              select 1
              from public.agent_current_status cs
              join public.agent_status_reasons r on r.id = cs.reason_id
              where cs.profile_id = s.profile_id
                and r.is_pause
            ) then 'paused'
            else 'available'
          end,
          last_state_change_at = now(),
          updated_at = now()
      where s.profile_id = v_attempt.agent_id
        and s.campaign_id = v_attempt.campaign_id
        and s.status in ('ringing', 'on_call', 'wrap_up');
    else
      update public.dialer_agent_sessions
      set status = 'wrap_up', last_state_change_at = now(), updated_at = now()
      where profile_id = v_attempt.agent_id
        and campaign_id = v_attempt.campaign_id
        and status <> 'offline';
    end if;
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
      || case
        when v_management_closed
        then jsonb_build_object('gestion_ya_tipificada', true)
        else '{}'::jsonb
      end
  );

  return v_call_id;
end;
$function$;

-- El AgentComplete del motor también pide 'wrap_up' al colgar. Sin una
-- gestión abierta no hay nada que tipificar: se respeta lo que el ejecutivo
-- tiene elegido. Si la conexión todavía no alcanzó a crear la gestión (una
-- llamada de un segundo), el 'completed' que el motor encola detrás del
-- puente deja el cierre igual.
create or replace function public.update_agent_dialer_status(
  p_profile_id uuid,
  p_campaign_id uuid,
  p_extension text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_effective_status text := p_status;
  v_in_pause boolean;
begin
  if auth.uid() is not null then
    raise exception 'update_agent_dialer_status solo puede ser llamada por el motor de discado.';
  end if;
  if p_status not in ('offline', 'available', 'ringing', 'on_call', 'wrap_up', 'paused') then
    raise exception 'status % invalido.', p_status;
  end if;
  if p_status <> 'offline' and exists (
    select 1 from public.agent_current_status current_status
    join public.agent_status_reasons reason on reason.id = current_status.reason_id
    where current_status.profile_id = p_profile_id and reason.code = 'desconectado'
  ) then
    return;
  end if;

  v_in_pause := exists (
    select 1 from public.agent_current_status current_status
    join public.agent_status_reasons reason on reason.id = current_status.reason_id
    where current_status.profile_id = p_profile_id and reason.is_pause
  );

  if p_status = 'available' and v_in_pause then
    v_effective_status := 'paused';
  end if;

  if p_status = 'wrap_up' and not exists (
    select 1 from public.calls c
    where c.agent_id = p_profile_id
      and c.ended_at is null
  ) then
    v_effective_status := case when v_in_pause then 'paused' else 'available' end;
  end if;

  insert into public.dialer_agent_sessions (
    profile_id, campaign_id, extension, status, last_state_change_at
  ) values (p_profile_id, p_campaign_id, p_extension, v_effective_status, now())
  on conflict (profile_id, campaign_id) do update
  set extension = excluded.extension,
      status = case
        when public.dialer_agent_sessions.status = 'wrap_up'
          and excluded.status in ('available', 'ringing', 'paused')
          then public.dialer_agent_sessions.status
        else excluded.status
      end,
      last_state_change_at = case
        when public.dialer_agent_sessions.status <> (
          case
            when public.dialer_agent_sessions.status = 'wrap_up'
              and excluded.status in ('available', 'ringing', 'paused')
              then public.dialer_agent_sessions.status
            else excluded.status
          end
        ) then now()
        else public.dialer_agent_sessions.last_state_change_at
      end,
      updated_at = now();
end;
$function$;

create or replace function public.dialer_close_orphaned_bridges()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_closed integer;
begin
  with orphaned as (
    update public.dial_attempts da
    set status = 'completed',
        ended_at = greatest(c.ended_at, da.bridged_at),
        hangup_cause = coalesce(da.hangup_cause, 'ORPHANED_BRIDGE'),
        updated_at = now()
    from public.calls c
    where c.id = da.call_id
      and da.status = 'bridged'
      and da.ended_at is null
      and c.ended_at is not null
      and da.updated_at < now() - interval '2 hours'
    returning da.id, da.call_id, da.lead_id, da.agent_id
  )
  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  select call_id, lead_id, agent_id, 'dialer.orphaned_bridge_closed',
         jsonb_build_object('dial_attempt_id', id, 'source', 'dialer_close_orphaned_bridges')
  from orphaned;

  get diagnostics v_closed = row_count;
  return v_closed;
end;
$function$;

revoke execute on function public.dialer_close_orphaned_bridges() from public, anon, authenticated;

select cron.schedule(
  'dialer-close-orphaned-bridges',
  '*/5 * * * *',
  'select public.dialer_close_orphaned_bridges()'
);
