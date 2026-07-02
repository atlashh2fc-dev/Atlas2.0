drop policy if exists "calls_select_authenticated" on public.calls;
drop policy if exists "calls_insert_own" on public.calls;
drop policy if exists "calls_update_authenticated" on public.calls;

create policy "calls_select" on public.calls
  for select to authenticated using (
    current_role_name() = 'admin'::app_role
    or (current_role_name() = 'agente'::app_role and lead_id in (select leads.id from leads where leads.assigned_to = auth.uid()))
    or (current_role_name() = 'supervisor'::app_role and lead_id in (select leads.id from leads where leads.team_id = current_team_id()))
  );

create policy "calls_insert" on public.calls
  for insert to authenticated with check (
    current_role_name() = 'admin'::app_role
    or (current_role_name() = 'agente'::app_role and agent_id = auth.uid() and lead_id in (select leads.id from leads where leads.assigned_to = auth.uid()))
  );

create policy "calls_update" on public.calls
  for update to authenticated using (
    current_role_name() = 'admin'::app_role
    or (current_role_name() = 'agente'::app_role and agent_id = auth.uid())
    or (current_role_name() = 'supervisor'::app_role and lead_id in (select leads.id from leads where leads.team_id = current_team_id()))
  );

drop policy if exists "call_events_select_authenticated" on public.call_events;
drop policy if exists "call_events_insert_authenticated" on public.call_events;

create policy "call_events_select" on public.call_events
  for select to authenticated using (
    current_role_name() = 'admin'::app_role
    or (current_role_name() = 'agente'::app_role and lead_id in (select leads.id from leads where leads.assigned_to = auth.uid()))
    or (current_role_name() = 'supervisor'::app_role and lead_id in (select leads.id from leads where leads.team_id = current_team_id()))
  );

create policy "call_events_insert" on public.call_events
  for insert to authenticated with check (
    current_role_name() = 'admin'::app_role
    or agent_id = auth.uid()
  );
;
