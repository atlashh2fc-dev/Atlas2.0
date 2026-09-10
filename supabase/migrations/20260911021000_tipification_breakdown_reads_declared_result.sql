-- Expone también el resultado que declara el nodo del workflow.
--
-- Complementa a 20260911014000: aquella versión devolvía el estado y el
-- desenlace que graba el cierre, que cubren a las campañas comerciales y a las
-- gestiones sin contacto. Faltaba el caso de las gestiones efectivas cuyo
-- desenlace queda en `other`, que son justamente las que el workflow de la
-- campaña sí clasifica.
--
-- `workflow_steps.result_kind` (ver 20260911020000) lo declara por nodo. Acá se
-- resuelve el motivo contra los `allowed_results` del workflow de la campaña
-- del lead. La normalización a mayúsculas sin acentos es la misma con la que el
-- cierre graba el motivo: se verificó que los 17 motivos usados por la cartera
-- de cobranza casan con su nodo, ninguno queda suelto.
--
-- Cambia el tipo de retorno, así que hay que soltar y volver a crear.

drop function if exists public.get_campaign_tipification_breakdown(timestamptz, timestamptz, uuid);

create function public.get_campaign_tipification_breakdown(
  p_from timestamp with time zone,
  p_to timestamp with time zone,
  p_campaign_id uuid default null
)
returns table(reason text, status text, outcome text, declared_result text, total integer)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with nodos as (
    select s.workflow_id,
           upper(translate(opcion, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU')) as motivo,
           s.result_kind
    from public.workflow_steps s
    cross join lateral unnest(s.allowed_results) as opcion
    where s.result_kind is not null
  )
  select c.reason, c.status, c.outcome, n.result_kind, count(*)::integer as total
  from public.calls c
  join public.leads l on l.id = c.lead_id
  left join public.campaigns cm on cm.id = l.campaign_id
  left join nodos n
    on n.workflow_id = cm.workflow_id
   and n.motivo = upper(translate(c.reason, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'))
  where c.started_at >= p_from
    and c.started_at <= p_to
    and (p_campaign_id is null or l.campaign_id = p_campaign_id)
    and c.reason is not null
    and c.reason <> 'GESTION EN CURSO'
  group by c.reason, c.status, c.outcome, n.result_kind
  order by count(*) desc, c.reason;
$function$;

revoke execute on function public.get_campaign_tipification_breakdown(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_campaign_tipification_breakdown(timestamptz, timestamptz, uuid) to authenticated, service_role;

comment on function public.get_campaign_tipification_breakdown(timestamptz, timestamptz, uuid) is
  'Tipificaciones del periodo con el estado y el desenlace grabados por el cierre, mas el resultado que declara el nodo del workflow. Mismo universo que el CTE current_calls de get_campaign_dashboard_summary.';
