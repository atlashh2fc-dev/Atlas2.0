-- Vincula cada cierre remoto a los session_id que existían cuando el admin
-- emitió la orden. Un login posterior no puede observar, ejecutar ni confirmar
-- una orden antigua. Si el admin vuelve a cerrarlo, se crea una orden nueva
-- que captura esa sesión y rota nuevamente la credencial SIP.

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
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return true;
  end if;
  if v_user_id is null
    or v_session_text is null
    or not pg_input_is_valid(v_session_text, 'uuid') then
    return false;
  end if;
  v_session_id := v_session_text::uuid;

  return exists (
    select 1
    from public.profiles profile
    join auth.sessions session
      on session.user_id = profile.id
     and session.id = v_session_id
    where profile.id = v_user_id
      and profile.active
  ) and not exists (
    select 1
    from public.revoked_app_sessions revoked
    where revoked.session_id = v_session_id
      and revoked.profile_id = v_user_id
  );
end;
$function$;

revoke all on function public.is_current_app_session_valid() from public, anon;
grant execute on function public.is_current_app_session_valid()
  to authenticated, service_role;

create or replace function public.current_role_name()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $function$
  select profile.role
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.active
    and public.is_current_app_session_valid();
$function$;

create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select profile.team_id
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.active
    and public.is_current_app_session_valid();
$function$;

-- Esta función es la única excepción a la invalidez general: una sesión que
-- acaba de ser revocada necesita poder leer SU orden para apagar SIP y salir.
-- La relación exacta session_id + profile_id + command_id impide que un login
-- nuevo herede una orden anterior del mismo usuario.
create or replace function public.is_current_session_target_of_command(
  p_command_id uuid,
  p_target_profile_id uuid
)
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
  if v_user_id is null
    or v_user_id is distinct from p_target_profile_id
    or v_session_text is null
    or not pg_input_is_valid(v_session_text, 'uuid') then
    return false;
  end if;
  v_session_id := v_session_text::uuid;

  return exists (
    select 1
    from public.profiles profile
    join auth.sessions session
      on session.user_id = profile.id
     and session.id = v_session_id
    join public.revoked_app_sessions revoked
      on revoked.session_id = session.id
     and revoked.profile_id = profile.id
     and revoked.command_id = p_command_id
    where profile.id = v_user_id
      and profile.active
      and profile.role = 'agente'::public.app_role
  );
end;
$function$;

revoke all on function public.is_current_session_target_of_command(uuid, uuid)
  from public, anon;
grant execute on function public.is_current_session_target_of_command(uuid, uuid)
  to authenticated;

drop policy if exists agent_control_commands_select
  on public.agent_control_commands;
create policy agent_control_commands_select
  on public.agent_control_commands for select to authenticated
  using (
    public.current_role_name() = 'admin'::public.app_role
    or public.is_current_session_target_of_command(id, target_profile_id)
  );

drop policy if exists agent_sip_credentials_select
  on public.agent_sip_credentials;
create policy agent_sip_credentials_select
  on public.agent_sip_credentials for select to authenticated
  using (
    profile_id = (select auth.uid())
    and public.is_current_app_session_valid()
  );

-- El cliente nunca consulta la tabla de órdenes directamente. Revalida su
-- session_id dentro de la transacción que selecciona el comando.
create or replace function public.get_my_agent_control_command()
returns table (
  id uuid,
  target_profile_id uuid,
  command text
)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
  select control.id, control.target_profile_id, control.command
  from public.agent_control_commands control
  where public.is_current_session_target_of_command(
    control.id,
    control.target_profile_id
  )
  order by control.created_at desc
  limit 1;
$function$;

revoke all on function public.get_my_agent_control_command()
  from public, anon;
grant execute on function public.get_my_agent_control_command()
  to authenticated;

