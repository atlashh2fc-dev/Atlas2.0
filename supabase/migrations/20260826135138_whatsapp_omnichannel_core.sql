-- WhatsApp Business as a first-class Atlas campaign channel.
-- Provider secrets stay in the server environment; the database stores only
-- operational identifiers and auditable conversation state.

create table public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text not null,
  business_name text not null,
  meta_business_id text,
  meta_ad_account_id text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'paused', 'error')),
  last_webhook_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_channels_waba_not_blank check (btrim(waba_id) <> ''),
  constraint whatsapp_channels_phone_id_not_blank check (btrim(phone_number_id) <> ''),
  constraint whatsapp_channels_display_phone_not_blank check (btrim(display_phone_number) <> '')
);

create table public.whatsapp_campaign_routes (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.whatsapp_channels(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  meta_campaign_id text,
  meta_ad_id text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, campaign_id, meta_campaign_id, meta_ad_id)
);

create unique index whatsapp_campaign_routes_default_uidx
  on public.whatsapp_campaign_routes(channel_id)
  where is_default and is_active;

create unique index whatsapp_campaign_routes_ad_uidx
  on public.whatsapp_campaign_routes(channel_id, meta_ad_id)
  where meta_ad_id is not null and is_active;

create index whatsapp_campaign_routes_campaign_idx
  on public.whatsapp_campaign_routes(campaign_id)
  where is_active;

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.whatsapp_channels(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  lead_id uuid not null references public.leads(id) on delete restrict,
  contact_wa_id text not null,
  contact_phone text not null,
  contact_name text,
  assigned_to uuid references public.profiles(id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'pending', 'closed')),
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  referral jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, contact_wa_id),
  constraint whatsapp_conversations_wa_id_not_blank check (btrim(contact_wa_id) <> ''),
  constraint whatsapp_conversations_phone_not_blank check (btrim(contact_phone) <> '')
);

create index whatsapp_conversations_campaign_activity_idx
  on public.whatsapp_conversations(campaign_id, status, last_message_at desc);

create index whatsapp_conversations_agent_activity_idx
  on public.whatsapp_conversations(assigned_to, status, last_message_at desc);

