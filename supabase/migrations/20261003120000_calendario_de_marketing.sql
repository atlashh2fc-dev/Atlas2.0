-- Marketing · Etapa 1: el calendario de lo que la empresa publica.
--
-- Reels, publicaciones en grupos de Facebook, correos de Atlas Lead y anuncios
-- de Meta, cada uno con su canal, su fecha, su estado y lo que rindió. En esta
-- etapa Atlas solo lo muestra: no publica nada en Meta. Las piezas las escriben
-- los alimentadores (Claude, Atlas Lead, Meta) por /api/marketing/items, que
-- hace upsert por (empresa, origen, external_id) para que reenviar una semana
-- no la duplique.
--
-- Marketing es una aplicación más de la suite: se contrata por empresa. Altius
-- es la primera que la usa.

-- ---------------------------------------------------------------------------
-- La aplicación en el catálogo de la suite.
-- ---------------------------------------------------------------------------
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
    'aprende',         -- Atlas Aprende: capacitación de los equipos
    'marketing'        -- calendario de publicaciones, correos y anuncios
  ));

insert into public.organization_modules (organization_id, module)
select public.organization_id_by_slug('altius'), 'marketing'
where public.organization_id_by_slug('altius') is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Una pieza del calendario: un reel, un correo, un anuncio, un post en grupo.
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Agrupa piezas de una misma acción ("Lanzamiento Vet oct-26").
  campaign text,
  channel text not null,
  format text not null,
  title text not null,
  body text,
  -- Nombre del grupo o audiencia a la que va.
  target text,
  product text,
  -- Quién la escribió dentro de la estrategia ("Agente 3 · Producto en acción").
  agent text,
  asset_url text,
  external_url text,
  status text not null default 'borrador',
  scheduled_at timestamptz not null,
  -- Piezas que duran varios días, como una campaña de anuncios.
  ends_at timestamptz,
  published_at timestamptz,
  -- reach, reactions, comments, shares, saves, leads: lo que reporte cada canal.
  metrics jsonb not null default '{}'::jsonb,
  -- Quién escribió la fila; junto con external_id identifica la pieza al reenviarla.
  source text not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_items_channel_check check (channel in (
    'instagram', 'facebook', 'facebook_grupo', 'email', 'meta_ads', 'whatsapp', 'web', 'tiktok', 'linkedin', 'otro'
  )),
  constraint marketing_items_format_check check (format in (
    'reel', 'post', 'historia', 'carrusel', 'correo', 'anuncio', 'video', 'imagen'
  )),
  constraint marketing_items_product_check check (product is null or product in (
    'atlas_crm', 'crm_dental', 'crm_vet', 'crm_barberia', 'crm_center', 'atlas_pulso'
  )),
  constraint marketing_items_status_check check (status in (
    'idea', 'borrador', 'programado', 'publicado', 'pausado', 'fallido'
  )),
  constraint marketing_items_source_check check (source in ('claude', 'atlas_lead', 'meta', 'manual')),
  constraint marketing_items_title_not_blank check (btrim(title) <> ''),
  constraint marketing_items_metrics_object check (jsonb_typeof(metrics) = 'object'),
  constraint marketing_items_ends_after_start check (ends_at is null or ends_at >= scheduled_at),
  constraint marketing_items_external_id_not_blank check (external_id is null or btrim(external_id) <> '')
);

comment on table public.marketing_items is
  'Calendario de marketing por empresa: piezas por canal con estado y métricas. Lo escriben los alimentadores vía /api/marketing/items.';

-- El upsert de los alimentadores. Un índice parcial no le sirve a PostgREST
-- (no puede pasar el WHERE en on_conflict); con NULL distintos por defecto, las
-- piezas manuales sin external_id siguen pudiendo ser varias.
create unique index if not exists marketing_items_external_uidx
  on public.marketing_items (organization_id, source, external_id);

-- El calendario lee por empresa y rango de fechas.
create index if not exists marketing_items_calendario_idx
  on public.marketing_items (organization_id, scheduled_at);

drop trigger if exists marketing_items_set_updated_at on public.marketing_items;
create trigger marketing_items_set_updated_at
  before update on public.marketing_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seguridad: aislamiento por empresa (restrictiva) como el resto de las tablas.
-- Lee cualquier miembro de la empresa; escriben admin, supervisor o el dueño de
-- la plataforma. Borrar queda solo para el servicio: un alimentador que se
-- equivoca reenvía la pieza, no la borra desde una sesión.
-- ---------------------------------------------------------------------------
alter table public.marketing_items enable row level security;

drop policy if exists marketing_items_organization_isolation on public.marketing_items;
create policy marketing_items_organization_isolation on public.marketing_items
  as restrictive
  for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists marketing_items_select on public.marketing_items;
create policy marketing_items_select on public.marketing_items
  for select to authenticated
  using (organization_id = any (public.current_org_ids()));

drop policy if exists marketing_items_insert on public.marketing_items;
create policy marketing_items_insert on public.marketing_items
  for insert to authenticated
  with check (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or public.is_platform_owner()
  );

drop policy if exists marketing_items_update on public.marketing_items;
create policy marketing_items_update on public.marketing_items
  for update to authenticated
  using (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or public.is_platform_owner()
  )
  with check (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or public.is_platform_owner()
  );

revoke all on public.marketing_items from anon;
grant select, insert, update on public.marketing_items to authenticated;
grant all on public.marketing_items to service_role;
