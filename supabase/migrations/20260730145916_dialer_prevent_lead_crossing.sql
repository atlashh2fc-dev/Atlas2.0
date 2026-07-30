-- Candados para que, con varios ejecutivos conectados, las bases y los
-- registros no se crucen. Es el modelo de Genesys/Five9 para marcación en cola
-- compartida:
--
--   1. El pool de la campaña no se pre-reparte: gana el primer ejecutivo libre.
--   2. Un registro en marcación queda bloqueado para todos los demás.
--   3. Un compromiso personal (callback) se le entrega a SU ejecutivo, nunca al
--      pool: si el discador lo tomara, lo podría atender cualquiera.
--   4. Nunca dos llamadas simultáneas al mismo teléfono, aunque estén en
--      campañas distintas.
--
-- 3 y 4 son los que faltaban.
create or replace function public.claim_next_dial_targets(p_campaign_id uuid, p_batch_size integer default 1)
returns table(dial_attempt_id uuid, lead_id uuid, phone text, full_name text, rut text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_max_redial_attempts integer;
  v_available_agents integer;
  v_effective_batch_size integer;
begin
  if v_actor_id is not null then
    raise exception 'claim_next_dial_targets solo puede ser llamada por el motor de discado.';
  end if;

  select coalesce(dc.max_redial_attempts, 4)
  into v_max_redial_attempts
  from public.dialer_campaign_configs dc
  where dc.campaign_id = p_campaign_id;
  v_max_redial_attempts := coalesce(v_max_redial_attempts, 4);

  select count(*)::integer
  into v_available_agents
  from public.dialer_agent_sessions das
  where das.campaign_id = p_campaign_id
    and das.status = 'available'
    and not exists (
      select 1
      from public.calls open_call
      where open_call.agent_id = das.profile_id
        and open_call.ended_at is null
        and open_call.started_at >= now() - interval '4 hours'
    );

  v_effective_batch_size := least(
    greatest(coalesce(p_batch_size, 1), 0),
    coalesce(v_available_agents, 0)
  );

  if v_effective_batch_size = 0 then
    return;
  end if;

  return query
  with recent_negative as (
    select
      da.lead_id,
      count(*) as attempts,
      max(da.ended_at) as last_ended_at
    from public.dial_attempts da
    where da.campaign_id = p_campaign_id
      and da.status in ('no_answer', 'busy', 'failed', 'voicemail')
      and da.ended_at >= now() - interval '7 days'
    group by da.lead_id
  ), candidates as (
    select l.id, l.phone, l.full_name, l.rut
    from public.leads l
    left join recent_negative rn on rn.lead_id = l.id
    where l.campaign_id = p_campaign_id
      and l.phone is not null
      and btrim(l.phone) <> ''
      and (
        (
          l.next_action_at is not null
          and l.next_action_at <= now()
          and l.workflow_status = 'callback'
          -- Un callback con dueño es un compromiso personal: lo trabaja ese
          -- ejecutivo desde Mi agenda. El discador solo toma los que quedaron
          -- sin responsable.
          and coalesce(l.managed_by, l.assigned_to) is null
        )
        or (
          l.next_action_at is null
          and coalesce(l.assignment_status, 'pending') not in ('managed', 'exception')
          and coalesce(l.workflow_status, 'pending') not in ('managed', 'exception', 'callback')
        )
      )
      and not exists (
        select 1
        from public.calls open_call
        where open_call.lead_id = l.id
          and open_call.ended_at is null
      )
      and not exists (
        select 1
        from public.dial_attempts da
        where da.lead_id = l.id
          and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
      -- Mismo teléfono en curso, aunque sea de otra campaña: no se llama dos
      -- veces al mismo cliente al mismo tiempo.
      and not exists (
        select 1
        from public.dial_attempts da2
        where da2.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
          and regexp_replace(coalesce(da2.phone, ''), '\D', '', 'g')
              = regexp_replace(l.phone, '\D', '', 'g')
      )
      and coalesce(rn.attempts, 0) < v_max_redial_attempts
      and (
        rn.last_ended_at is null
        or rn.last_ended_at <= now() - (
          case
            when rn.attempts <= 1 then interval '15 minutes'
            when rn.attempts = 2 then interval '1 hour'
            else interval '4 hours'
          end
        )
      )
    order by
      l.external_priority_rank asc nulls last,
      l.next_action_at asc nulls last,
      l.updated_at asc
    limit v_effective_batch_size
    for update of l skip locked
  ), inserted as (
    insert into public.dial_attempts (lead_id, campaign_id, phone, status)
    select c.id, p_campaign_id, c.phone, 'queued'
    from candidates c
    returning
      public.dial_attempts.id as inserted_attempt_id,
      public.dial_attempts.lead_id as inserted_lead_id
  )
  select
    i.inserted_attempt_id,
    i.inserted_lead_id,
    c.phone,
    c.full_name,
    c.rut
  from inserted i
  join candidates c on c.id = i.inserted_lead_id;
end;
$function$;

-- NOTA: la primera versión de claim_dial_attempt_for_agent reutilizaba
-- assign_lead, que exige usuario autenticado y por lo tanto habría fallado en
-- producción. La versión definitiva está en
-- 20260730150057_fix_claim_dial_attempt_assignment_without_actor.sql.
