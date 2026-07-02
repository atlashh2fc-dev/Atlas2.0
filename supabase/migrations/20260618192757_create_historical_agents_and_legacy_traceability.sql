
-- 1. Tabla de agentes históricos (personas con gestión real en el CRM legado,
--    independientemente de si tienen login en Atlas hoy)
create table public.historical_agents (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  legacy_system text not null,
  legacy_executive_id text,
  linked_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (legacy_system, legacy_executive_id)
);

comment on table public.historical_agents is
  'Ejecutivos provenientes de CRMs legados. linked_profile_id se completa cuando el admin activa a la persona con un perfil real en Atlas (ver feature "Activar ejecutivo histórico").';

alter table public.historical_agents enable row level security;

create policy historical_agents_select on public.historical_agents
  for select to authenticated
  using ((select current_role_name()) in ('admin','supervisor'));

create policy historical_agents_write on public.historical_agents
  for all to authenticated
  using ((select current_role_name()) = 'admin')
  with check ((select current_role_name()) = 'admin');

-- 2. Columnas de atribución histórica + trazabilidad/idempotencia
alter table public.calls
  add column historical_agent_id uuid references public.historical_agents(id) on delete set null,
  add column legacy_call_id text;

create unique index calls_legacy_call_id_uidx on public.calls (legacy_call_id) where legacy_call_id is not null;
create index calls_historical_agent_id_idx on public.calls (historical_agent_id);

alter table public.interactions
  add column historical_agent_id uuid references public.historical_agents(id) on delete set null,
  add column legacy_source text;

create index interactions_historical_agent_id_idx on public.interactions (historical_agent_id);

alter table public.leads
  add column legacy_lead_id text;

create unique index leads_legacy_lead_id_uidx on public.leads (legacy_lead_id) where legacy_lead_id is not null;
;
