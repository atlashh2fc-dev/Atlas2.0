-- Cierre remoto integral de una sesión de ejecutivo.
-- La cuenta, sus campañas y su extensión permanecen activas: sólo se revocan
-- las sesiones que existen al momento de la orden. Un login posterior crea
-- un session_id nuevo y funciona normalmente.

create table public.revoked_app_sessions (
  session_id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  revoked_by uuid references public.profiles(id) on delete set null,
  command_id uuid,
  revoked_at timestamptz not null default now()
);

create index revoked_app_sessions_profile_idx
  on public.revoked_app_sessions (profile_id, revoked_at desc);

alter table public.revoked_app_sessions enable row level security;
revoke all on table public.revoked_app_sessions from anon, authenticated;

create table public.agent_control_commands (
  id uuid primary key default gen_random_uuid(),
  target_profile_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  command text not null default 'force_logout' check (command = 'force_logout'),
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  previous_reason_code text,
  previous_phone_status text,
  disconnected_in_schedule boolean not null default false,
  scheduled_campaign_ids uuid[] not null default '{}',
  browser_acknowledged_at timestamptz,
  claimed_at timestamptz,
  claimed_by text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  pbx_completed_at timestamptz,
  pbx_result jsonb not null default '{}',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.revoked_app_sessions
  add constraint revoked_app_sessions_command_fk
  foreign key (command_id) references public.agent_control_commands(id) on delete set null;

create index agent_control_commands_target_idx
  on public.agent_control_commands (target_profile_id, created_at desc);
create index agent_control_commands_pending_idx
  on public.agent_control_commands (next_attempt_at, created_at)
  where status in ('pending', 'processing');

alter table public.agent_control_commands enable row level security;

-- Debe seguir siendo visible para la sesión objetivo aunque ya esté en la
-- deny-list; de lo contrario Realtime no podría entregarle la orden de salir.
create policy agent_control_commands_target_select
  on public.agent_control_commands for select to authenticated
  using (target_profile_id = (select auth.uid()));

create policy agent_control_commands_admin_select
  on public.agent_control_commands for select to authenticated
  using (public.current_role_name() = 'admin'::public.app_role);

revoke insert, update, delete on public.agent_control_commands from anon, authenticated;

alter publication supabase_realtime add table public.agent_control_commands;

create or replace function public.is_current_app_session_valid()
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt() ->> 'session_id';
  v_session_id uuid;
begin
  if auth.role() = 'service_role' then return true; end if;
  if v_user_id is null or v_session_text is null then return false; end if;
  begin
    v_session_id := v_session_text::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
    select 1 from auth.sessions s
    where s.id = v_session_id and s.user_id = v_user_id
  ) and not exists (
    select 1 from public.revoked_app_sessions r
    where r.session_id = v_session_id and r.profile_id = v_user_id
  );
end;
$function$;

revoke all on function public.is_current_app_session_valid() from public, anon;
grant execute on function public.is_current_app_session_valid() to authenticated, service_role;

-- Centraliza el corte también para las políticas existentes que consultan el
-- rol. Una sesión revocada deja de tener rol dentro de Atlas, aunque su JWT
-- stateless todavía no haya expirado.
create or replace function public.current_role_name()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $function$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and public.is_current_app_session_valid();
$function$;

create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select p.team_id
  from public.profiles p
  where p.id = (select auth.uid())
    and public.is_current_app_session_valid();
$function$;

drop policy if exists agent_current_status_self_insert on public.agent_current_status;
create policy agent_current_status_self_insert on public.agent_current_status
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and public.is_current_app_session_valid()
  );

drop policy if exists agent_current_status_self_update on public.agent_current_status;
create policy agent_current_status_self_update on public.agent_current_status
  for update to authenticated
  using (
    profile_id = (select auth.uid())
    and public.is_current_app_session_valid()
  )
  with check (
    profile_id = (select auth.uid())
    and public.is_current_app_session_valid()
  );

