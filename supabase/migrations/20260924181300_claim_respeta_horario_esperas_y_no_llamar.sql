-- claim_next_dial_targets: horario de la campaña, esperas por lead y por
-- teléfono, tope de intentos y lista de no llamar.
--
-- Qué cambia respecto de 20260731170000:
--   * Fuera de la franja de la campaña o en feriado
--     (dialer_campaign_in_calling_window) no sale ninguna llamada nueva. Sin
--     franja configurada, como siempre.
--   * Cortacircuitos: si la troncal está rechazando casi todo
--     (dialer_campaign_technical_breaker_open), no se marca nada hasta que pase
--     la ventana de 10 minutos. Apagado salvo que la campaña lo configure.
--   * La espera ya no se recalcula aquí sobre 'no_answer/busy/failed/voicemail'
--     de los últimos 7 días: la escribe cada intento terminado en
--     leads.dialer_retry_at (20260924181200), contando también 'completed' sin
--     contestar, 'abandoned' y los descartes técnicos.
--   * La cola se lee de tres índices ya ordenados (fresca, reintentos vencidos
--     y agendas sin dueño vencidas) y se toma lo justo; antes se recorría y
--     ordenaba la campaña entera en cada ciclo (~0,9 s con 80 mil leads).
--   * Última barrera antes de marcar: teléfono en la lista de no llamar, en
--     vuelo en cualquier campaña, marcado hace menos que la espera mínima (por
--     si un recálculo de dialer_retry_at quedó pendiente), llamada abierta o
--     intento activo del lead.

