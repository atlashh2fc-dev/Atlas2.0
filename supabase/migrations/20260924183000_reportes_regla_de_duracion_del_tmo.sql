-- Qué duración entra al TMO, en una sola regla para todos los reportes.
--
-- Atlas 1 no midió la duración de sus llamadas (duration_seconds venía vacío
-- en todas): lo que quedó en started_at/ended_at son las horas del formulario,
-- y 2.953 de esas llamadas se cerraron días después (la más larga, 105 días).
-- Sumadas, el TMO del equipo Equifax salía en ~17,7 horas. Por eso las llamadas
-- migradas (legacy_call_id) no entran al TMO; siguen contando como gestión.
-- En las nativas se aplica el mismo criterio de cualquier contact center: una
-- gestión abierta más de 2 horas es un registro olvidado que alguien cerró
-- después, no tiempo de atención (hoy son 13 de 9.047; el p99 es 9 minutos).
-- Se descarta, no se recorta: recortarla a 2 h seguiría inflando el promedio.

create or replace function public.report_call_handle_seconds(
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_legacy_call_id text
)
returns numeric
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_legacy_call_id is not null then null
    when p_started_at is null or p_ended_at is null then null
    when p_ended_at < p_started_at then null
    when p_ended_at - p_started_at > interval '2 hours' then null
    else extract(epoch from (p_ended_at - p_started_at))::numeric
  end;
$$;

comment on function public.report_call_handle_seconds(timestamptz, timestamptz, text) is
  'Segundos de atención que entran al TMO; null si la llamada es migrada de Atlas 1, está abierta o dura más de 2 horas.';

-- Es una función pura, pero los reportes que corren como quien consulta la
-- necesitan; a visitantes no les sirve.
revoke all on function public.report_call_handle_seconds(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.report_call_handle_seconds(timestamptz, timestamptz, text) to authenticated, service_role;
