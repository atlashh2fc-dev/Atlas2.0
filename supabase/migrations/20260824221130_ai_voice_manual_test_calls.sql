-- Cola auditable para llamadas manuales de prueba con el agente de voz.
--
-- Es independiente de la base y del encendido automatico de la campana:
-- un admin solicita una llamada puntual desde Atlas y el motor (service_role)
-- la reclama, usa la credencial de ElevenLabs que vive solo en EC2 y publica
-- el resultado en esta misma fila.

create table public.ai_voice_test_calls (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ai_voice_campaign_configs(campaign_id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  contact_name text not null default 'Prueba',
  phone text not null,
  status text not null default 'queued',
  provider_conversation_id text,
  provider_call_id text,
  provider_result jsonb not null default '{}'::jsonb,
  hangup_cause text,
  claimed_at timestamptz,
  originated_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_voice_test_calls_contact_name_check
    check (char_length(btrim(contact_name)) between 1 and 120),
  constraint ai_voice_test_calls_phone_check
    check (phone ~ '^\+56[0-9]{9}$'),
  constraint ai_voice_test_calls_status_check
    check (status in (
      'queued', 'claiming', 'originating', 'ringing', 'answered',
      'no_answer', 'busy', 'failed', 'voicemail', 'completed'
    ))
);

comment on table public.ai_voice_test_calls is
  'Solicitudes manuales y auditadas de llamada de prueba; no consumen ni modifican leads de campana.';
comment on column public.ai_voice_test_calls.phone is
  'Telefono chileno normalizado a E.164 antes de encolar.';

create index ai_voice_test_calls_campaign_created_idx
  on public.ai_voice_test_calls (campaign_id, created_at desc);

create unique index ai_voice_test_calls_active_phone_uidx
  on public.ai_voice_test_calls (campaign_id, phone)
  where status in ('queued', 'claiming', 'originating', 'ringing', 'answered');

create unique index ai_voice_test_calls_provider_conversation_uidx
  on public.ai_voice_test_calls (provider_conversation_id)
  where provider_conversation_id is not null;

alter table public.ai_voice_test_calls enable row level security;

create policy ai_voice_test_calls_admin_select
  on public.ai_voice_test_calls
  for select to authenticated
  using ((select public.current_role_name()) = 'admin'::public.app_role);

create policy ai_voice_test_calls_admin_insert
  on public.ai_voice_test_calls
  for insert to authenticated
  with check (
    (select public.current_role_name()) = 'admin'::public.app_role
    and requested_by = (select auth.uid())
  );

revoke all on table public.ai_voice_test_calls from public, anon, authenticated;
grant select, insert on table public.ai_voice_test_calls to authenticated;
grant select, insert, update, delete on table public.ai_voice_test_calls to service_role;

create trigger ai_voice_test_calls_set_updated_at
  before update on public.ai_voice_test_calls
  for each row execute function public.set_updated_at();

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
            and not (
              active_call.status = 'claiming'
              and active_call.claimed_at < pg_catalog.now() - interval '2 minutes'
            )
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
       or (
         request.status = 'claiming'
         and request.claimed_at < pg_catalog.now() - interval '2 minutes'
       )
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

create or replace function public.register_ai_voice_test_call_event(
  p_test_call_id uuid,
  p_status text,
  p_provider_conversation_id text default null,
  p_provider_call_id text default null,
  p_result jsonb default '{}'::jsonb,
  p_hangup_cause text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_call public.ai_voice_test_calls;
  v_current_rank integer;
  v_incoming_rank integer;
begin
  if v_actor_id is not null then
    raise exception 'register_ai_voice_test_call_event solo puede ser llamada por el motor.';
  end if;

  if p_status not in (
    'claiming', 'originating', 'ringing', 'answered',
    'no_answer', 'busy', 'failed', 'voicemail', 'completed'
  ) then
    raise exception 'Estado de prueba IA invalido: %', p_status;
  end if;

  select * into v_call
  from public.ai_voice_test_calls
  where id = p_test_call_id
  for update;

  if not found then
    raise exception 'Llamada manual IA % no existe.', p_test_call_id;
  end if;

  if v_call.status in ('no_answer', 'busy', 'failed', 'voicemail', 'completed') then
    return;
  end if;

  v_current_rank := case v_call.status
    when 'queued' then 0
    when 'claiming' then 1
    when 'originating' then 2
    when 'ringing' then 3
    when 'answered' then 4
    else 0
  end;
  v_incoming_rank := case p_status
    when 'claiming' then 1
    when 'originating' then 2
    when 'ringing' then 3
    when 'answered' then 4
    else 100
  end;

  if v_incoming_rank < v_current_rank then
    return;
  end if;

  update public.ai_voice_test_calls
  set
    status = p_status,
    provider_conversation_id = coalesce(p_provider_conversation_id, provider_conversation_id),
    provider_call_id = coalesce(p_provider_call_id, provider_call_id),
    provider_result = provider_result || coalesce(p_result, '{}'::jsonb),
    hangup_cause = coalesce(p_hangup_cause, hangup_cause),
    originated_at = case
      when p_status = 'originating' then coalesce(originated_at, pg_catalog.now())
      else originated_at
    end,
    answered_at = case
      when p_status = 'answered' then coalesce(answered_at, pg_catalog.now())
      else answered_at
    end,
    ended_at = case
      when p_status in ('no_answer', 'busy', 'failed', 'voicemail', 'completed')
        then coalesce(ended_at, pg_catalog.now())
      else ended_at
    end,
    updated_at = pg_catalog.now()
  where id = p_test_call_id;
end;
$function$;

revoke all on function public.register_ai_voice_test_call_event(uuid, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.register_ai_voice_test_call_event(uuid, text, text, text, jsonb, text)
  to service_role;
