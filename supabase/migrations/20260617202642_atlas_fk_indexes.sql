
create index if not exists interactions_workflow_step_id_idx on public.interactions(workflow_step_id);
create index if not exists leads_created_by_idx on public.leads(created_by);
create index if not exists leads_workflow_id_idx on public.leads(workflow_id);
create index if not exists profiles_team_id_idx on public.profiles(team_id);
create index if not exists teams_supervisor_id_idx on public.teams(supervisor_id);
create index if not exists workflows_created_by_idx on public.workflows(created_by);
;
