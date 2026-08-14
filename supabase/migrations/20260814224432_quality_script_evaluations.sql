-- Evaluaciones de Calidad contra pautas comerciales versionadas (rubrica v1).
--
-- La primera pauta corresponde al guion outbound "Asistente Ejecutiva en
-- Linea — Administradores de Condominios" para la campana Secretaria Virtual.
-- La pauta completa se guarda como snapshot en cada resultado: una edicion
-- futura del guion nunca reescribe la evidencia ni el puntaje historico.

create table public.call_quality_evaluations (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null
    references public.call_recordings(id) on delete cascade,
  transcription_id uuid not null
    references public.call_transcriptions(id) on delete cascade,
  transcription_source_sha256 text not null,
  rubric_key text not null,
  rubric_version integer not null,
  rubric_name text not null,
  rubric_snapshot jsonb not null,
  provider text not null default 'inception',
  model text not null default 'mercury-2',
  status text not null default 'pending',
  overall_score numeric(5, 2),
  verdict text,
  speaker_confidence numeric(4, 3),
  summary text,
  criteria jsonb not null default '[]'::jsonb,
  strengths jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  objections jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  provider_request_id text,
  usage jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  requested_by uuid references public.profiles(id) on delete set null,
  error_message text,
  processing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_quality_evaluations_recording_rubric_unique
    unique (recording_id, rubric_key, rubric_version),
  constraint call_quality_evaluations_transcription_source_sha256_check
    check (transcription_source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint call_quality_evaluations_rubric_key_check
    check (nullif(btrim(rubric_key), '') is not null),
  constraint call_quality_evaluations_rubric_version_check
    check (rubric_version > 0),
  constraint call_quality_evaluations_provider_check
    check (provider = 'inception'),
  constraint call_quality_evaluations_model_check
    check (model = 'mercury-2'),
  constraint call_quality_evaluations_status_check
    check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint call_quality_evaluations_score_check
    check (overall_score is null or (overall_score >= 0 and overall_score <= 100)),
  constraint call_quality_evaluations_verdict_check
    check (verdict is null or verdict in ('cumple', 'parcial', 'no_cumple', 'no_evaluable')),
  constraint call_quality_evaluations_speaker_confidence_check
    check (speaker_confidence is null or (speaker_confidence >= 0 and speaker_confidence <= 1)),
  constraint call_quality_evaluations_attempt_count_check
    check (attempt_count >= 0),
  constraint call_quality_evaluations_rubric_snapshot_check
    check (jsonb_typeof(rubric_snapshot) = 'object'),
  constraint call_quality_evaluations_criteria_check
    check (jsonb_typeof(criteria) = 'array'),
  constraint call_quality_evaluations_strengths_check
    check (jsonb_typeof(strengths) = 'array'),
  constraint call_quality_evaluations_improvements_check
    check (jsonb_typeof(improvements) = 'array'),
  constraint call_quality_evaluations_objections_check
    check (jsonb_typeof(objections) = 'array'),
  constraint call_quality_evaluations_risk_flags_check
    check (jsonb_typeof(risk_flags) = 'array'),
  constraint call_quality_evaluations_usage_check
    check (jsonb_typeof(usage) = 'object'),
  constraint call_quality_evaluations_completed_payload_check
    check (
      status <> 'completed'
      or (
        overall_score is not null
        and verdict is not null
        and speaker_confidence is not null
        and nullif(btrim(summary), '') is not null
        and completed_at is not null
        and error_message is null
      )
    ),
  constraint call_quality_evaluations_failed_error_check
    check (status <> 'failed' or nullif(btrim(error_message), '') is not null)
);

comment on table public.call_quality_evaluations is
  'Evaluacion IA auditable de una transcripcion contra una pauta comercial versionada.';
comment on column public.call_quality_evaluations.rubric_snapshot is
  'Snapshot inmutable de criterios, pesos y fuente usados para producir el resultado.';
comment on column public.call_quality_evaluations.speaker_confidence is
  'Confianza de Mercury al atribuir semanticamente los turnos; Whisper no entrega diarizacion.';

create index call_quality_evaluations_status_updated_idx
  on public.call_quality_evaluations (status, updated_at desc);
create index call_quality_evaluations_completed_score_idx
  on public.call_quality_evaluations (completed_at desc, overall_score)
  where status = 'completed';
create index call_quality_evaluations_transcription_idx
  on public.call_quality_evaluations (transcription_id);

alter table public.call_quality_evaluations enable row level security;

create policy call_quality_evaluations_quality_select
on public.call_quality_evaluations
for select
to authenticated
using (
  exists (
    select 1
    from public.call_recordings recording
    where recording.id = recording_id
      and (
        (select public.current_role_name()) = 'admin'
        or (
          (select public.current_role_name()) = 'supervisor'
          and recording.team_id = any((select unnest(public.supervised_team_ids())))
        )
      )
  )
);

revoke all on public.call_quality_evaluations from anon, authenticated, service_role;
grant select on public.call_quality_evaluations to authenticated;
grant select, insert, update on public.call_quality_evaluations to service_role;

-- Extiende el resumen existente sin cambiar su firma. Las cifras de auditoria
-- solo consideran la campana outbound exacta y la version vigente de la pauta.
create or replace function public.get_quality_transcription_summary(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select case
    when (select public.current_role_name()) not in ('admin', 'supervisor')
      then jsonb_build_object(
        'total_recordings', 0,
        'eligible_recordings', 0,
        'completed', 0,
        'processing', 0,
        'failed', 0,
        'pending', 0,
        'transcribed_seconds', 0,
        'auditable_recordings', 0,
        'evaluated', 0,
        'evaluation_processing', 0,
        'evaluation_failed', 0,
        'evaluation_pending', 0,
        'average_score', 0
      )
    else (
      select jsonb_build_object(
        'total_recordings', count(*),
        'eligible_recordings', count(*) filter (
          where recording.status = 'ready'
            and recording.duration_seconds > 120
            and call.outcome in ('sale', 'not_interested')
            and (
              recording.queue_talk_seconds is null
              or recording.duration_seconds >= recording.queue_talk_seconds - 2
            )
        ),
        'completed', count(*) filter (
          where transcription.status = 'completed'
            and recording.status = 'ready'
            and recording.duration_seconds > 120
            and call.outcome in ('sale', 'not_interested')
            and (
              recording.queue_talk_seconds is null
              or recording.duration_seconds >= recording.queue_talk_seconds - 2
            )
        ),
        'processing', count(*) filter (
          where transcription.status = 'processing'
            and recording.status = 'ready'
            and recording.duration_seconds > 120
            and call.outcome in ('sale', 'not_interested')
            and (
              recording.queue_talk_seconds is null
              or recording.duration_seconds >= recording.queue_talk_seconds - 2
            )
        ),
        'failed', count(*) filter (
          where transcription.status = 'failed'
            and recording.status = 'ready'
            and recording.duration_seconds > 120
            and call.outcome in ('sale', 'not_interested')
            and (
              recording.queue_talk_seconds is null
              or recording.duration_seconds >= recording.queue_talk_seconds - 2
            )
        ),
        'pending', count(*) filter (
          where recording.status = 'ready'
            and recording.duration_seconds > 120
            and call.outcome in ('sale', 'not_interested')
            and (
              recording.queue_talk_seconds is null
              or recording.duration_seconds >= recording.queue_talk_seconds - 2
            )
            and transcription.id is null
        ),
        'transcribed_seconds', coalesce(sum(recording.duration_seconds) filter (
          where transcription.status = 'completed'
            and recording.status = 'ready'
            and recording.duration_seconds > 120
            and call.outcome in ('sale', 'not_interested')
            and (
              recording.queue_talk_seconds is null
              or recording.duration_seconds >= recording.queue_talk_seconds - 2
            )
        ), 0),
        'auditable_recordings', count(*) filter (
          where transcription.status = 'completed'
            and lower(btrim(campaign.name)) = 'secretaria virtual'
        ),
        'evaluated', count(*) filter (
          where evaluation.status = 'completed'
        ),
        'evaluation_processing', count(*) filter (
          where evaluation.status = 'processing'
        ),
        'evaluation_failed', count(*) filter (
          where evaluation.status = 'failed'
        ),
        'evaluation_pending', count(*) filter (
          where transcription.status = 'completed'
            and lower(btrim(campaign.name)) = 'secretaria virtual'
            and evaluation.id is null
        ),
        'average_score', coalesce(round(avg(evaluation.overall_score) filter (
          where evaluation.status = 'completed'
            and evaluation.verdict <> 'no_evaluable'
        ), 2), 0)
      )
      from public.call_recordings recording
      join public.calls call
        on call.id = recording.call_id
      join public.campaigns campaign
        on campaign.id = recording.campaign_id
      left join public.call_transcriptions transcription
        on transcription.recording_id = recording.id
      left join public.call_quality_evaluations evaluation
        on evaluation.recording_id = recording.id
       and evaluation.transcription_id = transcription.id
       and evaluation.transcription_source_sha256 = transcription.source_sha256
       and evaluation.rubric_key = 'secretaria_virtual_condominios'
       and evaluation.rubric_version = 1
      where recording.status <> 'deleted'
        and recording.started_at >= p_from
        and recording.started_at <= p_to
    )
  end;
$function$;

revoke all on function public.get_quality_transcription_summary(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_quality_transcription_summary(timestamptz, timestamptz)
  to authenticated;
