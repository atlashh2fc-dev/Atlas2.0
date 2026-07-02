create index if not exists mail_result_contacts_hot_campaign_lead_idx
  on public.mail_result_contacts (campaign_id, lead_id, created_at desc)
  where lead_id is not null and (opened or clicked);

create index if not exists mail_result_contacts_hot_batch_lead_idx
  on public.mail_result_contacts (batch_id, lead_id, created_at desc)
  where lead_id is not null and (opened or clicked);

create or replace function public.get_mail_agent_control_summary(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null
)
returns table (
  agent_id uuid,
  agent_name text,
  assigned_leads integer,
  clicked_leads integer,
  opened_only_leads integer,
  uncontacted_leads integer,
  clicked_uncontacted_leads integer,
  contacted_leads integer,
  interactions integer,
  agendas integer,
  pending_agendas integer,
  overdue_agendas integer,
  no_next_action_leads integer,
  next_agenda_at timestamptz,
  last_interaction_at timestamptz,
  last_event_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with access_check as (
    select
      public.request_is_service_role()
      or coalesce(
        (select public.current_role_name()) in ('admin'::public.app_role, 'supervisor'::public.app_role),
        false
      ) as allowed
  ),
  engagement as (
    select
      b.mail_campaign_id,
      b.campaign_id,
      r.lead_id,
      bool_or(r.opened) as opened,
      bool_or(r.clicked) as clicked,
      max(r.created_at) as last_event_at
    from public.mail_result_contacts r
    join public.mail_result_batches b on b.id = r.batch_id
    where r.lead_id is not null
      and (select allowed from access_check)
      and (r.opened or r.clicked)
      and (p_mail_campaign_id is null or b.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or b.campaign_id = p_campaign_id)
    group by b.mail_campaign_id, b.campaign_id, r.lead_id
  ),
  assigned as (
    select
      e.mail_campaign_id,
      e.campaign_id,
      e.lead_id,
      e.opened,
      e.clicked,
      e.last_event_at,
      l.assigned_to as agent_id,
      l.next_action_at,
      p.full_name as agent_name
    from engagement e
    join public.leads l on l.id = e.lead_id
    join public.profiles p on p.id = l.assigned_to
    where l.assigned_to is not null
  ),
  interaction_counts as (
    select
      a.agent_id,
      a.lead_id,
      count(i.id)::integer as interaction_count,
      max(i.created_at) as last_interaction_at
    from assigned a
    left join public.interactions i
      on i.lead_id = a.lead_id
     and i.agent_id = a.agent_id
    group by a.agent_id, a.lead_id
  )
  select
    a.agent_id,
    max(a.agent_name) as agent_name,
    count(*)::integer as assigned_leads,
    count(*) filter (where a.clicked)::integer as clicked_leads,
    count(*) filter (where a.opened and not a.clicked)::integer as opened_only_leads,
    count(*) filter (where coalesce(ic.interaction_count, 0) = 0)::integer as uncontacted_leads,
    count(*) filter (where a.clicked and coalesce(ic.interaction_count, 0) = 0)::integer as clicked_uncontacted_leads,
    count(*) filter (where coalesce(ic.interaction_count, 0) > 0)::integer as contacted_leads,
    coalesce(sum(ic.interaction_count), 0)::integer as interactions,
    count(*) filter (where a.next_action_at is not null)::integer as agendas,
    count(*) filter (where a.next_action_at is not null and a.next_action_at > now())::integer as pending_agendas,
    count(*) filter (where a.next_action_at is not null and a.next_action_at <= now())::integer as overdue_agendas,
    count(*) filter (where a.next_action_at is null)::integer as no_next_action_leads,
    min(a.next_action_at) filter (where a.next_action_at is not null) as next_agenda_at,
    max(ic.last_interaction_at) as last_interaction_at,
    max(a.last_event_at) as last_event_at
  from assigned a
  left join interaction_counts ic
    on ic.agent_id = a.agent_id
   and ic.lead_id = a.lead_id
  group by a.agent_id
  order by
    count(*) filter (where a.next_action_at is not null and a.next_action_at <= now()) desc,
    count(*) filter (where a.clicked) desc,
    count(*) desc,
    max(a.agent_name);
$$;

revoke all on function public.get_mail_agent_control_summary(uuid, uuid) from public, anon;
grant execute on function public.get_mail_agent_control_summary(uuid, uuid) to authenticated, service_role;
