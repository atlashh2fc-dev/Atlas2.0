
revoke execute on function public.current_role_name() from public, anon;
revoke execute on function public.current_team_id() from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.current_role_name() to authenticated;
grant execute on function public.current_team_id() to authenticated;
;
