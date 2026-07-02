
create view public.lead_workflow_progress
with (security_invoker = true) as
select
  l.id as lead_id,
  l.workflow_id,
  coalesce(m.total_mandatory, 0) as total_mandatory_steps,
  coalesce(c.completed_mandatory, 0) as completed_mandatory_steps,
  ns.id as next_step_id,
  ns.name as next_step_name,
  ns.step_order as next_step_order,
  ns.is_mandatory as next_step_mandatory,
  ns.allowed_results as next_step_allowed_results,
  (coalesce(m.total_mandatory, 0) > 0
    and coalesce(c.completed_mandatory, 0) >= coalesce(m.total_mandatory, 0)) as is_compliant
from public.leads l
left join (
  select workflow_id, count(*) as total_mandatory
  from public.workflow_steps
  where is_mandatory
  group by workflow_id
) m on m.workflow_id = l.workflow_id
left join (
  select i.lead_id, count(distinct i.workflow_step_id) as completed_mandatory
  from public.interactions i
  join public.workflow_steps ws on ws.id = i.workflow_step_id and ws.is_mandatory
  group by i.lead_id
) c on c.lead_id = l.id
left join lateral (
  select ws.id, ws.name, ws.step_order, ws.is_mandatory, ws.allowed_results
  from public.workflow_steps ws
  where ws.workflow_id = l.workflow_id
    and not exists (
      select 1 from public.interactions i2
      where i2.lead_id = l.id and i2.workflow_step_id = ws.id
    )
  order by ws.step_order
  limit 1
) ns on true;

grant select on public.lead_workflow_progress to authenticated;
;
