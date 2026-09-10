-- Exige rol para el embudo por canal de Secretaría Virtual.
--
-- La función es SECURITY DEFINER, así que omite el RLS de leads, calls y
-- whatsapp. No comprobaba rol, de modo que cualquier agente con sesión obtenía
-- las métricas completas de la campaña: base, contactados, interesados y
-- ventas por canal. No es dato personal, pero es inteligencia comercial fuera
-- del alcance de su rol.
--
-- Sólo la llaman pantallas de administración, así que el guardia no cambia
-- ningún uso legítimo. Sigue el mismo patrón que
-- 20260730041934_harden_report_function_role_guard.
--
-- El cuerpo se trasplanta desde el catálogo en vez de transcribirse: son 5.600
-- caracteres de agregaciones por canal y copiarlos sólo agregaría una
-- oportunidad de equivocarse. La migración que crea la función corre antes que
-- ésta, así que en una base nueva el trasplante encuentra lo que necesita.
--
-- Es idempotente: si la función ya tiene el guardia, no la toca.
--
-- Verificado después de aplicar: con clave de servicio devuelve exactamente los
-- mismos tres canales y las mismas cifras que antes (Mail 400, WhatsApp 8,
-- Llamada / base 7.269), y sin sesión queda rechazada.

do $bloque$
declare
  cuerpo text;
begin
  select prosrc into cuerpo
  from pg_proc
  where proname = 'get_secretaria_virtual_channel_funnel'
    and pronamespace = 'public'::regnamespace;

  if cuerpo is null then
    raise exception 'No se encontro la funcion original.';
  end if;

  -- Ya envuelta: el cuerpo de plpgsql contiene `return query`.
  if position('return query' in lower(cuerpo)) > 0 then
    raise notice 'La funcion ya tiene guardia, no se toca.';
    return;
  end if;

  execute format(
    'create or replace function public.get_secretaria_virtual_channel_funnel('
    || 'p_from timestamp with time zone, p_to timestamp with time zone) '
    || 'returns table(channel text, base integer, contacted integer, interested integer, sales integer) '
    || 'language plpgsql stable security definer set search_path to %L as $f$ '
    || 'begin '
    || '  if not public.request_is_service_role() '
    || '     and coalesce((select public.current_role_name())::text, '''') not in (''admin'', ''supervisor'') then '
    || '    raise exception ''No tienes permisos para ver este reporte.''; '
    || '  end if; '
    || '  return query %s '
    || 'end $f$',
    'public', cuerpo
  );
end
$bloque$;
