-- Fundacion del motor de discado (proyecto separado, fuera de Next.js, conectado
-- a Asterisk via AMI). El motor corre como servicio propio y habla con este
-- proyecto usando la service_role key: no depende de sesion web, igual que la
-- integracion de Atlas Lead (ver 20260702200148_fix_atlas_lead_service_role_sync.sql).
--
-- Piezas:
--   - dialer_campaign_configs: parametros de discado por campana (modo, ratio,
--     caller id, contexto de troncal).
--   - dialer_agent_sessions: estado en vivo del agente dentro de la cola de
--     discado (disponible/en llamada/wrap-up), reportado por el motor.
--   - dial_attempts: un registro por intento de marcado (una llamada saliente
--     originada por el motor), independiente de `calls` hasta que se conecta
--     con un agente.
--
-- El motor NUNCA escribe directo en `leads`/`calls`; todo pasa por las RPCs de
-- abajo para mantener el claim transaccional (sin doble marcado) y el mismo
-- rastro de auditoria (`call_events`) que ya usa el resto de Atlas.

create table if not exists public.dialer_campaign_configs (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  dial_mode text not null default 'progressive' check (dial_mode in ('preview', 'progressive', 'predictive')),
  max_dial_ratio numeric not null default 1.2 check (max_dial_ratio > 0),
  caller_id text,
  trunk_context text not null default 'from-dialer-outbound',
  queue_name text not null default 'outbound_default',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dialer_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  extension text not null,
  status text not null default 'offline' check (status in ('offline', 'available', 'ringing', 'on_call', 'wrap_up')),
  last_state_change_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, campaign_id)
);

create table if not exists public.dial_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  call_id uuid references public.calls(id) on delete set null,
  agent_id uuid references public.profiles(id) on delete set null,
  phone text not null,
  status text not null default 'queued' check (
    status in ('queued', 'originating', 'ringing', 'answered', 'bridged', 'no_answer', 'busy', 'failed', 'abandoned', 'voicemail', 'completed')
  ),
  ami_unique_id text,
  ami_channel text,
  originated_at timestamptz,
  answered_at timestamptz,
  bridged_at timestamptz,
  ended_at timestamptz,
  hangup_cause text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dial_attempts_campaign_status_idx on public.dial_attempts (campaign_id, status);
create index if not exists dial_attempts_lead_idx on public.dial_attempts (lead_id);
create index if not exists dial_attempts_agent_idx on public.dial_attempts (agent_id);
create unique index if not exists dial_attempts_ami_unique_id_idx on public.dial_attempts (ami_unique_id) where ami_unique_id is not null;

alter table public.dialer_campaign_configs enable row level security;
alter table public.dialer_agent_sessions enable row level security;
alter table public.dial_attempts enable row level security;

-- Lectura para el resto de Atlas (dashboards, UI de agente). Escritura solo
-- vía RPC security definer / service_role: no hay policy de insert/update.
create policy dialer_campaign_configs_select on public.dialer_campaign_configs
  for select to authenticated using (true);

create policy dialer_agent_sessions_select on public.dialer_agent_sessions
  for select to authenticated using (
    profile_id = (select auth.uid())
    or public.current_role_name() in ('admin', 'supervisor')
  );