create or replace function public.acknowledge_agent_control_command(
  p_command_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.agent_control_commands control
  set browser_acknowledged_at = coalesce(
        control.browser_acknowledged_at,
        clock_timestamp()
      ),
      updated_at = clock_timestamp()
  where control.id = p_command_id
    and public.is_current_session_target_of_command(
      control.id,
      control.target_profile_id
    );

  if not found then
    raise exception 'La orden no pertenece a la sesión actual.';
  end if;
end;
$function$;

revoke all on function public.acknowledge_agent_control_command(uuid)
  from public, anon;
grant execute on function public.acknowledge_agent_control_command(uuid)
  to authenticated;

create or replace function public.force_agent_logout(
  p_target_profile_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog, extensions
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_command_id uuid;
  v_reason_id uuid;
  v_now timestamptz := clock_timestamp();
  v_previous_reason text;
  v_previous_phone text;
  v_campaign_ids uuid[] := '{}';
  v_reused boolean := false;
  v_has_unrevoked_sessions boolean := false;
  v_new_revocations integer := 0;
begin
  if public.current_role_name() is distinct from 'admin'::public.app_role then
    raise exception 'Solo un administrador puede cerrar sesiones de ejecutivos.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_target_profile_id::text, 0)
  );

  select *
  into v_target
  from public.profiles
  where id = p_target_profile_id
  for update;

  if not found
    or v_target.role <> 'agente'::public.app_role
    or not v_target.active then
    raise exception 'El ejecutivo no existe o está inactivo.';
  end if;

  select control.id
  into v_command_id
  from public.agent_control_commands control
  where control.target_profile_id = p_target_profile_id
    and control.status in ('pending', 'processing')
  order by control.created_at desc
  limit 1
  for update;
  v_reused := found;

  if v_reused then
    select exists (
      select 1
      from auth.sessions session
      where session.user_id = p_target_profile_id
        and not exists (
          select 1
          from public.revoked_app_sessions revoked
          where revoked.session_id = session.id
            and revoked.profile_id = p_target_profile_id
        )
    ) into v_has_unrevoked_sessions;

    -- Sin sesiones nuevas, la misma orden sigue siendo la operación vigente.
    -- Si apareció un login posterior y el admin vuelve a cerrar sesión, debe
    -- nacer una orden nueva y rotar otra vez la clave SIP: esa estación ya
    -- conoce la clave de la orden anterior y reutilizarla no sería un corte
    -- completo.
    if not v_has_unrevoked_sessions then
      return v_command_id;
    end if;
  end if;
  v_command_id := gen_random_uuid();

  select reason.id
  into v_reason_id
  from public.agent_status_reasons reason
  where reason.code = 'desconectado';
  if v_reason_id is null then
    raise exception 'Falta el estado de sistema Desconectado.';
  end if;

  select reason.code
  into v_previous_reason
  from public.agent_current_status current_status
  join public.agent_status_reasons reason
    on reason.id = current_status.reason_id
  where current_status.profile_id = p_target_profile_id;

  select session.status
  into v_previous_phone
  from public.dialer_agent_sessions session
  where session.profile_id = p_target_profile_id
  order by session.updated_at desc
  limit 1;

  select coalesce(array_agg(distinct membership.campaign_id), '{}')
  into v_campaign_ids
  from public.campaign_agents membership
  join public.campaign_agent_schedules schedule
    on schedule.campaign_agent_id = membership.id
  join public.campaigns campaign
    on campaign.id = membership.campaign_id
   and campaign.is_active
  cross join lateral (
    select v_now at time zone schedule.timezone as local_now
  ) local_time
  where membership.profile_id = p_target_profile_id
    and extract(dow from local_time.local_now)::smallint
        = any(schedule.days_of_week)
    and local_time.local_now::time >= schedule.start_time
    and local_time.local_now::time < schedule.end_time;

  insert into public.agent_control_commands (
    id,
    target_profile_id,
    requested_by,
    reason,
    previous_reason_code,
    previous_phone_status,
    disconnected_in_schedule,
    scheduled_campaign_ids,
    created_at,
    updated_at
  ) values (
    v_command_id,
    p_target_profile_id,
    v_actor_id,
    nullif(btrim(p_reason), ''),
    v_previous_reason,
    v_previous_phone,
    cardinality(v_campaign_ids) > 0,
    v_campaign_ids,
    v_now,
    v_now
  );

  insert into public.revoked_app_sessions (
    session_id,
    profile_id,
    revoked_by,
    command_id,
    revoked_at
  )
  select session.id,
         p_target_profile_id,
         v_actor_id,
         v_command_id,
         v_now
  from auth.sessions session
  where session.user_id = p_target_profile_id
  on conflict (session_id) do nothing;
  get diagnostics v_new_revocations = row_count;

  update public.agent_sip_credentials
  set sip_password = encode(gen_random_bytes(24), 'hex'),
      updated_at = v_now
  where profile_id = p_target_profile_id
    and is_active;

  update public.agent_current_status
  set reason_id = v_reason_id,
      since = v_now,
      last_heartbeat_at = null
  where profile_id = p_target_profile_id
    and reason_id is distinct from v_reason_id;

  if not found and not exists (
    select 1
    from public.agent_current_status
    where profile_id = p_target_profile_id
  ) then
    insert into public.agent_current_status (
      profile_id,
      reason_id,
      since,
      last_heartbeat_at
    ) values (
      p_target_profile_id,
      v_reason_id,
      v_now,
      null
    );
  end if;

  update public.dialer_agent_sessions
  set status = 'offline',
      last_state_change_at = v_now,
      updated_at = v_now
  where profile_id = p_target_profile_id
    and status <> 'offline';

  insert into public.call_events (
    call_id,
    lead_id,
    agent_id,
    event_type,
    payload
  )
  select call.id,
         call.lead_id,
         call.agent_id,
         'call.agent_force_logout',
         jsonb_build_object(
           'command_id', v_command_id,
           'requested_by', v_actor_id,
           'reason', nullif(btrim(p_reason), ''),
           'source', 'admin_monitor'
         )
  from public.calls call
  where call.agent_id = p_target_profile_id
    and call.ended_at is null
    and not exists (
      select 1
      from public.call_events event
      where event.call_id = call.id
        and event.event_type = 'call.agent_force_logout'
        and event.payload ->> 'command_id' = v_command_id::text
    );

  insert into public.sensitive_access_log (
    actor_id,
    action,
    target_profile_id,
    metadata
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
      'scheduled_campaign_ids', v_campaign_ids,
      'sessions_revoked', v_new_revocations
    )
  );

  return v_command_id;
end;
$function$;

revoke all on function public.force_agent_logout(uuid, text)
  from public, anon;
grant execute on function public.force_agent_logout(uuid, text)
  to authenticated;
