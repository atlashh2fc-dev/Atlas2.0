-- Si el motor cae despues de reclamar y antes de guardar el conversation_id,
-- no existe una clave de idempotencia documentada por el endpoint SIP de
-- ElevenLabs. Reintentar a ciegas podria llamar dos veces al mismo telefono.
-- Por eso una reserva huerfana se cierra como fallida y exige un nuevo clic.

create or replace function public.claim_next_ai_voice_test_calls(
  p_campaign_ids uuid[],
  p_batch_size integer default 3
)
returns table(
  test_call_id uuid,
  campaign_id uuid,
  phone text,
  contact_name text,
  agent_id text,
  phone_number_id text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is not null then
    raise exception 'claim_next_ai_voice_test_calls solo puede ser llamada por el motor.';
  end if;

  if coalesce(array_length(p_campaign_ids, 1), 0) = 0 then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ai_voice_test_calls', 0)
  );

  update public.ai_voice_test_calls stale_call
  set
    status = 'failed',
    hangup_cause = coalesce(stale_call.hangup_cause, 'ENGINE_CLAIM_TIMEOUT'),
    provider_result = stale_call.provider_result || jsonb_build_object(
      'stage', 'engine_claim',
      'reason', 'claim_timeout_without_provider_id'
    ),
    ended_at = coalesce(stale_call.ended_at, pg_catalog.now()),
    updated_at = pg_catalog.now()
  where stale_call.campaign_id = any(p_campaign_ids)
    and stale_call.status = 'claiming'
    and stale_call.claimed_at < pg_catalog.now() - interval '2 minutes';

  return query
  with capacities as (
    select
      config.campaign_id,
      config.agent_id,
      config.phone_number_id,
      greatest(
        config.max_concurrent_calls - (
          select count(*)::integer
          from public.ai_voice_test_calls active_call
          where active_call.campaign_id = config.campaign_id
            and active_call.status in ('claiming', 'originating', 'ringing', 'answered')
        ),
        0
      ) as available
    from public.ai_voice_campaign_configs config
    join public.campaigns campaign on campaign.id = config.campaign_id
    where config.campaign_id = any(p_campaign_ids)
      and campaign.is_active
      and config.phone_number_id is not null
  ), candidates as (
    select
      request.id,
      request.campaign_id,
      row_number() over (
        partition by request.campaign_id
        order by request.created_at asc
      ) as campaign_position
    from public.ai_voice_test_calls request
    join capacities on capacities.campaign_id = request.campaign_id
    where request.status = 'queued'
  ), selected as (
    select candidate.id
    from candidates candidate
    join capacities on capacities.campaign_id = candidate.campaign_id
    where candidate.campaign_position <= capacities.available
    order by candidate.id
    limit greatest(coalesce(p_batch_size, 3), 0)
  ), claimed as (
    update public.ai_voice_test_calls request
    set
      status = 'claiming',
      claimed_at = pg_catalog.now(),
      hangup_cause = null,
      updated_at = pg_catalog.now()
    from selected
    where request.id = selected.id
    returning request.id, request.campaign_id, request.phone, request.contact_name
  )
  select
    claimed.id,
    claimed.campaign_id,
    claimed.phone,
    claimed.contact_name,
    capacities.agent_id,
    capacities.phone_number_id
  from claimed
  join capacities on capacities.campaign_id = claimed.campaign_id;
end;
$function$;

revoke all on function public.claim_next_ai_voice_test_calls(uuid[], integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_ai_voice_test_calls(uuid[], integer)
  to service_role;
