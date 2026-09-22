-- Cada negocio sabe de qué registro viene.
--
-- Los negocios que abre el agente calificador nacían sin `lead_id`, y el
-- hilo de correo de la campaña (lo que Atlas Lead le mandó al lead y lo que
-- respondió) quedaba en otra ficha. Se enlazan por el correo del contacto
-- dentro de la misma empresa, hoy y cada vez que nazca uno nuevo.

update public.sales_opportunities negocio
   set lead_id = registro.id
  from public.sales_contacts contacto
  join lateral (
    select l.id from public.leads l
     where l.organization_id = contacto.organization_id and lower(l.email) = lower(contacto.email)
     order by l.updated_at desc limit 1
  ) registro on true
 where negocio.lead_id is null
   and contacto.id = negocio.contact_id
   and nullif(btrim(coalesce(contacto.email, '')), '') is not null;

create or replace function public.enlazar_negocio_a_registro()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare v_email text;
begin
  if new.lead_id is not null then return new; end if;
  select lower(coalesce(nullif(btrim(contacto.email), ''), nullif(btrim(cuenta.email), ''))) into v_email
    from public.sales_companies cuenta
    left join public.sales_contacts contacto on contacto.id = new.contact_id
   where cuenta.id = new.company_id;
  if v_email is null then return new; end if;
  select l.id into new.lead_id from public.leads l
   where l.organization_id = new.organization_id and lower(l.email) = v_email
   order by l.updated_at desc limit 1;
  return new;
end;
$$;

drop trigger if exists sales_opportunities_enlace_registro on public.sales_opportunities;
create trigger sales_opportunities_enlace_registro before insert on public.sales_opportunities
  for each row execute function public.enlazar_negocio_a_registro();
