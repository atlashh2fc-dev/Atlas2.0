-- Recovery and concurrency hardening for the outbound dialer.
--
-- Incident 2026-07-31:
-- Asterisk returns Uniqueid="<unknown>" when Originate fails before creating
-- a channel. Persisting that sentinel collided with the partial unique index,
-- rolled back register_dial_event, and left attempts in queued forever.

create or replace function public.normalize_ami_unique_id(p_value text)
returns text
language sql
immutable
parallel safe
as $function$
  select case
    when lower(btrim(coalesce(p_value, ''))) in ('', 'unknown', '<unknown>', 'null', 'none')
      then null
    else btrim(p_value)
  end
$function$;

create or replace function public.normalize_dial_attempt_ami_unique_id()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.ami_unique_id := public.normalize_ami_unique_id(new.ami_unique_id);
  return new;
end;
$function$;

drop trigger if exists dial_attempts_normalize_ami_unique_id on public.dial_attempts;
create trigger dial_attempts_normalize_ami_unique_id
  before insert or update of ami_unique_id on public.dial_attempts
  for each row execute function public.normalize_dial_attempt_ami_unique_id();

update public.dial_attempts
set ami_unique_id = null
where ami_unique_id is not null
  and public.normalize_ami_unique_id(ami_unique_id) is null;

alter table public.dial_attempts
  drop constraint if exists dial_attempts_ami_unique_id_not_sentinel_check;
alter table public.dial_attempts
  add constraint dial_attempts_ami_unique_id_not_sentinel_check
  check (
    ami_unique_id is null
    or public.normalize_ami_unique_id(ami_unique_id) is not null
  );

-- One active attempt per lead and per canonical Chilean destination. These
-- constraints close write-skew between overlapping ticks/instances.
create or replace function public.canonical_chile_phone(p_phone text)
returns text
language sql
immutable
parallel safe
as $function$
  with normalized as (
    select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits
  )
  select case
    when digits = '' then null
    when digits ~ '^56[0-9]{9}$' then digits
    when length(digits) = 9 then '56' || digits
    when length(digits) = 8 then '562' || digits
    else digits
  end
  from normalized
$function$;

create unique index if not exists dial_attempts_one_active_per_lead_idx
  on public.dial_attempts (lead_id)
  where status in ('queued', 'originating', 'ringing', 'answered', 'bridged');

create unique index if not exists dial_attempts_one_active_per_phone_idx
  on public.dial_attempts (public.canonical_chile_phone(phone))
  where status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
    and public.canonical_chile_phone(phone) is not null;

