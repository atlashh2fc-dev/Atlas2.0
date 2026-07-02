
drop view public.agent_performance;

create view public.agent_performance
with (security_invoker = true) as
select
  p.id as agent_id,
  p.full_name,
  p.team_id,
  t.name as team_name,
  coalesce(ic.total_interactions, 0) as total_interactions,
  coalesce(ic.leads_managed, 0) as leads_managed,
  coalesce(conv.conversions, 0) as conversions,
  resp.avg_first_response_seconds
from public.profiles p
left join public.teams t on t.id = p.team_id
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
;
