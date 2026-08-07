-- La serie diaria de los reportes se corta en días de la operación, no en UTC.
--
-- `generate_series(from_at::date, to_at::date)` castea en la zona de la sesión
-- (UTC en Supabase). Como el período termina a las 23:59:59 hora de Chile —que
-- en UTC ya es el día siguiente— la "Evolución diaria" agregaba un día extra
-- vacío al final. Con la ventana fija de 30 días pasaba desapercibido; ahora
-- que el período es elegible, pedir "Hoy" devolvía dos puntos para un solo día.
--
-- Por la misma razón se agrupan las gestiones por su fecha local: la operación
-- es chilena y un reporte que corta el día a las 20:00 hora local reparte mal
-- las llamadas de la tarde. Hoy no cambia ningún número (ninguna gestión de los
-- últimos 30 días cae en un día distinto al convertir la zona), pero deja el
-- cálculo correcto para cuando la operación se extienda a la noche.
--
-- Se reescriben ambas funciones a partir de su definición vigente para no
-- arrastrar una copia desactualizada de sus cientos de líneas: cualquier otro
-- cambio aplicado antes que este se conserva intacto.
do $$
declare
  v_target text;
  v_def text;
  v_new text;
begin
  foreach v_target in array array['get_campaign_dashboard_summary', 'get_crm_dashboard_summary'] loop
    select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_target;

    if v_def is null then
      raise exception 'No existe public.%', v_target;
    end if;

    v_new := replace(
      v_def,
      '(select from_at::date from params)',
      '(select (from_at at time zone ''America/Santiago'')::date from params)'
    );
    v_new := replace(
      v_new,
      '(select to_at::date from params)',
      '(select (to_at at time zone ''America/Santiago'')::date from params)'
    );
    v_new := replace(
      v_new,
      'started_at::date',
      '(started_at at time zone ''America/Santiago'')::date'
    );

    if v_new = v_def then
      raise exception 'No se encontró el patrón de fechas en public.%', v_target;
    end if;

    execute v_new;
  end loop;
end $$;
