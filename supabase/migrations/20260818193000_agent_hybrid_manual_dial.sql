-- Modo hibrido seguro. El permiso vive en la membresia de la misma campana:
-- no se crean campanas, gestiones ni colas paralelas.
-- La PBX confirma QueuePause y ausencia de canales mediante un worker durable
-- antes de que Atlas permita originar la llamada manual.

alter table public.campaign_agents
  add column if not exists manual_dial_enabled boolean not null default false;

insert into public.agent_status_reasons (
  code, label, is_pause, sort_order, is_active, is_system,
  is_productive, excludes_from_adherence
)
values ('llamada_manual', 'Llamada manual', true, 85, true, true, true, false)
on conflict (code) do update
set label = excluded.label,
    is_pause = excluded.is_pause,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    is_system = excluded.is_system,
    is_productive = excluded.is_productive,
    excludes_from_adherence = excluded.excludes_from_adherence,
    updated_at = now();

alter table public.dialer_agent_sessions
  drop constraint if exists dialer_agent_sessions_status_check;
alter table public.dialer_agent_sessions
  add constraint dialer_agent_sessions_status_check
  check (status = any (array[
    'offline', 'available', 'ringing', 'on_call', 'wrap_up', 'paused', 'pausing'
  ]));

-- Un eco AMI atrasado nunca puede volver a abrir capacidad mientras el CRM
-- mantiene al ejecutivo en AUX. Esto protege llamada_manual y todos los otros
-- motivos de pausa, incluso si QueueAdd/QueueMemberStatus llegan desordenados.
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
  v_effective_status text := p_status;
begin
  if auth.uid() is not null then
    raise exception 'update_agent_dialer_status solo puede ser llamada por el motor de discado.';
  end if;
  if p_status not in ('offline', 'available', 'ringing', 'on_call', 'wrap_up', 'paused') then
    raise exception 'status % invalido.', p_status;
  end if;
  if p_status <> 'offline' and exists (
    select 1 from public.agent_current_status current_status
    join public.agent_status_reasons reason on reason.id = current_status.reason_id
    where current_status.profile_id = p_profile_id and reason.code = 'desconectado'
  ) then
    return;
  end if;
  if p_status = 'available' and exists (
    select 1 from public.agent_current_status current_status
    join public.agent_status_reasons reason on reason.id = current_status.reason_id
    where current_status.profile_id = p_profile_id and reason.is_pause
  ) then
    v_effective_status := 'paused';
  end if;

  insert into public.dialer_agent_sessions (
    profile_id, campaign_id, extension, status, last_state_change_at
  ) values (p_profile_id, p_campaign_id, p_extension, v_effective_status, now())
  on conflict (profile_id, campaign_id) do update
  set extension = excluded.extension,
      status = case
        when public.dialer_agent_sessions.status = 'wrap_up'
          and excluded.status in ('available', 'ringing', 'paused')
          then public.dialer_agent_sessions.status
        else excluded.status
      end,
      last_state_change_at = case
        when public.dialer_agent_sessions.status <> (
          case
            when public.dialer_agent_sessions.status = 'wrap_up'
              and excluded.status in ('available', 'ringing', 'paused')
              then public.dialer_agent_sessions.status
            else excluded.status
          end
        ) then now()
        else public.dialer_agent_sessions.last_state_change_at
      end,
      updated_at = now();
end;
$function$;

