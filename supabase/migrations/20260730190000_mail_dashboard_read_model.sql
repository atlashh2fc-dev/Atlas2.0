-- La bandeja operativa no debe reconstruir el historial de eventos mail en
-- cada navegación. `lead_mail_status` es la proyección acumulada y se
-- actualiza dentro de la importación; estas lecturas la usan como fuente.

create index if not exists lead_mail_status_hot_queue_idx
  on public.lead_mail_status (campaign_id, priority_rank, last_seen_at desc, lead_id)
  where opened or clicked;

create index if not exists lead_mail_status_hot_global_queue_idx
  on public.lead_mail_status (priority_rank, last_seen_at desc, lead_id)
  where opened or clicked;

create index if not exists interactions_lead_agent_created_idx
  on public.interactions (lead_id, agent_id, created_at desc);

create or replace function public.get_mail_engagement_page(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null,
  p_limit integer default 101,
  p_after_priority_rank integer default null,
  p_after_last_event_at timestamptz default null,
  p_after_lead_id uuid default null
)
returns table (
  mail_campaign_id uuid,
  mail_campaign_name text,
  campaign_id uuid,
  campaign_name text,
  lead_id uuid,
  full_name text,
  rut text,
  phone text,
  email text,
  assigned_to uuid,
  assigned_to_name text,
  team_id uuid,
  opened boolean,
  clicked boolean,
  last_event_at timestamptz,
  priority_rank integer,
  priority_reason text
)
language sql
security definer
set search_path = public
as $$
  with access_check as (
    select
      public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
  )
  select
    mc.id as mail_campaign_id,
    coalesce(mc.name, c.name) as mail_campaign_name,
    s.campaign_id,
    c.name as campaign_name,
    l.id as lead_id,
    l.full_name,
    l.rut,
    l.phone,
    l.email,
    l.assigned_to,
    p.full_name as assigned_to_name,
    l.team_id,
    s.opened,
    s.clicked,
    s.last_seen_at as last_event_at,
    s.priority_rank,
    coalesce(s.priority_reason, case when s.clicked then 'Click detectado en campana mail' else 'Apertura detectada en campana mail' end) as priority_reason
  from public.lead_mail_status s
  join public.leads l on l.id = s.lead_id
  join public.campaigns c on c.id = s.campaign_id
  join public.mail_campaigns mc on mc.campaign_id = s.campaign_id
  left join public.profiles p on p.id = l.assigned_to
  cross join access_check ac
  where (s.opened or s.clicked)
    and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
    and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
    and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
    and (p_campaign_id is null or s.campaign_id = p_campaign_id)
    and (
      p_after_priority_rank is null
      or s.priority_rank > p_after_priority_rank
      or (
        s.priority_rank = p_after_priority_rank
        and (
          s.last_seen_at < p_after_last_event_at
          or (s.last_seen_at = p_after_last_event_at and s.lead_id > p_after_lead_id)
        )
      )
    )
  order by s.priority_rank asc, s.last_seen_at desc, s.lead_id asc
  limit least(greatest(coalesce(p_limit, 101), 1), 101);
$$;

create or replace function public.get_mail_engagement_report_read_model(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null
)
returns table (
  mail_campaign_id uuid,
  mail_campaign_name text,
  campaign_id uuid,
  campaign_name text,
  sent_leads integer,
  delivered_leads integer,
  opened_leads integer,
  clicked_leads integer,
  hot_leads integer,
  assigned_hot_leads integer,
  managed_hot_leads integer,
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
  )
  select
    mc.id as mail_campaign_id,
    coalesce(mc.name, c.name) as mail_campaign_name,
    s.campaign_id,
    c.name as campaign_name,
    count(*) filter (where s.sent)::integer as sent_leads,
    count(*) filter (where s.delivered)::integer as delivered_leads,
    count(*) filter (where s.opened)::integer as opened_leads,
    count(*) filter (where s.clicked)::integer as clicked_leads,
    count(*) filter (where s.opened or s.clicked)::integer as hot_leads,
    count(*) filter (where (s.opened or s.clicked) and l.assigned_to is not null)::integer as assigned_hot_leads,
    count(*) filter (
      where (s.opened or s.clicked)
        and (l.assignment_status = 'managed' or l.workflow_status = 'managed')
    )::integer as managed_hot_leads,
    max(s.last_seen_at) as last_event_at
  from public.lead_mail_status s
  join public.leads l on l.id = s.lead_id
  join public.campaigns c on c.id = s.campaign_id
  join public.mail_campaigns mc on mc.campaign_id = s.campaign_id
  cross join access_check ac
  where (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
    and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
    and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
    and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  group by mc.id, mc.name, s.campaign_id, c.name
  order by max(s.last_seen_at) desc nulls last, coalesce(mc.name, c.name);
$$;

create or replace function public.get_mail_agent_control_summary_read_model(
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
  candidate_leads as (
    select
      s.lead_id,
      s.opened,
      s.clicked,
      s.last_seen_at as last_event_at,
      l.assigned_to,
      l.next_action_at
    from public.lead_mail_status s
    join public.leads l on l.id = s.lead_id
    join public.mail_campaigns mc on mc.campaign_id = s.campaign_id
    cross join access_check ac
    where (s.opened or s.clicked)
      and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
      and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
      and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
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

revoke all on function public.get_mail_engagement_page(uuid, uuid, integer, integer, timestamptz, uuid) from public, anon;
grant execute on function public.get_mail_engagement_page(uuid, uuid, integer, integer, timestamptz, uuid) to authenticated, service_role;

revoke all on function public.get_mail_engagement_report_read_model(uuid, uuid) from public, anon;
grant execute on function public.get_mail_engagement_report_read_model(uuid, uuid) to authenticated, service_role;

revoke all on function public.get_mail_agent_control_summary_read_model(uuid, uuid) from public, anon;
grant execute on function public.get_mail_agent_control_summary_read_model(uuid, uuid) to authenticated, service_role;
