-- Qué duración entra al TMO y qué llamada es una cotización, cada una en una
-- sola regla para todos los reportes.
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
--
-- Las dos reglas van sin «set search_path» a propósito: así Postgres las
-- incrusta en la consulta que las usa en vez de llamarlas fila por fila. Con el
-- set, evaluarlas sobre las 107 mil llamadas costaba 0,7 s (TMO) y 3,6 s
-- (cotización); incrustadas, 25 ms y ~100 ms. No hay riesgo de suplantación:
-- solo usan operadores y funciones de pg_catalog, que Postgres busca antes que
-- cualquier esquema del search_path.

create or replace function public.report_call_handle_seconds(
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_legacy_call_id text
)
returns numeric
language sql
immutable
parallel safe
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

-- Qué llamada es una cotización.
--
-- Los reportes buscaban «COTIZACION» y «VENTA» dentro del motivo. Con el
-- historial de Atlas 1 eso contaba como venta el motivo «CLIENTE NO SUJETO A
-- VENTA» (206 llamadas, outcome not_interested) y notas libres con
-- «VENTAS@...» o «Postventa»: en septiembre el equipo Equifax veía 37 ventas y
-- las reales eran 5. La venta pasa a contarse por el resultado declarado
-- (outcome = 'sale'), que ya tienen «VENTA EN VALIDACION» de Atlas 1 y «VENTA
-- CERRADA» nativa. La cotización no tiene un resultado propio (sale como
-- interested, callback u other), así que se reconoce por su motivo exacto del
-- árbol, sin importar mayúsculas ni tilde, para que la «cotización enviada»
-- escrita a mano en Atlas 1 también cuente.
create or replace function public.report_call_is_quote(p_reason text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(upper(btrim(translate(p_reason, 'óÓ', 'oO'))) = 'COTIZACION ENVIADA', false);
$$;

comment on function public.report_call_is_quote(text) is
  'true si el motivo de la llamada es la cotización enviada del árbol de tipificación.';

revoke all on function public.report_call_is_quote(text) from public, anon;
grant execute on function public.report_call_is_quote(text) to authenticated, service_role;
