-- Omnichannel ACD queues are first-class resources, separate from commercial
-- campaigns and provider channels. A source (for example a Meta Ads campaign)
-- enters one queue; the queue owns routing, members, capacity and SLA.

create table public.contact_center_queues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  routing_mode text not null default 'least_loaded'
    check (routing_mode in ('least_loaded', 'manual')),
  service_level_seconds integer not null default 300
    check (service_level_seconds between 60 and 86400),
  max_concurrent_per_agent integer
    check (max_concurrent_per_agent is null or max_concurrent_per_agent between 1 and 500),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contact_center_queue_members (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.contact_center_queues(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  max_concurrent integer
    check (max_concurrent is null or max_concurrent between 1 and 500),
  joined_at timestamptz not null default now(),
  unique (queue_id, profile_id)
);

create table public.contact_center_queue_sources (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.contact_center_queues(id) on delete cascade,
  channel_type text not null
    check (channel_type in ('voice', 'whatsapp', 'email', 'chat', 'instagram')),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  whatsapp_route_id uuid unique references public.whatsapp_campaign_routes(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint contact_center_queue_source_whatsapp_route check (
    channel_type <> 'whatsapp' or whatsapp_route_id is not null
  )
);

create index contact_center_queue_members_queue_idx
  on public.contact_center_queue_members(queue_id, is_active, joined_at);
create index contact_center_queue_sources_campaign_idx
  on public.contact_center_queue_sources(campaign_id, channel_type)
  where is_active;

create trigger contact_center_queues_set_updated_at
  before update on public.contact_center_queues
  for each row execute function public.set_updated_at();

alter table public.whatsapp_conversations
  add column queue_id uuid references public.contact_center_queues(id) on delete restrict;

create index whatsapp_conversations_queue_activity_idx
  on public.whatsapp_conversations(queue_id, status, last_message_at desc);

alter table public.contact_center_queues enable row level security;
alter table public.contact_center_queue_members enable row level security;
alter table public.contact_center_queue_sources enable row level security;

create policy contact_center_queues_select
on public.contact_center_queues for select to authenticated
using ((select public.current_role_name()) in ('admin', 'supervisor'));

create policy contact_center_queue_members_select
on public.contact_center_queue_members for select to authenticated
using ((select public.current_role_name()) in ('admin', 'supervisor'));

create policy contact_center_queue_sources_select
on public.contact_center_queue_sources for select to authenticated
using ((select public.current_role_name()) in ('admin', 'supervisor'));

revoke all on table public.contact_center_queues from anon, authenticated;
revoke all on table public.contact_center_queue_members from anon, authenticated;
revoke all on table public.contact_center_queue_sources from anon, authenticated;
grant select on table public.contact_center_queues to authenticated;
grant select on table public.contact_center_queue_members to authenticated;
grant select on table public.contact_center_queue_sources to authenticated;
grant all on table public.contact_center_queues to service_role;
grant all on table public.contact_center_queue_members to service_role;
grant all on table public.contact_center_queue_sources to service_role;

-- Seed the current WhatsApp operation as a queue, then connect its commercial
-- campaign source and existing campaign agents without duplicating people.
insert into public.contact_center_queues (
  name, description, routing_mode, service_level_seconds
) values (
  'Secretaría Virtual · Atención Digital',
  'Cola omnicanal para contactos digitales de Secretaría Virtual.',
  'least_loaded',
  300
)
on conflict (name) do nothing;

insert into public.contact_center_queue_sources (
  queue_id, channel_type, campaign_id, whatsapp_route_id
)
select
  queue.id,
  'whatsapp',
  route.campaign_id,
  route.id
from public.contact_center_queues queue
join public.whatsapp_campaign_routes route
  on route.campaign_id = 'f59045b2-cb77-49dd-ae4a-a105cdd55121'::uuid
 and route.is_active
where queue.name = 'Secretaría Virtual · Atención Digital'
on conflict (whatsapp_route_id) do update
set queue_id = excluded.queue_id,
    campaign_id = excluded.campaign_id,
    is_active = true;

insert into public.contact_center_queue_members (queue_id, profile_id)
select queue.id, membership.profile_id
from public.contact_center_queues queue
join public.campaign_agents membership
  on membership.campaign_id = 'f59045b2-cb77-49dd-ae4a-a105cdd55121'::uuid
where queue.name = 'Secretaría Virtual · Atención Digital'
on conflict (queue_id, profile_id) do nothing;

update public.whatsapp_conversations conversation
set queue_id = source.queue_id
from public.contact_center_queue_sources source
where source.channel_type = 'whatsapp'
  and source.is_active
  and source.campaign_id = conversation.campaign_id
  and conversation.queue_id is distinct from source.queue_id;

-- New WhatsApp leads inherit the ACD policy. The pre-existing ingestion
-- function may nominate a campaign agent; this gate replaces that nomination
-- with the queue's routing decision before the lead is stored.
create or replace function public.route_new_whatsapp_lead_to_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.contact_center_queues%rowtype;
  v_agent_id uuid;
  v_team_id uuid;
begin
  if new.external_last_source_code is distinct from 'meta_whatsapp'
     or new.campaign_id is null then
    return new;
  end if;

  select queue.* into v_queue
  from public.contact_center_queues queue
  join public.contact_center_queue_sources source on source.queue_id = queue.id
  where source.channel_type = 'whatsapp'
    and source.campaign_id = new.campaign_id
    and source.is_active
    and queue.is_active
  order by source.created_at
  limit 1;

  if v_queue.id is null then
    return new;
  end if;

  if v_queue.routing_mode = 'manual' then
    new.assigned_to := null;
    return new;
  end if;

  select member.profile_id, profile.team_id
  into v_agent_id, v_team_id
  from public.contact_center_queue_members member
  join public.profiles profile on profile.id = member.profile_id
  left join public.whatsapp_conversations active_conversation
    on active_conversation.queue_id = member.queue_id
   and active_conversation.assigned_to = member.profile_id
   and active_conversation.status in ('open', 'pending')
  where member.queue_id = v_queue.id
    and member.is_active
    and profile.active
    and profile.role = 'agente'::public.app_role
  group by member.profile_id, profile.team_id, member.joined_at,
    member.max_concurrent, v_queue.max_concurrent_per_agent
  having coalesce(member.max_concurrent, v_queue.max_concurrent_per_agent) is null
      or count(active_conversation.id) < coalesce(member.max_concurrent, v_queue.max_concurrent_per_agent)
  order by count(active_conversation.id), member.joined_at, member.profile_id
  limit 1;

  new.assigned_to := v_agent_id;
  if v_team_id is not null then new.team_id := v_team_id; end if;
  return new;
end;
$$;

create trigger route_new_whatsapp_lead_to_queue
  before insert on public.leads
  for each row
  when (new.external_last_source_code = 'meta_whatsapp')
  execute function public.route_new_whatsapp_lead_to_queue();

-- Persist the selected queue and the lead's effective assignment on the new
-- interaction. This keeps CRM ownership and ACD ownership coherent at intake.
create or replace function public.scope_new_whatsapp_conversation_to_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_routing_mode text;
  v_lead_assigned_to uuid;
begin
  if new.queue_id is null then
    select source.queue_id, queue.routing_mode
    into new.queue_id, v_routing_mode
    from public.contact_center_queue_sources source
    join public.contact_center_queues queue on queue.id = source.queue_id
    where source.channel_type = 'whatsapp'
      and source.campaign_id = new.campaign_id
      and source.is_active
      and queue.is_active
    order by source.created_at
    limit 1;
  else
    select routing_mode into v_routing_mode
    from public.contact_center_queues where id = new.queue_id;
  end if;

  if new.queue_id is not null then
    select assigned_to into v_lead_assigned_to
    from public.leads where id = new.lead_id;
    new.assigned_to := case when v_routing_mode = 'manual' then null else v_lead_assigned_to end;
  end if;
  return new;
end;
$$;

create trigger scope_new_whatsapp_conversation_to_queue
  before insert on public.whatsapp_conversations
  for each row execute function public.scope_new_whatsapp_conversation_to_queue();

create or replace function public.get_contact_center_queue_control(
  p_queue_id uuid,
  p_from timestamptz default now() - interval '30 days'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_role_name();
  v_result jsonb;
begin
  if v_role is null
     or v_role not in ('admin'::public.app_role, 'supervisor'::public.app_role) then
    raise exception 'queue_control_access_denied';
  end if;

  with
  queue_metrics as (
    select
      count(*) filter (where status in ('open', 'pending'))::integer as active,
      count(*) filter (where status = 'open')::integer as open,
      count(*) filter (where status = 'pending')::integer as pending,
      count(*) filter (where status = 'closed')::integer as closed,
      count(*) filter (where status in ('open', 'pending') and assigned_to is null)::integer as unassigned,
      count(*) filter (where status in ('open', 'pending') and unread_count > 0)::integer as unread,
      count(*) filter (where status in ('open', 'pending') and ai_state = 'handoff')::integer as handoff
    from public.whatsapp_conversations where queue_id = p_queue_id
  ),
  period_conversations as (
    select
      count(*) filter (where created_at >= p_from)::integer as offered,
      count(*) filter (where closed_at >= p_from)::integer as closed,
      avg(extract(epoch from (closed_at - created_at)))
        filter (where closed_at >= p_from and closed_at >= created_at) as avg_handle_seconds
    from public.whatsapp_conversations where queue_id = p_queue_id
  ),
  period_messages as (
    select
      count(*) filter (where message.direction = 'inbound')::integer as inbound_messages,
      count(*) filter (where message.direction = 'outbound')::integer as outbound_messages
    from public.whatsapp_messages message
    join public.whatsapp_conversations conversation on conversation.id = message.conversation_id
    where conversation.queue_id = p_queue_id and message.created_at >= p_from
  ),
  first_inbound as (
    select conversation.id, min(coalesce(message.provider_timestamp, message.created_at)) as at
    from public.whatsapp_conversations conversation
    join public.whatsapp_messages message on message.conversation_id = conversation.id
    where conversation.queue_id = p_queue_id
      and message.direction = 'inbound'
      and message.created_at >= p_from
    group by conversation.id
  ),
  first_response as (
    select inbound.id, inbound.at,
      min(coalesce(message.provider_timestamp, message.created_at)) as response_at
    from first_inbound inbound
    join public.whatsapp_messages message
      on message.conversation_id = inbound.id
     and message.direction = 'outbound'
     and coalesce(message.provider_timestamp, message.created_at) >= inbound.at
    group by inbound.id, inbound.at
  ),
  response_metric as (
    select avg(extract(epoch from (response_at - at))) as avg_answer_seconds from first_response
  ),
  member_rows as (
    select member.profile_id, profile.full_name, profile.active,
      count(conversation.id) filter (where conversation.status in ('open', 'pending'))::integer as active_interactions,
      count(conversation.id) filter (where conversation.status in ('open', 'pending') and conversation.unread_count > 0)::integer as unread,
      count(conversation.id) filter (where conversation.status in ('open', 'pending') and conversation.ai_state = 'handoff')::integer as handoffs,
      count(conversation.id) filter (where conversation.closed_at >= p_from)::integer as closed_in_period,
      max(conversation.last_message_at) filter (where conversation.status in ('open', 'pending')) as last_activity_at
    from public.contact_center_queue_members member
    join public.profiles profile on profile.id = member.profile_id
    left join public.whatsapp_conversations conversation
      on conversation.queue_id = member.queue_id and conversation.assigned_to = member.profile_id
    where member.queue_id = p_queue_id and member.is_active
    group by member.profile_id, profile.full_name, profile.active, member.joined_at
    order by count(conversation.id) filter (where conversation.status in ('open', 'pending')),
      member.joined_at, profile.full_name
  ),
  members as (select coalesce(jsonb_agg(to_jsonb(member_rows)), '[]'::jsonb) value from member_rows),
  closure_rows as (
    select reason.id, reason.label, count(conversation.id)::integer as total
    from public.whatsapp_closure_reasons reason
    join public.contact_center_queue_sources source on source.campaign_id = reason.campaign_id
    left join public.whatsapp_conversations conversation
      on conversation.queue_id = source.queue_id
     and conversation.close_reason_id = reason.id
     and conversation.closed_at >= p_from
    where source.queue_id = p_queue_id and reason.is_active
    group by reason.id, reason.label, reason.sort_order
    order by count(conversation.id) desc, reason.sort_order, reason.label
  ),
  closures as (select coalesce(jsonb_agg(to_jsonb(closure_rows)), '[]'::jsonb) value from closure_rows)
  select jsonb_build_object(
    'queue', to_jsonb(queue_metrics),
    'period', to_jsonb(period_conversations) || to_jsonb(period_messages) || to_jsonb(response_metric),
    'members', members.value,
    'closures', closures.value
  ) into v_result
  from queue_metrics, period_conversations, period_messages, response_metric, members, closures;

  return v_result;
end;
$$;

revoke all on function public.get_contact_center_queue_control(uuid, timestamptz)
  from public, anon;
grant execute on function public.get_contact_center_queue_control(uuid, timestamptz)
  to authenticated, service_role;

comment on table public.contact_center_queues is
  'Omnichannel ACD queues. Campaigns and provider channels connect as sources.';
comment on table public.contact_center_queue_members is
  'Agents eligible to receive interactions from an ACD queue.';
comment on table public.contact_center_queue_sources is
  'Maps commercial/channel sources to an operational ACD queue.';
