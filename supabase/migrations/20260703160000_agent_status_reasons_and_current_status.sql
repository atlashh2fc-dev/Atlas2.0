-- Motivos de pausa/disponibilidad configurables por admin (Disponible, Auxiliar,
-- Baño, Capacitación, etc.). "is_pause=false" identifica el estado base
-- "disponible" (no debe pausar al agente en la cola); cualquier otro motivo
-- con is_pause=true sí lo pausa via AMI QueuePause desde el motor de discado.
create table public.agent_status_reasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  is_pause boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_status_reasons enable row level security;

create policy agent_status_reasons_select on public.agent_status_reasons
  for select to authenticated using (true);

create policy agent_status_reasons_admin_insert on public.agent_status_reasons
  for insert with check (current_role_name() = 'admin'::app_role);

create policy agent_status_reasons_admin_update on public.agent_status_reasons
  for update using (current_role_name() = 'admin'::app_role);

create policy agent_status_reasons_admin_delete on public.agent_status_reasons
  for delete using (current_role_name() = 'admin'::app_role);

create trigger agent_status_reasons_set_updated_at
  before update on public.agent_status_reasons
  for each row execute function public.set_updated_at();

insert into public.agent_status_reasons (code, label, is_pause, sort_order) values
  ('disponible', 'Disponible', false, 0),
  ('auxiliar', 'Auxiliar', true, 1),
  ('bano', 'Baño', true, 2),
  ('capacitacion', 'Capacitación', true, 3);

-- Estado actual de cada agente (independiente de campaña): qué motivo tiene
-- seleccionado ahora mismo. El motor lo lee y sincroniza QueuePause en
-- Asterisk para TODAS las colas en las que el agente sea miembro.
create table public.agent_current_status (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  reason_id uuid not null references public.agent_status_reasons(id),
  since timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_current_status enable row level security;

create policy agent_current_status_select on public.agent_current_status
  for select to authenticated using (
    profile_id = (select auth.uid())
    or current_role_name() = any (array['admin'::app_role, 'supervisor'::app_role])
  );

create policy agent_current_status_self_insert on public.agent_current_status
  for insert to authenticated with check (profile_id = (select auth.uid()));

create policy agent_current_status_self_update on public.agent_current_status
  for update to authenticated using (profile_id = (select auth.uid()));

create trigger agent_current_status_set_updated_at
  before update on public.agent_current_status
  for each row execute function public.set_updated_at();
