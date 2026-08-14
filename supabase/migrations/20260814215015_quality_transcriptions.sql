-- Transcripciones de grabaciones de Calidad.
--
-- El audio sigue siendo privado. Admin y supervisores solo pueden leer la
-- transcripcion de grabaciones que ya estan dentro de su alcance; toda
-- escritura la realiza el backend con service_role despues de autorizar al
-- usuario con su sesion y RLS.

create table public.call_transcriptions (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null unique
    references public.call_recordings(id) on delete cascade,
  provider text not null default 'groq',
  model text not null default 'whisper-large-v3',
  source_sha256 text not null,
  status text not null default 'pending',
  language_code text,
  transcript_text text,
  segments jsonb not null default '[]'::jsonb,
  words jsonb not null default '[]'::jsonb,
  provider_request_id text,
  attempt_count integer not null default 0,
  requested_by uuid references public.profiles(id) on delete set null,
  error_message text,
  processing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_transcriptions_provider_check
    check (provider = 'groq'),
  constraint call_transcriptions_model_check
    check (model = 'whisper-large-v3'),
  constraint call_transcriptions_source_sha256_check
    check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint call_transcriptions_status_check
    check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint call_transcriptions_attempt_count_check
    check (attempt_count >= 0),
  constraint call_transcriptions_segments_check
    check (jsonb_typeof(segments) = 'array'),
  constraint call_transcriptions_words_check
    check (jsonb_typeof(words) = 'array'),
  constraint call_transcriptions_completed_payload_check
    check (
      status <> 'completed'
      or (
        nullif(btrim(transcript_text), '') is not null
        and completed_at is not null
        and error_message is null
      )
    ),
  constraint call_transcriptions_failed_error_check
    check (
      status <> 'failed'
      or nullif(btrim(error_message), '') is not null
    )
);

comment on table public.call_transcriptions is
  'Resultado auditable de transcripcion de una grabacion; el audio no se expone al navegador ni se almacena aqui.';
comment on column public.call_transcriptions.source_sha256 is
  'Hash del audio transcrito; evita reutilizar texto si el objeto fuente cambia.';
comment on column public.call_transcriptions.segments is
  'Segmentos con timestamps devueltos por el proveedor, sin asumir identidad del hablante.';

create index call_transcriptions_status_updated_idx
  on public.call_transcriptions (status, updated_at desc);
create index call_transcriptions_completed_at_idx
  on public.call_transcriptions (completed_at desc)
  where status = 'completed';

alter table public.call_transcriptions enable row level security;

create policy call_transcriptions_quality_select
on public.call_transcriptions
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

revoke all on public.call_transcriptions from anon, authenticated, service_role;
grant select on public.call_transcriptions to authenticated;
grant select, insert, update on public.call_transcriptions to service_role;

-- Resumen exacto para Reportes y analisis. SECURITY INVOKER conserva RLS y
-- el guard de rol evita convertir la funcion en una consulta generica.
create function public.get_quality_transcription_summary(
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
        'transcribed_seconds', 0
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
        ), 0)
      )
      from public.call_recordings recording
      join public.calls call
        on call.id = recording.call_id
      left join public.call_transcriptions transcription
        on transcription.recording_id = recording.id
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

create function public.get_quality_recent_transcriptions(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 50
)
returns table (
  recording_id uuid,
  recording_started_at timestamptz,
  campaign_id uuid,
  agent_id uuid,
  transcription_status text,
  language_code text,
  transcript_characters integer,
  transcription_updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    recording.id,
    recording.started_at,
    recording.campaign_id,
    recording.agent_id,
    transcription.status,
    transcription.language_code,
    char_length(coalesce(transcription.transcript_text, '')),
    transcription.updated_at
  from public.call_transcriptions transcription
  join public.call_recordings recording
    on recording.id = transcription.recording_id
  join public.calls call
    on call.id = recording.call_id
  where (select public.current_role_name()) in ('admin', 'supervisor')
    and recording.started_at >= p_from
    and recording.started_at <= p_to
    and recording.status = 'ready'
    and recording.duration_seconds > 120
    and call.outcome in ('sale', 'not_interested')
    and (
      recording.queue_talk_seconds is null
      or recording.duration_seconds >= recording.queue_talk_seconds - 2
    )
  order by transcription.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$function$;

revoke all on function public.get_quality_recent_transcriptions(timestamptz, timestamptz, integer)
  from public, anon;
grant execute on function public.get_quality_recent_transcriptions(timestamptz, timestamptz, integer)
  to authenticated;
