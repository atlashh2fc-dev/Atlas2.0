
-- Same per-row function re-evaluation bug as leads/calls/profiles, found in the
-- workflow_compliance/agent_performance views (interactions joined against all leads).
drop policy if exists interactions_select on public.interactions;
create policy interactions_select on public.interactions
  for select
  using (
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'agente' and lead_id in (select leads.id from leads where leads.assigned_to = (select auth.uid())))
    or ((select current_role_name()) = 'supervisor' and lead_id in (select leads.id from leads where leads.team_id = (select current_team_id())))
  );

drop policy if exists interactions_insert on public.interactions;
create policy interactions_insert on public.interactions
  for insert
  with check (
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'agente' and agent_id = (select auth.uid()) and lead_id in (select leads.id from leads where leads.assigned_to = (select auth.uid())))
  );

drop policy if exists interactions_delete_admin on public.interactions;
create policy interactions_delete_admin on public.interactions
  for delete
  using ((select current_role_name()) = 'admin');

-- Missing indexes on FKs flagged by the performance advisor — cheap insurance as
-- tables grow (avoids seq scans on cascade checks / joins through these columns).
create index if not exists call_events_agent_id_idx on public.call_events (agent_id);
create index if not exists calls_callback_owner_user_id_idx on public.calls (callback_owner_user_id);
create index if not exists campaigns_created_by_idx on public.campaigns (created_by);
create index if not exists campaigns_workflow_id_idx on public.campaigns (workflow_id);
create index if not exists leads_managed_by_idx on public.leads (managed_by);
create index if not exists workflow_step_branches_to_step_id_idx on public.workflow_step_branches (to_step_id);
create index if not exists workflow_step_branches_workflow_id_idx on public.workflow_step_branches (workflow_id);
;
