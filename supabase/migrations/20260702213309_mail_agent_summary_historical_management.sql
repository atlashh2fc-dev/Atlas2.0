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
security definer
set search_path = public
as $$
  with access_check as (
    select
      public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
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
    left join public.mail_campaigns mc on mc.id = b.mail_campaign_id
    cross join access_check ac
    where r.lead_id is not null
      and (r.opened or r.clicked)
      and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
      and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
      and (p_mail_campaign_id is null or b.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or b.campaign_id = p_campaign_id)
    group by b.mail_campaign_id, b.campaign_id, r.lead_id
  ),
  candidate_leads as (
    select
      e.mail_campaign_id,
      e.campaign_id,
      e.lead_id,
      e.opened,
      e.clicked,
      e.last_event_at,
      l.assigned_to,
      l.next_action_at
    from engagement e
    join public.leads l on l.id = e.lead_id
  ),
  interaction_owners as (
    select
      cl.lead_id,
      coalesce(ha.linked_profile_id, i.historical_agent_id, i.agent_id) as owner_id,
      coalesce(linked.full_name, ha.full_name, p.full_name, 'Ejecutivo sin nombre') as owner_name,
      count(i.id)::integer as interaction_count,
      max(i.created_at) as last_interaction_at
    from candidate_leads cl
    join public.interactions i on i.lead_id = cl.lead_id
    left join public.historical_agents ha on ha.id = i.historical_agent_id
    left join public.profiles linked on linked.id = ha.linked_profile_id
    left join public.profiles p on p.id = i.agent_id
    where coalesce(ha.linked_profile_id, i.historical_agent_id, i.agent_id) is not null
    group by cl.lead_id, coalesce(ha.linked_profile_id, i.historical_agent_id, i.agent_id), coalesce(linked.full_name, ha.full_name, p.full_name, 'Ejecutivo sin nombre')
  ),
  assignment_owners as (
    select
      cl.lead_id,
      cl.assigned_to as owner_id,
      p.full_name as owner_name,
      0::integer as interaction_count,
      null::timestamptz as last_interaction_at
    from candidate_leads cl
    join public.profiles p on p.id = cl.assigned_to
    where cl.assigned_to is not null
      and not exists (
        select 1
        from interaction_owners io
        where io.lead_id = cl.lead_id
          and io.owner_id = cl.assigned_to
      )
  ),
  owner_rows as (
    select * from interaction_owners
    union all
    select * from assignment_owners
  )
  select
    o.owner_id as agent_id,
    max(o.owner_name) as agent_name,
    count(distinct cl.lead_id)::integer as assigned_leads,
    count(distinct cl.lead_id) filter (where cl.clicked)::integer as clicked_leads,
    count(distinct cl.lead_id) filter (where cl.opened and not cl.clicked)::integer as opened_only_leads,
    count(distinct cl.lead_id) filter (where coalesce(o.interaction_count, 0) = 0)::integer as uncontacted_leads,
    count(distinct cl.lead_id) filter (where cl.clicked and coalesce(o.interaction_count, 0) = 0)::integer as clicked_uncontacted_leads,
    count(distinct cl.lead_id) filter (where coalesce(o.interaction_count, 0) > 0)::integer as contacted_leads,
    coalesce(sum(o.interaction_count), 0)::integer as interactions,
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null)::integer as agendas,
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null and cl.next_action_at > now())::integer as pending_agendas,
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null and cl.next_action_at <= now())::integer as overdue_agendas,
    count(distinct cl.lead_id) filter (where cl.next_action_at is null)::integer as no_next_action_leads,
    min(cl.next_action_at) filter (where cl.next_action_at is not null) as next_agenda_at,
    max(o.last_interaction_at) as last_interaction_at,
    max(cl.last_event_at) as last_event_at
  from owner_rows o
  join candidate_leads cl on cl.lead_id = o.lead_id
  group by o.owner_id
  order by
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null and cl.next_action_at <= now()) desc,
    count(distinct cl.lead_id) filter (where cl.clicked) desc,
    count(distinct cl.lead_id) desc,
    max(o.owner_name);
$$;

revoke all on function public.get_mail_agent_control_summary(uuid, uuid) from public, anon;
grant execute on function public.get_mail_agent_control_summary(uuid, uuid) to authenticated, service_role;
