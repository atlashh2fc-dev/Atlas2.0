-- Campañas salientes atendidas exclusivamente por un agente de voz IA.
--
-- Este flujo es deliberadamente independiente del discador humano:
-- - no usa campaign_agents, extensiones ni Queue de Asterisk;
-- - Atlas conserva la base, el claim y la auditoría;
-- - ElevenLabs origina la conversación por el troncal SIP configurado;
-- - la API key vive solo en el motor, nunca en Supabase ni en el navegador.

create table public.ai_voice_campaign_configs (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  provider text not null default 'elevenlabs',
  agent_id text not null,
  phone_number_id text,
  max_concurrent_calls integer not null default 1,
  max_attempts_per_contact integer not null default 1,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_voice_campaign_configs_provider_check
    check (provider = 'elevenlabs'),
  constraint ai_voice_campaign_configs_agent_id_check
    check (agent_id ~ '^agent_[A-Za-z0-9]+$'),
  constraint ai_voice_campaign_configs_phone_number_id_check
    check (phone_number_id is null or btrim(phone_number_id) <> ''),
  constraint ai_voice_campaign_configs_concurrency_check
    check (max_concurrent_calls between 1 and 10),
  constraint ai_voice_campaign_configs_attempts_check
    check (max_attempts_per_contact between 1 and 5)
);

comment on table public.ai_voice_campaign_configs is
  'Configuración de campañas sin ejecutivos humanos, atendidas por un agente de voz IA.';
comment on column public.ai_voice_campaign_configs.phone_number_id is
  'ID no secreto del número/troncal SIP importado en ElevenLabs. La API key permanece en el motor.';

alter table public.ai_voice_campaign_configs enable row level security;

create policy ai_voice_campaign_configs_select
  on public.ai_voice_campaign_configs
  for select to authenticated
  using (true);

create policy ai_voice_campaign_configs_admin_insert
  on public.ai_voice_campaign_configs
  for insert to authenticated
  with check (public.current_role_name() = 'admin'::public.app_role);

create policy ai_voice_campaign_configs_admin_update
  on public.ai_voice_campaign_configs
  for update to authenticated
  using (public.current_role_name() = 'admin'::public.app_role)
  with check (public.current_role_name() = 'admin'::public.app_role);

create policy ai_voice_campaign_configs_admin_delete
  on public.ai_voice_campaign_configs
  for delete to authenticated
  using (public.current_role_name() = 'admin'::public.app_role);

grant select, insert, update, delete on table public.ai_voice_campaign_configs to authenticated;
grant select, insert, update, delete on table public.ai_voice_campaign_configs to service_role;

create trigger ai_voice_campaign_configs_set_updated_at
  before update on public.ai_voice_campaign_configs
  for each row execute function public.set_updated_at();

create or replace function public.enforce_campaign_dialer_isolation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_table_name = 'ai_voice_campaign_configs' and exists (
    select 1 from public.dialer_campaign_configs human
    where human.campaign_id = new.campaign_id
  ) then
    raise exception 'Una campaña IA no puede usar el discador de ejecutivos.';
  end if;

  if tg_table_name = 'ai_voice_campaign_configs' and exists (
    select 1 from public.campaign_agents membership
    where membership.campaign_id = new.campaign_id
  ) then
    raise exception 'Una campaña IA no puede tener ejecutivos asignados.';
  end if;

  if tg_table_name = 'dialer_campaign_configs' and exists (
    select 1 from public.ai_voice_campaign_configs ai
    where ai.campaign_id = new.campaign_id
  ) then
    raise exception 'Una campaña de ejecutivos no puede usar el discador IA.';
  end if;


  if tg_table_name = 'campaign_agents' and exists (
    select 1 from public.ai_voice_campaign_configs ai
    where ai.campaign_id = new.campaign_id
  ) then
    raise exception 'No se pueden asignar ejecutivos a una campaña IA.';
  end if;

  return new;
end;
$function$;

create trigger ai_voice_campaign_configs_isolation
  before insert or update on public.ai_voice_campaign_configs
  for each row execute function public.enforce_campaign_dialer_isolation();

create trigger dialer_campaign_configs_ai_isolation
  before insert or update on public.dialer_campaign_configs
  for each row execute function public.enforce_campaign_dialer_isolation();

create trigger campaign_agents_ai_isolation
  before insert or update on public.campaign_agents
  for each row execute function public.enforce_campaign_dialer_isolation();

alter table public.dial_attempts
  add column if not exists provider text not null default 'asterisk',
  add column if not exists provider_conversation_id text,
  add column if not exists provider_call_id text,
  add column if not exists provider_result jsonb not null default '{}'::jsonb;

alter table public.dial_attempts
  drop constraint if exists dial_attempts_attempt_kind_check;
alter table public.dial_attempts
  add constraint dial_attempts_attempt_kind_check
  check (attempt_kind in ('pool', 'personal_callback', 'ai_voice'));

alter table public.dial_attempts
  add constraint dial_attempts_provider_check
  check (provider in ('asterisk', 'elevenlabs'));

create unique index dial_attempts_provider_conversation_uidx
  on public.dial_attempts (provider, provider_conversation_id)
  where provider_conversation_id is not null;

comment on column public.dial_attempts.provider is
  'asterisk para el discador humano; elevenlabs para campañas de voz IA.';
