-- Núcleo de ventas B2B.
--
-- Atlas 2.0 nació para un call center: leads, llamadas y tipificaciones. Vender
-- Atlas Pulso a una empresa necesita otra forma: la empresa cliente, sus
-- contactos, la oportunidad con monto y etapa, y lo que se hizo en cada paso.
--
-- Todo nace con empresa dueña (`organization_id`) y con la misma frontera que el
-- resto del CRM: política permisiva por rol más política restrictiva de empresa.

create table if not exists public.sales_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.default_organization_id() references public.organizations(id),
  rut text,
  normalized_rut text,
  name text not null,
  trade_name text,
  industry text,
  commune text,
  region text,
  country text not null default 'Chile',
  website text,
  phone text,
  email text,
  size_band text,
  employees integer,
  source text,
  crm_entity_id uuid references public.crm_entities(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_companies_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists sales_companies_rut_uidx
  on public.sales_companies (organization_id, normalized_rut)
  where normalized_rut is not null;
create index if not exists sales_companies_organization_idx on public.sales_companies (organization_id);
create index if not exists sales_companies_name_idx on public.sales_companies (organization_id, lower(name));

create or replace function public.sales_companies_normalize()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  new.normalized_rut := nullif(public.normalize_lead_rut(new.rut), '');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sales_companies_normalize on public.sales_companies;
create trigger sales_companies_normalize
before insert or update on public.sales_companies
for each row execute function public.sales_companies_normalize();

create table if not exists public.sales_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.default_organization_id() references public.organizations(id),
  company_id uuid not null references public.sales_companies(id) on delete cascade,
  full_name text not null,
  role_title text,
  email text,
  phone text,
  whatsapp text,
  is_decision_maker boolean not null default false,
  lead_id uuid references public.leads(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_contacts_name_not_blank check (btrim(full_name) <> '')
);

create index if not exists sales_contacts_company_idx on public.sales_contacts (company_id);
create index if not exists sales_contacts_organization_idx on public.sales_contacts (organization_id);

create table if not exists public.sales_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.default_organization_id() references public.organizations(id),
  key text not null,
  name text not null,
  position integer not null,
  probability numeric(5,2) not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint sales_stages_probability_range check (probability >= 0 and probability <= 100)
);

create unique index if not exists sales_stages_key_uidx on public.sales_stages (organization_id, key);
create index if not exists sales_stages_order_idx on public.sales_stages (organization_id, position);

create table if not exists public.sales_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.default_organization_id() references public.organizations(id),
  code text not null,
  name text not null,
  description text,
  monthly_price numeric(14,2),
  one_time_price numeric(14,2),
  currency text not null default 'CLP',
  min_term_months integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_products_code_uidx on public.sales_products (organization_id, code);

create table if not exists public.sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.default_organization_id() references public.organizations(id),
  company_id uuid not null references public.sales_companies(id) on delete cascade,
  contact_id uuid references public.sales_contacts(id) on delete set null,
  name text not null,
  stage_id uuid not null references public.sales_stages(id),
  status text not null default 'abierta' check (status in ('abierta', 'ganada', 'perdida')),
  monthly_amount numeric(14,2) not null default 0,
  one_time_amount numeric(14,2) not null default 0,
  currency text not null default 'CLP',
  expected_close_date date,
  closed_at timestamptz,
  lost_reason text,
  owner_id uuid references public.profiles(id) on delete set null,
  source text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  next_action_at timestamptz,
  next_action_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_opportunities_name_not_blank check (btrim(name) <> '')
);

create index if not exists sales_opportunities_org_status_idx on public.sales_opportunities (organization_id, status);
create index if not exists sales_opportunities_stage_idx on public.sales_opportunities (stage_id);
create index if not exists sales_opportunities_company_idx on public.sales_opportunities (company_id);
create index if not exists sales_opportunities_owner_idx on public.sales_opportunities (owner_id, next_action_at);

create table if not exists public.sales_opportunity_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.default_organization_id() references public.organizations(id),
  opportunity_id uuid not null references public.sales_opportunities(id) on delete cascade,
  product_id uuid references public.sales_products(id) on delete set null,
  description text,
  quantity integer not null default 1,
  monthly_price numeric(14,2) not null default 0,
  one_time_price numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint sales_opportunity_items_quantity_positive check (quantity > 0)
);

create index if not exists sales_opportunity_items_opportunity_idx on public.sales_opportunity_items (opportunity_id);

create table if not exists public.sales_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.default_organization_id() references public.organizations(id),
  opportunity_id uuid references public.sales_opportunities(id) on delete cascade,
  company_id uuid references public.sales_companies(id) on delete cascade,
  contact_id uuid references public.sales_contacts(id) on delete set null,
  kind text not null check (kind in ('llamada', 'correo', 'whatsapp', 'reunion', 'nota', 'tarea', 'etapa')),
  subject text,
  body text,
  occurred_at timestamptz not null default now(),
  due_at timestamptz,
  done boolean not null default true,
  owner_id uuid references public.profiles(id) on delete set null,
  lead_mail_message_id uuid,
  whatsapp_conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  call_id uuid references public.calls(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sales_activities_target check (opportunity_id is not null or company_id is not null)
);

