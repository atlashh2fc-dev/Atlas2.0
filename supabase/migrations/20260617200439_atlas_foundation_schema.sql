
-- ============================================================
-- ATLAS 2.0 - Esquema base: roles, perfiles, equipos, leads, interacciones
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Roles ----------
create type public.app_role as enum ('agente', 'supervisor', 'admin');

-- ---------- Equipos ----------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  supervisor_id uuid, -- fk a profiles, se agrega después de crear profiles
  created_at timestamptz not null default now()
);

-- ---------- Perfiles (extiende auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.app_role not null default 'agente',
  team_id uuid references public.teams(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teams
  add constraint teams_supervisor_fk foreign key (supervisor_id) references public.profiles(id) on delete set null;

-- ---------- Función helper: rol del usuario actual (evita recursión en RLS) ----------
create or replace function public.current_role_name()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

-- ---------- Leads ----------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  rut text,
  phone text,
  full_name text not null,
  email text,
  status text not null default 'nuevo',
  assigned_to uuid references public.profiles(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  extra jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_rut_idx on public.leads (rut);
create index leads_phone_idx on public.leads (phone);
create index leads_assigned_to_idx on public.leads (assigned_to);
create index leads_team_id_idx on public.leads (team_id);

-- ---------- Interacciones / Gestiones ----------
create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete set null,
  result text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index interactions_lead_id_idx on public.interactions (lead_id);
create index interactions_agent_id_idx on public.interactions (agent_id);

-- ---------- updated_at triggers ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger leads_set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

-- ---------- Trigger: crear profile automáticamente al registrar usuario ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'agente')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- RLS
-- ============================================================
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.leads enable row level security;
alter table public.interactions enable row level security;

-- ---- profiles ----
create policy "profiles_select_self" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_select_team_supervisor" on public.profiles
  for select using (public.current_role_name() = 'supervisor' and team_id = public.current_team_id());

create policy "profiles_select_admin" on public.profiles
  for select using (public.current_role_name() = 'admin');

create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid());

create policy "profiles_admin_all" on public.profiles
  for all using (public.current_role_name() = 'admin');

-- ---- teams ----
create policy "teams_select_all_authenticated" on public.teams
  for select using (auth.uid() is not null);

create policy "teams_admin_write" on public.teams
  for all using (public.current_role_name() = 'admin');

-- ---- leads ----
create policy "leads_select_agente" on public.leads
  for select using (public.current_role_name() = 'agente' and assigned_to = auth.uid());

create policy "leads_update_agente" on public.leads
  for update using (public.current_role_name() = 'agente' and assigned_to = auth.uid());

create policy "leads_select_supervisor" on public.leads
  for select using (public.current_role_name() = 'supervisor' and team_id = public.current_team_id());

create policy "leads_update_supervisor" on public.leads
  for update using (public.current_role_name() = 'supervisor' and team_id = public.current_team_id());

create policy "leads_admin_all" on public.leads
  for all using (public.current_role_name() = 'admin');

-- ---- interactions ----
create policy "interactions_select_agente" on public.interactions
  for select using (
    public.current_role_name() = 'agente'
    and lead_id in (select id from public.leads where assigned_to = auth.uid())
  );

create policy "interactions_insert_agente" on public.interactions
  for insert with check (
    public.current_role_name() = 'agente'
    and agent_id = auth.uid()
    and lead_id in (select id from public.leads where assigned_to = auth.uid())
  );

create policy "interactions_select_supervisor" on public.interactions
  for select using (
    public.current_role_name() = 'supervisor'
    and lead_id in (select id from public.leads where team_id = public.current_team_id())
  );

create policy "interactions_admin_all" on public.interactions
  for all using (public.current_role_name() = 'admin');
;
