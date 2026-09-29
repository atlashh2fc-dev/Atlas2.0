-- Un enlace de correo lleva a una pantalla de otra de tus empresas (el aviso de
-- Prospección de Altius se abría estando en Geimser y respondía 404). Esta
-- función dice cuál de las empresas a las que llega la persona tiene alguna de
-- esas aplicaciones, para cambiar a ella en vez de negar la pantalla.
create or replace function public.empresa_con_modulo(p_modulos text[])
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select organization.id
  from public.organizations organization
  left join public.organization_members member
    on member.organization_id = organization.id
   and member.profile_id = (select auth.uid())
  where organization.active
    and (member.profile_id is not null or public.is_platform_owner())
    and exists (
      select 1 from public.organization_modules modulo
      where modulo.organization_id = organization.id
        and modulo.enabled
        and modulo.module = any (p_modulos)
    )
  order by coalesce(member.is_default, false) desc, organization.slug
  limit 1;
$$;

revoke all on function public.empresa_con_modulo(text[]) from public;
revoke execute on function public.empresa_con_modulo(text[]) from anon;
grant execute on function public.empresa_con_modulo(text[]) to authenticated, service_role;
