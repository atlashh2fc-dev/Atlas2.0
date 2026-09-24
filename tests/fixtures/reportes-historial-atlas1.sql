-- Esquema mínimo de Atlas 2.0 para ejecutar los reportes del supervisor en un
-- PostgreSQL local y aislado. Solo lo que leen las funciones bajo prueba.
set client_min_messages = warning;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant usage on schema public to authenticated;

create type public.app_role as enum ('agente', 'supervisor', 'admin');

create table public.organizations (id uuid primary key, name text);
create table public.teams (id uuid primary key, name text);
create table public.profiles (
  id uuid primary key, full_name text, role public.app_role not null, active boolean not null default true,
  team_id uuid references public.teams(id), organization_id uuid
);
create table public.supervisor_teams (profile_id uuid, team_id uuid);
create table public.campaigns (id uuid primary key, name text, organization_id uuid, is_active boolean default true);
create table public.campaign_agents (campaign_id uuid, profile_id uuid);
create table public.historical_agents (id uuid primary key, full_name text, linked_profile_id uuid);
create table public.leads (
  id uuid primary key, full_name text, rut text, phone text, email text, status text,
  tipificacion_actual text, observacion_actual text, managed_at timestamptz,
  organization_id uuid, team_id uuid, campaign_id uuid, assigned_to uuid, next_action_at timestamptz
);
create table public.lead_contacts (
  id uuid primary key default gen_random_uuid(), lead_id uuid, contact_type text, value text, label text,
  is_primary boolean, is_valid boolean, created_at timestamptz default now()
);
create table public.calls (
  id uuid primary key default gen_random_uuid(), lead_id uuid references public.leads(id),
  agent_id uuid, historical_agent_id uuid, status text, outcome text, reason text, notes text,
  started_at timestamptz, ended_at timestamptz, next_action_at timestamptz,
  equifax_uf_amount numeric, equifax_products text[], equifax_recipient_email text,
  discarded_reason text, legacy_call_id text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.interactions (
  id uuid primary key default gen_random_uuid(), lead_id uuid references public.leads(id),
  agent_id uuid, historical_agent_id uuid, result text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz default now()
);
create table public.vocalcom_call_events (
  lead_id uuid, match_status text, called_at timestamptz, created_at timestamptz default now(),
  connection_status text, duration_seconds numeric
);
create table public.dialer_campaign_configs (
  campaign_id uuid primary key, queue_name text, campaign_type text, is_active boolean default true
);
create table public.dial_attempts (campaign_id uuid, status text, created_at timestamptz default now());
create table public.contact_center_queue_sources (queue_id uuid, campaign_id uuid, is_active boolean);
create table public.contact_center_queue_members (queue_id uuid, profile_id uuid, is_active boolean);
create table public.supervisor_report_daily_agent_metrics (
  metric_day date, team_id uuid, report_agent_key text, profile_id uuid, historical_agent_id uuid,
  crm_gestiones int, leads_gestionados int, llamadas_cerradas int, contactos_efectivos int, no_contacto int,
  agendas int, cotizaciones int, ventas int, uf numeric, tmo_sum_seconds numeric, tmo_count int,
  refreshed_at timestamptz, primary key (metric_day, team_id, report_agent_key)
);
create table public.supervisor_report_daily_agent_tipifications (
  metric_day date, team_id uuid, report_agent_key text, profile_id uuid, historical_agent_id uuid,
  label text, count int, refreshed_at timestamptz
);
create table public.supervisor_report_daily_tipifications (
  metric_day date, team_id uuid, agent_id uuid, label text, count int, refreshed_at timestamptz
);
grant select on all tables in schema public to authenticated;

-- Frontera de empresa y rol, leídos de quien consulta.
create function public.current_role_name() returns public.app_role language sql stable security definer
set search_path to 'public' as $$ select role from public.profiles where id = auth.uid() and active $$;
create function public.can_access_org(p_org uuid) returns boolean language sql stable security definer
set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and organization_id = p_org)
$$;
create function public.supervised_team_ids() returns uuid[] language sql stable security definer
set search_path to 'public' as $$
  select coalesce(array_agg(team_id), '{}') from public.supervisor_teams where profile_id = auth.uid()
$$;
create function public.is_current_app_session_valid() returns boolean language sql stable as $$ select true $$;
create function public.can_access_whatsapp_campaign(p_campaign uuid, p_other uuid) returns boolean
language sql stable as $$ select false $$;
create function public.org_of_campaign(p_campaign uuid) returns uuid language sql stable
set search_path to 'public' as $$ select organization_id from public.campaigns where id = p_campaign $$;

-- Datos. Septiembre de 2026 en Chile es UTC-3 (el horario de verano parte el 6).
insert into public.organizations values ('00000000-0000-4000-8000-0000000000a1', 'Geimser'),
                                        ('00000000-0000-4000-8000-0000000000a2', 'Otra empresa');
