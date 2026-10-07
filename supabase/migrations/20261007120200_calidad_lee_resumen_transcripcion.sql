-- El perfil Calidad ve la pestaña Transcripción (cobertura y costo).
--
-- Las dos funciones son security invoker: RLS ya acota a la empresa o a los
-- equipos de quien consulta. Solo se suma 'calidad' a la lista de roles; el
-- resto de la definición vigente queda idéntico.
do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.get_quality_transcription_summary(timestamptz,timestamptz)'::regprocedure);
  if position('not in (''admin'', ''supervisor'')' in definition) = 0 then
    raise exception 'get_quality_transcription_summary cambió: revisar antes de agregar calidad';
  end if;
  execute replace(definition, 'not in (''admin'', ''supervisor'')', 'not in (''admin'', ''supervisor'', ''calidad'')');

  definition := pg_get_functiondef('public.get_quality_recent_transcriptions(timestamptz,timestamptz,integer)'::regprocedure);
  if position('in (''admin'', ''supervisor'')' in definition) = 0 then
    raise exception 'get_quality_recent_transcriptions cambió: revisar antes de agregar calidad';
  end if;
  execute replace(definition, 'in (''admin'', ''supervisor'')', 'in (''admin'', ''supervisor'', ''calidad'')');
end;
$migration$;