create index whatsapp_conversations_lead_idx
  on public.whatsapp_conversations(lead_id);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  provider_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null default 'text',
  text_body text,
  status text not null default 'received'
    check (status in ('pending', 'accepted', 'received', 'sent', 'delivered', 'read', 'failed', 'deleted')),
  sender_wa_id text,
  context_provider_message_id text,
  referral jsonb not null default '{}'::jsonb,
  provider_payload jsonb not null default '{}'::jsonb,
  provider_timestamp timestamptz,
  sent_by uuid references public.profiles(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index whatsapp_messages_provider_id_uidx
  on public.whatsapp_messages(provider_message_id)
  where provider_message_id is not null;

create index whatsapp_messages_conversation_time_idx
  on public.whatsapp_messages(conversation_id, provider_timestamp, created_at);

create table public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_key text not null unique,
  event_type text not null,
  phone_number_id text,
  status text not null default 'received'
    check (status in ('received', 'processed', 'duplicate', 'unmapped', 'failed')),
  payload jsonb not null,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index whatsapp_webhook_events_received_idx
  on public.whatsapp_webhook_events(received_at desc);

create trigger whatsapp_channels_set_updated_at
  before update on public.whatsapp_channels
  for each row execute function public.set_updated_at();

create trigger whatsapp_campaign_routes_set_updated_at
  before update on public.whatsapp_campaign_routes
  for each row execute function public.set_updated_at();

create trigger whatsapp_conversations_set_updated_at
  before update on public.whatsapp_conversations
  for each row execute function public.set_updated_at();

create trigger whatsapp_messages_set_updated_at
  before update on public.whatsapp_messages
  for each row execute function public.set_updated_at();

create or replace function public.can_access_whatsapp_campaign(
  p_campaign_id uuid,
  p_assigned_to uuid default null
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case public.current_role_name()
    when 'admin'::public.app_role then true
    when 'agente'::public.app_role then (
      p_assigned_to = (select auth.uid())
      or (
        p_assigned_to is null
        and exists (
          select 1
          from public.campaign_agents membership
          where membership.campaign_id = p_campaign_id
            and membership.profile_id = (select auth.uid())
        )
      )
    )
    when 'supervisor'::public.app_role then exists (
      select 1
      from public.campaign_agents membership
      join public.profiles agent on agent.id = membership.profile_id
      where membership.campaign_id = p_campaign_id
        and agent.active
        and agent.team_id = any(public.supervised_team_ids())
    )
    else false
  end;
$$;

revoke all on function public.can_access_whatsapp_campaign(uuid, uuid)
  from public, anon;
grant execute on function public.can_access_whatsapp_campaign(uuid, uuid)
  to authenticated, service_role;

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

create or replace function public.update_whatsapp_message_status(
  p_provider_message_id text,
  p_status text,
  p_provider_timestamp timestamptz,
  p_error_message text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
begin
  if p_status not in ('accepted', 'sent', 'delivered', 'read', 'failed', 'deleted') then
    raise exception 'invalid_whatsapp_status';
  end if;

  update public.whatsapp_messages message
  set status = case
        when p_status in ('failed', 'deleted') then p_status
        when message.status in ('failed', 'deleted') then message.status
        when array_position(array['pending', 'accepted', 'sent', 'delivered', 'read'], p_status)
           >= array_position(array['pending', 'accepted', 'sent', 'delivered', 'read'], message.status)
          then p_status
        else message.status
      end,
      provider_timestamp = greatest(
        coalesce(message.provider_timestamp, '-infinity'::timestamptz),
        coalesce(p_provider_timestamp, '-infinity'::timestamptz)
      ),
      error_message = coalesce(p_error_message, message.error_message),
      provider_payload = coalesce(message.provider_payload, '{}'::jsonb)
        || jsonb_build_object('latest_status', coalesce(p_payload, '{}'::jsonb))
  where message.provider_message_id = p_provider_message_id
  returning message.id into v_message_id;

  return v_message_id;
end;
$$;

revoke all on function public.update_whatsapp_message_status(text, text, timestamptz, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_whatsapp_message_status(text, text, timestamptz, text, jsonb)
  to service_role;

alter table public.whatsapp_channels enable row level security;
alter table public.whatsapp_campaign_routes enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_webhook_events enable row level security;

create policy whatsapp_channels_select
on public.whatsapp_channels for select to authenticated
using (
  (select public.current_role_name()) = 'admin'::public.app_role
  or exists (
    select 1
    from public.whatsapp_campaign_routes route
    where route.channel_id = whatsapp_channels.id
      and route.is_active
      and public.can_access_whatsapp_campaign(route.campaign_id, null)
  )
);

create policy whatsapp_campaign_routes_select
on public.whatsapp_campaign_routes for select to authenticated
using (
  is_active
  and public.can_access_whatsapp_campaign(campaign_id, null)
);

create policy whatsapp_conversations_select
on public.whatsapp_conversations for select to authenticated
using (
  public.can_access_whatsapp_campaign(campaign_id, assigned_to)
);

create policy whatsapp_messages_select
on public.whatsapp_messages for select to authenticated
using (
  exists (
    select 1
    from public.whatsapp_conversations conversation
    where conversation.id = whatsapp_messages.conversation_id
      and public.can_access_whatsapp_campaign(conversation.campaign_id, conversation.assigned_to)
  )
);

revoke all on table public.whatsapp_channels from anon, authenticated;
revoke all on table public.whatsapp_campaign_routes from anon, authenticated;
revoke all on table public.whatsapp_conversations from anon, authenticated;
revoke all on table public.whatsapp_messages from anon, authenticated;
revoke all on table public.whatsapp_webhook_events from anon, authenticated;

grant select on table public.whatsapp_channels to authenticated;
grant select on table public.whatsapp_campaign_routes to authenticated;
grant select on table public.whatsapp_conversations to authenticated;
grant select on table public.whatsapp_messages to authenticated;

grant all on table public.whatsapp_channels to service_role;
grant all on table public.whatsapp_campaign_routes to service_role;
grant all on table public.whatsapp_conversations to service_role;
grant all on table public.whatsapp_messages to service_role;
grant all on table public.whatsapp_webhook_events to service_role;

alter publication supabase_realtime add table
  public.whatsapp_conversations,
  public.whatsapp_messages;

comment on table public.whatsapp_channels is
  'WhatsApp Business phone assets. Access tokens and app secrets remain server-side.';
comment on table public.whatsapp_conversations is
  'Campaign-scoped WhatsApp threads linked to the canonical Atlas lead.';
comment on table public.whatsapp_webhook_events is
  'Backend-only idempotency and diagnostics for signed Meta webhooks.';