revoke all on function public.update_agent_dialer_status(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_agent_dialer_status(uuid, uuid, text, text)
  to service_role;

create table public.agent_hybrid_manual_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  extension text not null,
  generation uuid not null default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  ready_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_hybrid_manual_requests_pending_idx
  on public.agent_hybrid_manual_requests (next_attempt_at, created_at)
  where status = 'pending';

alter table public.agent_hybrid_manual_requests enable row level security;
create policy agent_hybrid_manual_requests_select_own
  on public.agent_hybrid_manual_requests for select to authenticated
  using (profile_id = (select auth.uid()));
revoke insert, update, delete on public.agent_hybrid_manual_requests
  from anon, authenticated;

-- Reutiliza la gestion manual madura. La unica excepcion para una campana
-- automatica exige que el flujo hibrido durable ya tenga ACK de la PBX.
do $migration$
declare
  v_definition text;
  v_original text := $original$
  if p_entry_mode = 'before_dial' and v_dial_mode <> 'manual' then
    raise exception 'Esta campaña es automática. Para marcar desde el CTI, configura la campaña en modo Manual.';
  end if;
$original$;
  v_replacement text := $replacement$
  if p_entry_mode = 'before_dial'
     and v_dial_mode <> 'manual'
     and not exists (
       select 1
       from public.agent_hybrid_manual_requests request
       where request.profile_id = v_actor_id
         and request.campaign_id = p_campaign_id
         and request.status = 'ready'
     ) then
    raise exception 'La central telefonica aun no confirma el modo manual seguro.';
  end if;
$replacement$;
begin
  select pg_get_functiondef(
    'public.begin_agent_manual_call_management(uuid,text,text,text)'::regprocedure
  ) into v_definition;
  if position(v_original in v_definition) = 0 then
    raise exception 'No se encontro la validacion esperada de begin_agent_manual_call_management.';
  end if;
  execute replace(v_definition, v_original, v_replacement);
end;
$migration$;

-- Los callbacks personales originan directo al anexo y no pasan por la cola.
-- Comparten un advisory lock por agente con la entrada hibrida: si el callback
-- ya fue reclamado, enter espera y luego ve el dial_attempt; si enter gano,
-- el callback omite a ese agente porque su sesion deja de estar available.
do $migration$
declare
  v_definition text;
  v_original text := $original$
    join public.dialer_agent_sessions s
      on s.profile_id = d.owner_id
     and s.campaign_id = p_campaign_id
     and s.status = 'available'
    where not exists (
$original$;
  v_replacement text := $replacement$
    join public.dialer_agent_sessions s
      on s.profile_id = d.owner_id
     and s.campaign_id = p_campaign_id
     and s.status = 'available'
    where pg_try_advisory_xact_lock(hashtextextended(d.owner_id::text, 48001))
      and not exists (
$replacement$;
begin
  select pg_get_functiondef(
    'public.claim_due_personal_callbacks(uuid,integer)'::regprocedure
  ) into v_definition;
  if position(v_original in v_definition) = 0 then
    raise exception 'No se encontro la seleccion esperada de callbacks personales.';
  end if;
  execute replace(v_definition, v_original, v_replacement);
end;
$migration$;

-- Las transiciones de motivos de sistema no pueden hacerse con un UPDATE
-- directo desde el navegador. Las RPC SECURITY DEFINER de este archivo son
-- las unicas que pueden entrar/salir de llamada_manual o desconectado.
create or replace function public.guard_agent_system_status_transition()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_old_system boolean := false;
  v_new_system boolean := false;
begin
  if tg_op = 'UPDATE' then
    select reason.is_system into v_old_system
    from public.agent_status_reasons reason where reason.id = old.reason_id;
  end if;
  select reason.is_system into v_new_system
  from public.agent_status_reasons reason where reason.id = new.reason_id;

  if auth.uid() is not null
     and current_user in ('authenticated', 'anon')
     and (coalesce(v_old_system, false) or coalesce(v_new_system, false)) then
    raise exception 'Los estados de sistema solo pueden cambiarse mediante el flujo operativo de Atlas.';
  end if;
  return new;
end;
$function$;

drop trigger if exists agent_current_status_guard_system_transition
  on public.agent_current_status;
create trigger agent_current_status_guard_system_transition
  before insert or update of reason_id on public.agent_current_status
  for each row execute function public.guard_agent_system_status_transition();

create or replace function public.set_my_agent_current_status(p_reason_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then raise exception 'Debes iniciar sesion.'; end if;
  if not exists (
    select 1 from public.agent_status_reasons reason
    where reason.id = p_reason_id and reason.is_active and not reason.is_system
  ) then
    raise exception 'El motivo seleccionado no esta disponible.';
  end if;
  if exists (
    select 1
    from public.agent_current_status current_status
    join public.agent_status_reasons reason on reason.id = current_status.reason_id
    where current_status.profile_id = v_actor_id and reason.code = 'llamada_manual'
  ) then
    raise exception 'Finaliza o cancela el modo de llamada manual desde el telefono Atlas.';
  end if;

  insert into public.agent_current_status (profile_id, reason_id, since, last_heartbeat_at)
  values (v_actor_id, p_reason_id, now(), now())
  on conflict (profile_id) do update
    set reason_id = excluded.reason_id,
        since = case
          when public.agent_current_status.reason_id = excluded.reason_id
            then public.agent_current_status.since
          else excluded.since
        end,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = now();
end;
$function$;

create or replace function public.mark_my_agent_logged_out()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_reason_id uuid;
begin
  if v_actor_id is null then return; end if;
  select id into v_reason_id from public.agent_status_reasons
  where code = 'desconectado' and is_active;
  if v_reason_id is null then return; end if;

  insert into public.agent_current_status (profile_id, reason_id, since, last_heartbeat_at)
  values (v_actor_id, v_reason_id, now(), now())
  on conflict (profile_id) do update
    set reason_id = excluded.reason_id,
        since = excluded.since,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = now();
end;
$function$;

create or replace function public.enter_agent_hybrid_manual_mode(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_reason_id uuid;
  v_extension text;
begin
  if v_actor_id is null then
    raise exception 'Debes iniciar sesion para realizar una llamada manual.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor_id::text, 48001));

  perform 1 from public.profiles profile
  where profile.id = v_actor_id and profile.active
    and profile.role = 'agente'::public.app_role
  for update;
  if not found then
    raise exception 'Solo un ejecutivo activo puede realizar una llamada manual.';
  end if;

  if not exists (
    select 1
    from public.campaign_agents membership
    join public.campaigns campaign on campaign.id = membership.campaign_id and campaign.is_active
    join public.dialer_campaign_configs config
      on config.campaign_id = membership.campaign_id
     and config.is_active
    where membership.profile_id = v_actor_id
      and membership.campaign_id = p_campaign_id
      and (config.dial_mode = 'manual' or membership.manual_dial_enabled)
  ) then
    raise exception 'No tienes habilitado el discado manual en esta campana.';
  end if;

  select credentials.extension into v_extension
  from public.agent_sip_credentials credentials
  where credentials.profile_id = v_actor_id and credentials.is_active;
  if v_extension is null then
    raise exception 'Tu extension telefonica no esta activa.';
  end if;

  if exists (
    select 1 from public.profiles profile
    where profile.id = v_actor_id
      and profile.intercall_break_until is not null
      and profile.intercall_break_until > now()
  ) then
    raise exception 'La interrupcion legal sigue en curso. Espera antes de realizar otra llamada.';
  end if;

  if exists (
    select 1 from public.calls call
    where call.agent_id = v_actor_id and call.ended_at is null
      and call.started_at >= now() - interval '12 hours'
  ) or exists (
    select 1 from public.dial_attempts attempt
    where attempt.agent_id = v_actor_id
      and attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
  ) or exists (
    select 1 from public.dialer_agent_sessions session
    where session.profile_id = v_actor_id
      and session.status in ('ringing', 'on_call', 'wrap_up')
  ) then
    raise exception 'Termina la llamada y su tipificacion antes de marcar manualmente.';
  end if;

  select id into v_reason_id from public.agent_status_reasons
  where code = 'llamada_manual' and is_active;
  if v_reason_id is null then
    raise exception 'El modo de llamada manual no esta configurado.';
  end if;

  insert into public.agent_current_status (profile_id, reason_id, since, last_heartbeat_at)
  values (v_actor_id, v_reason_id, now(), now())
  on conflict (profile_id) do update
    set reason_id = excluded.reason_id,
        since = excluded.since,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = now();

  -- Corta capacidad en la misma transaccion. 'pausing' no es un ACK: solo el
  -- worker PBX puede llevar la solicitud durable a ready.
  update public.dialer_agent_sessions session
  set status = 'pausing', last_state_change_at = now(), updated_at = now()
  from public.dialer_campaign_configs config
  where session.profile_id = v_actor_id
    and config.campaign_id = session.campaign_id
    and config.is_active and config.dial_mode <> 'manual'
    and session.status in ('available', 'offline', 'paused', 'pausing');

  insert into public.agent_hybrid_manual_requests (
    profile_id, campaign_id, extension, generation, status, attempts,
    next_attempt_at, claimed_at, claimed_by, ready_at, last_error, created_at, updated_at
  ) values (
    v_actor_id, p_campaign_id, v_extension, gen_random_uuid(), 'pending', 0,
    now(), null, null, null, null, now(), now()
  )
  on conflict (profile_id) do update
    set campaign_id = excluded.campaign_id,
        extension = excluded.extension,
        generation = excluded.generation,
        status = 'pending', attempts = 0, next_attempt_at = now(),
        claimed_at = null, claimed_by = null, ready_at = null,
        last_error = null, created_at = now(), updated_at = now();
end;
$function$;

create or replace function public.exit_agent_hybrid_manual_mode()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_available_reason_id uuid;
begin
  if v_actor_id is null then raise exception 'Debes iniciar sesion.'; end if;
  perform 1 from public.profiles where id = v_actor_id for update;
  perform 1 from public.agent_hybrid_manual_requests
  where profile_id = v_actor_id for update;

  if not exists (
    select 1 from public.agent_current_status current_status
    join public.agent_status_reasons reason on reason.id = current_status.reason_id
    where current_status.profile_id = v_actor_id and reason.code = 'llamada_manual'
  ) then
    delete from public.agent_hybrid_manual_requests where profile_id = v_actor_id;
    return;
  end if;

  if exists (
    select 1 from public.calls call
    where call.agent_id = v_actor_id and call.ended_at is null
      and call.started_at >= now() - interval '12 hours'
  ) or exists (
    select 1 from public.dial_attempts attempt
    where attempt.agent_id = v_actor_id
      and attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
  ) or exists (
    select 1 from public.dialer_agent_sessions session
    where session.profile_id = v_actor_id
      and session.status in ('ringing', 'on_call', 'wrap_up')
  ) then
    raise exception 'Termina la llamada y la tipificacion antes de volver a Disponible.';
  end if;

  select id into v_available_reason_id from public.agent_status_reasons
  where code = 'disponible' and is_active and not is_pause;
  if v_available_reason_id is null then
    raise exception 'El estado Disponible no esta configurado.';
  end if;

  update public.agent_current_status
  set reason_id = v_available_reason_id, since = now(),
      last_heartbeat_at = now(), updated_at = now()
  where profile_id = v_actor_id;
  delete from public.agent_hybrid_manual_requests where profile_id = v_actor_id;
end;
$function$;

create or replace function public.begin_agent_hybrid_manual_call_management(
  p_campaign_id uuid,
  p_phone text,
  p_full_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  perform 1 from public.profiles where id = v_actor_id for update;
  perform 1 from public.agent_hybrid_manual_requests request
  where request.profile_id = v_actor_id
    and request.campaign_id = p_campaign_id
    and request.status = 'ready'
  for update;
  if not found then
    raise exception 'Espera a que Asterisk confirme la salida de la cola automatica.';
  end if;

  if not exists (
    select 1 from public.agent_current_status current_status
    join public.agent_status_reasons reason on reason.id = current_status.reason_id
    where current_status.profile_id = v_actor_id and reason.code = 'llamada_manual'
  ) then
    raise exception 'Activa Llamada manual antes de marcar.';
  end if;

  if exists (
    select 1 from public.dial_attempts attempt
    where attempt.agent_id = v_actor_id
      and attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
  ) or exists (
    select 1 from public.dialer_agent_sessions session
    where session.profile_id = v_actor_id
      and session.status in ('ringing', 'on_call', 'wrap_up', 'pausing')
  ) then
    raise exception 'Hay una llamada automatica en curso o pendiente para tu extension.';
  end if;

  return public.begin_agent_manual_call_management(
    p_campaign_id, p_phone, p_full_name, 'before_dial'
  );
end;
$function$;

create or replace function public.begin_agent_manual_call_management_api(
  p_campaign_id uuid,
  p_phone text,
  p_full_name text default null,
  p_entry_mode text default 'before_dial'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if p_entry_mode = 'before_dial' and exists (
    select 1 from public.campaign_agents membership
    join public.dialer_campaign_configs config
      on config.campaign_id = membership.campaign_id
     and config.is_active and config.dial_mode <> 'manual'
    join public.campaigns campaign
      on campaign.id = membership.campaign_id and campaign.is_active
    where membership.profile_id = v_actor_id
  ) then
    return public.begin_agent_hybrid_manual_call_management(
      p_campaign_id, p_phone, p_full_name
    );
  end if;
  return public.begin_agent_manual_call_management(
    p_campaign_id, p_phone, p_full_name, p_entry_mode
  );
end;
$function$;

create or replace function public.claim_agent_hybrid_manual_requests(
  p_worker_id text,
  p_limit integer default 5
)
returns table(request_id uuid, profile_id uuid, extension text)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is not null then
    raise exception 'Solo el motor telefonico puede reclamar solicitudes hibridas.';
  end if;
  return query
  with candidates as (
    select request.id
    from public.agent_hybrid_manual_requests request
    where (request.status = 'pending' and request.next_attempt_at <= now())
       or (request.status = 'processing' and request.claimed_at < now() - interval '15 seconds')
    order by request.created_at
    limit greatest(coalesce(p_limit, 5), 1)
    for update skip locked
  ), claimed as (
    update public.agent_hybrid_manual_requests request
    set status = 'processing', claimed_at = now(), claimed_by = p_worker_id,
        attempts = request.attempts + 1, updated_at = now()
    from candidates
    where request.id = candidates.id
    returning request.id, request.profile_id, request.extension
  )
  select claimed.id, claimed.profile_id, claimed.extension from claimed;
end;
$function$;

create or replace function public.complete_agent_hybrid_manual_request(
  p_request_id uuid,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is not null then
    raise exception 'Solo el motor telefonico puede completar solicitudes hibridas.';
  end if;
  if p_success then
    -- El worker solo llega aqui despues del ACK de QueuePause y de comprobar
    -- que no quedan canales PJSIP. Publicar paused y ready en la misma
    -- transaccion evita que la UI vea un permiso listo con una sesion pausing.
    update public.dialer_agent_sessions session
    set status = 'paused', last_state_change_at = now(), updated_at = now()
    from public.agent_hybrid_manual_requests request
    where request.id = p_request_id
      and request.status = 'processing'
      and session.profile_id = request.profile_id
      and session.status = 'pausing';
  end if;
  update public.agent_hybrid_manual_requests
  set status = case when p_success then 'ready' else 'pending' end,
      ready_at = case when p_success then now() else null end,
      next_attempt_at = case when p_success then next_attempt_at else now() + interval '1 second' end,
      claimed_at = null,
      claimed_by = null,
      last_error = case when p_success then null else nullif(btrim(coalesce(p_error, '')), '') end,
      updated_at = now()
  where id = p_request_id and status = 'processing';
end;
$function$;

revoke all on function public.begin_agent_manual_call_management(uuid, text, text, text)
  from authenticated;
revoke all on function public.set_my_agent_current_status(uuid) from public, anon;
grant execute on function public.set_my_agent_current_status(uuid) to authenticated;
revoke all on function public.mark_my_agent_logged_out() from public, anon;
grant execute on function public.mark_my_agent_logged_out() to authenticated;
revoke all on function public.enter_agent_hybrid_manual_mode(uuid) from public, anon;
grant execute on function public.enter_agent_hybrid_manual_mode(uuid) to authenticated;
revoke all on function public.exit_agent_hybrid_manual_mode() from public, anon;
grant execute on function public.exit_agent_hybrid_manual_mode() to authenticated;
revoke all on function public.begin_agent_hybrid_manual_call_management(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.begin_agent_manual_call_management_api(uuid, text, text, text)
  from public, anon;
grant execute on function public.begin_agent_manual_call_management_api(uuid, text, text, text)
  to authenticated;
revoke all on function public.claim_agent_hybrid_manual_requests(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_agent_hybrid_manual_requests(text, integer)
  to service_role;
revoke all on function public.complete_agent_hybrid_manual_request(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_agent_hybrid_manual_request(uuid, boolean, text)
  to service_role;
