create index agent_control_commands_requested_by_idx
  on public.agent_control_commands (requested_by);

create index revoked_app_sessions_revoked_by_idx
  on public.revoked_app_sessions (revoked_by);

create index revoked_app_sessions_command_idx
  on public.revoked_app_sessions (command_id);
