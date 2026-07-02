
-- Fijar search_path en set_updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Estas funciones solo deben usarse internamente desde políticas RLS,
-- no deben ser invocables directamente vía RPC por anon/authenticated.
revoke execute on function public.current_role_name() from anon, authenticated;
revoke execute on function public.current_team_id() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
;