-- Terminalize only reservations that never obtained a channel. Calls that
-- reached originating/answered/bridged require reconciliation with Asterisk
-- and are intentionally outside this watchdog.
create or replace function public.expire_stale_queued_dial_attempts(
  p_campaign_id uuid,
  p_older_than_seconds integer default 300
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_expired integer := 0;
begin
  if (select auth.uid()) is not null then
    raise exception 'expire_stale_queued_dial_attempts solo puede ser llamada por el motor.';
  end if;
  if p_older_than_seconds < 60 then
    raise exception 'p_older_than_seconds debe ser al menos 60.';
  end if;

  with expired as (
    update public.dial_attempts attempt
    set
      status = 'failed',
      ended_at = now(),
      hangup_cause = coalesce(attempt.hangup_cause, 'ORIGINATE_ACK_TIMEOUT'),
      updated_at = now()
    where attempt.campaign_id = p_campaign_id
      and attempt.status = 'queued'
      and attempt.originated_at is null
      and attempt.ami_unique_id is null
      and attempt.created_at < now() - make_interval(secs => p_older_than_seconds)
    returning attempt.id, attempt.lead_id, attempt.agent_id, attempt.call_id
  ), audit as (
    insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
    select
      expired.call_id,
      expired.lead_id,
      expired.agent_id,
      'dialer.failed',
      jsonb_build_object(
        'dial_attempt_id', expired.id,
        'source', 'dialer_recovery',
        'reason', 'originate_ack_timeout',
        'older_than_seconds', p_older_than_seconds
      )
    from expired
  )
  select count(*)::integer into v_expired from expired;

  return v_expired;
end;
$function$;

revoke all on function public.expire_stale_queued_dial_attempts(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.expire_stale_queued_dial_attempts(uuid, integer)
  to service_role;

-- Serialize claims per campaign and recalculate capacity inside the same
-- transaction. The engine still supplies its adaptive batch size; the DB
-- enforces the configured ceiling against the latest in-flight count.
create or replace function public.claim_next_dial_targets(
  p_campaign_id uuid,
  p_batch_size integer default 1
)
returns table(dial_attempt_id uuid, lead_id uuid, phone text, full_name text, rut text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_max_redial_attempts integer;
  v_max_dial_ratio numeric;
  v_available_agents integer;
  v_in_flight integer;
  v_target_in_flight integer;
  v_effective_batch_size integer;
begin
  if v_actor_id is not null then
    raise exception 'claim_next_dial_targets solo puede ser llamada por el motor de discado.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 0));

  select
    coalesce(config.max_redial_attempts, 4),
    coalesce(config.max_dial_ratio, 1)
  into v_max_redial_attempts, v_max_dial_ratio
  from public.dialer_campaign_configs config
  where config.campaign_id = p_campaign_id;
  v_max_redial_attempts := coalesce(v_max_redial_attempts, 4);
  v_max_dial_ratio := greatest(coalesce(v_max_dial_ratio, 1), 1);

  select count(*)::integer
  into v_available_agents
  from public.dialer_agent_sessions session
  where session.campaign_id = p_campaign_id
    and session.status = 'available'
    and not exists (
      select 1
      from public.calls open_call
      where open_call.agent_id = session.profile_id
        and open_call.ended_at is null
        and open_call.started_at >= now() - interval '4 hours'
    );

  select count(*)::integer
  into v_in_flight
  from public.dial_attempts attempt
  where attempt.campaign_id = p_campaign_id
    and attempt.attempt_kind = 'pool'
    and (
      attempt.status in ('originating', 'ringing', 'answered', 'bridged')
      or (
        attempt.status = 'queued'
        and attempt.created_at >= now() - interval '5 minutes'
      )
    );

  v_target_in_flight := ceil(coalesce(v_available_agents, 0) * v_max_dial_ratio)::integer;
  v_effective_batch_size := least(
    greatest(coalesce(p_batch_size, 1), 0),
    greatest(v_target_in_flight - coalesce(v_in_flight, 0), 0)
  );

  if v_effective_batch_size = 0 then
    return;
  end if;

  return query
  with recent_negative as (
    select
      attempt.lead_id,
      count(*) as attempts,
      max(attempt.ended_at) as last_ended_at
    from public.dial_attempts attempt
    where attempt.campaign_id = p_campaign_id
      and attempt.status in ('no_answer', 'busy', 'failed', 'voicemail')
      and attempt.ended_at >= now() - interval '7 days'
    group by attempt.lead_id
  ), candidates as (
    select lead.id, lead.phone, lead.full_name, lead.rut
    from public.leads lead
    left join recent_negative on recent_negative.lead_id = lead.id
    where lead.campaign_id = p_campaign_id
      and lead.phone is not null
      and btrim(lead.phone) <> ''
      and (
        (
          lead.next_action_at is not null
          and lead.next_action_at <= now()
          and lead.workflow_status = 'callback'
          and coalesce(lead.managed_by, lead.assigned_to) is null
        )
        or (
          lead.next_action_at is null
          and coalesce(lead.assignment_status, 'pending') not in ('managed', 'exception')
          and coalesce(lead.workflow_status, 'pending') not in ('managed', 'exception', 'callback')
        )
      )
      and not exists (
        select 1 from public.calls open_call
        where open_call.lead_id = lead.id and open_call.ended_at is null
      )
      and not exists (
        select 1 from public.dial_attempts active_attempt
        where active_attempt.lead_id = lead.id
          and active_attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
      and not exists (
        select 1 from public.dial_attempts active_phone
        where active_phone.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
          and public.canonical_chile_phone(active_phone.phone)
              = public.canonical_chile_phone(lead.phone)
      )
      and coalesce(recent_negative.attempts, 0) < v_max_redial_attempts
      and (
        recent_negative.last_ended_at is null
        or recent_negative.last_ended_at <= now() - (
          case
            when recent_negative.attempts <= 1 then interval '15 minutes'
            when recent_negative.attempts = 2 then interval '1 hour'
            else interval '4 hours'
          end
        )
      )
    order by
      lead.external_priority_rank asc nulls last,
      lead.next_action_at asc nulls last,
      lead.updated_at asc
    limit v_effective_batch_size
    for update of lead skip locked
  ), inserted as (
    insert into public.dial_attempts (lead_id, campaign_id, phone, status)
    select candidate.id, p_campaign_id, candidate.phone, 'queued'
    from candidates candidate
    on conflict do nothing
    returning
      public.dial_attempts.id as inserted_attempt_id,
      public.dial_attempts.lead_id as inserted_lead_id
  )
  select
    inserted.inserted_attempt_id,
    inserted.inserted_lead_id,
    candidates.phone,
    candidates.full_name,
    candidates.rut
  from inserted
  join candidates on candidates.id = inserted.inserted_lead_id;
end;
$function$;

revoke all on function public.claim_next_dial_targets(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_dial_targets(uuid, integer)
  to service_role;

-- Ignore regressive events. A terminal attempt cannot be reopened by a late
-- Originate/Dial event, and metadata sentinels are normalized again in SQL.
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
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_attempt public.dial_attempts;
  v_call_id uuid;
  v_current_rank integer;
  v_incoming_rank integer;
  v_normalized_unique_id text := public.normalize_ami_unique_id(p_ami_unique_id);
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

-- A late AgentCalled must not assign a terminal attempt.
create or replace function public.claim_dial_attempt_for_agent(
  p_dial_attempt_id uuid,
  p_agent_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_lead public.leads%rowtype;
  v_agent public.profiles%rowtype;
  v_lead_id uuid;
  v_team_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is not null then
    raise exception 'claim_dial_attempt_for_agent solo puede ser llamada por el motor de discado.';
  end if;

  select * into v_agent
  from public.profiles
  where id = p_agent_id and role = 'agente' and active
  limit 1;
  if not found then
    raise exception 'El ejecutivo % no existe o no está activo.', p_agent_id;
  end if;

  update public.dial_attempts attempt
  set agent_id = p_agent_id, updated_at = v_now
  where attempt.id = p_dial_attempt_id
    and attempt.agent_id is null
    and attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
  returning attempt.lead_id into v_lead_id;

  if v_lead_id is null then return false; end if;

  select * into v_lead from public.leads where id = v_lead_id for update;
  if not found then return false; end if;

  v_team_id := coalesce(v_lead.team_id, v_agent.team_id);

  update public.lead_assignments
  set is_active = false, ends_at = v_now, updated_at = v_now
  where lead_id = v_lead_id and is_active;

  insert into public.lead_assignments
    (lead_id, assigned_to, assigned_by, team_id, campaign_id, reason, source, is_active, starts_at)
  values
    (v_lead_id, p_agent_id, null, v_team_id, v_lead.campaign_id,
     'Atendió la llamada del discador', 'dialer.answer', true, v_now);

  update public.leads
  set assigned_to = p_agent_id,
      managed_by = p_agent_id,
      team_id = v_team_id,
      assignment_status = 'assigned',
      updated_at = v_now
  where id = v_lead_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    v_lead_id,
    v_lead.crm_entity_id,
    null,
    'lead.assigned',
    jsonb_build_object(
      'old_assigned_to', v_lead.assigned_to,
      'new_assigned_to', p_agent_id,
      'team_id', v_team_id,
      'campaign_id', v_lead.campaign_id,
      'source', 'dialer.answer',
      'dial_attempt_id', p_dial_attempt_id
    )
  );

  return true;
end;
$function$;

revoke all on function public.claim_dial_attempt_for_agent(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_dial_attempt_for_agent(uuid, uuid)
  to service_role;
