-- Multiempresa, paso 1: las organizaciones existen.
--
-- Atlas 2.0 nació para un solo cliente: Geimser. Hoy cada admin ve todo lo que
-- hay en la base, porque las políticas dicen literalmente "admin => true". Para
-- administrar varias empresas en el mismo CRM (Geimser, Altius Ignite y las que
-- vengan) hace falta una frontera que no dependa de que cada consulta se acuerde
-- de filtrar.
--
-- Esta migración solo crea la frontera y deja a todos adentro de Geimser. No
-- cambia ninguna política todavía: nadie pierde ni gana acceso al aplicarla.
--
-- Decisiones:
-- - Un perfil pertenece a una organización (`profiles.organization_id`, paso 2)
--   y puede ser miembro de varias (`organization_members`). Lo segundo existe
--   para el dueño de la plataforma y para quien administre a más de un cliente.
-- - El rol sigue viviendo en `profiles.role` para la operación diaria; en la
--   membresía se guarda el rol con el que esa persona entra a esa organización.
-- - `platform_owners` es la única puerta que cruza organizaciones. Se siembra
--   con la cuenta dueña y se audita en las pruebas.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  constraint organizations_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists organizations_slug_uidx on public.organizations (slug);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, profile_id)
);

create index if not exists organization_members_profile_idx
  on public.organization_members (profile_id);

create unique index if not exists organization_members_default_uidx
  on public.organization_members (profile_id)
  where is_default;

drop trigger if exists organization_members_set_updated_at on public.organization_members;
create trigger organization_members_set_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

-- La única cuenta que puede cruzar organizaciones. Se administra por SQL, no
-- desde la aplicación: quien la edite tiene que pasar por una migración.
create table if not exists public.platform_owners (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.organizations (slug, name)
values
  ('geimser', 'Geimser'),
  ('altius', 'Altius Ignite')
on conflict (slug) do nothing;

-- Todo lo que existe hoy es de Geimser.
insert into public.organization_members (organization_id, profile_id, role, is_default)
select organization.id, profile.id, profile.role, true
from public.profiles profile
cross join lateral (
  select id from public.organizations where slug = 'geimser'
) organization
on conflict (organization_id, profile_id) do nothing;

-- El dueño de la plataforma: ve y administra todas las organizaciones.
insert into public.platform_owners (profile_id)
select profile.id
from public.profiles profile
join auth.users account on account.id = profile.id
where lower(account.email) = 'hh2fc24@gmail.com'
on conflict (profile_id) do nothing;

insert into public.organization_members (organization_id, profile_id, role, is_default)
select organization.id, owner.profile_id, 'admin'::public.app_role, false
from public.platform_owners owner
cross join public.organizations organization
on conflict (organization_id, profile_id) do nothing;

/*
 * Ayudantes de identidad.
 *
 * Son SECURITY DEFINER porque las políticas que los usan corren con el rol del
 * visitante: si leyeran `organization_members` con RLS puesta, la política se
 * llamaría a sí misma. Cada uno fija su `search_path` y no recibe parámetros
 * del cliente.
 */
create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.platform_owners owner
    where owner.profile_id = (select auth.uid())
  );
$$;

create or replace function public.current_org_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(array_agg(distinct member.organization_id), '{}'::uuid[])
  from public.organization_members member
  join public.organizations organization
    on organization.id = member.organization_id
   and organization.active
  where member.profile_id = (select auth.uid());
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select member.organization_id
  from public.organization_members member
  join public.organizations organization
    on organization.id = member.organization_id
   and organization.active
  where member.profile_id = (select auth.uid())
  order by member.is_default desc, organization.slug
  limit 1;
$$;

create or replace function public.organization_id_by_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select id from public.organizations where slug = p_slug;
$$;

-- Atajo para los valores por defecto del paso 2: lo que se cree sin declarar
-- organización queda en Geimser, que es donde vive toda la operación actual.
create or replace function public.default_organization_id()
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select id from public.organizations where slug = 'geimser';
$$;

revoke all on function public.is_platform_owner() from public;
revoke all on function public.current_org_ids() from public;
revoke all on function public.current_org_id() from public;
revoke all on function public.organization_id_by_slug(text) from public;
revoke all on function public.default_organization_id() from public;

grant execute on function public.is_platform_owner() to authenticated, service_role;
grant execute on function public.current_org_ids() to authenticated, service_role;
grant execute on function public.current_org_id() to authenticated, service_role;
grant execute on function public.organization_id_by_slug(text) to authenticated, service_role;
grant execute on function public.default_organization_id() to authenticated, service_role;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.platform_owners enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select
on public.organizations
for select
to authenticated
using (
  public.is_platform_owner()
  or id = any (public.current_org_ids())
);

drop policy if exists organizations_write_platform on public.organizations;
create policy organizations_write_platform
on public.organizations
for all
to authenticated
using (public.is_platform_owner())
with check (public.is_platform_owner());

drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select
on public.organization_members
for select
to authenticated
using (
  public.is_platform_owner()
  or profile_id = (select auth.uid())
  or organization_id = any (public.current_org_ids())
);

drop policy if exists organization_members_write on public.organization_members;
create policy organization_members_write
on public.organization_members
for all
to authenticated
using (
  public.is_platform_owner()
  or (
    organization_id = any (public.current_org_ids())
    and (select public.current_role_name()) = 'admin'::public.app_role
  )
)
with check (
  public.is_platform_owner()
  or (
    organization_id = any (public.current_org_ids())
    and (select public.current_role_name()) = 'admin'::public.app_role
  )
);

-- Nadie administra la lista de dueños desde la aplicación.
drop policy if exists platform_owners_select on public.platform_owners;
create policy platform_owners_select
on public.platform_owners
for select
to authenticated
using (public.is_platform_owner());
