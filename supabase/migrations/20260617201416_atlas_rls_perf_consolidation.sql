
-- ============================================================
-- Consolidar políticas RLS: una sola política por acción/tabla,
-- usando (select auth.uid()) para evitar re-evaluación por fila.
-- ============================================================

-- ---- profiles ----
drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_select_team_supervisor" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_admin_all" on public.profiles;

create policy "profiles_select" on public.profiles
  for select using (
    id = (select auth.uid())
    or public.current_role_name() = 'admin'
    or (public.current_role_name() = 'supervisor' and team_id = public.current_team_id())
  );

create policy "profiles_update" on public.profiles
  for update using (
    id = (select auth.uid())
    or public.current_role_name() = 'admin'
  );

create policy "profiles_insert_admin" on public.profiles
  for insert with check (public.current_role_name() = 'admin');

create policy "profiles_delete_admin" on public.profiles
  for delete using (public.current_role_name() = 'admin');

-- ---- teams ----
drop policy if exists "teams_select_all_authenticated" on public.teams;
drop policy if exists "teams_admin_write" on public.teams;

create policy "teams_select" on public.teams
  for select using ((select auth.uid()) is not null);

create policy "teams_insert_admin" on public.teams
  for insert with check (public.current_role_name() = 'admin');

create policy "teams_update_admin" on public.teams
  for update using (public.current_role_name() = 'admin');

create policy "teams_delete_admin" on public.teams
  for delete using (public.current_role_name() = 'admin');

-- ---- leads ----
drop policy if exists "leads_select_agente" on public.leads;
drop policy if exists "leads_select_supervisor" on public.leads;
drop policy if exists "leads_admin_all" on public.leads;
drop policy if exists "leads_update_agente" on public.leads;
drop policy if exists "leads_update_supervisor" on public.leads;

create policy "leads_select" on public.leads
  for select using (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'agente' and assigned_to = (select auth.uid()))
    or (public.current_role_name() = 'supervisor' and team_id = public.current_team_id())
  );

create policy "leads_update" on public.leads
  for update using (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'agente' and assigned_to = (select auth.uid()))
    or (public.current_role_name() = 'supervisor' and team_id = public.current_team_id())
  );

create policy "leads_insert_admin" on public.leads
  for insert with check (public.current_role_name() = 'admin');

create policy "leads_delete_admin" on public.leads
  for delete using (public.current_role_name() = 'admin');

-- ---- interactions ----
drop policy if exists "interactions_select_agente" on public.interactions;
drop policy if exists "interactions_select_supervisor" on public.interactions;
drop policy if exists "interactions_admin_all" on public.interactions;
drop policy if exists "interactions_insert_agente" on public.interactions;

create policy "interactions_select" on public.interactions
  for select using (
    public.current_role_name() = 'admin'
    or (
      public.current_role_name() = 'agente'
      and lead_id in (select id from public.leads where assigned_to = (select auth.uid()))
    )
    or (
      public.current_role_name() = 'supervisor'
      and lead_id in (select id from public.leads where team_id = public.current_team_id())
    )
  );

create policy "interactions_insert" on public.interactions
  for insert with check (
    public.current_role_name() = 'admin'
    or (
      public.current_role_name() = 'agente'
      and agent_id = (select auth.uid())
      and lead_id in (select id from public.leads where assigned_to = (select auth.uid()))
    )
  );

create policy "interactions_delete_admin" on public.interactions
  for delete using (public.current_role_name() = 'admin');
;