-- ¿Está la campaña rechazando casi todo por fallas técnicas? Ventana fija de
-- 10 minutos y al menos 20 intentos terminados, para no cortar por dos fallas
-- sueltas. Se cierra sola: sin intentos nuevos, la ventana se vacía y el claim
-- vuelve a probar.
create or replace function public.dialer_campaign_technical_breaker_open(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with config as (
    select config.technical_breaker_ratio as ratio
    from public.dialer_campaign_configs config
    where config.campaign_id = p_campaign_id
      and config.technical_breaker_ratio is not null
  ), recientes as (
    select
      count(*) as total,
      count(*) filter (
        where public.dialer_attempt_result_class(attempt.status, attempt.attempt_kind, attempt.originated_at, attempt.hangup_cause) = 'tecnico'
      ) as tecnicos
    from public.dial_attempts attempt
    where attempt.campaign_id = p_campaign_id
      and attempt.attempt_kind = 'pool'
      and attempt.ended_at > now() - interval '10 minutes'
  )
  select coalesce(
    (select recientes.total >= 20 and recientes.tecnicos >= config.ratio * recientes.total
     from config, recientes),
    false
  );
$$;

create or replace function public.claim_next_dial_targets(p_campaign_id uuid, p_batch_size integer default 1)
returns table(dial_attempt_id uuid, lead_id uuid, phone text, full_name text, rut text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_max_redial_attempts integer;
  v_max_dial_ratio numeric;
  v_available_agents integer;
  v_in_flight integer;
  v_target_in_flight integer;
  v_effective_batch_size integer;
  v_scan integer;
  v_min_gap integer;
  v_tech_gap integer;
begin
  if v_actor_id is not null then
    raise exception 'claim_next_dial_targets solo puede ser llamada por el motor de discado.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 0));

  -- Fuera de horario o en feriado no se marca, aunque haya ejecutivos
  -- «Disponibles».
  if not public.dialer_campaign_in_calling_window(p_campaign_id) then
    return;
  end if;

  -- Troncal caída: seguir marcando solo gasta la base y los ejecutivos esperan
  -- igual.
  if public.dialer_campaign_technical_breaker_open(p_campaign_id) then
    return;
  end if;

  select
    coalesce(config.max_redial_attempts, 4),
    coalesce(config.max_dial_ratio, 1),
    config.redial_backoff_minutes[1],
    config.technical_retry_minutes
  into v_max_redial_attempts, v_max_dial_ratio, v_min_gap, v_tech_gap
  from public.dialer_campaign_configs config
  where config.campaign_id = p_campaign_id;
  v_max_redial_attempts := coalesce(v_max_redial_attempts, 4);
  v_max_dial_ratio := greatest(coalesce(v_max_dial_ratio, 1), 1);
  v_min_gap := coalesce(v_min_gap, 30);
  v_tech_gap := least(coalesce(v_tech_gap, 10), v_min_gap);

  -- Con 0 intentos permitidos el pool no marca (así lo usan las campañas
  -- entrantes); antes salía de «0 < 0», ahora se dice explícito.
  if v_max_redial_attempts <= 0 then
    return;
  end if;

  select campaign.organization_id
  into v_organization_id
  from public.campaigns campaign
  where campaign.id = p_campaign_id;

  select count(*)::integer
  into v_available_agents
  from public.dialer_agent_sessions session
  where session.campaign_id = p_campaign_id
    and session.status = 'available'
    and not exists (
      select 1
      from public.calls open_call
      where open_call.agent_id = session.profile_id
        and open_call.ended_at is null
        and open_call.started_at >= now() - interval '4 hours'
    );

  select count(*)::integer
  into v_in_flight
  from public.dial_attempts attempt
  where attempt.campaign_id = p_campaign_id
    and attempt.attempt_kind = 'pool'
    and (
      attempt.status in ('originating', 'ringing', 'answered', 'bridged')
      or (
        attempt.status = 'queued'
        and attempt.created_at >= now() - interval '5 minutes'
      )
    );

  v_target_in_flight := ceil(coalesce(v_available_agents, 0) * v_max_dial_ratio)::integer;
  v_effective_batch_size := least(
    greatest(coalesce(p_batch_size, 1), 0),
    greatest(v_target_in_flight - coalesce(v_in_flight, 0), 0)
  );

  if v_effective_batch_size = 0 then
    return;
  end if;

  -- Cada fuente trae algo más que el lote: los primeros de la cola pueden
  -- estar en vuelo ahora mismo (su intento todavía no terminó) o con una
  -- llamada manual abierta, y la barrera final los descarta.
  v_scan := v_effective_batch_size + coalesce(v_in_flight, 0) + 20;

  return query
  with pool_sources as (
    -- Nunca marcados en este ciclo, en el orden de prioridad del índice.
    (
      select lead.id
      from public.leads lead
      where lead.campaign_id = p_campaign_id
        and lead.phone is not null
        and btrim(lead.phone) <> ''
        and lead.dialer_retry_at is null
        and lead.next_action_at is null
        and coalesce(lead.assignment_status, 'pending') not in ('managed', 'exception')
        and coalesce(lead.workflow_status, 'pending') not in ('managed', 'exception', 'callback')
      order by lead.external_priority_rank asc nulls last, lead.updated_at asc
      limit v_scan
    )
    union all
    -- Reintentos cuya espera ya venció.
    (
      select lead.id
      from public.leads lead
      where lead.campaign_id = p_campaign_id
        and lead.dialer_retry_at <= now()
        and lead.phone is not null
        and btrim(lead.phone) <> ''
        and (
          (
            lead.next_action_at is not null
            and lead.next_action_at <= now()
            and lead.workflow_status = 'callback'
            and coalesce(lead.managed_by, lead.assigned_to) is null
          )
          or (
            lead.next_action_at is null
            and coalesce(lead.assignment_status, 'pending') not in ('managed', 'exception')
            and coalesce(lead.workflow_status, 'pending') not in ('managed', 'exception', 'callback')
          )
        )
      order by lead.external_priority_rank asc nulls last, lead.next_action_at asc nulls last, lead.updated_at asc
      limit v_scan
    )
    union all
    -- Agendas sin dueño que ya vencieron.
    (
      select lead.id
      from public.leads lead
      where lead.campaign_id = p_campaign_id
        and lead.workflow_status = 'callback'
        and lead.next_action_at is not null
        and lead.next_action_at <= now()
        and coalesce(lead.managed_by, lead.assigned_to) is null
        and lead.dialer_retry_at is null
        and lead.phone is not null
        and btrim(lead.phone) <> ''
      order by lead.external_priority_rank asc nulls last, lead.next_action_at asc nulls last, lead.updated_at asc
      limit v_scan
    )
  ), pool as (
    -- Un solo lead por teléfono en el lote: el de mejor prioridad. Si no, el
    -- segundo choca con el índice de teléfono en vuelo y el ejecutivo pierde
    -- ese turno.
    select distinct on (public.canonical_chile_phone(lead.phone)) lead.id
    from public.leads lead
    join pool_sources on pool_sources.id = lead.id
    order by
      public.canonical_chile_phone(lead.phone),
      lead.external_priority_rank asc nulls last,
      lead.next_action_at asc nulls last,
      lead.updated_at asc
  ), candidates as (
    select lead.id, lead.phone, lead.full_name, lead.rut
    from public.leads lead
    where lead.id in (select pool.id from pool)
      and lead.campaign_id = p_campaign_id
      and lead.phone is not null
      and btrim(lead.phone) <> ''
      and (lead.dialer_retry_at is null or lead.dialer_retry_at <= now())
      and (
        (
          lead.next_action_at is not null
          and lead.next_action_at <= now()
          and lead.workflow_status = 'callback'
          and coalesce(lead.managed_by, lead.assigned_to) is null
        )
        or (
          lead.next_action_at is null
          and coalesce(lead.assignment_status, 'pending') not in ('managed', 'exception')
          and coalesce(lead.workflow_status, 'pending') not in ('managed', 'exception', 'callback')
        )
      )
      and not exists (
        select 1 from public.calls open_call
        where open_call.lead_id = lead.id and open_call.ended_at is null
      )
      and not exists (
        select 1 from public.dial_attempts active_attempt
        where active_attempt.lead_id = lead.id
          and active_attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
      and not exists (
        select 1 from public.dial_attempts active_phone
        where active_phone.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
          and public.canonical_chile_phone(active_phone.phone)
              = public.canonical_chile_phone(lead.phone)
      )
      -- Red por si dialer_retry_at quedó sin recalcular (el disparador falló o
      -- el lead estaba bloqueado): ningún número se vuelve a marcar antes de la
      -- espera mínima, en cualquier lead o campaña. Lee pocas filas por el
      -- índice dial_attempts_phone_history_idx.
      and not exists (
        select 1 from public.dial_attempts recent
        where public.canonical_chile_phone(recent.phone) = public.canonical_chile_phone(lead.phone)
          and recent.ended_at is not null
          and recent.ended_at > now() - make_interval(mins => v_min_gap)
          and public.dialer_attempt_result_class(recent.status, recent.attempt_kind, recent.originated_at, recent.hangup_cause) is distinct from 'ignorado'
          and (
            public.dialer_attempt_result_class(recent.status, recent.attempt_kind, recent.originated_at, recent.hangup_cause) = 'real'
            or recent.ended_at > now() - make_interval(mins => v_tech_gap)
          )
      )
      and not public.dialer_phone_is_suppressed(v_organization_id, p_campaign_id, lead.phone)
    order by
      lead.external_priority_rank asc nulls last,
      lead.next_action_at asc nulls last,
      lead.updated_at asc
    limit v_effective_batch_size
    for update of lead skip locked
  ), inserted as (
    -- Dos leads con el mismo teléfono en un mismo lote: el índice único de
    -- teléfono en vuelo deja pasar solo uno.
    insert into public.dial_attempts (lead_id, campaign_id, phone, status)
    select candidate.id, p_campaign_id, candidate.phone, 'queued'
    from candidates candidate
    on conflict do nothing
    returning
      public.dial_attempts.id as inserted_attempt_id,
      public.dial_attempts.lead_id as inserted_lead_id
  )
  select
    inserted.inserted_attempt_id,
    inserted.inserted_lead_id,
    candidates.phone,
    candidates.full_name,
    candidates.rut
  from inserted
  join candidates on candidates.id = inserted.inserted_lead_id;
end;
$function$;

revoke all on function public.dialer_campaign_technical_breaker_open(uuid) from public, anon, authenticated;
grant execute on function public.dialer_campaign_technical_breaker_open(uuid) to service_role;

revoke all on function public.claim_next_dial_targets(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_dial_targets(uuid, integer)
  to service_role;
