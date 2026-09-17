-- Un dato pertenece a la empresa de su campaña, no a la empresa por omisión.
--
-- `organization_id` se llenaba con `default_organization_id()`, que mira la
-- sesión de quien escribe. Las integraciones escriben con la llave de servicio
-- y no tienen sesión, así que todo lo que entraba por Atlas Lead caía en
-- Geimser aunque la campaña fuera de Altius.
--
-- Eso no era solo cosmético: esos leads quedaban visibles para los
-- administradores de Geimser, justo lo que la frontera de empresa debe impedir.
--
-- La campaña ya sabe de quién es. Que el lead lo herede de ella.

create or replace function public.heredar_empresa_de_la_campana()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid;
begin
  if new.campaign_id is null then
    return new;
  end if;

  select campaign.organization_id into v_org
  from public.campaigns campaign
  where campaign.id = new.campaign_id;

  if v_org is not null then
    new.organization_id := v_org;
  end if;

  return new;
end;
$$;

revoke all on function public.heredar_empresa_de_la_campana() from public;

drop trigger if exists leads_heredan_empresa on public.leads;
create trigger leads_heredan_empresa
  before insert or update of campaign_id on public.leads
  for each row execute function public.heredar_empresa_de_la_campana();

drop trigger if exists sales_opportunities_heredan_empresa on public.sales_opportunities;
create trigger sales_opportunities_heredan_empresa
  before insert or update of campaign_id on public.sales_opportunities
  for each row execute function public.heredar_empresa_de_la_campana();

-- Reparar lo que ya entró con la empresa equivocada.
update public.leads lead
set organization_id = campaign.organization_id, updated_at = now()
from public.campaigns campaign
where campaign.id = lead.campaign_id
  and lead.organization_id is distinct from campaign.organization_id;

update public.sales_opportunities oportunidad
set organization_id = campaign.organization_id, updated_at = now()
from public.campaigns campaign
where campaign.id = oportunidad.campaign_id
  and oportunidad.organization_id is distinct from campaign.organization_id;

do $$
declare
  v_desalineados int;
begin
  select count(*) into v_desalineados
  from public.leads lead
  join public.campaigns campaign on campaign.id = lead.campaign_id
  where lead.organization_id is distinct from campaign.organization_id;

  if v_desalineados > 0 then
    raise exception 'Quedan % leads en una empresa distinta a la de su campaña', v_desalineados;
  end if;
end;
$$;
