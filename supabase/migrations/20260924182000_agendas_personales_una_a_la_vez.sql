-- Agendas personales: una a la vez por ejecutivo, y nunca otra vez después de
-- una conversación.
--
-- Hallazgo B3 de la auditoría de Equifax (24-09-2026). La versión anterior de
-- claim_due_personal_callbacks tenía tres defectos que molestaban al cliente:
--
-- 1. Varias agendas del mismo ejecutivo salían juntas. El candado por dueño era
--    pg_try_advisory_xact_lock dentro de un mismo SELECT, y los candados
--    consultivos son reentrantes en la misma transacción: la segunda agenda del
--    mismo dueño también lo "ganaba". En Secretaria Virtual hubo 33 casos de 2
--    a 4 INVITE simultáneos al mismo softphone; uno sonaba y el resto fallaba.
--    Equifax trae 50 minutos con 2 o más agendas del mismo ejecutivo (hasta 9).
-- 2. Después de una conversación la agenda se volvía a marcar. El lead sigue en
--    workflow_status='callback' hasta que el ejecutivo tipifica, y el único
--    freno era callback_last_attempt_at + 120 s: 36 clientes volvieron a sonar
--    tras haber contestado (mediana 117 s, mínimo 3 s).
-- 3. Un cliente que no contestaba recibía un intento cada 120 s durante toda la
--    ventana: hasta 15 llamadas en 30 minutos.
--
-- Reglas nuevas (las mismas que aplican Genesys y Five9 a sus "personal
-- callbacks"):
--
-- * Una sola agenda en vuelo por ejecutivo. Se elige la más antigua de cada
--   dueño y el resto espera su turno en orden de next_action_at. Tampoco sale
--   si el dueño ya tiene cualquier intento vivo, una gestión abierta o la
--   interrupción legal entre llamadas en curso.
-- * El compromiso se da por atendido en cuanto existe una gestión (calls) del
--   lead desde la hora comprometida: la crea el propio discador cuando el
--   cliente contesta, o el ejecutivo cuando la llama a mano desde la agenda o
--   la ficha (begin_agent_agenda_callback). Así "Llamar ahora" deja la agenda
--   tomada y el discador no la marca en paralelo ni después. Si además hubo un
--   intento contestado (answered_at), tampoco sale: cubre a un motor antiguo
--   que todavía no registraba la conexión.
-- * Al cliente se le hace sonar como máximo 2 veces por compromiso y con 10
--   minutos entre una y otra. El intento solo "toca" al cliente cuando el
--   ejecutivo ya contestó (originated_at): si el ejecutivo no atiende su
--   teléfono el cliente no se entera, y ese reintento sigue usando
--   personal_callback_retry_seconds.
-- * Pasada la ventana no se hace nada aquí: con personal_callback_on_expiry =
--   'keep_in_agenda' (todas las campañas hoy) la agenda queda vencida en "Mi
--   agenda" para que el ejecutivo la llame a mano.
--
-- La selección se hace fila a fila para que una agenda con conflicto (por
-- ejemplo el mismo número recién tomado por el pool, que choca con
-- dial_attempts_one_active_per_phone_idx) no tumbe la entrega de las demás.

create or replace function public.claim_due_personal_callbacks(
  p_campaign_id uuid,
  p_limit integer default 5
)
returns table(
  dial_attempt_id uuid,
  lead_id uuid,
  phone text,
  full_name text,
  rut text,
  agent_id uuid,
  agent_extension text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_cfg public.dialer_campaign_configs%rowtype;
  v_limit integer := greatest(coalesce(p_limit, 5), 0);
  v_now timestamptz := now();
  -- Veces que se deja sonar al cliente por un mismo compromiso, y la espera
  -- entre una y otra. Son reglas de cortesía, no de configuración comercial.
  v_max_customer_rings constant integer := 2;
  v_customer_ring_gap constant interval := interval '10 minutes';
  v_owners uuid[] := '{}';
  v_active_extensions text[];
  v_candidate record;
  v_attempt_id uuid;
begin
  if v_actor_id is not null then
    raise exception 'claim_due_personal_callbacks solo puede ser llamada por el motor de discado.';
  end if;

  select * into v_cfg
  from public.dialer_campaign_configs
  where campaign_id = p_campaign_id;

  if not found or not v_cfg.is_active or not v_cfg.personal_callback_enabled or v_limit = 0 then
    return;
  end if;

  -- Una agenda automática no suena fuera del horario de la campaña aunque el
  -- cliente la haya pedido: queda vencida en la agenda para llamarla a mano.
  if not public.dialer_campaign_in_calling_window(p_campaign_id) then
    return;
  end if;

  -- El dueño tiene que estar en la cola de esta campaña según el multiskill: la
  -- campaña que eligió o que le fijó su supervisor, y su franja. La sesión por
  -- sí sola puede quedar en 'available' de una campaña que ya no opera.
  v_active_extensions := array(
    select active.extension from public.get_active_campaign_agent_extensions(p_campaign_id) active
  );

  for v_candidate in
    select
      l.id,
      l.phone,
      l.full_name,
      l.rut,
      l.next_action_at,
      coalesce(l.managed_by, l.assigned_to) as owner_id,
      s.extension
    from public.leads l
    join public.dialer_agent_sessions s
      on s.profile_id = coalesce(l.managed_by, l.assigned_to)
     and s.campaign_id = p_campaign_id
     and s.status = 'available'
     and s.extension = any(v_active_extensions)
    where l.campaign_id = p_campaign_id
      and l.workflow_status = 'callback'
      and l.callback_mode = 'personal'
      -- Solo los compromisos telefónicos entran al discador; los de WhatsApp o
      -- reunión los gestiona el responsable (igual que "Mi agenda").
      and coalesce(l.next_action_channel, 'phone') = 'phone'
      and l.next_action_at is not null
      and l.next_action_at <= v_now
      and l.next_action_at >= v_now - make_interval(mins => v_cfg.personal_callback_window_minutes)
      and coalesce(l.managed_by, l.assigned_to) is not null
      and l.phone is not null
      and btrim(l.phone) <> ''
      -- Un número en la lista de no llamar no se marca ni aunque haya compromiso;
      -- el resguardo de dial_attempts lo descartaría igual, pero sin avisar.
      and not public.dialer_phone_is_suppressed(l.organization_id, p_campaign_id, l.phone)
      and (
        l.callback_last_attempt_at is null
        or l.callback_last_attempt_at <= v_now - make_interval(secs => v_cfg.personal_callback_retry_seconds)
      )
      -- Compromiso ya atendido: hay una gestión del lead desde la hora
      -- comprometida (contestó el cliente o el ejecutivo la tomó a mano), o
      -- una gestión abierta de cualquier momento.
      and not exists (
        select 1 from public.calls c
        where c.lead_id = l.id
          and (c.ended_at is null or c.started_at >= l.next_action_at)
      )
      -- Un intento de este compromiso ya fue contestado por el cliente.
      and not exists (
        select 1 from public.dial_attempts answered
        where answered.lead_id = l.id
          and answered.attempt_kind = 'personal_callback'
          and answered.created_at >= l.next_action_at
          and answered.answered_at is not null
      )
      -- Cortesía con el cliente: máximo dos timbres por compromiso, separados.
      -- Solo cuenta lo que llegó a sonarle: una falla de la troncal ('failed')
      -- con el ejecutivo ya en línea no gasta el cupo del cliente.
      and (
        select count(*)
        from public.dial_attempts rung
        where rung.lead_id = l.id
          and rung.attempt_kind = 'personal_callback'
          and rung.created_at >= l.next_action_at
          and rung.originated_at is not null
          and rung.status <> 'failed'
      ) < v_max_customer_rings
      and not exists (
        select 1 from public.dial_attempts rung
        where rung.lead_id = l.id
          and rung.attempt_kind = 'personal_callback'
          and rung.created_at >= l.next_action_at
          and rung.originated_at is not null
          and rung.status <> 'failed'
          and coalesce(rung.ended_at, rung.updated_at) > v_now - v_customer_ring_gap
      )
      and not exists (
        select 1 from public.dial_attempts da
        where da.lead_id = l.id
          and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
      -- Mismo criterio que dial_attempts_one_active_per_phone_idx: el número
      -- convive en la base como 9XXXXXXXX y como 569XXXXXXXX.
      and not exists (
        select 1 from public.dial_attempts da2
        where da2.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
          and public.canonical_chile_phone(da2.phone) = public.canonical_chile_phone(l.phone)
      )
    order by l.next_action_at asc, l.id
    for update of l skip locked
  loop
    exit when cardinality(v_owners) >= v_limit;

    -- Una agenda por ejecutivo en cada entrega; las siguientes esperan su turno.
    continue when v_candidate.owner_id = any(v_owners);

    -- Frente a otra transacción concurrente del motor. Dentro de esta misma
    -- transacción el candado es reentrante, por eso manda el arreglo de arriba.
    continue when not pg_try_advisory_xact_lock(hashtextextended(v_candidate.owner_id::text, 48001));

    -- El dueño tiene que estar realmente libre: sin otro intento vivo (pool o
    -- agenda), sin gestión por tipificar y fuera de la interrupción legal.
    continue when exists (
      select 1 from public.dial_attempts busy
      where busy.agent_id = v_candidate.owner_id
        and busy.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
        and busy.created_at >= v_now - interval '4 hours'
    );
    continue when exists (
      select 1 from public.calls open_call
      where open_call.agent_id = v_candidate.owner_id
        and open_call.ended_at is null
        and open_call.started_at >= v_now - interval '4 hours'
    );
    continue when exists (
      select 1 from public.profiles owner_profile
      where owner_profile.id = v_candidate.owner_id
        and (
          not owner_profile.active
          or coalesce(owner_profile.intercall_break_until > v_now, false)
        )
    );
    -- Mismo criterio que el trigger reject_dial_attempt_for_disconnected_agent:
    -- antes el trigger reventaba la entrega completa de la campaña cuando una
    -- sesión atrasada decía 'available' para alguien ya desconectado.
    continue when exists (
      select 1
      from public.agent_current_status current_status
      join public.agent_status_reasons reason on reason.id = current_status.reason_id
      where current_status.profile_id = v_candidate.owner_id
        and reason.code = 'desconectado'
    );

    v_attempt_id := null;
    begin
      insert into public.dial_attempts (lead_id, campaign_id, phone, status, agent_id, attempt_kind)
      values (v_candidate.id, p_campaign_id, v_candidate.phone, 'queued', v_candidate.owner_id, 'personal_callback')
      returning id into v_attempt_id;
    exception when unique_violation then
      -- El pool o una llamada manual tomó el mismo número entre la selección
      -- y la inserción. Esta agenda espera al siguiente ciclo.
      continue;
    end;

    -- El resguardo de dial_attempts descarta en silencio (sin fila) un intento
    -- hacia un número recién suprimido: no hay nada que entregar al motor.
    continue when v_attempt_id is null;

    update public.leads
       set callback_attempts = coalesce(callback_attempts, 0) + 1,
           callback_last_attempt_at = v_now,
           updated_at = v_now
     where id = v_candidate.id;

    v_owners := v_owners || v_candidate.owner_id;

    dial_attempt_id := v_attempt_id;
    lead_id := v_candidate.id;
    phone := v_candidate.phone;
    full_name := v_candidate.full_name;
    rut := v_candidate.rut;
    agent_id := v_candidate.owner_id;
    agent_extension := v_candidate.extension;
    return next;
  end loop;

  return;
end;
$function$;

revoke execute on function public.claim_due_personal_callbacks(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_due_personal_callbacks(uuid, integer) to service_role;
