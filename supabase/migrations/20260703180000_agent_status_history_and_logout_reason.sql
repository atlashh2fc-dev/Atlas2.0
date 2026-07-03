-- Historial append-only de motivos de pausa (Disponible/Auxiliar/Baño/
-- Capacitación). agent_current_status solo guarda el estado ACTUAL (1 fila
-- por agente); acá queda el rastro de cada segmento pasado para poder medir
-- adherencia/tiempo en pausa en un rango de fechas. El segmento "abierto"
-- (todavía en curso) NO vive acá — se representa como la fila viva de
-- agent_current_status con until=NULL al momento de reportar.
create table public.agent_current_status_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reason_id uuid not null references public.agent_status_reasons(id),
  since timestamptz not null,
  until timestamptz not null,
  created_at timestamptz not null default now()
);

create index agent_current_status_history_profile_idx
  on public.agent_current_status_history (profile_id, since);

alter table public.agent_current_status_history enable row level security;

create policy agent_current_status_history_select on public.agent_current_status_history
  for select to authenticated using (
    profile_id = (select auth.uid())
    or current_role_name() = any (array['admin'::app_role, 'supervisor'::app_role])
  );

-- Al cambiar de motivo, cierra el segmento anterior en el historial antes de
-- sobreescribir la fila viva. Transparente para el CRM: setMyCurrentStatus
-- sigue haciendo un upsert normal, este trigger es el que arma el rastro.
create or replace function public.log_agent_current_status_change()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if old.reason_id is distinct from new.reason_id then
    insert into public.agent_current_status_history (profile_id, reason_id, since, until)
    values (old.profile_id, old.reason_id, old.since, now());
  end if;
  return new;
end;
$$;

create trigger agent_current_status_log_change
  before update on public.agent_current_status
  for each row execute function public.log_agent_current_status_change();

-- Mismo patrón para el estado telefónico (disponible/timbrando/en_llamada/
-- wrap_up) que ya mantiene el motor en dialer_agent_sessions.
create table public.dialer_agent_sessions_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  extension text not null,
  status text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index dialer_agent_sessions_history_profile_idx
  on public.dialer_agent_sessions_history (profile_id, started_at);

alter table public.dialer_agent_sessions_history enable row level security;

create policy dialer_agent_sessions_history_select on public.dialer_agent_sessions_history
  for select to authenticated using (
    profile_id = (select auth.uid())
    or current_role_name() = any (array['admin'::app_role, 'supervisor'::app_role])
  );

create or replace function public.log_dialer_agent_session_change()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if old.status is distinct from new.status then
    insert into public.dialer_agent_sessions_history (profile_id, campaign_id, extension, status, started_at, ended_at)
    values (old.profile_id, old.campaign_id, old.extension, old.status, old.last_state_change_at, now());
  end if;
  return new;
end;
$$;

create trigger dialer_agent_sessions_log_change
  before update on public.dialer_agent_sessions
  for each row execute function public.log_dialer_agent_session_change();

-- Motivo especial, no seleccionable manualmente por el agente (is_system),
-- que se fuerza automáticamente al cerrar sesión desde el CRM. Sin esto, un
-- agente que cierra sesión (o vuelve a entrar como otro rol) queda mostrado
-- como "Disponible" indefinidamente en el monitor en vivo y el motor sigue
-- creyendo que puede recibir llamadas — riesgo real detectado en producción.
alter table public.agent_status_reasons
  add column if not exists is_system boolean not null default false;

insert into public.agent_status_reasons (code, label, is_pause, sort_order, is_system)
values ('desconectado', 'Desconectado', true, 99, true)
on conflict (code) do nothing;