insert into public.teams values ('00000000-0000-4000-8000-0000000000b1', 'Equifax Outbound'),
                                ('00000000-0000-4000-8000-0000000000b2', 'Otro equipo');
insert into public.profiles (id, full_name, role, team_id, organization_id) values
  ('00000000-0000-4000-8000-0000000000c1', 'Admin', 'admin', null, '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000c2', 'Supervisora', 'supervisor', null, '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000c3', 'Ejecutiva', 'agente', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000c4', 'Supervisor ajeno', 'supervisor', null, '00000000-0000-4000-8000-0000000000a1');
insert into public.supervisor_teams values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b1'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000b2');
insert into public.campaigns (id, name, organization_id) values
  ('00000000-0000-4000-8000-0000000000d1', 'Equifax', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000d2', 'Equifax hoy', '00000000-0000-4000-8000-0000000000a1');
insert into public.campaign_agents values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3');
insert into public.dialer_campaign_configs values
  ('00000000-0000-4000-8000-0000000000d2', 'equifax_outbound', 'outbound', true);
insert into public.leads (id, full_name, organization_id, team_id, campaign_id) values
  ('00000000-0000-4000-8000-0000000000e1', 'Empresa uno', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1'),
  ('00000000-0000-4000-8000-0000000000e2', 'Empresa dos', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1'),
  ('00000000-0000-4000-8000-0000000000e3', 'Empresa tres', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1'),
  ('00000000-0000-4000-8000-0000000000e4', 'Empresa cuatro', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1'),
  ('00000000-0000-4000-8000-0000000000e5', 'Empresa de hoy', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d2');

-- 1. Nativa de 90 s que termina a las 22:30 de Chile del 10-09 (01:30 UTC del 11).
insert into public.calls (id, lead_id, agent_id, status, outcome, reason, started_at, ended_at) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000c3',
   'connected', 'sale', 'VENTA CERRADA', '2026-09-10 22:28:30-03', '2026-09-10 22:30:00-03');
-- 2. Migrada de Atlas 1 que quedó abierta tres días: no entra al TMO, y «NO
--    SUJETO A VENTA» no es una venta.
insert into public.calls (id, lead_id, agent_id, status, outcome, reason, started_at, ended_at, legacy_call_id) values
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000c3',
   'connected', 'not_interested', 'CLIENTE NO SUJETO A VENTA', '2026-09-07 10:00-03', '2026-09-10 10:00-03', 'A1-1');
-- 3. Migrada abierta sin tipificar: descartada, con su interacción «connected».
insert into public.calls (id, lead_id, agent_id, status, started_at, ended_at, legacy_call_id, discarded_reason) values
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000c3',
   'connected', '2026-09-10 11:59-03', '2026-09-10 12:00-03', 'A1-2', 'Llamada abierta sin tipificar en Atlas 1 (migración)');
-- 4. Cotización de Atlas 1 escrita a mano.
insert into public.calls (id, lead_id, agent_id, status, outcome, reason, started_at, ended_at, legacy_call_id) values
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000c3',
   'connected', 'callback', 'cotización enviada', '2026-09-10 15:00-03', '2026-09-10 15:05-03', 'A1-3');

insert into public.interactions (lead_id, agent_id, result, metadata, created_at) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000c3', 'connected',
   '{"call_id": "00000000-0000-4000-8000-0000000000f1"}', '2026-09-10 22:30:00-03'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000c3', 'CLIENTE NO SUJETO A VENTA',
   '{"call_id": "00000000-0000-4000-8000-0000000000f2"}', '2026-09-10 10:00-03'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000c3', 'connected',
   '{"call_id": "00000000-0000-4000-8000-0000000000f3"}', '2026-09-10 12:00-03'),
  -- Gestión CRM sin llamada: cuenta como gestión y aporta su tipificación.
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000c3', 'VOLVER A LLAMAR',
   '{}', '2026-09-10 16:00-03');

-- Campaña del discador con llamadas cerradas hoy: una nativa vendida, una
-- nativa sin respuesta, una migrada y una descartada.
insert into public.calls (lead_id, agent_id, status, outcome, reason, started_at, ended_at, legacy_call_id, discarded_reason) values
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000c3', 'connected', 'sale', 'VENTA CERRADA', now() - interval '2 minutes', now(), null, null),
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000c3', 'no_answer', 'other', 'NO CONECTA', now() - interval '2 minutes', now(), null, null),
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000c3', 'connected', 'sale', 'VENTA EN VALIDACION', now() - interval '2 minutes', now(), 'A1-9', null),
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000c3', 'connected', null, null, now() - interval '2 minutes', now(), 'A1-10', 'Llamada abierta sin tipificar en Atlas 1 (migración)');

create function public.assert_test(p_ok boolean, p_message text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FALLA: %', p_message;
  end if;
  raise notice 'ok: %', p_message;
end
$$;
