-- Una derivación creada por la IA no puede silenciar indefinidamente un hilo
-- si ningún agente llegó a responder. La propiedad humana real nunca se
-- recupera automáticamente: solo vencen handoffs Mercury sin salida humana.

create or replace function public.resume_expired_whatsapp_ai_handoff(
  p_conversation_id uuid,
  p_inbound_message_id uuid,
  p_idle_minutes integer default 480
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_handoff public.whatsapp_conversation_events%rowtype;
  v_inbound_created_at timestamptz;
  v_assignment_agent uuid;
begin
  if p_idle_minutes < 60 or p_idle_minutes > 43200 then
    raise exception 'invalid_whatsapp_handoff_idle_minutes';
  end if;

  select * into v_conversation
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if v_conversation.id is null
     or v_conversation.status = 'closed'
     or v_conversation.ai_state <> 'handoff' then
    return false;
  end if;

  select message.created_at into v_inbound_created_at
  from public.whatsapp_messages message
  where message.id = p_inbound_message_id
    and message.conversation_id = p_conversation_id
    and message.direction = 'inbound'
    and message.message_type = 'text';
  if v_inbound_created_at is null then return false; end if;

  if p_inbound_message_id <> (
    select message.id
    from public.whatsapp_messages message
    where message.conversation_id = p_conversation_id
    order by message.created_at desc, message.id desc
    limit 1
  ) then
    return false;
  end if;

  select event.* into v_handoff
  from public.whatsapp_conversation_events event
  where event.conversation_id = p_conversation_id
    and event.event_type = 'ai_handoff'
  order by event.created_at desc
  limit 1;

  if v_handoff.id is null
     or v_handoff.metadata->>'source' <> 'mercury'
     or v_inbound_created_at < v_handoff.created_at + make_interval(mins => p_idle_minutes) then
    return false;
  end if;

  -- Any real human response after the AI handoff makes ownership permanent
  -- until the normal human workflow closes or changes it.
  if exists (
    select 1 from public.whatsapp_messages message
    where message.conversation_id = p_conversation_id
      and message.direction = 'outbound'
      and message.sent_by is not null
      and message.created_at > v_handoff.created_at
  ) then
    return false;
  end if;

  v_assignment_agent := v_conversation.assigned_to;
  update public.lead_assignments
  set is_active = false, ends_at = now(), updated_at = now()
  where lead_id = v_conversation.lead_id
    and assigned_to = v_assignment_agent
    and source = 'whatsapp.ai_handoff'
    and is_active;

  if found then
    update public.leads
    set assigned_to = null,
        assignment_status = 'unassigned',
        updated_at = now()
    where id = v_conversation.lead_id
      and assigned_to = v_assignment_agent;
  end if;

  update public.whatsapp_conversations
  set ai_state = 'auto',
      assigned_to = null,
      ai_last_error = null
  where id = p_conversation_id;

  insert into public.whatsapp_conversation_events(
    conversation_id, event_type, note, metadata
  ) values (
    p_conversation_id,
    'ai_resumed',
    'La IA retomó una derivación vencida que no recibió respuesta humana.',
    jsonb_build_object(
      'source', 'expired_mercury_handoff',
      'handoff_event_id', v_handoff.id,
      'handoff_created_at', v_handoff.created_at,
      'inbound_message_id', p_inbound_message_id,
      'idle_minutes', p_idle_minutes
    )
  );

  return true;
end;
$$;

revoke all on function public.resume_expired_whatsapp_ai_handoff(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.resume_expired_whatsapp_ai_handoff(uuid, uuid, integer)
  to service_role;

create or replace function public.get_whatsapp_ai_work(p_limit integer default 20)
returns table (conversation_id uuid, inbound_message_id uuid)
language sql
security definer
set search_path = public
as $$
  select message.conversation_id, message.id
  from public.whatsapp_messages message
  join public.whatsapp_conversations conversation on conversation.id = message.conversation_id
  join public.whatsapp_ai_configs config on config.campaign_id = conversation.campaign_id and config.enabled
  left join public.whatsapp_ai_runs run on run.inbound_message_id = message.id
  where message.direction = 'inbound'
    and message.message_type = 'text'
    and nullif(btrim(message.text_body), '') is not null
    and conversation.status <> 'closed'
    and (
      conversation.ai_state = 'auto'
      or (
        conversation.ai_state = 'handoff'
        and exists (
          select 1
          from public.whatsapp_conversation_events handoff
          where handoff.id = (
            select latest_handoff.id
            from public.whatsapp_conversation_events latest_handoff
            where latest_handoff.conversation_id = conversation.id
              and latest_handoff.event_type = 'ai_handoff'
            order by latest_handoff.created_at desc
            limit 1
          )
            and handoff.metadata->>'source' = 'mercury'
            and message.created_at >= handoff.created_at + interval '8 hours'
            and not exists (
              select 1 from public.whatsapp_messages human_message
              where human_message.conversation_id = conversation.id
                and human_message.direction = 'outbound'
                and human_message.sent_by is not null
                and human_message.created_at > handoff.created_at
            )
        )
      )
    )
    and message.id = (
      select latest.id
      from public.whatsapp_messages latest
      where latest.conversation_id = message.conversation_id
        and not (latest.direction = 'outbound' and latest.status = 'failed')
      order by latest.created_at desc, latest.id desc
      limit 1
    )
    and (
      run.id is null
      or (run.status = 'failed' and run.attempt_count < 3 and coalesce(run.next_retry_at, now()) <= now())
      or (run.status = 'processing' and run.attempt_count < 3 and run.last_attempt_at <= now() - interval '3 minutes')
    )
  order by message.created_at asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.get_whatsapp_ai_work(integer)
  from public, anon, authenticated;
grant execute on function public.get_whatsapp_ai_work(integer)
  to service_role;

comment on function public.resume_expired_whatsapp_ai_handoff(uuid, uuid, integer) is
  'Resumes only stale Mercury handoffs with no subsequent human response; preserves active human ownership.';
