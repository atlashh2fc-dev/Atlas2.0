-- Atlas Vendedor: configuración y borradores.
--
-- Arranca en modo borrador: escribe y espera aprobación. Cuando su forma de
-- escribir convenza, se cambia `modo` a 'autonomo'. La constitución vive acá y
-- no en el código: corregir cómo habla no puede exigir un despliegue.

create table if not exists public.sales_agent_configs (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  modo text not null default 'borrador' check (modo in ('borrador', 'autonomo')),
  modelo text not null default 'mercury-2',
  constitucion text not null,
  conocimiento text not null default '',
  max_respuestas_por_dia integer not null default 30 check (max_respuestas_por_dia between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sales_agent_configs is
  'Personalidad, reglas y correa del agente vendedor. Cambiar cómo habla no debe requerir un despliegue.';

create table if not exists public.sales_agent_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid references public.sales_opportunities(id) on delete set null,
  lead_id uuid,
  mail_message_id uuid,
  para_email text not null,
  asunto text not null,
  cuerpo text not null,
  intencion text,
  razonamiento text,
  escalar boolean not null default false,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'descartado')),
  decidido_por uuid references public.profiles(id) on delete set null,
  decidido_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.sales_agent_drafts is
  'Lo que el agente propone responder. En modo borrador espera aprobación; en modo autónomo se marca enviado.';

-- Índice parcial: un mismo correo no se contesta dos veces. Ojo, al insertar hay
-- que repetir su condición en el `on conflict` (ver 20260918221657).
create unique index if not exists sales_agent_drafts_mensaje_idx
  on public.sales_agent_drafts (mail_message_id)
  where mail_message_id is not null;

create index if not exists sales_agent_drafts_pendientes_idx
  on public.sales_agent_drafts (organization_id, estado, created_at desc);

alter table public.sales_agent_configs enable row level security;
alter table public.sales_agent_drafts enable row level security;

drop policy if exists sales_agent_configs_select on public.sales_agent_configs;
create policy sales_agent_configs_select on public.sales_agent_configs
  for select to authenticated
  using (organization_id = any (public.current_org_ids()));

drop policy if exists sales_agent_configs_write on public.sales_agent_configs;
create policy sales_agent_configs_write on public.sales_agent_configs
  for all to authenticated
  using (organization_id = any (public.current_org_ids())
     and (select public.current_role_name()) = 'admin'::public.app_role)
  with check (organization_id = any (public.current_org_ids())
     and (select public.current_role_name()) = 'admin'::public.app_role);

drop policy if exists sales_agent_drafts_select on public.sales_agent_drafts;
create policy sales_agent_drafts_select on public.sales_agent_drafts
  for select to authenticated
  using (organization_id = any (public.current_org_ids())
     and (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]));

drop policy if exists sales_agent_drafts_update on public.sales_agent_drafts;
create policy sales_agent_drafts_update on public.sales_agent_drafts
  for update to authenticated
  using (organization_id = any (public.current_org_ids())
     and (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]))
  with check (organization_id = any (public.current_org_ids()));
