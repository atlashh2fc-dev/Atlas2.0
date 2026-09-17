-- El catálogo de aplicaciones es el mismo que vendemos en altiusignite.com.
--
-- Si el sitio ofrece Atlas ITSM y Atlas Analytics, la suite tiene que poder
-- activarlos por empresa; si no, vendemos algo que la plataforma no sabe dar.

alter table public.organization_modules
  drop constraint if exists organization_modules_module_check;

alter table public.organization_modules
  add constraint organization_modules_module_check check (module in (
    'leads',           -- capa base: registros y su seguimiento
    'ventas_b2b',      -- embudo de empresas
    'ventas_b2c',      -- venta a consumidor final
    'contact_center',  -- Atlas CRM: voz, discador, agentes, colas, calidad
    'correo',          -- Atlas Lead: campañas de correo
    'whatsapp',        -- canal WhatsApp, con o sin IA
    'bigdata',         -- Atlas Scoring: datos y priorización
    'analytics',       -- Atlas Analytics: tableros e indicadores
    'itsm',            -- Atlas ITSM: mesa de ayuda e inventario
    'finanzas',        -- Atlas Financiero: tesorería, cartera, SII
    'aprende'          -- Atlas Aprende: capacitación de los equipos
  ));

insert into public.organization_modules (organization_id, module)
select public.organization_id_by_slug('geimser'), unnest(array['finanzas', 'bigdata', 'analytics'])
on conflict do nothing;

insert into public.organization_modules (organization_id, module)
select public.organization_id_by_slug('altius'), unnest(array['bigdata'])
on conflict do nothing;

do $$
begin
  if not exists (
    select 1 from public.organization_modules
    where organization_id = public.organization_id_by_slug('geimser') and module = 'analytics'
  ) then
    raise exception 'El catálogo alineado con el sitio no quedó sembrado';
  end if;
end;
$$;
