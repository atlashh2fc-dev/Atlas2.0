-- `current_org_ids()` ya respetaba la empresa elegida, pero `current_org_id()`
-- seguía devolviendo la primera membresía. Se notó al crear: mirando Altius, la
-- oportunidad nacía en Geimser y sin precio, porque el catálogo es por empresa.
--
-- Ahora la empresa elegida manda también al crear.

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with alcance as (
    select member.organization_id, member.is_default
    from public.organization_members member
    join public.organizations organization
      on organization.id = member.organization_id
     and organization.active
    where member.profile_id = (select auth.uid())
    union
    select organization.id, false
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
  select coalesce(
    (
      select alcance.organization_id
      from alcance
      where alcance.organization_id = (select id from elegida)
      limit 1
    ),
    (
      select alcance.organization_id
      from alcance
      join public.organizations organization on organization.id = alcance.organization_id
      order by alcance.is_default desc, organization.slug
      limit 1
    )
  );
$$;

revoke all on function public.current_org_id() from public;
revoke execute on function public.current_org_id() from anon;
grant execute on function public.current_org_id() to authenticated, service_role;
