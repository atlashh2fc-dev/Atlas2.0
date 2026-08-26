-- A contact can arrive through more than one campaign over time. Keep each
-- commercial thread scoped to its campaign instead of silently reusing the
-- first conversation ever created for the phone number.

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_channel_id_contact_wa_id_key;

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_channel_campaign_contact_key
  unique (channel_id, campaign_id, contact_wa_id);

create index if not exists whatsapp_conversations_contact_activity_idx
  on public.whatsapp_conversations (channel_id, contact_wa_id, last_message_at desc)
  where status in ('open', 'pending');

create or replace function public.ingest_whatsapp_message(
  p_channel_id uuid,
  p_campaign_id uuid,
  p_provider_message_id text,
  p_direction text,
  p_contact_wa_id text,
  p_contact_phone text,
  p_contact_name text,
  p_message_type text,
  p_text_body text,
  p_provider_timestamp timestamptz,
  p_sender_wa_id text,
  p_context_provider_message_id text,
  p_referral jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_lead public.leads%rowtype;
  v_campaign public.campaigns%rowtype;
  v_assigned_to uuid;
  v_team_id uuid;
  v_message_id uuid;
  v_normalized_phone text := regexp_replace(coalesce(p_contact_phone, ''), '\\D', '', 'g');
  v_created boolean := false;
begin
  if p_direction not in ('inbound', 'outbound') then
    raise exception 'invalid_whatsapp_direction';
  end if;
  if btrim(coalesce(p_contact_wa_id, '')) = '' or v_normalized_phone = '' then
    raise exception 'invalid_whatsapp_contact';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_channel_id::text || ':' || p_contact_wa_id, 0)
  );

  if p_provider_message_id is not null then
    select m.id, c.id, c.lead_id, c.assigned_to
    into v_message_id, v_conversation.id, v_conversation.lead_id, v_conversation.assigned_to
    from public.whatsapp_messages m
    join public.whatsapp_conversations c on c.id = m.conversation_id
    where m.provider_message_id = p_provider_message_id;

    if v_message_id is not null then
      return jsonb_build_object(
        'duplicate', true,
        'message_id', v_message_id,
        'conversation_id', v_conversation.id,
        'lead_id', v_conversation.lead_id,
        'assigned_to', v_conversation.assigned_to
      );
    end if;
  end if;

  select * into v_conversation
  from public.whatsapp_conversations
  where channel_id = p_channel_id
    and campaign_id = p_campaign_id
    and contact_wa_id = p_contact_wa_id;

  if v_conversation.id is null then
    select * into v_campaign
    from public.campaigns
    where id = p_campaign_id
      and is_active;

    if v_campaign.id is null then
      raise exception 'whatsapp_campaign_not_active';
    end if;

    select l.* into v_lead
    from public.leads l
    where l.campaign_id = p_campaign_id
      and (
        regexp_replace(coalesce(l.phone, ''), '\\D', '', 'g') = v_normalized_phone
        or exists (
          select 1
          from public.lead_contacts contact
          where contact.lead_id = l.id
            and contact.contact_type = 'phone'
            and contact.normalized_value = v_normalized_phone
        )
      )
    order by l.updated_at desc
    limit 1;

    if v_lead.id is null then
      select membership.profile_id, agent.team_id
      into v_assigned_to, v_team_id
      from public.campaign_agents membership
      join public.profiles agent on agent.id = membership.profile_id
      left join public.whatsapp_conversations open_conversation
        on open_conversation.assigned_to = membership.profile_id
       and open_conversation.status in ('open', 'pending')
      where membership.campaign_id = p_campaign_id
        and agent.active
        and agent.role = 'agente'::public.app_role
      group by membership.profile_id, agent.team_id, membership.assigned_at
      order by count(open_conversation.id), membership.assigned_at, membership.profile_id
      limit 1;

      insert into public.leads (
        phone,
        full_name,
        status,
        assigned_to,
        team_id,
        workflow_id,
        campaign_id,
        external_last_source_code,
        external_last_seen_at,
        extra
      ) values (
        p_contact_phone,
        coalesce(nullif(btrim(p_contact_name), ''), 'WhatsApp ' || p_contact_phone),
        'nuevo',
        v_assigned_to,
        v_team_id,
        v_campaign.workflow_id,
        p_campaign_id,
        'meta_whatsapp',
        coalesce(p_provider_timestamp, now()),
        jsonb_build_object(
          'source', 'meta_whatsapp',
          'whatsapp_id', p_contact_wa_id,
          'referral', coalesce(p_referral, '{}'::jsonb)
        )
      ) returning * into v_lead;

      insert into public.lead_contacts (
        lead_id,
        contact_type,
        value,
        normalized_value,
        label,
        is_primary,
        is_valid,
        source,
        metadata
      ) values (
        v_lead.id,
        'phone',
        p_contact_phone,
        v_normalized_phone,
        'WhatsApp',
        true,
        true,
        'meta_whatsapp',
        jsonb_build_object('wa_id', p_contact_wa_id)
      ) on conflict (lead_id, contact_type, normalized_value) do nothing;

      v_created := true;
    else
      v_assigned_to := coalesce(v_lead.managed_by, v_lead.assigned_to);
      v_team_id := v_lead.team_id;
    end if;

    insert into public.whatsapp_conversations (
      channel_id,
      campaign_id,
      lead_id,
      contact_wa_id,
      contact_phone,
      contact_name,
      assigned_to,
      status,
      last_message_at,
      last_inbound_at,
      last_outbound_at,
      unread_count,
      referral
    ) values (
      p_channel_id,
      p_campaign_id,
      v_lead.id,
      p_contact_wa_id,
      p_contact_phone,
      nullif(btrim(p_contact_name), ''),
      v_assigned_to,
      'open',
      coalesce(p_provider_timestamp, now()),
      case when p_direction = 'inbound' then coalesce(p_provider_timestamp, now()) end,
      case when p_direction = 'outbound' then coalesce(p_provider_timestamp, now()) end,
      0,
      coalesce(p_referral, '{}'::jsonb)
    ) returning * into v_conversation;
  end if;

  insert into public.whatsapp_messages (
    conversation_id,
    provider_message_id,
    direction,
    message_type,
    text_body,
    status,
    sender_wa_id,
    context_provider_message_id,
    referral,
    provider_payload,
    provider_timestamp
  ) values (
    v_conversation.id,
    p_provider_message_id,
    p_direction,
    coalesce(nullif(p_message_type, ''), 'unknown'),
    p_text_body,
    case when p_direction = 'inbound' then 'received' else 'sent' end,
    p_sender_wa_id,
    p_context_provider_message_id,
    coalesce(p_referral, '{}'::jsonb),
    coalesce(p_payload, '{}'::jsonb),
    p_provider_timestamp
  )
  on conflict (provider_message_id) where provider_message_id is not null do nothing
  returning id into v_message_id;

  if v_message_id is null and p_provider_message_id is not null then
    select id into v_message_id
    from public.whatsapp_messages
    where provider_message_id = p_provider_message_id;
  end if;

  update public.whatsapp_conversations
  set contact_name = coalesce(nullif(btrim(p_contact_name), ''), contact_name),
      contact_phone = p_contact_phone,
      status = case when p_direction = 'inbound' then 'open' else status end,
      last_message_at = greatest(last_message_at, coalesce(p_provider_timestamp, now())),
      last_inbound_at = case
        when p_direction = 'inbound' then greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), coalesce(p_provider_timestamp, now()))
        else last_inbound_at
      end,
      last_outbound_at = case
        when p_direction = 'outbound' then greatest(coalesce(last_outbound_at, '-infinity'::timestamptz), coalesce(p_provider_timestamp, now()))
        else last_outbound_at
      end,
      unread_count = unread_count + case when p_direction = 'inbound' and v_message_id is not null then 1 else 0 end,
      referral = case
        when coalesce(p_referral, '{}'::jsonb) = '{}'::jsonb then referral
        else p_referral
      end
  where id = v_conversation.id;

  update public.leads
  set external_last_source_code = 'meta_whatsapp',
      external_last_seen_at = greatest(coalesce(external_last_seen_at, '-infinity'::timestamptz), coalesce(p_provider_timestamp, now())),
      assigned_to = coalesce(assigned_to, v_conversation.assigned_to),
      team_id = coalesce(team_id, v_team_id)
  where id = v_conversation.lead_id;

  return jsonb_build_object(
    'duplicate', false,
    'created_lead', v_created,
    'message_id', v_message_id,
    'conversation_id', v_conversation.id,
    'lead_id', v_conversation.lead_id,
    'assigned_to', v_conversation.assigned_to
  );
end;
$$;

revoke all on function public.ingest_whatsapp_message(
  uuid, uuid, text, text, text, text, text, text, text, timestamptz, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_message(
  uuid, uuid, text, text, text, text, text, text, text, timestamptz, text, text, jsonb, jsonb
) to service_role;
