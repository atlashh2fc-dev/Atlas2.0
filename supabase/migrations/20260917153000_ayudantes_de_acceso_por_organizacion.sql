-- Las funciones SECURITY DEFINER se saltan la seguridad por fila: para ellas las
-- políticas restrictivas de organización no existen. Estos dos ayudantes son la
-- forma corta de devolverles la frontera.
--
-- `can_access_org` se usa dentro de consultas (funciones SQL) y
-- `assert_org_access` corta la ejecución en las funciones plpgsql.

create or replace function public.can_access_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select p_organization_id is null
    or public.is_platform_owner()
    or p_organization_id = any (public.current_org_ids());
$$;

create or replace function public.assert_org_access(p_organization_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if not public.can_access_org(p_organization_id) then
    raise exception 'El dato pertenece a otra empresa'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.can_access_org(uuid) from public;
revoke all on function public.assert_org_access(uuid) from public;
revoke execute on function public.can_access_org(uuid) from anon;
revoke execute on function public.assert_org_access(uuid) from anon;
grant execute on function public.can_access_org(uuid) to authenticated, service_role;
grant execute on function public.assert_org_access(uuid) to authenticated, service_role;