comment on column public.dial_attempts.provider_result is
  'Resumen técnico del proveedor, sin credenciales ni audio.';

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
    select attempt.lead_id, count(*)::integer as attempts
    from public.dial_attempts attempt
    where attempt.campaign_id = p_campaign_id
      and attempt.attempt_kind = 'ai_voice'
    group by attempt.lead_id
  ), candidates as (
    select lead.id, lead.phone, lead.full_name, lead.rut
    from public.leads lead
    left join attempts_by_lead on attempts_by_lead.lead_id = lead.id
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
    returning id, lead_id
  )
  select
    inserted.id,
    inserted.lead_id,
    candidates.phone,
    candidates.full_name,
    candidates.rut
  from inserted
  join candidates on candidates.id = inserted.lead_id;
end;
$function$;

revoke all on function public.claim_next_ai_voice_targets(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_ai_voice_targets(uuid, integer)
  to service_role;

create or replace function public.register_ai_voice_event(
  p_dial_attempt_id uuid,
  p_status text,
  p_provider_conversation_id text default null,
  p_provider_call_id text default null,
  p_result jsonb default '{}'::jsonb,
  p_hangup_cause text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_attempt public.dial_attempts;
  v_current_rank integer;
  v_incoming_rank integer;
begin
  if v_actor_id is not null then
    raise exception 'register_ai_voice_event solo puede ser llamada por el motor.';
  end if;

  if p_status not in (
    'queued', 'originating', 'ringing', 'answered', 'bridged',
    'no_answer', 'busy', 'failed', 'voicemail', 'completed'
  ) then
    raise exception 'Estado IA inválido: %', p_status;
  end if;

  select * into v_attempt
  from public.dial_attempts
  where id = p_dial_attempt_id
    and attempt_kind = 'ai_voice'
    and provider = 'elevenlabs'
  for update;

  if not found then
    raise exception 'Intento IA % no existe.', p_dial_attempt_id;
  end if;

  if v_attempt.status in ('no_answer', 'busy', 'failed', 'voicemail', 'completed') then
    return;
  end if;

  v_current_rank := case v_attempt.status
    when 'queued' then 0
    when 'originating' then 1
    when 'ringing' then 2
    when 'answered' then 3
    when 'bridged' then 4
    else 0
  end;
  v_incoming_rank := case p_status
    when 'queued' then 0
    when 'originating' then 1
    when 'ringing' then 2
    when 'answered' then 3
    when 'bridged' then 4
    else 100
  end;

  if v_incoming_rank < v_current_rank then
    return;
  end if;

  update public.dial_attempts
  set
    status = p_status,
    provider_conversation_id = coalesce(p_provider_conversation_id, provider_conversation_id),
    provider_call_id = coalesce(p_provider_call_id, provider_call_id),
    provider_result = provider_result || coalesce(p_result, '{}'::jsonb),
    hangup_cause = coalesce(p_hangup_cause, hangup_cause),
    originated_at = case when p_status = 'originating' then coalesce(originated_at, now()) else originated_at end,
    answered_at = case when p_status in ('answered', 'bridged') then coalesce(answered_at, now()) else answered_at end,
    bridged_at = case when p_status = 'bridged' then coalesce(bridged_at, now()) else bridged_at end,
    ended_at = case
      when p_status in ('no_answer', 'busy', 'failed', 'voicemail', 'completed') then coalesce(ended_at, now())
      else ended_at
    end,
    updated_at = now()
  where id = p_dial_attempt_id;

  if p_status = 'completed' then
    update public.leads
    set
      managed_at = coalesce(managed_at, now()),
      assignment_status = 'managed',
      workflow_status = 'managed',
      extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object(
        'last_ai_provider', 'elevenlabs',
        'last_ai_conversation_id', coalesce(p_provider_conversation_id, v_attempt.provider_conversation_id)
      ),
      updated_at = now()
    where id = v_attempt.lead_id;
  end if;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    null,
    v_attempt.lead_id,
    null,
    'ai_voice.' || p_status,
    coalesce(p_result, '{}'::jsonb) || jsonb_build_object(
      'dial_attempt_id', p_dial_attempt_id,
      'campaign_id', v_attempt.campaign_id,
      'provider', 'elevenlabs',
      'provider_conversation_id', coalesce(p_provider_conversation_id, v_attempt.provider_conversation_id),
      'provider_call_id', coalesce(p_provider_call_id, v_attempt.provider_call_id)
    )
  );
end;
$function$;

revoke all on function public.register_ai_voice_event(uuid, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.register_ai_voice_event(uuid, text, text, text, jsonb, text)
  to service_role;

-- Configura el piloto ya creado en Atlas, siempre detenido y sin troncal hasta
-- completar la integración Asterisk. En instalaciones donde no existe esa
-- campaña, este bloque no inserta nada.
insert into public.ai_voice_campaign_configs (
  campaign_id,
  provider,
  agent_id,
  phone_number_id,
  max_concurrent_calls,
  max_attempts_per_contact,
  is_active
)
select
  campaign.id,
  'elevenlabs',
  'agent_5001m0trhg8cfhs98qhw1bpayagf',
  null,
  1,
  1,
  false
from public.campaigns campaign
where campaign.name = 'Piloto IA ElevenLabs'
on conflict (campaign_id) do nothing;
