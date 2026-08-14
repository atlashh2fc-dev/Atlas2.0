-- Mantiene el reporte alineado con la selección de Calidad: únicamente venta o
-- rechazo, audio disponible y completo, duración superior a dos minutos.
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
      with scoped as (
        select
          recording.duration_seconds,
          recording.status as recording_status,
          call.outcome,
          campaign.name as campaign_name,
          transcription.id as transcription_id,
          transcription.status as transcription_status,
          evaluation.id as evaluation_id,
          evaluation.status as evaluation_status,
          evaluation.overall_score,
          evaluation.verdict,
          (
            recording.status = 'ready'
            and recording.duration_seconds > 120
            and call.outcome in ('sale', 'not_interested')
            and (
              recording.queue_talk_seconds is null
              or recording.duration_seconds >= recording.queue_talk_seconds - 2
            )
          ) as is_selected,
          (lower(btrim(campaign.name)) = 'secretaria virtual') as uses_rubric
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
      select jsonb_build_object(
        'total_recordings', count(*),
        'eligible_recordings', count(*) filter (where is_selected),
        'completed', count(*) filter (
          where is_selected and transcription_status = 'completed'
        ),
        'processing', count(*) filter (
          where is_selected and transcription_status = 'processing'
        ),
        'failed', count(*) filter (
          where is_selected and transcription_status = 'failed'
        ),
        'pending', count(*) filter (
          where is_selected and transcription_id is null
        ),
        'transcribed_seconds', coalesce(sum(duration_seconds) filter (
          where is_selected and transcription_status = 'completed'
        ), 0),
        'auditable_recordings', count(*) filter (
          where is_selected
            and uses_rubric
            and transcription_status = 'completed'
        ),
        'evaluated', count(*) filter (
          where is_selected
            and uses_rubric
            and transcription_status = 'completed'
            and evaluation_status = 'completed'
        ),
        'evaluation_processing', count(*) filter (
          where is_selected
            and uses_rubric
            and transcription_status = 'completed'
            and evaluation_status = 'processing'
        ),
        'evaluation_failed', count(*) filter (
          where is_selected
            and uses_rubric
            and transcription_status = 'completed'
            and evaluation_status = 'failed'
        ),
        'evaluation_pending', count(*) filter (
          where is_selected
            and uses_rubric
            and transcription_status = 'completed'
            and evaluation_id is null
        ),
        'average_score', coalesce(round(avg(overall_score) filter (
          where is_selected
            and uses_rubric
            and transcription_status = 'completed'
            and evaluation_status = 'completed'
            and verdict <> 'no_evaluable'
        ), 2), 0)
      )
      from scoped
    )
  end;
$function$;

revoke all on function public.get_quality_transcription_summary(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_quality_transcription_summary(timestamptz, timestamptz)
  to authenticated;
