-- Evita la colisión entre la columna OUT `lead_id` de la función y las
-- columnas homónimas de los CTE internos. La campaña sigue exigiendo estar
-- activa y mantiene los mismos límites de concurrencia e intentos.
create or replace function public.claim_next_ai_voice_targets(
  p_campaign_id uuid,
  p_batch_size integer default 1
)
returns table(
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
  v_max_concurrent integer;
  v_max_attempts integer;
  v_in_flight integer;
  v_effective_batch_size integer;
begin
  if v_actor_id is not null then
    raise exception 'claim_next_ai_voice_targets solo puede ser llamada por el motor.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_campaign_id::text, 0));

  select config.max_concurrent_calls, config.max_attempts_per_contact
  into v_max_concurrent, v_max_attempts
  from public.ai_voice_campaign_configs config
  join public.campaigns campaign on campaign.id = config.campaign_id
  where config.campaign_id = p_campaign_id
    and config.is_active
    and campaign.is_active
    and config.phone_number_id is not null;

  if not found then
    return;
  end if;

  select count(*)::integer
  into v_in_flight
  from public.dial_attempts attempt
  where attempt.campaign_id = p_campaign_id
    and attempt.attempt_kind = 'ai_voice'
    and (
      attempt.status in ('originating', 'ringing', 'answered', 'bridged')
      or (
        attempt.status = 'queued'
        and attempt.created_at >= now() - interval '5 minutes'
      )
    );

  v_effective_batch_size := least(
    greatest(coalesce(p_batch_size, 1), 0),
    greatest(v_max_concurrent - coalesce(v_in_flight, 0), 0)
  );

  if v_effective_batch_size = 0 then
    return;
  end if;

  return query
  with attempts_by_lead as (
    select attempt.lead_id as attempted_lead_id, count(*)::integer as attempts
    from public.dial_attempts attempt
    where attempt.campaign_id = p_campaign_id
      and attempt.attempt_kind = 'ai_voice'
    group by attempt.lead_id
  ), candidates as (
    select lead.id, lead.phone, lead.full_name, lead.rut
    from public.leads lead
    left join attempts_by_lead
      on attempts_by_lead.attempted_lead_id = lead.id
    where lead.campaign_id = p_campaign_id
      and lead.phone is not null
      and btrim(lead.phone) <> ''
      and coalesce(attempts_by_lead.attempts, 0) < v_max_attempts
      and not exists (
        select 1
        from public.dial_attempts active_attempt
        where active_attempt.lead_id = lead.id
          and active_attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
      and not exists (
        select 1
        from public.dial_attempts active_phone
        where active_phone.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
          and public.canonical_chile_phone(active_phone.phone)
              = public.canonical_chile_phone(lead.phone)
      )
    order by lead.created_at asc
    limit v_effective_batch_size
    for update of lead skip locked
  ), inserted as (
    insert into public.dial_attempts (
      lead_id,
      campaign_id,
      phone,
      status,
      attempt_kind,
      provider
    )
    select
      candidate.id,
      p_campaign_id,
      candidate.phone,
      'queued',
      'ai_voice',
      'elevenlabs'
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

revoke all on function public.claim_next_ai_voice_targets(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_ai_voice_targets(uuid, integer)
  to service_role;