create or replace function public.force_agent_logout(
  p_target_profile_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_reason_id uuid;
  v_now timestamptz := clock_timestamp();
  v_previous_reason text;
  v_previous_phone text;
  v_campaign_ids uuid[] := '{}';
begin
  if public.current_role_name() is distinct from 'admin'::public.app_role then
    raise exception 'Solo un administrador puede cerrar sesiones de ejecutivos.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_target_profile_id::text, 0));

  select * into v_target
  from public.profiles
  where id = p_target_profile_id
  for update;

  if not found or v_target.role <> 'agente'::public.app_role then
    raise exception 'El ejecutivo no existe.';
  end if;

  select c.id into v_command_id
  from public.agent_control_commands c
  where c.target_profile_id = p_target_profile_id
    and c.status in ('pending', 'processing')
  order by c.created_at desc
  limit 1;
  if found then return v_command_id; end if;
  v_command_id := gen_random_uuid();

  select r.id into v_reason_id
  from public.agent_status_reasons r
  where r.code = 'desconectado';
  if v_reason_id is null then
    raise exception 'Falta el estado de sistema Desconectado.';
  end if;

  select r.code into v_previous_reason
  from public.agent_current_status s
  join public.agent_status_reasons r on r.id = s.reason_id
  where s.profile_id = p_target_profile_id;

  select s.status into v_previous_phone
  from public.dialer_agent_sessions s
  where s.profile_id = p_target_profile_id
  order by s.updated_at desc
  limit 1;

  -- Sólo horarios explícitos definen jornada laboral. Una membresía legacy
  -- "siempre activa" sirve al motor, pero no se convierte en jornada 24/7.
  select coalesce(array_agg(distinct ca.campaign_id), '{}') into v_campaign_ids
  from public.campaign_agents ca
  join public.campaign_agent_schedules sch on sch.campaign_agent_id = ca.id
  join public.campaigns camp on camp.id = ca.campaign_id and camp.is_active
  cross join lateral (
    select v_now at time zone sch.timezone as local_now
  ) local_time
  where ca.profile_id = p_target_profile_id
    and extract(dow from local_time.local_now)::smallint = any(sch.days_of_week)
    and local_time.local_now::time >= sch.start_time
    and local_time.local_now::time < sch.end_time;

  insert into public.agent_control_commands (
    id, target_profile_id, requested_by, reason,
    previous_reason_code, previous_phone_status,
    disconnected_in_schedule, scheduled_campaign_ids, created_at, updated_at
  ) values (
    v_command_id, p_target_profile_id, v_actor_id, nullif(btrim(p_reason), ''),
    v_previous_reason, v_previous_phone,
    cardinality(v_campaign_ids) > 0, v_campaign_ids, v_now, v_now
  );

  -- Deny-list exacta de las sesiones actuales. Los logins posteriores tienen
  -- otro session_id y no quedan bloqueados.
  insert into public.revoked_app_sessions (
    session_id, profile_id, revoked_by, command_id, revoked_at
  )
  select s.id, p_target_profile_id, v_actor_id, v_command_id, v_now
  from auth.sessions s
  where s.user_id = p_target_profile_id
  on conflict (session_id) do nothing;

  -- La clave nueva invalida futuros REGISTER con credenciales ya copiadas.
  -- El motor la sincroniza a PJSIP antes de confirmar el comando.
  update public.agent_sip_credentials
  set sip_password = encode(gen_random_bytes(24), 'hex'), updated_at = v_now
  where profile_id = p_target_profile_id and is_active;

  update public.agent_current_status
  set reason_id = v_reason_id, since = v_now, last_heartbeat_at = null
  where profile_id = p_target_profile_id
    and reason_id is distinct from v_reason_id;
  if not found and not exists (
    select 1 from public.agent_current_status where profile_id = p_target_profile_id
  ) then
    insert into public.agent_current_status (profile_id, reason_id, since, last_heartbeat_at)
    values (p_target_profile_id, v_reason_id, v_now, null);
  end if;

  update public.dialer_agent_sessions
  set status = 'offline', last_state_change_at = v_now, updated_at = v_now
  where profile_id = p_target_profile_id and status <> 'offline';

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  select c.id, c.lead_id, c.agent_id, 'call.agent_force_logout',
    jsonb_build_object(
      'command_id', v_command_id,
      'requested_by', v_actor_id,
      'reason', nullif(btrim(p_reason), ''),
      'source', 'admin_monitor'
    )
  from public.calls c
  where c.agent_id = p_target_profile_id and c.ended_at is null;

  insert into public.sensitive_access_log (
    actor_id, action, target_profile_id, metadata
  ) values (
    v_actor_id,
    'agent.force_logout',
    p_target_profile_id,
    jsonb_build_object(
      'command_id', v_command_id,
      'reason', nullif(btrim(p_reason), ''),
      'previous_reason_code', v_previous_reason,
      'previous_phone_status', v_previous_phone,
      'disconnected_in_schedule', cardinality(v_campaign_ids) > 0,
      'scheduled_campaign_ids', v_campaign_ids
    )
  );

  return v_command_id;
end;
$function$;

revoke all on function public.force_agent_logout(uuid, text) from public, anon;
grant execute on function public.force_agent_logout(uuid, text) to authenticated;

create or replace function public.acknowledge_agent_control_command(p_command_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.agent_control_commands
  set browser_acknowledged_at = coalesce(browser_acknowledged_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where id = p_command_id and target_profile_id = auth.uid();
  if not found then raise exception 'La orden no pertenece a esta sesión.'; end if;
end;
$function$;

revoke all on function public.acknowledge_agent_control_command(uuid) from public, anon;
grant execute on function public.acknowledge_agent_control_command(uuid) to authenticated;

create or replace function public.claim_agent_control_commands(
  p_worker_id text,
  p_limit integer default 5
)
returns table (
  command_id uuid,
  profile_id uuid,
  extension text,
  sip_password text,
  previous_phone_status text,
  reason text
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is not null then
    raise exception 'Sólo el motor puede reclamar órdenes de control.';
  end if;

  return query
  with candidates as (
    select c.id
    from public.agent_control_commands c
    where (
      c.status = 'pending'
      or (c.status = 'processing' and c.claimed_at < now() - interval '30 seconds')
    )
      and c.next_attempt_at <= now()
      and c.attempts < 5
    order by c.created_at
    limit greatest(coalesce(p_limit, 5), 0)
    for update skip locked
  ), claimed as (
    update public.agent_control_commands c
    set status = 'processing', claimed_at = clock_timestamp(), claimed_by = p_worker_id,
        attempts = c.attempts + 1, updated_at = clock_timestamp()
    from candidates x
    where c.id = x.id
    returning c.*
  )
  select c.id, c.target_profile_id, cred.extension, cred.sip_password,
         c.previous_phone_status, c.reason
  from claimed c
  join public.agent_sip_credentials cred
    on cred.profile_id = c.target_profile_id and cred.is_active;
end;
$function$;

revoke all on function public.claim_agent_control_commands(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_agent_control_commands(text, integer) to service_role;

create or replace function public.complete_agent_control_command(
  p_command_id uuid,
  p_success boolean,
  p_result jsonb default '{}',
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is not null then
    raise exception 'Sólo el motor puede completar órdenes de control.';
  end if;

  update public.agent_control_commands c
  set status = case
        when p_success then 'completed'
        when c.attempts >= 5 then 'failed'
        else 'pending'
      end,
      pbx_completed_at = case when p_success then clock_timestamp() else c.pbx_completed_at end,
      pbx_result = coalesce(p_result, '{}'),
      last_error = case when p_success then null else left(coalesce(p_error, 'Error PBX'), 2000) end,
      next_attempt_at = case when p_success then c.next_attempt_at else clock_timestamp() + interval '2 seconds' end,
      updated_at = clock_timestamp()
  where c.id = p_command_id and c.status = 'processing';
  if not found then raise exception 'La orden ya no está en procesamiento.'; end if;
end;
$function$;

revoke all on function public.complete_agent_control_command(uuid, boolean, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_agent_control_command(uuid, boolean, jsonb, text)
  to service_role;

-- Una sesión desconectada es una guarda autoritativa. Eventos AMI tardíos no
-- pueden reabrirla; el próximo login la cambia a Disponible sólo después de
-- micrófono + REGISTER exitosos.
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
begin
  if auth.uid() is not null then
    raise exception 'update_agent_dialer_status solo puede ser llamada por el motor de discado.';
  end if;
  if p_status not in ('offline', 'available', 'ringing', 'on_call', 'wrap_up', 'paused') then
    raise exception 'status % invalido.', p_status;
  end if;
  if p_status <> 'offline' and exists (
    select 1
    from public.agent_current_status s
    join public.agent_status_reasons r on r.id = s.reason_id
    where s.profile_id = p_profile_id and r.code = 'desconectado'
  ) then
    return;
  end if;

  insert into public.dialer_agent_sessions (
    profile_id, campaign_id, extension, status, last_state_change_at
  ) values (p_profile_id, p_campaign_id, p_extension, p_status, now())
  on conflict (profile_id, campaign_id) do update
  set extension = excluded.extension,
      status = excluded.status,
      last_state_change_at = case
        when public.dialer_agent_sessions.status <> excluded.status then now()
        else public.dialer_agent_sessions.last_state_change_at
      end,
      updated_at = now();
end;
$function$;

-- El monitor expone el estado durable de la orden sin revelar credenciales.
drop function if exists public.get_agent_live_status();
create function public.get_agent_live_status()
returns table (
  profile_id uuid,
  full_name text,
  email text,
  extension text,
  campaign_id uuid,
  campaign_name text,
  phone_status text,
  phone_status_since timestamptz,
  reason_id uuid,
  reason_code text,
  reason_label text,
  is_pause boolean,
  reason_since timestamptz,
  control_command_id uuid,
  control_status text,
  control_requested_at timestamptz,
  control_browser_acknowledged_at timestamptz,
  control_pbx_completed_at timestamptz,
  control_last_error text
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(public.current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'get_agent_live_status solo puede ser llamada por admin o supervisor.';
  end if;

  return query
  select p.id, p.full_name, p.email, cred.extension,
         phone.campaign_id, camp.name, coalesce(phone.status, 'offline'),
         phone.last_state_change_at, reason.id, reason.code, reason.label,
         coalesce(reason.is_pause, false), current_status.since,
         command.id, command.status, command.created_at,
         command.browser_acknowledged_at, command.pbx_completed_at, command.last_error
  from public.profiles p
  join public.agent_sip_credentials cred
    on cred.profile_id = p.id and cred.is_active
  left join lateral (
    select session.*
    from public.dialer_agent_sessions session
    join public.campaigns active_campaign
      on active_campaign.id = session.campaign_id and active_campaign.is_active
    where session.profile_id = p.id
    order by session.updated_at desc
    limit 1
  ) phone on true
  left join public.campaigns camp on camp.id = phone.campaign_id
  left join public.agent_current_status current_status on current_status.profile_id = p.id
  left join public.agent_status_reasons reason on reason.id = current_status.reason_id
  left join lateral (
    select control.*
    from public.agent_control_commands control
    where control.target_profile_id = p.id
    order by control.created_at desc
    limit 1
  ) command on true
  where p.role = 'agente' and p.active
  order by p.full_name;
end;
$function$;

revoke all on function public.get_agent_live_status() from public, anon;
grant execute on function public.get_agent_live_status() to authenticated;

-- Un agente desconectado ni siquiera se mantiene como miembro deseado de las
-- colas. Esto también hace fail-closed a una estación nueva hasta que publique
-- su primer estado tras REGISTER.
create or replace function public.get_active_campaign_agent_extensions(p_campaign_id uuid)
returns table (extension text)
language sql
stable
security definer
set search_path = public
as $function$
  select distinct credentials.extension
  from public.campaign_agents membership
  join public.profiles profile
    on profile.id = membership.profile_id
    and profile.active and profile.role = 'agente'::public.app_role
  join public.agent_sip_credentials credentials
    on credentials.profile_id = membership.profile_id and credentials.is_active
  join public.agent_current_status current_status
    on current_status.profile_id = membership.profile_id
  join public.agent_status_reasons reason on reason.id = current_status.reason_id
  where membership.campaign_id = p_campaign_id
    and reason.code <> 'desconectado'
    and (
      (
        not exists (
          select 1 from public.campaign_agent_schedules schedule
          where schedule.campaign_agent_id = membership.id
        )
        and membership.schedule_required = false
      )
      or exists (
        select 1
        from public.campaign_agent_schedules schedule
        cross join lateral (
          select now() at time zone schedule.timezone as local_now
        ) local_time
        where schedule.campaign_agent_id = membership.id
          and extract(dow from local_time.local_now)::smallint = any(schedule.days_of_week)
          and local_time.local_now::time >= schedule.start_time
          and local_time.local_now::time < schedule.end_time
      )
    );
$function$;

revoke all on function public.get_active_campaign_agent_extensions(uuid)
  from public, anon, authenticated;
grant execute on function public.get_active_campaign_agent_extensions(uuid) to service_role;

-- Ninguna carrera entre claim/originate y el cierre puede asignar un intento
-- nuevo a un agente cuyo estado autoritativo ya es Desconectado.
create or replace function public.reject_dial_attempt_for_disconnected_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.agent_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.agent_id is not distinct from old.agent_id then return new; end if;
  if exists (
      select 1
      from public.agent_current_status s
      join public.agent_status_reasons r on r.id = s.reason_id
      where s.profile_id = new.agent_id and r.code = 'desconectado'
    ) then
    raise exception 'El ejecutivo está desconectado; no se puede asignar el intento.';
  end if;
  return new;
end;
$function$;

drop trigger if exists dial_attempts_reject_disconnected_agent on public.dial_attempts;
create trigger dial_attempts_reject_disconnected_agent
  before insert or update of agent_id on public.dial_attempts
  for each row execute function public.reject_dial_attempt_for_disconnected_agent();

-- Reporte de jornada real: Disponible/AUX/Desconectado se recortan contra los
-- horarios explícitos. Fuera de jornada no suman. Desconectado se informa en
-- su propia columna y nunca se mezcla con pausas ni productividad.
drop function if exists public.get_agent_activity_report(date, date, uuid);
create function public.get_agent_activity_report(
  p_date_from date,
  p_date_to date,
  p_campaign_id uuid default null
)
returns table(
  profile_id uuid,
  full_name text,
  calls_handled integer,
  talk_seconds numeric,
  avg_handle_seconds numeric,
  logged_in_seconds numeric,
  productive_seconds numeric,
  occupancy_rate numeric,
  scheduled_seconds numeric,
  available_seconds numeric,
  paused_seconds numeric,
  disconnected_seconds numeric,
  adherence_rate numeric
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_from timestamptz := p_date_from;
  v_to timestamptz := p_date_to + 1;
  v_scoped boolean := p_campaign_id is not null;
begin
  if coalesce(public.current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'get_agent_activity_report solo puede ser llamada por admin o supervisor.';
  end if;

  return query
  with phone_segments as (
    select h.profile_id as pid, h.status, h.started_at, h.ended_at
    from public.dialer_agent_sessions_history h
    where h.started_at < v_to and h.ended_at > v_from
    union all
    select s.profile_id, s.status, s.last_state_change_at, now()
    from public.dialer_agent_sessions s
    where s.last_state_change_at < v_to and now() > v_from
  ),
  phone_overlap as (
    select ps.pid, ps.status,
      extract(epoch from (least(ps.ended_at, v_to) - greatest(ps.started_at, v_from))) as seconds
    from phone_segments ps
    where least(ps.ended_at, v_to) > greatest(ps.started_at, v_from)
  ),
  phone_agg as (
    select po.pid,
      sum(po.seconds) filter (where po.status <> 'offline') as logged,
      sum(po.seconds) filter (where po.status in ('on_call', 'wrap_up')) as productive
    from phone_overlap po
    group by po.pid
  ),
  schedule_windows as (
    select ca.profile_id as pid,
      ((day_value.day::date + sch.start_time) at time zone sch.timezone) as starts_at,
      ((day_value.day::date + sch.end_time) at time zone sch.timezone) as ends_at
    from public.campaign_agent_schedules sch
    join public.campaign_agents ca on ca.id = sch.campaign_agent_id
    cross join lateral generate_series(
      p_date_from::timestamp,
      p_date_to::timestamp,
      interval '1 day'
    ) day_value(day)
    where extract(dow from day_value.day)::smallint = any(sch.days_of_week)
  ),
  clipped_schedules as (
    select sw.pid, greatest(sw.starts_at, v_from) as starts_at,
      least(sw.ends_at, v_to) as ends_at
    from schedule_windows sw
    where least(sw.ends_at, v_to) > greatest(sw.starts_at, v_from)
  ),
  schedule_agg as (
    select cs.pid, sum(extract(epoch from (cs.ends_at - cs.starts_at))) as scheduled
    from clipped_schedules cs
    group by cs.pid
  ),
  reason_segments as (
    select h.profile_id as pid, r.code, r.is_pause, h.since as starts_at, h.until as ends_at
    from public.agent_current_status_history h
    join public.agent_status_reasons r on r.id = h.reason_id
    where h.since < v_to and h.until > v_from
    union all
    select s.profile_id, r.code, r.is_pause, s.since, now()
    from public.agent_current_status s
    join public.agent_status_reasons r on r.id = s.reason_id
    where s.since < v_to and now() > v_from
  ),
  reason_in_schedule as (
    select rs.pid, rs.code, rs.is_pause,
      extract(epoch from (
        least(rs.ends_at, cs.ends_at) - greatest(rs.starts_at, cs.starts_at)
      )) as seconds
    from reason_segments rs
    join clipped_schedules cs on cs.pid = rs.pid
    where least(rs.ends_at, cs.ends_at) > greatest(rs.starts_at, cs.starts_at)
  ),
  reason_agg as (
    select ris.pid,
      sum(ris.seconds) filter (where ris.code <> 'desconectado' and not ris.is_pause) as available,
      sum(ris.seconds) filter (where ris.code <> 'desconectado' and ris.is_pause) as paused,
      sum(ris.seconds) filter (where ris.code = 'desconectado') as disconnected
    from reason_in_schedule ris
    group by ris.pid
  ),
  calls_agg as (
    select da.agent_id as pid,
      count(*) filter (where da.status = 'completed') as calls_handled,
      sum(extract(epoch from (da.ended_at - da.bridged_at)))
        filter (where da.bridged_at is not null and da.ended_at is not null) as talk
    from public.dial_attempts da
    where da.agent_id is not null
      and da.originated_at >= v_from and da.originated_at < v_to
      and (p_campaign_id is null or da.campaign_id = p_campaign_id)
    group by da.agent_id
  )
  select p.id, p.full_name,
    coalesce(ca.calls_handled, 0)::integer,
    round(coalesce(ca.talk, 0), 1),
    round(coalesce(ca.talk, 0) / nullif(ca.calls_handled, 0), 1),
    case when v_scoped then null else round(coalesce(pa.logged, 0), 1) end,
    case when v_scoped then null else round(coalesce(pa.productive, 0), 1) end,
    case when v_scoped then null else round(100.0 * coalesce(pa.productive, 0) / nullif(pa.logged, 0), 1) end,
    case when v_scoped or sa.pid is null then null else round(sa.scheduled, 1) end,
    case when v_scoped or sa.pid is null then null else round(coalesce(ra.available, 0), 1) end,
    case when v_scoped or sa.pid is null then null else round(coalesce(ra.paused, 0), 1) end,
    case when v_scoped or sa.pid is null then null else round(coalesce(ra.disconnected, 0), 1) end,
    case when v_scoped or sa.pid is null then null else round(100.0 * coalesce(ra.available, 0) / nullif(sa.scheduled, 0), 1) end
  from public.profiles p
  left join phone_agg pa on pa.pid = p.id
  left join schedule_agg sa on sa.pid = p.id
  left join reason_agg ra on ra.pid = p.id
  left join calls_agg ca on ca.pid = p.id
  where p.role = 'agente'
    and (
      case when v_scoped then ca.pid is not null
      else (pa.pid is not null or sa.pid is not null or ra.pid is not null or ca.pid is not null)
      end
    )
  order by p.full_name;
end;
$function$;

revoke all on function public.get_agent_activity_report(date, date, uuid)
  from public, anon;
grant execute on function public.get_agent_activity_report(date, date, uuid)
  to authenticated;

comment on function public.get_agent_activity_report(date, date, uuid) is
  'Actividad por ejecutivo. Estados sólo dentro de horarios explícitos; desconexión se informa separada y fuera de jornada no suma.';
