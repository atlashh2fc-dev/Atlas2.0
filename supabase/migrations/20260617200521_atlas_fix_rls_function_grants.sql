
-- current_role_name/current_team_id se usan DENTRO de las políticas RLS,
-- que se evalúan con los privilegios del rol "authenticated" -> deben mantener EXECUTE.
-- Solo se revoca de "anon" (usuarios no autenticados no deberían necesitarlas).
grant execute on function public.current_role_name() to authenticated;
grant execute on function public.current_team_id() to authenticated;
revoke execute on function public.current_role_name() from anon;
revoke execute on function public.current_team_id() from anon;

-- handle_new_user es invocada solo por el trigger (security definer), nadie debe llamarla por RPC
revoke execute on function public.handle_new_user() from anon, authenticated;
;
