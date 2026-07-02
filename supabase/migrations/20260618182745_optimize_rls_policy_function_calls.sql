
-- Fix: current_role_name()/current_team_id()/auth.uid() were being re-evaluated once PER ROW
-- inside RLS policies on leads/calls/profiles (each call does a SELECT against profiles).
-- On the leads table (55k+ rows after bulk uploads) this caused statement timeouts.
-- Wrapping each call in "(select ...)" lets Postgres cache the result as a single InitPlan
-- evaluated once per query instead of once per row.

-- leads
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select
  using (
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'agente' and assigned_to = (select auth.uid()))
    or ((select current_role_name()) = 'supervisor' and team_id = (select current_team_id()))
  );

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update
  using (
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'agente' and assigned_to = (select auth.uid()))
    or ((select current_role_name()) = 'supervisor' and team_id = (select current_team_id()))
  );

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert
  with check (
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'supervisor' and (team_id is null or team_id = (select current_team_id())))
  );

drop policy if exists leads_delete_admin on public.leads;
create policy leads_delete_admin on public.leads
  for delete
  using ((select current_role_name()) = 'admin');

-- calls
drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
  for select
  using (
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'agente' and lead_id in (select leads.id from leads where leads.assigned_to = (select auth.uid())))
    or ((select current_role_name()) = 'supervisor' and lead_id in (select leads.id from leads where leads.team_id = (select current_team_id())))
  );

drop policy if exists calls_insert on public.calls;
create policy calls_insert on public.calls
  for insert
  with check (
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'agente' and agent_id = (select auth.uid()) and lead_id in (select leads.id from leads where leads.assigned_to = (select auth.uid())))
  );

drop policy if exists calls_update on public.calls;
create policy calls_update on public.calls
  for update
  using (
    (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'agente' and agent_id = (select auth.uid()))
    or ((select current_role_name()) = 'supervisor' and lead_id in (select leads.id from leads where leads.team_id = (select current_team_id())))
  );

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  using (
    id = (select auth.uid())
    or (select current_role_name()) = 'admin'
    or ((select current_role_name()) = 'supervisor' and team_id = (select current_team_id()))
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (
    id = (select auth.uid())
    or (select current_role_name()) = 'admin'
  );

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert
  with check ((select current_role_name()) = 'admin');

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete
  using ((select current_role_name()) = 'admin');

-- teams (cheap already, but make consistent)
drop policy if exists teams_insert_admin on public.teams;
create policy teams_insert_admin on public.teams
  for insert
  with check ((select current_role_name()) = 'admin');

drop policy if exists teams_update_admin on public.teams;
create policy teams_update_admin on public.teams
  for update
  using ((select current_role_name()) = 'admin');

drop policy if exists teams_delete_admin on public.teams;
create policy teams_delete_admin on public.teams
  for delete
  using ((select current_role_name()) = 'admin');

-- campaigns (admin-only write policies use the same function)
drop policy if exists campaigns_admin_insert on public.campaigns;
create policy campaigns_admin_insert on public.campaigns
  for insert
  with check ((select current_role_name()) = 'admin');

drop policy if exists campaigns_admin_update on public.campaigns;
create policy campaigns_admin_update on public.campaigns
  for update
  using ((select current_role_name()) = 'admin');

drop policy if exists campaigns_admin_delete on public.campaigns;
create policy campaigns_admin_delete on public.campaigns
  for delete
  using ((select current_role_name()) = 'admin');
;
