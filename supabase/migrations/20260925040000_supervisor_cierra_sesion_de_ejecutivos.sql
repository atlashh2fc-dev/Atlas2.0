-- El supervisor también puede cerrar la sesión de sus ejecutivos.
--
-- Hasta ahora force_agent_logout era solo de admin. Se abre al supervisor con
-- el mismo alcance que ya tiene su monitor en vivo: únicamente ejecutivos de
-- los equipos que supervisa. El resto del cierre no cambia (revoca sesiones,
-- rota la clave SIP, deja la orden durable para navegador y PBX, marca
-- Desconectado). La auditoría ahora guarda el rol de quien pidió el cierre.
--
-- Se reemplaza la función interna `_sin_empresa`: la envoltura
-- force_agent_logout sigue aplicando la guardia de empresa antes de llamarla.

create or replace function public.force_agent_logout_sin_empresa(
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
  v_actor_role public.app_role;
begin
  v_actor_role := public.current_role_name();
  if v_actor_role is null
    or v_actor_role not in ('admin'::public.app_role, 'supervisor'::public.app_role) then
    raise exception 'Solo un administrador o supervisor puede cerrar sesiones de ejecutivos.';
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

  -- El supervisor solo alcanza a los ejecutivos que ve en su monitor: los de
  -- los equipos que supervisa (mismo filtro que get_agent_live_status).
  if v_actor_role = 'supervisor'::public.app_role
    and not coalesce(v_target.team_id = any(public.supervised_team_ids()), false) then
    raise exception 'Ese ejecutivo no pertenece a un equipo que supervises.';
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
           'source', v_actor_role::text || '_monitor'
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
      'actor_role', v_actor_role,
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

revoke execute on function public.force_agent_logout_sin_empresa(uuid, text)
  from public, anon, authenticated;
