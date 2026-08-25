-- Resultados estructurados y evidencia de audio para la encuesta PREVER.
--
-- ElevenLabs origina estas llamadas sin crear una fila en `calls` ni asignar
-- un ejecutivo humano. Se conserva el mismo bucket privado y catálogo que usa
-- Calidad, pero la identidad del proveedor queda explícita y auditable.

alter table public.ai_voice_campaign_configs
  add column survey_schema text,
  add constraint ai_voice_campaign_configs_survey_schema_check
    check (survey_schema is null or survey_schema = 'prever_v1');

alter table public.call_recordings
  add column source text not null default 'asterisk',
  add column provider_conversation_id text,
  add column provider_agent_name text;

alter table public.call_recordings
  alter column call_id drop not null,
  alter column agent_id drop not null;

alter table public.call_recordings
  add constraint call_recordings_source_check
    check (source in ('asterisk', 'elevenlabs')),
  add constraint call_recordings_provider_conversation_check
    check (
      (source = 'asterisk' and provider_conversation_id is null)
      or (
        source = 'elevenlabs'
        and nullif(btrim(provider_conversation_id), '') is not null
        and call_id is null
        and agent_id is null
      )
    ),
  add constraint call_recordings_provider_agent_name_check
    check (provider_agent_name is null or nullif(btrim(provider_agent_name), '') is not null);

create unique index call_recordings_provider_conversation_uidx
  on public.call_recordings (provider_conversation_id)
  where provider_conversation_id is not null;

alter table public.call_recordings
  drop constraint call_recordings_ready_payload_check,
  add constraint call_recordings_ready_payload_check
    check (
      status <> 'ready'
      or (
        storage_path is not null
        and nullif(btrim(codec), '') is not null
        and mime_type in ('audio/ogg', 'audio/opus', 'audio/mpeg')
        and size_bytes > 0
        and sha256 is not null
        and duration_seconds >= 0
        and ended_at is not null
        and ingested_at is not null
      )
    );

create or replace function public.enforce_call_recording_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.dial_attempts%rowtype;
  v_call public.calls%rowtype;
  v_lead public.leads%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_attempt
      from public.dial_attempts
     where id = new.dial_attempt_id;

    if not found then
      raise exception 'dial_attempt % no existe', new.dial_attempt_id;
    end if;

    if v_attempt.lead_id is distinct from new.lead_id
      or v_attempt.campaign_id is distinct from new.campaign_id then
      raise exception 'Los rotulos de la grabacion no corresponden al dial_attempt %', new.dial_attempt_id;
    end if;

    if new.source = 'asterisk' then
      if v_attempt.call_id is null
        or v_attempt.agent_id is null
        or v_attempt.call_id is distinct from new.call_id
        or v_attempt.agent_id is distinct from new.agent_id then
        raise exception 'La grabacion Asterisk no corresponde al dial_attempt %', new.dial_attempt_id;
      end if;

      select * into v_call from public.calls where id = new.call_id;
      if not found
        or v_call.lead_id is distinct from new.lead_id
        or v_call.agent_id is distinct from new.agent_id then
        raise exception 'La llamada % no corresponde al lead/ejecutivo indicado', new.call_id;
      end if;
    elsif v_attempt.attempt_kind <> 'ai_voice'
      or v_attempt.provider <> 'elevenlabs'
      or v_attempt.provider_conversation_id is distinct from new.provider_conversation_id then
      raise exception 'La grabacion ElevenLabs no corresponde al dial_attempt %', new.dial_attempt_id;
    end if;

    select * into v_lead from public.leads where id = new.lead_id;
    if not found or v_lead.campaign_id is distinct from new.campaign_id then
      raise exception 'El lead % no corresponde a la campana indicada', new.lead_id;
    end if;

    if new.team_id is null then
      new.team_id := v_lead.team_id;
    elsif new.team_id is distinct from v_lead.team_id then
      raise exception 'El equipo indicado no corresponde al equipo actual del lead %', new.lead_id;
    end if;
  else
    if new.dial_attempt_id is distinct from old.dial_attempt_id
      or new.call_id is distinct from old.call_id
      or new.lead_id is distinct from old.lead_id
      or new.campaign_id is distinct from old.campaign_id
      or new.agent_id is distinct from old.agent_id
      or new.team_id is distinct from old.team_id
      or new.source is distinct from old.source
      or new.provider_conversation_id is distinct from old.provider_conversation_id
      or new.provider_agent_name is distinct from old.provider_agent_name
      or new.storage_bucket is distinct from old.storage_bucket
      or new.started_at is distinct from old.started_at
      or new.created_at is distinct from old.created_at then
      raise exception 'La identidad y los snapshots de una grabacion son inmutables';
    end if;

    if old.status = 'deleted' and new.status <> 'deleted' then
      raise exception 'Una grabacion eliminada no puede reactivarse';
    end if;

    if old.ingested_at is not null and (
      new.ingest_token_hash is distinct from old.ingest_token_hash
      or new.ingest_expires_at is distinct from old.ingest_expires_at
      or new.ingested_at is distinct from old.ingested_at
    ) then
      raise exception 'La evidencia de ingesta es inmutable una vez confirmada';
    end if;

    if new.status <> old.status and not (
      (old.status = 'recording' and new.status in ('processing', 'uploading', 'ready', 'failed', 'deleted'))
      or (old.status = 'processing' and new.status in ('uploading', 'ready', 'failed', 'deleted'))
      or (old.status = 'uploading' and new.status in ('ready', 'failed', 'deleted'))
      or (old.status = 'ready' and new.status in ('failed', 'archived', 'deleted'))
      or (old.status = 'failed' and new.status in ('recording', 'processing', 'uploading', 'deleted'))
      or (old.status = 'archived' and new.status = 'deleted')
    ) then
      raise exception 'Transicion de grabacion invalida: % -> %', old.status, new.status;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

