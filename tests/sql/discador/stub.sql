-- Esquema mínimo de Atlas 2.0 para probar las migraciones del discador
-- (20260924181000-20260924181400) en un Postgres desechable. Replica solo las
-- columnas y funciones que esas migraciones usan, con la misma firma que en
-- producción. Si una migración empieza a usar algo nuevo, agréguelo aquí.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create type public.app_role as enum ('agente', 'supervisor', 'admin');
create table public.organizations (id uuid primary key default gen_random_uuid(), name text, active boolean not null default true);
create table public.profiles (
  id uuid primary key default gen_random_uuid(), role public.app_role not null default 'agente',
  active boolean not null default true, full_name text
);
create table public.organization_members (organization_id uuid, profile_id uuid);
create table public.platform_owners (profile_id uuid);
create table public.campaigns (
  id uuid primary key default gen_random_uuid(), name text, is_active boolean not null default true,
  organization_id uuid references public.organizations(id)
);
-- Alcance de supervisor simplificado (en producción: equipos supervisados).
create table public.stub_supervisor_campaigns (profile_id uuid, campaign_id uuid);
create table public.leads (
  id uuid primary key default gen_random_uuid(), rut text, phone text, full_name text, status text,
  assigned_to uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  tipificacion_actual text, next_action_at timestamptz, workflow_status text default 'pending',
  assignment_status text default 'pending', managed_at timestamptz, managed_by uuid references public.profiles(id),
  campaign_id uuid references public.campaigns(id), external_priority_rank integer, organization_id uuid
);
create table public.calls (
  id uuid primary key default gen_random_uuid(), lead_id uuid references public.leads(id) on delete cascade,
  agent_id uuid references public.profiles(id), status text, outcome text, reason text,
  started_at timestamptz default now(), ended_at timestamptz, discarded_reason text,
  created_at timestamptz default now(), updated_at timestamptz default now(), legacy_call_id text
);
create table public.dialer_campaign_configs (
  campaign_id uuid primary key references public.campaigns(id), max_dial_ratio numeric default 1,
  is_active boolean default true, max_redial_attempts integer not null default 4,
  target_abandonment_rate numeric not null default 6.0, updated_at timestamptz default now()
);
create table public.dialer_agent_sessions (id uuid primary key default gen_random_uuid(), profile_id uuid, campaign_id uuid, status text);
create table public.dial_attempts (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id), call_id uuid, agent_id uuid, phone text not null,
  status text not null default 'queued', originated_at timestamptz, answered_at timestamptz, bridged_at timestamptz,
  ended_at timestamptz, hangup_cause text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), attempt_kind text not null default 'pool',
  provider text not null default 'asterisk'
);
create table public.ai_voice_campaign_configs (
  campaign_id uuid primary key references public.campaigns(id), max_concurrent_calls integer not null default 1,
  max_attempts_per_contact integer not null default 3, is_active boolean not null default true, phone_number_id text
);

create function public.canonical_chile_phone(p_phone text) returns text language sql immutable parallel safe set search_path to '' as $$
  with normalized as (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits)
  select case when digits = '' then null when digits ~ '^56[0-9]{9}$' then digits when length(digits) = 9 then '56' || digits
    when length(digits) = 8 then '562' || digits else digits end from normalized $$;
create unique index dial_attempts_one_active_per_lead_idx on public.dial_attempts (lead_id)
  where status in ('queued', 'originating', 'ringing', 'answered', 'bridged');
create unique index dial_attempts_one_active_per_phone_idx on public.dial_attempts (public.canonical_chile_phone(phone))
  where status in ('queued', 'originating', 'ringing', 'answered', 'bridged') and public.canonical_chile_phone(phone) is not null;

create function public.normalize_management_text(value text) returns text language sql immutable set search_path to 'public' as $$
  select trim(regexp_replace(translate(upper(coalesce(value, '')), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ', 'AAAAEEEEIIIIOOOOUUUUNC'), '[^A-Z0-9]+', ' ', 'g')) $$;
create function public.is_platform_owner() returns boolean language sql stable security definer set search_path to 'pg_catalog', 'public' as $$
  select exists (select 1 from public.platform_owners o where o.profile_id = (select auth.uid())) $$;
create function public.current_org_ids() returns uuid[] language sql stable security definer set search_path to 'pg_catalog', 'public' as $$
  select coalesce(array_agg(organization_id), '{}') from public.organization_members where profile_id = (select auth.uid()) $$;
create function public.current_role_name() returns public.app_role language sql stable security definer set search_path to 'public' as $$
  select role from public.profiles where id = (select auth.uid()) and active $$;
create function public.can_access_org(p_organization_id uuid) returns boolean language sql stable security definer set search_path to 'pg_catalog', 'public' as $$
  select p_organization_id is null or p_organization_id = any (public.current_org_ids()) $$;
create function public.assert_org_access(p_organization_id uuid) returns void language plpgsql stable security definer set search_path to 'pg_catalog', 'public' as $$
begin
  if not public.can_access_org(p_organization_id) then
    raise exception 'El dato pertenece a otra empresa' using errcode = '42501';
  end if;
end $$;
create function public.org_of_campaign(p_campaign_id uuid) returns uuid language sql stable security definer set search_path to 'pg_catalog', 'public' as $$
  select organization_id from public.campaigns where id = p_campaign_id $$;
create function public.get_report_scope_campaigns() returns table(id uuid, name text) language sql stable set search_path to 'public' as $$
  select c.id, c.name from public.campaigns c
  where (select public.current_role_name()) = 'admin'
     or exists (select 1 from public.stub_supervisor_campaigns s where s.campaign_id = c.id and s.profile_id = (select auth.uid())) $$;
create function public.set_updated_at() returns trigger language plpgsql set search_path to 'public' as $$
begin new.updated_at = now(); return new; end $$;
create trigger leads_set_updated_at before update on public.leads for each row execute function public.set_updated_at();

-- Índices de producción que las funciones del discador dan por hechos.
create index dial_attempts_lead_idx on public.dial_attempts (lead_id);
create index dial_attempts_campaign_status_idx on public.dial_attempts (campaign_id, status);
create index leads_campaign_id_idx on public.leads (campaign_id);
create index leads_callback_due_idx on public.leads (campaign_id, next_action_at)
  where workflow_status = 'callback' and next_action_at is not null;
create index calls_lead_id_idx on public.calls (lead_id);
