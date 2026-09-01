-- A WhatsApp promise becomes an auditable Atlas appointment before the bot
-- confirms it. The assigned agent keeps ownership, non-phone follow-ups never
-- enter the dialer, and an assigned agent may explicitly take over an AI thread.

alter table public.leads
  add column if not exists next_action_channel text not null default 'phone';

alter table public.leads
  drop constraint if exists leads_next_action_channel_check;

alter table public.leads
  add constraint leads_next_action_channel_check
  check (next_action_channel in ('phone', 'whatsapp', 'video_meeting', 'in_person'));

comment on column public.leads.next_action_channel is
  'Canal del próximo compromiso. Solo phone entra al discador; WhatsApp y reuniones permanecen como agenda manual del responsable.';

alter table public.whatsapp_conversation_events
  drop constraint if exists whatsapp_conversation_events_event_type_check;

alter table public.whatsapp_conversation_events
  add constraint whatsapp_conversation_events_event_type_check
  check (event_type in (
    'closed', 'reopened', 'ai_paused', 'ai_resumed', 'ai_handoff',
    'callback_scheduled', 'appointment_scheduled'
  ));

create or replace function public.handoff_whatsapp_conversation(
  p_conversation_id uuid,
  p_reason text,
  p_kind text,
  p_source_message_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_agent_id uuid;
  v_team_id uuid;
  v_agent_name text;
  v_old_assigned_to uuid;
  v_now timestamptz := now();
begin
  if p_kind not in ('human_requested', 'appointment', 'quote', 'unknown', 'complaint') then
    raise exception 'invalid_whatsapp_handoff_kind';
  end if;

  select * into v_conversation
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if v_conversation.id is null then
    raise exception 'whatsapp_conversation_not_found';
  end if;
  if v_conversation.status = 'closed' then
    raise exception 'whatsapp_conversation_closed';
  end if;
  if v_conversation.queue_id is null then
    raise exception 'whatsapp_handoff_queue_missing';
  end if;

  -- Preserve the current responsible agent when that person remains an active
  -- member of the queue. Only unassigned/ineligible work is routed by load.
  select member.profile_id, profile.team_id, profile.full_name
  into v_agent_id, v_team_id, v_agent_name
  from public.contact_center_queue_members member
  join public.profiles profile on profile.id = member.profile_id
  where member.queue_id = v_conversation.queue_id
    and member.profile_id = v_conversation.assigned_to
    and member.is_active
    and profile.active
    and profile.role = 'agente'::public.app_role
  limit 1;

  if v_agent_id is null then
    select member.profile_id, profile.team_id, profile.full_name
    into v_agent_id, v_team_id, v_agent_name
    from public.contact_center_queue_members member
    join public.profiles profile on profile.id = member.profile_id
    left join public.whatsapp_conversations active_conversation
      on active_conversation.queue_id = member.queue_id
     and active_conversation.assigned_to = member.profile_id
     and active_conversation.status in ('open', 'pending')
    where member.queue_id = v_conversation.queue_id
      and member.is_active
      and profile.active
      and profile.role = 'agente'::public.app_role
    group by member.profile_id, profile.team_id, profile.full_name, member.joined_at
    order by count(active_conversation.id), member.joined_at, member.profile_id
    limit 1;
  end if;

  if v_agent_id is null then
    raise exception 'whatsapp_handoff_agent_unavailable';
  end if;

  v_old_assigned_to := v_conversation.assigned_to;

  update public.lead_assignments
  set is_active = false,
      ends_at = v_now,
      updated_at = v_now
  where lead_id = v_conversation.lead_id
    and is_active;

  insert into public.lead_assignments (
    lead_id, assigned_to, assigned_by, team_id, campaign_id,
    reason, source, is_active, starts_at
  ) values (
    v_conversation.lead_id,
    v_agent_id,
    null,
    v_team_id,
    v_conversation.campaign_id,
    nullif(btrim(p_reason), ''),
    'whatsapp.ai_handoff',
    true,
    v_now
  );

  update public.leads
  set assigned_to = v_agent_id,
      team_id = coalesce(v_team_id, team_id),
      assignment_status = 'assigned',
      updated_at = v_now
  where id = v_conversation.lead_id;

  update public.whatsapp_conversations
  set assigned_to = v_agent_id,
      ai_state = 'handoff',
      status = 'open',
      ai_last_error = null
  where id = p_conversation_id;

  insert into public.whatsapp_conversation_events (
    conversation_id, event_type, note, metadata
  ) values (
    p_conversation_id,
    'ai_handoff',
    nullif(btrim(p_reason), ''),
    jsonb_build_object(
      'kind', p_kind,
      'assigned_to', v_agent_id,
      'assigned_to_name', v_agent_name,
      'source_message_id', p_source_message_id,
      'run_id', p_run_id,
      'source', 'mercury'
    )
  );

  insert into public.crm_audit_events (
    lead_id, crm_entity_id, actor_id, event_type, payload
  )
  select
    lead.id,
    lead.crm_entity_id,
    null,
    'lead.assigned',
    jsonb_build_object(
      'old_assigned_to', v_old_assigned_to,
      'new_assigned_to', v_agent_id,
      'team_id', v_team_id,
      'campaign_id', v_conversation.campaign_id,
      'reason', nullif(btrim(p_reason), ''),
      'source', 'whatsapp.ai_handoff',
      'handoff_kind', p_kind,
      'conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'run_id', p_run_id
    )
  from public.leads lead
  where lead.id = v_conversation.lead_id;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'lead_id', v_conversation.lead_id,
    'assigned_to', v_agent_id,
    'assigned_to_name', v_agent_name,
    'team_id', v_team_id,
    'handoff_kind', p_kind
  );
