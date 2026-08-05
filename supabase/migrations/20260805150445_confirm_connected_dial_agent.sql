-- Incident 2026-08-05: AgentCalled is only an offer, not proof that the
-- member answered. The old RPC assigned the lead to the first notified
-- member; AgentConnect could then create the call for a different member.
-- This function is called only from AgentConnect and makes the connected
-- agent authoritative across the attempt and CRM assignment.
create or replace function public.confirm_dial_attempt_agent_connection(
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
  v_attempt public.dial_attempts%rowtype;
  v_lead public.leads%rowtype;
  v_agent public.profiles%rowtype;
  v_team_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is not null then
    raise exception 'confirm_dial_attempt_agent_connection solo puede ser llamada por el motor.';
  end if;

  select * into v_agent
  from public.profiles
  where id = p_agent_id and role = 'agente' and active
  limit 1;
  if not found then
    raise exception 'El ejecutivo % no existe o no está activo.', p_agent_id;
  end if;

  select * into v_attempt
  from public.dial_attempts
  where id = p_dial_attempt_id
  for update;

  if not found
    or v_attempt.status not in ('queued', 'originating', 'ringing', 'answered', 'bridged') then
    return false;
  end if;

  update public.dial_attempts
  set agent_id = p_agent_id, updated_at = v_now
  where id = p_dial_attempt_id;

  select * into v_lead
  from public.leads
  where id = v_attempt.lead_id
  for update;
  if not found then return false; end if;

  v_team_id := coalesce(v_lead.team_id, v_agent.team_id);

  update public.lead_assignments
  set is_active = false, ends_at = v_now, updated_at = v_now
  where lead_id = v_lead.id
    and is_active
    and assigned_to is distinct from p_agent_id;

  if not exists (
    select 1
    from public.lead_assignments
    where lead_id = v_lead.id
      and assigned_to = p_agent_id
      and is_active
  ) then
    insert into public.lead_assignments
      (lead_id, assigned_to, assigned_by, team_id, campaign_id, reason, source, is_active, starts_at)
    values
      (v_lead.id, p_agent_id, null, v_team_id, v_lead.campaign_id,
       'Conectó la llamada del discador', 'dialer.connect', true, v_now);
  end if;

  update public.leads
  set assigned_to = p_agent_id,
      team_id = v_team_id,
      assignment_status = 'assigned',
      updated_at = v_now
  where id = v_lead.id;

  if v_lead.assigned_to is distinct from p_agent_id
    or v_attempt.agent_id is distinct from p_agent_id then
    insert into public.crm_audit_events
      (lead_id, crm_entity_id, actor_id, event_type, payload)
    values (
      v_lead.id,
      v_lead.crm_entity_id,
      null,
      'lead.assigned',
      jsonb_build_object(
        'old_assigned_to', v_lead.assigned_to,
        'new_assigned_to', p_agent_id,
        'previous_attempt_agent_id', v_attempt.agent_id,
        'team_id', v_team_id,
        'campaign_id', v_lead.campaign_id,
        'source', 'dialer.connect',
        'dial_attempt_id', p_dial_attempt_id
      )
    );
  end if;

  return true;
end;
$function$;

revoke all on function public.confirm_dial_attempt_agent_connection(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_dial_attempt_agent_connection(uuid, uuid)
  to service_role;

comment on function public.confirm_dial_attempt_agent_connection(uuid, uuid) is
  'Confirma desde AgentConnect al ejecutivo realmente bridgeado y alinea intento y asignación del lead.';

-- QueuePause emits QueueMemberPause. Preserve wrap_up against that echo and
-- against late QueueMemberStatus events; only an actual connected call,
-- explicit offline, or the application close flow may leave wrap_up.
create or replace function public.update_agent_dialer_status(
  p_profile_id uuid,
  p_campaign_id uuid,
  p_extension text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is not null then
    raise exception 'update_agent_dialer_status solo puede ser llamada por el motor de discado.';
  end if;
  if p_status not in ('offline', 'available', 'ringing', 'on_call', 'wrap_up', 'paused') then
    raise exception 'status % invalido.', p_status;
  end if;
  if p_status <> 'offline' and exists (
    select 1
    from public.agent_current_status s
    join public.agent_status_reasons r on r.id = s.reason_id
    where s.profile_id = p_profile_id and r.code = 'desconectado'
  ) then
    return;
  end if;

  insert into public.dialer_agent_sessions (
    profile_id, campaign_id, extension, status, last_state_change_at
  ) values (p_profile_id, p_campaign_id, p_extension, p_status, now())
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

revoke all on function public.update_agent_dialer_status(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_agent_dialer_status(uuid, uuid, text, text)
  to service_role;

-- A stale, empty call must not make the partial unique index reject the next
-- real bridge forever. Repair only rows older than four hours and without any
-- typification; recent or managed rows remain protected by the unique index.
create or replace function public.repair_stale_open_call_before_insert()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_repaired record;
begin
  if new.agent_id is null then return new; end if;

  for v_repaired in
    update public.calls old_call
    set ended_at = coalesce(
          (
            select max(attempt.ended_at)
            from public.dial_attempts attempt
            where attempt.call_id = old_call.id
              and attempt.status in ('no_answer', 'busy', 'failed', 'abandoned', 'voicemail', 'completed')
          ),
          old_call.updated_at,
          old_call.started_at,
          now()
        ),
        discarded_reason = 'Gestión huérfana terminal saneada antes de una nueva llamada',
        updated_at = now()
    where old_call.agent_id = new.agent_id
      and old_call.ended_at is null
      and old_call.id <> new.id
      and old_call.started_at < now() - interval '4 hours'
      and old_call.status is null
      and old_call.outcome is null
      and old_call.reason is null
      and nullif(btrim(coalesce(old_call.notes, '')), '') is null
      and old_call.next_action_at is null
    returning old_call.id, old_call.lead_id, old_call.agent_id
  loop
    insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
    values (
      v_repaired.id,
      v_repaired.lead_id,
      v_repaired.agent_id,
      'call.repaired',
      jsonb_build_object(
        'reason', 'stale_empty_open_call',
        'source', 'before_new_call_guard',
        'incident', '2026-08-05'
      )
    );
  end loop;

  return new;
end;
$function$;

drop trigger if exists calls_repair_stale_open_before_insert on public.calls;
create trigger calls_repair_stale_open_before_insert
  before insert on public.calls
  for each row execute function public.repair_stale_open_call_before_insert();

-- Reconcile the same safe subset now so today's operation starts clean.
with repaired as (
  update public.calls old_call
  set ended_at = coalesce(
        (
          select max(attempt.ended_at)
          from public.dial_attempts attempt
          where attempt.call_id = old_call.id
            and attempt.status in ('no_answer', 'busy', 'failed', 'abandoned', 'voicemail', 'completed')
        ),
        old_call.updated_at,
        old_call.started_at,
        now()
      ),
      discarded_reason = 'Gestión huérfana terminal saneada durante incidente 2026-08-05',
      updated_at = now()
  where old_call.ended_at is null
    and old_call.started_at < now() - interval '4 hours'
    and old_call.status is null
    and old_call.outcome is null
    and old_call.reason is null
    and nullif(btrim(coalesce(old_call.notes, '')), '') is null
    and old_call.next_action_at is null
  returning old_call.id, old_call.lead_id, old_call.agent_id
)
insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
select
  repaired.id,
  repaired.lead_id,
  repaired.agent_id,
  'call.repaired',
  jsonb_build_object(
    'reason', 'stale_empty_open_call',
    'source', 'incident_repair_20260805'
  )
from repaired;

-- Repair the production crossing that established this incident. The UUID is
-- the dial attempt (not customer PII), and every predicate revalidates the
-- evidence before touching the lead so this is a no-op in other environments.
do $function$
declare
  v_attempt public.dial_attempts%rowtype;
  v_call public.calls%rowtype;
  v_lead public.leads%rowtype;
  v_now timestamptz := now();
begin
  select * into v_attempt
  from public.dial_attempts
  where id = 'ff79e8d6-c453-4556-b81b-f4dd50fd3c7e'::uuid
    and agent_id is not null
    and call_id is not null;
  if not found then return; end if;

  select * into v_call
  from public.calls
  where id = v_attempt.call_id
    and agent_id = v_attempt.agent_id;
  if not found then return; end if;

  select * into v_lead
  from public.leads
  where id = v_attempt.lead_id
    and assigned_to is distinct from v_attempt.agent_id
  for update;
  if not found then return; end if;

  update public.lead_assignments
  set is_active = false, ends_at = v_now, updated_at = v_now
  where lead_id = v_lead.id and is_active;

  insert into public.lead_assignments
    (lead_id, assigned_to, assigned_by, team_id, campaign_id, reason, source, is_active, starts_at)
  values
    (v_lead.id, v_attempt.agent_id, null, v_lead.team_id, v_lead.campaign_id,
     'Reconciliado con AgentConnect confirmado', 'incident.repair', true, v_now);

  update public.leads
  set assigned_to = v_attempt.agent_id,
      managed_by = case
        when managed_by = v_lead.assigned_to
          and not exists (
            select 1 from public.calls managed_call
            where managed_call.lead_id = v_lead.id
              and managed_call.agent_id = v_lead.assigned_to
              and managed_call.status = 'connected'
              and managed_call.ended_at is not null
              and managed_call.discarded_reason is null
          ) then null
        else managed_by
      end,
      updated_at = v_now
  where id = v_lead.id;

  insert into public.crm_audit_events
    (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    v_lead.id,
    v_lead.crm_entity_id,
    null,
    'lead.assignment_repaired',
    jsonb_build_object(
      'old_assigned_to', v_lead.assigned_to,
      'new_assigned_to', v_attempt.agent_id,
      'dial_attempt_id', v_attempt.id,
      'call_id', v_call.id,
      'source', 'incident_repair_20260805'
    )
  );
end;
$function$;
