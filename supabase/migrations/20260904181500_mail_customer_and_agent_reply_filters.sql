begin;

create or replace function public.get_mail_operational_bucket_summary(
  p_mail_campaign_id uuid default null, p_campaign_id uuid default null
)
returns table (bucket text, label text, sort_order integer, lead_count integer,
  oldest_event_at timestamptz, nearest_action_at timestamptz)
language sql security definer set search_path = '' as $$
  with clock as (select now() as observed_at), candidate_leads as (
    select s.opened, s.clicked,
      greatest(s.last_seen_at, mail.last_inbound_at, mail.last_agent_reply_at) as last_event_at,
      l.assigned_to, l.next_action_at, l.assignment_status, l.workflow_status,
      latest.last_interaction_at, mail.last_inbound_at, mail.last_agent_reply_at,
      clock.observed_at
    from public.mail_campaign_lead_status s
    join public.leads l on l.id = s.lead_id
    join public.mail_campaigns mc on mc.id = s.mail_campaign_id
    cross join clock
    left join lateral (
      select
        max(message.occurred_at) filter (where message.direction = 'inbound') as last_inbound_at,
        greatest(
          max(message.occurred_at) filter (
            where message.direction = 'outbound'
              and nullif(message.metadata->>'crm_reply_command_id', '') is not null
          ),
          (select max(command.delivered_at)
           from public.mail_reply_commands command
           where command.lead_id = s.lead_id
             and command.campaign_id = s.campaign_id
             and command.status = 'delivered')
        ) as last_agent_reply_at
      from public.lead_mail_messages message
      where message.lead_id = s.lead_id and message.campaign_id = s.campaign_id
    ) mail on true
    left join lateral (
      select i.created_at as last_interaction_at from public.interactions i
      where i.lead_id = s.lead_id order by i.created_at desc limit 1
    ) latest on true
    where (s.opened or s.clicked or mail.last_inbound_at is not null or mail.last_agent_reply_at is not null)
      and public.can_supervise_mail_lead(s.campaign_id, l.team_id)
      and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ), work_items as (
    select cl.*, case
      when cl.last_inbound_at is not null
        and (cl.last_agent_reply_at is null or cl.last_inbound_at > cl.last_agent_reply_at)
        then 'customer_replied'
      when cl.next_action_at is not null and cl.next_action_at <= cl.observed_at then 'overdue'
      when cl.assigned_to is null then 'unassigned'
      when cl.clicked and cl.last_interaction_at is null then 'clicked_uncontacted'
      when cl.opened and not cl.clicked and cl.last_interaction_at is null then 'opened_uncontacted'
      when cl.next_action_at is not null and cl.next_action_at > cl.observed_at then 'next_action'
      when cl.last_agent_reply_at is not null then 'agent_replied'
      when cl.workflow_status = 'managed' or cl.assignment_status = 'managed' then 'managed'
      else 'monitor'
    end as work_bucket
    from candidate_leads cl
  )
  select 'customer_replied'::text, 'Respuesta cliente pendiente'::text, 10,
    count(*) filter (where work_bucket = 'customer_replied')::integer,
    min(last_event_at) filter (where work_bucket = 'customer_replied'), null::timestamptz from work_items
  union all select 'overdue', 'Agenda vencida', 20,
    count(*) filter (where work_bucket = 'overdue')::integer,
    min(last_event_at) filter (where work_bucket = 'overdue'),
    min(next_action_at) filter (where work_bucket = 'overdue') from work_items
  union all select 'unassigned', 'Sin asignar', 30,
    count(*) filter (where work_bucket = 'unassigned')::integer,
    min(last_event_at) filter (where work_bucket = 'unassigned'), null::timestamptz from work_items
  union all select 'clicked_uncontacted', 'Click sin gestión', 40,
    count(*) filter (where work_bucket = 'clicked_uncontacted')::integer,
    min(last_event_at) filter (where work_bucket = 'clicked_uncontacted'), null::timestamptz from work_items
  union all select 'opened_uncontacted', 'Apertura sin gestión', 50,
    count(*) filter (where work_bucket = 'opened_uncontacted')::integer,
    min(last_event_at) filter (where work_bucket = 'opened_uncontacted'), null::timestamptz from work_items
  union all select 'next_action', 'Próxima acción', 60,
    count(*) filter (where work_bucket = 'next_action')::integer,
    min(last_event_at) filter (where work_bucket = 'next_action'),
    min(next_action_at) filter (where work_bucket = 'next_action') from work_items
  union all select 'agent_replied', 'Respondido por agente', 70,
    count(*) filter (where work_bucket = 'agent_replied')::integer,
    min(last_event_at) filter (where work_bucket = 'agent_replied'), null::timestamptz from work_items
  union all select 'managed', 'Gestionados', 80,
    count(*) filter (where work_bucket = 'managed')::integer,
    min(last_event_at) filter (where work_bucket = 'managed'), null::timestamptz from work_items
  union all select 'monitor', 'En seguimiento', 90,
    count(*) filter (where work_bucket = 'monitor')::integer,
    min(last_event_at) filter (where work_bucket = 'monitor'), null::timestamptz from work_items
  order by 3;