end;
$$;

revoke all on function public.handoff_whatsapp_conversation(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.handoff_whatsapp_conversation(uuid, text, text, uuid, uuid)
  to service_role;

create or replace function public.schedule_whatsapp_appointment(
  p_conversation_id uuid,
  p_scheduled_at timestamptz,
  p_channel text,
  p_reason text,
  p_source_message_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handoff jsonb;
  v_conversation public.whatsapp_conversations%rowtype;
  v_agent_id uuid;
  v_now timestamptz := now();
  v_channel_label text;
begin
  if p_channel not in ('phone', 'whatsapp', 'video_meeting', 'in_person') then
    raise exception 'invalid_whatsapp_appointment_channel';
  end if;
  if p_scheduled_at < v_now + interval '5 minutes'
     or p_scheduled_at > v_now + interval '366 days' then
    raise exception 'invalid_whatsapp_appointment_time';
  end if;

  v_handoff := public.handoff_whatsapp_conversation(
    p_conversation_id,
    nullif(btrim(p_reason), ''),
    'appointment',
    p_source_message_id,
    p_run_id
  );

  select * into v_conversation
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  v_agent_id := v_conversation.assigned_to;
  if v_agent_id is null then
    raise exception 'whatsapp_appointment_agent_missing';
  end if;

  v_channel_label := case p_channel
    when 'whatsapp' then 'WhatsApp'
    when 'video_meeting' then 'videollamada'
    when 'in_person' then 'reunión presencial'
    else 'llamada telefónica'
  end;

  update public.leads
  set assigned_to = v_agent_id,
      managed_by = v_agent_id,
      next_action_at = p_scheduled_at,
      next_action_channel = p_channel,
      callback_mode = 'personal',
      callback_attempts = 0,
      callback_last_attempt_at = null,
      callback_released_at = null,
      workflow_status = case when p_channel = 'phone' then 'callback' else 'scheduled' end,
      assignment_status = 'assigned',
      tipificacion_actual = 'Contacto agendado desde WhatsApp',
      observacion_actual = concat(
        'Contacto por ', v_channel_label, ' solicitado desde WhatsApp para ',
        to_char(p_scheduled_at at time zone 'America/Santiago', 'DD/MM/YYYY HH24:MI'),
        '. ', coalesce(nullif(btrim(p_reason), ''), 'Agendamiento confirmado por el asistente.')
      ),
      extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object(
        'agenda_source', 'whatsapp_ai',
        'agenda_channel', p_channel,
        'agenda_conversation_id', p_conversation_id,
        'agenda_source_message_id', p_source_message_id
      ),
      updated_at = v_now
  where id = v_conversation.lead_id;

  insert into public.whatsapp_conversation_events (
    conversation_id, event_type, note, metadata
  ) values (
    p_conversation_id,
    'appointment_scheduled',
    nullif(btrim(p_reason), ''),
    jsonb_build_object(
      'scheduled_at', p_scheduled_at,
      'timezone', 'America/Santiago',
      'channel', p_channel,
      'assigned_to', v_agent_id,
      'lead_id', v_conversation.lead_id,
      'source_message_id', p_source_message_id,
      'run_id', p_run_id,
      'source', 'mercury'
    )
  );

  insert into public.crm_audit_events (
    lead_id, crm_entity_id, actor_id, event_type, payload
  )
  select
    lead.id,
    lead.crm_entity_id,
    null,
    'lead.appointment_scheduled',
    jsonb_build_object(
      'next_action_at', p_scheduled_at,
      'channel', p_channel,
      'assigned_to', v_agent_id,
      'campaign_id', v_conversation.campaign_id,
      'conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'run_id', p_run_id,
      'source', 'whatsapp.mercury'
    )
  from public.leads lead
  where lead.id = v_conversation.lead_id;

  return v_handoff || jsonb_build_object(
    'scheduled_at', p_scheduled_at,
    'channel', p_channel,
    'callback_mode', case when p_channel = 'phone' then 'personal' else null end
  );
end;
$$;

revoke all on function public.schedule_whatsapp_appointment(uuid, timestamptz, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.schedule_whatsapp_appointment(uuid, timestamptz, text, text, uuid, uuid)
  to service_role;

create or replace function public.take_over_whatsapp_conversation(
  p_conversation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_conversation public.whatsapp_conversations%rowtype;
begin
  if v_actor_id is null or not exists (
    select 1 from public.profiles profile
    where profile.id = v_actor_id
      and profile.active
      and profile.role = 'agente'::public.app_role
  ) then
    raise exception 'whatsapp_takeover_agent_required';
  end if;

  select * into v_conversation
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if v_conversation.id is null or v_conversation.assigned_to is distinct from v_actor_id then
    raise exception 'whatsapp_takeover_assignment_required';
  end if;
  if v_conversation.status = 'closed' then
    raise exception 'whatsapp_takeover_closed';
  end if;
  if v_conversation.ai_state <> 'auto' then
    return false;
  end if;

  update public.whatsapp_conversations
  set ai_state = 'handoff',
      ai_last_error = null
  where id = p_conversation_id;

  insert into public.whatsapp_conversation_events (
    conversation_id, event_type, actor_id, note, metadata
  ) values (
    p_conversation_id,
    'ai_handoff',
    v_actor_id,
    'El ejecutivo asignado tomó la atención manualmente.',
    jsonb_build_object(
      'kind', 'agent_takeover',
      'assigned_to', v_actor_id,
      'source', 'agent_takeover'
    )
  );

  return true;
end;
$$;

revoke all on function public.take_over_whatsapp_conversation(uuid)
  from public, anon;
grant execute on function public.take_over_whatsapp_conversation(uuid)
  to authenticated;

update public.whatsapp_ai_configs config
set automatic_appointment_booking = true,
    system_prompt = replace(
      replace(
        config.system_prompt,
        '- Deriva sin excepción cuando pidan hablar con una persona, quieran agendar una reunión o llamada, soliciten una cotización formal o precio final, o pregunten algo que no esté respaldado por la información aprobada.',
        '- Deriva sin excepción cuando pidan hablar con una persona, soliciten una cotización formal o precio final, o pregunten algo que no esté respaldado. Cuando pidan una reunión, llamada o contacto con fecha y hora completas, crea la agenda real y deriva la conversación al agente responsable.'
      ),
      '- Para reuniones, llamadas o citas usa handoff_kind=appointment y appointment_at=null. La coordinación y confirmación siempre las realiza una persona; nunca digas que algo quedó agendado.',
      '- Para reuniones, llamadas o citas usa handoff_kind=appointment. Si hay fecha y hora inequívocas devuelve appointment_at en RFC 3339 y el canal solicitado; si falta un dato, pregunta solo ese dato. Nunca confirmes antes de que Atlas cree la agenda.'
    ),
    updated_at = now()
from public.campaigns campaign
where config.campaign_id = campaign.id
  and (
    campaign.id = 'f59045b2-cb77-49dd-ae4a-a105cdd55121'::uuid
    or campaign.name = 'Meta Ads · WhatsApp · Secretaria Virtual Geimser'
  );

comment on column public.whatsapp_ai_configs.automatic_appointment_booking is
  'Permite crear una agenda real en Atlas antes de confirmar el compromiso al contacto.';