grant select (source, provider_conversation_id, provider_agent_name)
  on public.call_recordings to authenticated;

alter table public.call_transcriptions
  drop constraint call_transcriptions_provider_check,
  drop constraint call_transcriptions_model_check,
  add constraint call_transcriptions_provider_check
    check (provider in ('groq', 'elevenlabs')),
  add constraint call_transcriptions_model_check
    check (
      (provider = 'groq' and model = 'whisper-large-v3')
      or (provider = 'elevenlabs' and model = 'conversation-transcript')
    );

create table public.prever_survey_results (
  id uuid primary key default gen_random_uuid(),
  dial_attempt_id uuid not null unique
    references public.dial_attempts(id) on delete restrict,
  campaign_id uuid not null
    references public.campaigns(id) on delete restrict,
  lead_id uuid not null
    references public.leads(id) on delete restrict,
  provider_conversation_id text not null unique,
  call_status text,
  respondent_name text,
  q1_service_general smallint,
  q2_information smallint,
  q3_commitments smallint,
  q4_benefits_advice text,
  q5_no_advice_reason text,
  q6_funeral_service smallint,
  q7_service_times smallint,
  q8_overall_satisfaction smallint,
  q9_recommendation smallint,
  q10_comments text,
  transcript jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  collected_data jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prever_survey_call_status_check check (
    call_status is null or call_status in (
      'Cliente responde llamada',
      'Cliente no responde llamada',
      'Cliente NO desea responder',
      'Cliente corta la llamada',
      'Cliente solicita llamar mas tarde',
      'Numero equivocado',
      'Otros'
    )
  ),
  constraint prever_survey_q1_check check (q1_service_general is null or q1_service_general between 1 and 7),
  constraint prever_survey_q2_check check (q2_information is null or q2_information between 1 and 7),
  constraint prever_survey_q3_check check (q3_commitments is null or q3_commitments between 1 and 7),
  constraint prever_survey_q4_check check (q4_benefits_advice is null or q4_benefits_advice in ('SI', 'NO')),
  constraint prever_survey_q5_check check (q5_no_advice_reason is null or q4_benefits_advice = 'NO'),
  constraint prever_survey_q6_check check (q6_funeral_service is null or q6_funeral_service between 1 and 7),
  constraint prever_survey_q7_check check (q7_service_times is null or q7_service_times between 1 and 7),
  constraint prever_survey_q8_check check (q8_overall_satisfaction is null or q8_overall_satisfaction between 1 and 7),
  constraint prever_survey_q9_check check (q9_recommendation is null or q9_recommendation between 0 and 10),
  constraint prever_survey_transcript_check check (jsonb_typeof(transcript) = 'array'),
  constraint prever_survey_analysis_check check (jsonb_typeof(analysis) = 'object'),
  constraint prever_survey_collected_data_check check (jsonb_typeof(collected_data) = 'object'),
  constraint prever_survey_time_order_check check (ended_at is null or started_at is null or ended_at >= started_at)
);

create index prever_survey_results_campaign_started_idx
  on public.prever_survey_results (campaign_id, started_at desc);
create index prever_survey_results_lead_idx
  on public.prever_survey_results (lead_id);

create or replace function public.enforce_prever_survey_result_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.dial_attempts%rowtype;
  v_lead public.leads%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.dial_attempt_id is distinct from old.dial_attempt_id
    or new.campaign_id is distinct from old.campaign_id
    or new.lead_id is distinct from old.lead_id
    or new.provider_conversation_id is distinct from old.provider_conversation_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'La identidad del resultado PREVER es inmutable';
  end if;

  select * into v_attempt from public.dial_attempts where id = new.dial_attempt_id;
  if not found
    or v_attempt.attempt_kind <> 'ai_voice'
    or v_attempt.provider <> 'elevenlabs'
    or v_attempt.campaign_id is distinct from new.campaign_id
    or v_attempt.lead_id is distinct from new.lead_id
    or v_attempt.provider_conversation_id is distinct from new.provider_conversation_id then
    raise exception 'El resultado PREVER no corresponde al intento indicado';
  end if;

  select * into v_lead from public.leads where id = new.lead_id;
  if not found or v_lead.campaign_id is distinct from new.campaign_id then
    raise exception 'El lead no corresponde a la campana PREVER indicada';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

create trigger prever_survey_results_enforce_integrity
before insert or update on public.prever_survey_results
for each row execute function public.enforce_prever_survey_result_integrity();

alter table public.prever_survey_results enable row level security;

create policy prever_survey_results_quality_select
on public.prever_survey_results
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and exists (
      select 1
      from public.leads lead
      where lead.id = lead_id
        and lead.team_id = any((select unnest(public.supervised_team_ids())))
    )
  )
);

revoke all on public.prever_survey_results from public, anon, authenticated, service_role;
grant select on public.prever_survey_results to authenticated;
grant select, insert, update on public.prever_survey_results to service_role;

create trigger prever_survey_results_set_updated_at
before update on public.prever_survey_results
for each row execute function public.set_updated_at();