create index if not exists sales_activities_opportunity_idx on public.sales_activities (opportunity_id, occurred_at desc);
create index if not exists sales_activities_company_idx on public.sales_activities (company_id, occurred_at desc);
create index if not exists sales_activities_pendientes_idx on public.sales_activities (organization_id, due_at) where not done;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'sales_companies', 'sales_contacts', 'sales_stages', 'sales_products',
    'sales_opportunities', 'sales_opportunity_items', 'sales_activities'
  ] loop
    execute format('alter table public.%I enable row level security', v_tabla);

    execute format('drop policy if exists %I on public.%I', v_tabla || '_select', v_tabla);
    execute format($politica$
      create policy %I on public.%I
      for select to authenticated
      using (
        (select public.current_role_name()) in ('admin'::public.app_role, 'supervisor'::public.app_role)
        or public.is_platform_owner()
      )
    $politica$, v_tabla || '_select', v_tabla);

    execute format('drop policy if exists %I on public.%I', v_tabla || '_write', v_tabla);
    execute format($politica$
      create policy %I on public.%I
      for all to authenticated
      using (
        (select public.current_role_name()) in ('admin'::public.app_role, 'supervisor'::public.app_role)
        or public.is_platform_owner()
      )
      with check (
        (select public.current_role_name()) in ('admin'::public.app_role, 'supervisor'::public.app_role)
        or public.is_platform_owner()
      )
    $politica$, v_tabla || '_write', v_tabla);

    execute format('drop policy if exists %I on public.%I', v_tabla || '_organization_isolation', v_tabla);
    execute format($politica$
      create policy %I on public.%I
      as restrictive for all to authenticated
      using (public.is_platform_owner() or organization_id = any (public.current_org_ids()))
      with check (public.is_platform_owner() or organization_id = any (public.current_org_ids()))
    $politica$, v_tabla || '_organization_isolation', v_tabla);
  end loop;
end
$$;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['sales_companies', 'sales_contacts', 'sales_products', 'sales_opportunities'] loop
    execute format('drop trigger if exists %I on public.%I', v_tabla || '_set_updated_at', v_tabla);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_tabla || '_set_updated_at', v_tabla
    );
  end loop;
end
$$;

insert into public.sales_stages (organization_id, key, name, position, probability, is_won, is_lost)
select organization.id, etapa.key, etapa.name, etapa.position, etapa.probability, etapa.is_won, etapa.is_lost
from public.organizations organization
cross join (values
  ('prospecto', 'Prospecto', 1, 10, false, false),
  ('contactado', 'Contactado', 2, 25, false, false),
  ('reunion', 'Reunión agendada', 3, 45, false, false),
  ('propuesta', 'Propuesta enviada', 4, 65, false, false),
  ('negociacion', 'Negociación', 5, 80, false, false),
  ('ganada', 'Ganada', 6, 100, true, false),
  ('perdida', 'Perdida', 7, 0, false, true)
) as etapa(key, name, position, probability, is_won, is_lost)
on conflict (organization_id, key) do nothing;

insert into public.sales_products (organization_id, code, name, description, monthly_price, one_time_price, min_term_months)
select public.organization_id_by_slug('altius'), producto.code, producto.name, producto.description,
       producto.monthly_price, producto.one_time_price, producto.min_term_months
from (values
  ('pulso_esencial', 'Pulso Esencial', 'Sitio de hasta 5 secciones, Atlas en la web con 100 conversaciones al mes, Atlas CRM hasta 100 contactos, hosting y dominio .cl, Tu Pulso semanal.', 29990::numeric, null::numeric, 12),
  ('pulso_crecimiento', 'Pulso Crecimiento', 'Todo lo de Esencial, hasta 10 secciones, agenda integrada, Atlas en WhatsApp, informe de Google Ads y Meta Ads.', 69990::numeric, null::numeric, 12),
  ('pulso_pro', 'Pulso Pro', 'Todo lo de Crecimiento, campañas con Atlas Lead, priorización con Atlas Scoring, integraciones y hasta 5 usuarios.', 149990::numeric, null::numeric, 12),
  ('atlas_crm', 'Atlas CRM', 'Gestión comercial y atención con voz y WhatsApp en una ficha.', null::numeric, null::numeric, null::integer),
  ('atlas_itsm', 'Atlas ITSM', 'Mesa de ayuda con responsables, plazos e inventario.', null::numeric, null::numeric, null::integer),
  ('atlas_analytics', 'Atlas Analytics', 'Tableros e indicadores de gestión.', null::numeric, null::numeric, null::integer),
  ('atlas_financiero', 'Atlas Financiero', 'Documentos tributarios, tesorería y cartera.', null::numeric, null::numeric, null::integer),
  ('atlas_lead', 'Atlas Lead', 'Campañas de correo con seguimiento comercial.', null::numeric, null::numeric, null::integer),
  ('atlas_scoring', 'Atlas Scoring', 'Priorización comercial y datos por empresa.', null::numeric, null::numeric, null::integer),
  ('desarrollo', 'Software a medida', 'Plataformas, portales e integraciones con alcance definido.', null::numeric, null::numeric, null::integer)
) as producto(code, name, description, monthly_price, one_time_price, min_term_months)
where public.organization_id_by_slug('altius') is not null
on conflict (organization_id, code) do nothing;