create policy dial_attempts_select on public.dial_attempts
  for select to authenticated using (
    agent_id = (select auth.uid())
    or public.current_role_name() in ('admin', 'supervisor')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: claim_next_dial_targets
-- Llamada por el motor (service_role) para obtener hasta `p_batch_size` leads
-- elegibles de la campana y reservarlos con un dial_attempt en 'queued'. Usa
-- `for update skip locked` para que dos ciclos del motor (o dos instancias)
-- nunca reserven el mismo lead dos veces.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.claim_next_dial_targets(
  p_campaign_id uuid,
  p_batch_size int default 1
)
returns table (
  dial_attempt_id uuid,
  lead_id uuid,
  phone text,
  full_name text,
  rut text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  -- Solo service_role (el motor no manda JWT de usuario, así que auth.uid()
  -- viene null); ningún usuario autenticado puede invocar esta RPC.
  if v_actor_id is not null then
    raise exception 'claim_next_dial_targets solo puede ser llamada por el motor de discado.';
  end if;

  return query
  with candidates as (
    select l.id, l.phone, l.full_name, l.rut
    from public.leads l
    where l.campaign_id = p_campaign_id
      and l.phone is not null
      and btrim(l.phone) <> ''
      and (l.next_action_at is null or l.next_action_at <= now())
      and not exists (
        select 1
        from public.dial_attempts da
        where da.lead_id = l.id
          and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
    order by l.external_priority_rank asc nulls last, l.next_action_at asc nulls last, l.updated_at asc
    limit p_batch_size
    for update of l skip locked
  ), inserted as (
    insert into public.dial_attempts (lead_id, campaign_id, phone, status)
    select c.id, p_campaign_id, c.phone, 'queued'
    from candidates c
    returning id, lead_id
  )
  select i.id, i.lead_id, c.phone, c.full_name, c.rut
  from inserted i
  join candidates c on c.id = i.lead_id;
end;
$function$;

revoke all on function public.claim_next_dial_targets(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_next_dial_targets(uuid, int) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: register_dial_event
-- El motor reporta cada transicion de un intento de marcado. Cuando el
-- evento es 'bridged' (agente conectado en vivo), asegura la fila en `calls`
-- reutilizando el mismo modelo que usa la ficha del agente
-- (getOrCreateOpenCall en src/app/actions/calls.ts), para que screen-pop,
-- tipificacion e historial funcionen igual que con Vocalcom.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.register_dial_event(
  p_dial_attempt_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_agent_id uuid default null,
  p_ami_unique_id text default null,
  p_ami_channel text default null,
  p_hangup_cause text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_attempt public.dial_attempts;
  v_call_id uuid;
begin
  if v_actor_id is not null then
    raise exception 'register_dial_event solo puede ser llamada por el motor de discado.';
  end if;

  select * into v_attempt from public.dial_attempts where id = p_dial_attempt_id for update;
  if not found then
    raise exception 'dial_attempt % no existe.', p_dial_attempt_id;
  end if;

  update public.dial_attempts
  set status = p_event_type,
      agent_id = coalesce(p_agent_id, agent_id),
      ami_unique_id = coalesce(p_ami_unique_id, ami_unique_id),
      ami_channel = coalesce(p_ami_channel, ami_channel),
      hangup_cause = coalesce(p_hangup_cause, hangup_cause),
      originated_at = case when p_event_type = 'originating' then now() else originated_at end,
      answered_at = case when p_event_type = 'answered' then now() else answered_at end,
      bridged_at = case when p_event_type = 'bridged' then now() else bridged_at end,
      ended_at = case
        when p_event_type in ('no_answer', 'busy', 'failed', 'abandoned', 'voicemail', 'completed')
        then now()
        else ended_at
      end,
      updated_at = now()
  where id = p_dial_attempt_id;

  if p_event_type = 'bridged' and p_agent_id is not null then
    insert into public.calls (lead_id, agent_id)
    values (v_attempt.lead_id, p_agent_id)
    returning id into v_call_id;

    update public.dial_attempts set call_id = v_call_id where id = p_dial_attempt_id;
  end if;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    coalesce(v_call_id, v_attempt.call_id),
    v_attempt.lead_id,
    coalesce(p_agent_id, v_attempt.agent_id),
    'dialer.' || p_event_type,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('dial_attempt_id', p_dial_attempt_id, 'source', 'asterisk_engine')
  );

  return coalesce(v_call_id, v_attempt.call_id);
end;
$function$;

revoke all on function public.register_dial_event(uuid, text, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.register_dial_event(uuid, text, jsonb, uuid, text, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: update_agent_dialer_status
-- El motor reporta presencia del agente en la cola Asterisk (via
-- QueueMemberStatus/AgentCalled/AgentComplete de AMI).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.update_agent_dialer_status(
  p_profile_id uuid,
  p_campaign_id uuid,
  p_extension text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is not null then
    raise exception 'update_agent_dialer_status solo puede ser llamada por el motor de discado.';
  end if;

  if p_status not in ('offline', 'available', 'ringing', 'on_call', 'wrap_up') then
    raise exception 'status % invalido.', p_status;
  end if;

  insert into public.dialer_agent_sessions (profile_id, campaign_id, extension, status, last_state_change_at)
  values (p_profile_id, p_campaign_id, p_extension, p_status, now())
  on conflict (profile_id, campaign_id) do update
  set extension = excluded.extension,
      status = excluded.status,
      last_state_change_at = case
        when public.dialer_agent_sessions.status <> excluded.status
        then now()
        else public.dialer_agent_sessions.last_state_change_at
      end,
      updated_at = now();
end;
$function$;

revoke all on function public.update_agent_dialer_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_agent_dialer_status(uuid, uuid, text, text) to service_role;
