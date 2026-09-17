-- Administrar empresas desde la aplicación.
--
-- Dos cosas: el dueño de la plataforma puede crear empresas y mover gente entre
-- ellas, y cualquiera con acceso a más de una puede elegir cuál está mirando.
--
-- La empresa elegida se guarda en el perfil y `current_org_ids()` la respeta, así
-- que el cambio de vista alcanza a toda la seguridad por fila sin tocar una sola
-- consulta de la aplicación.

alter table public.profiles
  add column if not exists viewing_organization_id uuid references public.organizations(id);

comment on column public.profiles.viewing_organization_id is
  'Empresa que la persona está mirando. Nula = todas las que le corresponden.';

create or replace function public.current_org_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with alcance as (
    select member.organization_id
    from public.organization_members member
    join public.organizations organization
      on organization.id = member.organization_id
     and organization.active
    where member.profile_id = (select auth.uid())
    union
    select organization.id
    from public.organizations organization
    where organization.active
      and exists (
        select 1 from public.platform_owners owner
        where owner.profile_id = (select auth.uid())
      )
  ),
  elegida as (
    select profile.viewing_organization_id as id
    from public.profiles profile
    where profile.id = (select auth.uid())
  )
  select case
    when (select id from elegida) is not null
      and (select id from elegida) in (select organization_id from alcance)
      then array[(select id from elegida)]
    else coalesce((select array_agg(distinct organization_id) from alcance), '{}'::uuid[])
  end;
$$;

revoke all on function public.current_org_ids() from public;
revoke execute on function public.current_org_ids() from anon;
grant execute on function public.current_org_ids() to authenticated, service_role;

create or replace function public.elegir_organizacion_activa(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if p_organization_id is not null
     and not exists (
       select 1 from public.organization_members member
       where member.profile_id = (select auth.uid())
         and member.organization_id = p_organization_id
     )
     and not public.is_platform_owner() then
    raise exception 'No perteneces a esa empresa' using errcode = '42501';
  end if;

  update public.profiles
     set viewing_organization_id = p_organization_id
   where id = (select auth.uid());
end;
$$;

create or replace function public.crear_organizacion(p_slug text, p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'Solo el dueño de la plataforma crea empresas' using errcode = '42501';
  end if;

  insert into public.organizations (slug, name)
  values (lower(btrim(p_slug)), btrim(p_name))
  returning id into v_id;

  insert into public.organization_members (organization_id, profile_id, role, is_default)
  select v_id, owner.profile_id, 'admin'::public.app_role, false
  from public.platform_owners owner
  on conflict (organization_id, profile_id) do nothing;

  return v_id;
end;
$$;

create or replace function public.activar_organizacion(p_organization_id uuid, p_activa boolean)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Solo el dueño de la plataforma activa o suspende empresas' using errcode = '42501';
  end if;

  update public.organizations set active = p_activa, updated_at = now()
   where id = p_organization_id;
end;
$$;

create or replace function public.mover_perfil_a_organizacion(p_profile_id uuid, p_organization_id uuid, p_role public.app_role default null)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_role public.app_role;
begin
  if not public.is_platform_owner() then
    raise exception 'Solo el dueño de la plataforma mueve personas entre empresas' using errcode = '42501';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id and active) then
    raise exception 'La empresa no existe o está suspendida';
  end if;

  select coalesce(p_role, profile.role) into v_role
  from public.profiles profile where profile.id = p_profile_id;

  if v_role is null then
    raise exception 'La persona no existe';
  end if;

  -- El disparador de `profiles` sincroniza la membresía principal.
  update public.profiles
     set organization_id = p_organization_id,
         role = v_role,
         viewing_organization_id = null
   where id = p_profile_id;

  delete from public.organization_members member
   where member.profile_id = p_profile_id
     and member.organization_id <> p_organization_id
     and not exists (
       select 1 from public.platform_owners owner where owner.profile_id = p_profile_id
     );
end;
$$;

do $$
declare
  v_funcion text;
begin
  foreach v_funcion in array array[
    'public.elegir_organizacion_activa(uuid)',
    'public.crear_organizacion(text, text)',
    'public.activar_organizacion(uuid, boolean)',
    'public.mover_perfil_a_organizacion(uuid, uuid, public.app_role)'
  ] loop
    execute format('revoke all on function %s from public', v_funcion);
    execute format('revoke execute on function %s from anon', v_funcion);
    execute format('grant execute on function %s to authenticated, service_role', v_funcion);
  end loop;
end
$$;
