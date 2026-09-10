-- Expone el resultado que cada cierre ya dejó grabado.
--
-- El tablero agrupaba las tipificaciones reconociendo el texto del motivo
-- contra el catálogo comercial heredado de Equifax. En una cartera de cobranza
-- eso deja fuera casi la mitad de las gestiones, porque la campaña tipifica con
-- los pasos de su propio workflow: compromiso de pago, convenio suscrito,
-- seguimiento de convenio.
--
-- Pero el significado no había que inventarlo, ya estaba en la base. Al cerrar
-- una llamada, `closeCall` arma el catálogo desde los pasos del workflow de la
-- campaña y persiste `calls.status` y `calls.outcome` junto al motivo. Están
-- poblados en el 100 % de las 7.996 gestiones con motivo, y 138 motivos
-- distintos producen apenas 143 combinaciones: la relación es prácticamente
-- uno a uno.
--
-- Esta función expone esos dos campos, que `get_campaign_dashboard_summary`
-- calculaba y descartaba. Se hace aparte y no tocando esa función, que tiene
-- 500 líneas y alimenta dos pantallas: el objetivo era no arriesgar un
-- contrato en producción para agregar dos columnas.
--
-- El universo replica exactamente el del CTE `current_calls` de esa función:
-- llamadas de leads de la campaña, iniciadas dentro del período, con motivo y
-- excluyendo el marcador 'GESTION EN CURSO'. Es SECURITY INVOKER como aquélla,
-- así que el alcance por rol lo sigue decidiendo la política de leads.

create or replace function public.get_campaign_tipification_breakdown(
  p_from timestamp with time zone,
  p_to timestamp with time zone,
  p_campaign_id uuid default null
)
returns table(reason text, status text, outcome text, total integer)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select c.reason, c.status, c.outcome, count(*)::integer as total
  from public.calls c
  join public.leads l on l.id = c.lead_id
  where c.started_at >= p_from
    and c.started_at <= p_to
    and (p_campaign_id is null or l.campaign_id = p_campaign_id)
    and c.reason is not null
    and c.reason <> 'GESTION EN CURSO'
  group by c.reason, c.status, c.outcome
  order by count(*) desc, c.reason;
$function$;

revoke execute on function public.get_campaign_tipification_breakdown(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_campaign_tipification_breakdown(timestamptz, timestamptz, uuid) to authenticated, service_role;

comment on function public.get_campaign_tipification_breakdown(timestamptz, timestamptz, uuid) is
  'Tipificaciones del periodo con el estado y el desenlace que dejo grabado el cierre. Mismo universo que el CTE current_calls de get_campaign_dashboard_summary.';
