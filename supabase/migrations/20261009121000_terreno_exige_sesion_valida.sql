-- Terreno: sin sesión válida de la app no se entra.
--
-- current_role_name() devuelve null si la sesión fue revocada o el perfil
-- está inactivo. En 20261009120000 la comparación `null not in (...)` daba
-- null y el chequeo de pertenencia a la campaña no levantaba: un token con
-- sesión revocada podía pasar. Ahora se exige el rol antes de todo.

create or replace function public.terreno_assert_campana(p_campaign_id uuid)
returns public.campaigns
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_role text := public.current_role_name()::text;
begin
  if (select auth.uid()) is null or v_role is null then
    raise exception 'Tu sesión no es válida. Vuelve a entrar.' using errcode = '42501';
  end if;
  select * into v_campaign
  from public.campaigns
  where id = p_campaign_id and modalidad = 'terreno' and is_active;
  if not found then
    raise exception 'La campaña de terreno no existe o no está activa.';
  end if;
  perform public.assert_org_access(v_campaign.organization_id);
  if v_role not in ('admin', 'supervisor') and not exists (
    select 1 from public.campaign_agents member
    where member.campaign_id = p_campaign_id and member.profile_id = (select auth.uid())
  ) then
    raise exception 'No perteneces a esta campaña. Pide a tu supervisor que te agregue.';
  end if;
  return v_campaign;
end;
$$;

revoke all on function public.terreno_assert_campana(uuid) from public, anon;

create or replace function public.terreno_mis_campanas()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select campaign.id, campaign.name
  from public.campaigns campaign
  where campaign.modalidad = 'terreno'
    and campaign.is_active
    and public.current_role_name() is not null
    and campaign.organization_id = any(public.current_org_ids())
    and (
      public.current_role_name() in ('admin', 'supervisor')
      or exists (
        select 1 from public.campaign_agents member
        where member.campaign_id = campaign.id
          and member.profile_id = (select auth.uid())
      )
    )
  order by campaign.name;
$$;

revoke all on function public.terreno_mis_campanas() from public, anon;
grant execute on function public.terreno_mis_campanas() to authenticated;
