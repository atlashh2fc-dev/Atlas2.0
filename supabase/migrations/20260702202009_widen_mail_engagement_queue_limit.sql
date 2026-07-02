create or replace function public.get_mail_engagement_queue(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null,
  p_limit integer default 5000
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
security invoker
set search_path = public
as $$
  with engagement as (
    select
      b.mail_campaign_id,
      b.campaign_id,
      r.lead_id,
      bool_or(r.opened) as opened,
      bool_or(r.clicked) as clicked,
      max(r.created_at) as last_event_at,
      min(case when r.clicked then 10 when r.opened then 20 else 70 end) as priority_rank
    from public.mail_result_contacts r
    join public.mail_result_batches b on b.id = r.batch_id
    where r.lead_id is not null
      and (r.opened or r.clicked)
      and (p_mail_campaign_id is null or b.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or b.campaign_id = p_campaign_id)
    group by b.mail_campaign_id, b.campaign_id, r.lead_id
  )
  select
    e.mail_campaign_id,
    coalesce(mc.name, c.name) as mail_campaign_name,
    e.campaign_id,
    c.name as campaign_name,
    l.id as lead_id,
    l.full_name,
    l.rut,
    l.phone,
    l.email,
    l.assigned_to,
    p.full_name as assigned_to_name,
    l.team_id,
    e.opened,
    e.clicked,
    e.last_event_at,
    e.priority_rank,
    case
      when e.clicked then 'Click detectado en campana mail'
      when e.opened then 'Apertura detectada en campana mail'
      else 'Senal mail'
    end as priority_reason
  from engagement e
  join public.leads l on l.id = e.lead_id
  join public.campaigns c on c.id = e.campaign_id
  left join public.mail_campaigns mc on mc.id = e.mail_campaign_id
  left join public.profiles p on p.id = l.assigned_to
  order by e.priority_rank asc, e.last_event_at desc, l.full_name
  limit least(greatest(coalesce(p_limit, 5000), 1), 5000);
$$;

revoke all on function public.get_mail_engagement_queue(uuid, uuid, integer) from public, anon;
grant execute on function public.get_mail_engagement_queue(uuid, uuid, integer) to authenticated, service_role;
