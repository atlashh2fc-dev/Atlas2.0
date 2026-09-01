begin;

-- Supabase/PostgREST exposes the authenticated role through auth.jwt().
-- Keep service-role detection centralized so every existing control-plane RPC
-- uses the same current claim source.
create or replace function public.request_is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$function$;

revoke all on function public.request_is_service_role() from public, anon;
grant execute on function public.request_is_service_role() to authenticated, service_role;

commit;
