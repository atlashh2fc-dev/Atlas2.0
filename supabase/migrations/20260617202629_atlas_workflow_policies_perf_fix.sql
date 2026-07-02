
drop policy workflows_admin_write on public.workflows;
drop policy workflow_steps_admin_write on public.workflow_steps;

create policy workflows_admin_insert on public.workflows
  for insert to authenticated
  with check (public.current_role_name() = 'admin');

create policy workflows_admin_update on public.workflows
  for update to authenticated
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

create policy workflows_admin_delete on public.workflows
  for delete to authenticated
  using (public.current_role_name() = 'admin');

create policy workflow_steps_admin_insert on public.workflow_steps
  for insert to authenticated
  with check (public.current_role_name() = 'admin');

create policy workflow_steps_admin_update on public.workflow_steps
  for update to authenticated
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

create policy workflow_steps_admin_delete on public.workflow_steps
  for delete to authenticated
  using (public.current_role_name() = 'admin');
;
