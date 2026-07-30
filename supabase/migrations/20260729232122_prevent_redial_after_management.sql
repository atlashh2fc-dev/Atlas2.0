-- A managed lead is terminal for automatic dialing unless it has an explicit
-- callback whose next_action_at is already due. Also keep the database as the
-- final capacity guard: a stale "available" session must not claim work while
-- that same agent still has an open call awaiting typification.
create or replace function public.claim_next_dial_targets(
  p_campaign_id uuid,
  p_batch_size integer default 1
)
returns table(dial_attempt_id uuid, lead_id uuid, phone text, full_name text, rut text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_max_redial_attempts integer;
  v_available_agents integer;
  v_effective_batch_size integer;
begin
  if v_actor_id is not null then
    raise exception 'claim_next_dial_targets solo puede ser llamada por el motor de discado.';
  end if;

  select coalesce(dc.max_redial_attempts, 4)
  into v_max_redial_attempts
  from public.dialer_campaign_configs dc
  where dc.campaign_id = p_campaign_id;
  v_max_redial_attempts := coalesce(v_max_redial_attempts, 4);

  select count(*)::integer
  into v_available_agents
  from public.dialer_agent_sessions das
  where das.campaign_id = p_campaign_id
    and das.status = 'available'
    and not exists (
      select 1
      from public.calls open_call
      where open_call.agent_id = das.profile_id
        and open_call.ended_at is null
    );

  v_effective_batch_size := least(
    greatest(coalesce(p_batch_size, 1), 0),
    coalesce(v_available_agents, 0)
  );

  if v_effective_batch_size = 0 then
    return;
  end if;

  return query
  with recent_negative as (
    select
      da.lead_id,
      count(*) as attempts,
      max(da.ended_at) as last_ended_at
    from public.dial_attempts da
    where da.campaign_id = p_campaign_id
      and da.status in ('no_answer', 'busy', 'failed', 'voicemail')
      and da.ended_at >= now() - interval '7 days'
    group by da.lead_id
  ), candidates as (
    select l.id, l.phone, l.full_name, l.rut
    from public.leads l
    left join recent_negative rn on rn.lead_id = l.id
    where l.campaign_id = p_campaign_id
      and l.phone is not null
      and btrim(l.phone) <> ''
      and (
        (
          l.next_action_at is not null
          and l.next_action_at <= now()
          and l.workflow_status = 'callback'
        )
        or (
          l.next_action_at is null
          and coalesce(l.assignment_status, 'pending') not in ('managed', 'exception')
          and coalesce(l.workflow_status, 'pending') not in ('managed', 'exception', 'callback')
        )
      )
      and not exists (
        select 1
        from public.calls open_call
        where open_call.lead_id = l.id
          and open_call.ended_at is null
      )
      and not exists (
        select 1
        from public.dial_attempts da
        where da.lead_id = l.id
          and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
      and coalesce(rn.attempts, 0) < v_max_redial_attempts
      and (
        rn.last_ended_at is null
        or rn.last_ended_at <= now() - (
          case
            when rn.attempts <= 1 then interval '15 minutes'
            when rn.attempts = 2 then interval '1 hour'
            else interval '4 hours'
          end
        )
      )
    order by
      l.external_priority_rank asc nulls last,
      l.next_action_at asc nulls last,
      l.updated_at asc
    limit v_effective_batch_size
    for update of l skip locked
  ), inserted as (
    insert into public.dial_attempts (lead_id, campaign_id, phone, status)
    select c.id, p_campaign_id, c.phone, 'queued'
    from candidates c
    returning
      public.dial_attempts.id as inserted_attempt_id,
      public.dial_attempts.lead_id as inserted_lead_id
  )
  select
    i.inserted_attempt_id,
    i.inserted_lead_id,
    c.phone,
    c.full_name,
    c.rut
  from inserted i
  join candidates c on c.id = i.inserted_lead_id;
end;
$function$;

revoke all on function public.claim_next_dial_targets(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_dial_targets(uuid, integer)
  to service_role;

-- Make the terminal dial event and ACW transition atomic. This closes the
-- short race where a completed attempt stopped counting as in-flight before
-- AgentComplete had changed the agent from available to wrap_up.
create or replace function public.register_dial_event(
  p_dial_attempt_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_agent_id uuid default null,
  p_ami_unique_id text default null,
  p_ami_channel text default null,
  p_hangup_cause text default null
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
begin
  if v_actor_id is not null then
    raise exception 'register_dial_event solo puede ser llamada por el motor de discado.';
  end if;

  select *
  into v_attempt
  from public.dial_attempts
  where id = p_dial_attempt_id
  for update;

  if not found then
    raise exception 'dial_attempt % no existe.', p_dial_attempt_id;
  end if;

  v_call_id := v_attempt.call_id;

  update public.dial_attempts
  set
    status = p_event_type,
    agent_id = coalesce(p_agent_id, agent_id),
    ami_unique_id = coalesce(p_ami_unique_id, ami_unique_id),
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

    update public.dial_attempts
    set call_id = v_call_id
    where id = p_dial_attempt_id;
  end if;

  if p_event_type in ('completed', 'abandoned')
    and v_attempt.bridged_at is not null
    and v_attempt.agent_id is not null then
    update public.dialer_agent_sessions
    set
      status = 'wrap_up',
      last_state_change_at = now(),
      updated_at = now()
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
  );

  return v_call_id;
end;
$function$;

revoke all on function public.register_dial_event(
  uuid, text, jsonb, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.register_dial_event(
  uuid, text, jsonb, uuid, text, text, text
) to service_role;

-- Preserve audit history but close the two orphan calls produced by this
-- incident (and any equivalent orphan): the linked dial attempt is terminal,
-- the lead already has a valid closed management, and this call has no
-- typification of its own.
with duplicate_calls as (
  select
    c.id,
    c.lead_id,
    c.agent_id,
    coalesce(da.ended_at, now()) as effective_ended_at
  from public.calls c
  join public.leads l on l.id = c.lead_id
  join public.dial_attempts da on da.call_id = c.id
  where c.ended_at is null
    and c.status is null
    and c.outcome is null
    and c.reason is null
    and da.status in ('no_answer', 'busy', 'failed', 'abandoned', 'voicemail', 'completed')
    and l.assignment_status = 'managed'
    and exists (
      select 1
      from public.calls managed_call
      where managed_call.lead_id = c.lead_id
        and managed_call.id <> c.id
        and managed_call.ended_at is not null
        and managed_call.reason is not null
    )
), closed_duplicates as (
  update public.calls c
  set
    ended_at = duplicate_calls.effective_ended_at,
    discarded_reason = 'Discado automático duplicado previo a corrección de elegibilidad',
    updated_at = now()
  from duplicate_calls
  where c.id = duplicate_calls.id
  returning c.id, c.lead_id, c.agent_id
)
insert into public.call_events (
  call_id,
  lead_id,
  agent_id,
  event_type,
  payload
)
select
  closed_duplicates.id,
  closed_duplicates.lead_id,
  closed_duplicates.agent_id,
  'call.discarded',
  jsonb_build_object(
    'reason', 'Discado automático duplicado previo a corrección de elegibilidad',
    'source', 'incident_repair_20260729'
  )
from closed_duplicates;