$$;

create or replace function public.get_mail_operational_queue_page(
  p_mail_campaign_id uuid default null, p_campaign_id uuid default null,
  p_bucket text default null, p_limit integer default 101,
  p_after_work_rank integer default null, p_after_priority_rank integer default null,
  p_after_last_event_at timestamptz default null, p_after_lead_id uuid default null
)
returns table (mail_campaign_id uuid, mail_campaign_name text, campaign_id uuid,
  campaign_name text, lead_id uuid, full_name text, rut text, phone text, email text,
  assigned_to uuid, assigned_to_name text, team_id uuid, next_action_at timestamptz,
  assignment_status text, workflow_status text, opened boolean, clicked boolean,
  last_event_at timestamptz, last_interaction_at timestamptz, priority_rank integer,
  priority_reason text, work_bucket text, work_rank integer, is_unassigned boolean,
  is_clicked_uncontacted boolean, is_opened_uncontacted boolean, is_overdue boolean,
  has_next_action boolean)
language sql security definer set search_path = '' as $$
  with clock as (select now() as observed_at), candidates as (
    select mc.id as mail_campaign_id, coalesce(mc.name, c.name) as mail_campaign_name,
      s.campaign_id, c.name as campaign_name, l.id as lead_id, l.full_name, l.rut,
      l.phone, l.email, l.assigned_to, p.full_name as assigned_to_name, l.team_id,
      l.next_action_at, l.assignment_status, l.workflow_status, s.opened, s.clicked,
      greatest(s.last_seen_at, mail.last_inbound_at, mail.last_agent_reply_at) as last_event_at,
      latest.last_interaction_at, s.priority_rank,
      case
        when mail.last_inbound_at is not null
          and (mail.last_agent_reply_at is null or mail.last_inbound_at > mail.last_agent_reply_at)
          then 'El cliente respondió el correo y espera gestión'
        when mail.last_agent_reply_at is not null then 'Respondido desde Atlas CRM'
        else coalesce(s.priority_reason, case when s.clicked
          then 'Click detectado en campaña mail' else 'Apertura detectada en campaña mail' end)
      end as priority_reason,
      l.assigned_to is null as is_unassigned,
      (s.clicked and latest.last_interaction_at is null) as is_clicked_uncontacted,
      (s.opened and not s.clicked and latest.last_interaction_at is null) as is_opened_uncontacted,
      (l.next_action_at is not null and l.next_action_at <= clock.observed_at) as is_overdue,
      (l.next_action_at is not null and l.next_action_at > clock.observed_at) as has_next_action,
      mail.last_inbound_at, mail.last_agent_reply_at
    from public.mail_campaign_lead_status s
    join public.mail_campaigns mc on mc.id = s.mail_campaign_id
    join public.leads l on l.id = s.lead_id
    join public.campaigns c on c.id = s.campaign_id
    left join public.profiles p on p.id = l.assigned_to
    cross join clock
    left join lateral (
      select
        max(message.occurred_at) filter (where message.direction = 'inbound') as last_inbound_at,
        greatest(
          max(message.occurred_at) filter (
            where message.direction = 'outbound'
              and nullif(message.metadata->>'crm_reply_command_id', '') is not null
          ),
          (select max(command.delivered_at)
           from public.mail_reply_commands command
           where command.lead_id = s.lead_id
             and command.campaign_id = s.campaign_id
             and command.status = 'delivered')
        ) as last_agent_reply_at
      from public.lead_mail_messages message
      where message.lead_id = s.lead_id and message.campaign_id = s.campaign_id
    ) mail on true
    left join lateral (
      select i.created_at as last_interaction_at from public.interactions i
      where i.lead_id = s.lead_id order by i.created_at desc limit 1
    ) latest on true
    where (s.opened or s.clicked or mail.last_inbound_at is not null or mail.last_agent_reply_at is not null)
      and public.can_supervise_mail_lead(s.campaign_id, l.team_id)
      and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ), work_items as (
    select c.*, case
      when c.last_inbound_at is not null
        and (c.last_agent_reply_at is null or c.last_inbound_at > c.last_agent_reply_at)
        then 'customer_replied'
      when c.is_overdue then 'overdue'
      when c.is_unassigned then 'unassigned'
      when c.is_clicked_uncontacted then 'clicked_uncontacted'
      when c.is_opened_uncontacted then 'opened_uncontacted'
      when c.has_next_action then 'next_action'
      when c.last_agent_reply_at is not null then 'agent_replied'
      when c.workflow_status = 'managed' or c.assignment_status = 'managed' then 'managed'
      else 'monitor' end as work_bucket,
      case
      when c.last_inbound_at is not null
        and (c.last_agent_reply_at is null or c.last_inbound_at > c.last_agent_reply_at) then 10
      when c.is_overdue then 20 when c.is_unassigned then 30
      when c.is_clicked_uncontacted then 40 when c.is_opened_uncontacted then 50
      when c.has_next_action then 60 when c.last_agent_reply_at is not null then 70
      when c.workflow_status = 'managed' or c.assignment_status = 'managed' then 80 else 90 end as work_rank
    from candidates c
  )
  select wi.mail_campaign_id, wi.mail_campaign_name, wi.campaign_id, wi.campaign_name,
    wi.lead_id, wi.full_name, wi.rut, wi.phone, wi.email, wi.assigned_to,
    wi.assigned_to_name, wi.team_id, wi.next_action_at, wi.assignment_status,
    wi.workflow_status, wi.opened, wi.clicked, wi.last_event_at, wi.last_interaction_at,
    wi.priority_rank, wi.priority_reason, wi.work_bucket, wi.work_rank,
    wi.is_unassigned, wi.is_clicked_uncontacted, wi.is_opened_uncontacted,
    wi.is_overdue, wi.has_next_action
  from work_items wi
  where (p_bucket is null or p_bucket = 'all' or p_bucket = wi.work_bucket)
    and (p_after_work_rank is null or wi.work_rank > p_after_work_rank
      or (wi.work_rank = p_after_work_rank and (wi.priority_rank > p_after_priority_rank
        or (wi.priority_rank = p_after_priority_rank and (wi.last_event_at < p_after_last_event_at
          or (wi.last_event_at = p_after_last_event_at and wi.lead_id > p_after_lead_id))))))
  order by wi.work_rank asc, wi.priority_rank asc, wi.last_event_at desc, wi.lead_id asc
  limit least(greatest(coalesce(p_limit, 101), 1), 101);
$$;

revoke all on function public.get_mail_operational_bucket_summary(uuid, uuid) from public, anon;
grant execute on function public.get_mail_operational_bucket_summary(uuid, uuid) to authenticated, service_role;
revoke all on function public.get_mail_operational_queue_page(uuid, uuid, text, integer, integer, integer, timestamptz, uuid) from public, anon;
grant execute on function public.get_mail_operational_queue_page(uuid, uuid, text, integer, integer, integer, timestamptz, uuid) to authenticated, service_role;

commit;
