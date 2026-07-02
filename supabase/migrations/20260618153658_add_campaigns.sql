
-- Campañas: ecosistema independiente con ejecutivos, BBDD y flujo productivo propios.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  workflow_id uuid references public.workflows(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_agents (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (campaign_id, profile_id)
);

alter table public.leads
  add column campaign_id uuid references public.campaigns(id) on delete set null;

create index leads_campaign_id_idx on public.leads(campaign_id);
create index campaign_agents_campaign_id_idx on public.campaign_agents(campaign_id);
create index campaign_agents_profile_id_idx on public.campaign_agents(profile_id);

alter table public.campaigns enable row level security;
alter table public.campaign_agents enable row level security;

-- campaigns: admin gestiona todo; supervisor/agente pueden ver las campañas activas
-- (necesitan ver el nombre/flujo para operar leads de esa campaña).
create policy campaigns_select on public.campaigns
  for select using (true);

create policy campaigns_admin_insert on public.campaigns
  for insert with check (current_role_name() = 'admin'::app_role);

create policy campaigns_admin_update on public.campaigns
  for update using (current_role_name() = 'admin'::app_role)
  with check (current_role_name() = 'admin'::app_role);

create policy campaigns_admin_delete on public.campaigns
  for delete using (current_role_name() = 'admin'::app_role);

-- campaign_agents: admin gestiona; cualquiera puede ver membresías (para mostrar
-- "ejecutivos asignados" en la UI de campaña y filtrar listas de asignación).
create policy campaign_agents_select on public.campaign_agents
  for select using (true);

create policy campaign_agents_admin_insert on public.campaign_agents
  for insert with check (current_role_name() = 'admin'::app_role);

create policy campaign_agents_admin_delete on public.campaign_agents
  for delete using (current_role_name() = 'admin'::app_role);

-- Reportería por campaña, mismo patrón que workflow_compliance.
create view public.campaign_performance as
select
  c.id as campaign_id,
  c.name as campaign_name,
  c.is_active,
  w.id as workflow_id,
  w.name as workflow_name,
  count(l.id) as total_leads,
  count(l.id) filter (where l.assignment_status = 'managed' or l.workflow_status = 'managed') as managed_leads,
  count(l.id) filter (where l.status = 'convertido') as conversions,
  case
    when count(l.id) > 0
      then round(100.0 * count(l.id) filter (where l.assignment_status = 'managed' or l.workflow_status = 'managed') / count(l.id), 1)
    else null
  end as managed_rate
from public.campaigns c
left join public.workflows w on w.id = c.workflow_id
left join public.leads l on l.campaign_id = c.id
group by c.id, c.name, c.is_active, w.id, w.name;
;
