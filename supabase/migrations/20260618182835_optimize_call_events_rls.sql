
drop policy if exists call_events_select on public.call_events;
create policy call_events_select on public.call_events
  for select
  using (
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'agente' and lead_id in (select leads.id from leads where leads.assigned_to = (select auth.uid())))
    or ((select current_role_name()) = 'supervisor' and lead_id in (select leads.id from leads where leads.team_id = (select current_team_id())))
  );

drop policy if exists call_events_insert on public.call_events;
create policy call_events_insert on public.call_events
  for insert
  with check (
    (select current_role_name()) = 'admin'
    or agent_id = (select auth.uid())
  );
;
