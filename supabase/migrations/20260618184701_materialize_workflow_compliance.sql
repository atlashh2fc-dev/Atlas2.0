
-- workflow_compliance was the slowest report query (~300ms+ and growing with lead volume):
-- it does nested-loop joins of every lead against interactions/workflow_steps/branches.
-- Pre-aggregate it per (workflow, team) in a materialized view refreshed on a schedule,
-- then expose it through a SECURITY DEFINER function that reproduces the exact same
-- row-level scoping the old RLS-based view gave each role (admin sees all teams summed
-- together, supervisor sees only their own team) so behavior for users doesn't change.

create materialized view public.workflow_compliance_mv as
select
  w.id as workflow_id,
  w.name as workflow_name,
  l.team_id,
  count(l.id) as total_leads,
  count(l.id) filter (where lwp.is_compliant) as compliant_leads
from public.workflows w
left join public.leads l on l.workflow_id = w.id
left join public.lead_workflow_progress lwp on lwp.lead_id = l.id
group by w.id, w.name, l.team_id;

-- needed for REFRESH ... CONCURRENTLY (avoids locking readers during refresh)
create unique index workflow_compliance_mv_pkey
  on public.workflow_compliance_mv (workflow_id, team_id);

revoke all on public.workflow_compliance_mv from anon, authenticated;

create or replace function public.get_workflow_compliance()
returns table (
  workflow_id uuid,
  workflow_name text,
  total_leads bigint,
  compliant_leads bigint,
  compliance_rate numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.workflow_id,
    m.workflow_name,
    sum(m.total_leads) as total_leads,
    sum(m.compliant_leads) as compliant_leads,
    case when sum(m.total_leads) > 0
      then round(100.0 * sum(m.compliant_leads) / sum(m.total_leads), 1)
      else null
    end as compliance_rate
  from public.workflow_compliance_mv m
  where
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'supervisor' and m.team_id = (select current_team_id()))
  group by m.workflow_id, m.workflow_name
  order by m.workflow_name;
$$;

revoke all on function public.get_workflow_compliance() from public;
grant execute on function public.get_workflow_compliance() to authenticated;

-- Refresh on a schedule instead of on every write (bulk uploads insert tens of
-- thousands of rows at once; refreshing per-row would be far worse than the
-- original problem). Near-real-time (90s lag) is fine for a reporting dashboard.
create extension if not exists pg_cron;

select cron.schedule(
  'refresh-workflow-compliance-mv',
  '*/2 * * * *',
  $$refresh materialized view concurrently public.workflow_compliance_mv$$
);

-- prime it immediately so it's not empty until the first cron tick
refresh materialized view public.workflow_compliance_mv;
;
