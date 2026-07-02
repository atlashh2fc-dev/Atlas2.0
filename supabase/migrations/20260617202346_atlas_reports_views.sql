
create view public.agent_performance
with (security_invoker = true) as
select
  p.id as agent_id,
  p.full_name,
  p.team_id,
  coalesce(ic.total_interactions, 0) as total_interactions,
  coalesce(ic.leads_managed, 0) as leads_managed,
  coalesce(conv.conversions, 0) as conversions,
  resp.avg_first_response_seconds
from public.profiles p
left join (
  select agent_id, count(*) as total_interactions, count(distinct lead_id) as leads_managed
  from public.interactions
  group by agent_id
) ic on ic.agent_id = p.id
left join (
  select l.assigned_to as agent_id, count(*) as conversions
  from public.leads l
  where l.status = 'convertido'
  group by l.assigned_to
) conv on conv.agent_id = p.id
left join (
  select i.agent_id, avg(extract(epoch from (i.created_at - l.created_at))) as avg_first_response_seconds
  from public.interactions i
  join public.leads l on l.id = i.lead_id
  where i.created_at = (
    select min(i2.created_at) from public.interactions i2 where i2.lead_id = i.lead_id
  )
  group by i.agent_id
) resp on resp.agent_id = p.id
where p.role = 'agente';

grant select on public.agent_performance to authenticated;

create view public.workflow_compliance
with (security_invoker = true) as
select
  w.id as workflow_id,
  w.name as workflow_name,
  count(l.id) as total_leads,
  count(l.id) filter (where lwp.is_compliant) as compliant_leads,
  case
    when count(l.id) > 0
    then round(100.0 * count(l.id) filter (where lwp.is_compliant) / count(l.id), 1)
    else null
  end as compliance_rate
from public.workflows w
left join public.leads l on l.workflow_id = w.id
left join public.lead_workflow_progress lwp on lwp.lead_id = l.id
group by w.id, w.name;

grant select on public.workflow_compliance to authenticated;
;
