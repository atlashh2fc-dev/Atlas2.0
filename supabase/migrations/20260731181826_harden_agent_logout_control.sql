-- Ajustes derivados de los advisors posteriores al DDL: una sola policy de
-- lectura para el comando, denegación explícita de la deny-list y ninguna
-- exposición RPC de la función que sólo debe ejecutarse como trigger.

drop policy if exists agent_control_commands_target_select
  on public.agent_control_commands;
drop policy if exists agent_control_commands_admin_select
  on public.agent_control_commands;

create policy agent_control_commands_select
  on public.agent_control_commands for select to authenticated
  using (
    target_profile_id = (select auth.uid())
    or public.current_role_name() = 'admin'::public.app_role
  );

create policy revoked_app_sessions_deny_direct_access
  on public.revoked_app_sessions for all to authenticated
  using (false)
  with check (false);

revoke all on function public.reject_dial_attempt_for_disconnected_agent()
  from public, anon, authenticated;
