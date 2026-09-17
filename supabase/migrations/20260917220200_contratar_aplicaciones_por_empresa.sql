-- Contratar o dar de baja una aplicación para una empresa.
--
-- Solo el dueño de la plataforma: activar una app es una decisión comercial, no
-- una preferencia que un administrador de la empresa pueda tomar por su cuenta.

create or replace function public.cambiar_modulo_de_empresa(
  p_organization_id uuid,
  p_module text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Solo el dueño de la plataforma contrata aplicaciones'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'La empresa no existe';
  end if;

  insert into public.organization_modules (organization_id, module, enabled)
  values (p_organization_id, p_module, p_enabled)
  on conflict (organization_id, module) do update set enabled = excluded.enabled;
end;
$$;

revoke all on function public.cambiar_modulo_de_empresa(uuid, text, boolean) from public;
revoke execute on function public.cambiar_modulo_de_empresa(uuid, text, boolean) from anon;
grant execute on function public.cambiar_modulo_de_empresa(uuid, text, boolean) to authenticated;

-- El dueño necesita el tablero completo de todas las empresas, también cuando
-- está mirando una sola: es la pantalla desde donde contrata.
create or replace function public.aplicaciones_de_las_empresas()
returns table (organization_id uuid, slug text, name text, module text, enabled boolean)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select organization.id, organization.slug, organization.name, modulo.module, coalesce(modulo.enabled, false)
  from public.organizations organization
  left join public.organization_modules modulo on modulo.organization_id = organization.id
  where public.is_platform_owner()
  order by organization.name, modulo.module;
$$;

revoke all on function public.aplicaciones_de_las_empresas() from public;
revoke execute on function public.aplicaciones_de_las_empresas() from anon;
grant execute on function public.aplicaciones_de_las_empresas() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.cambiar_modulo_de_empresa(uuid, text, boolean)', 'execute')
    or has_function_privilege('anon', 'public.aplicaciones_de_las_empresas()', 'execute') then
    raise exception 'Un visitante sin sesión alcanza el contrato de aplicaciones';
  end if;
end;
$$;
