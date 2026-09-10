-- Calcula los contadores de Registros en una pasada en vez de seis.
--
-- La versión anterior armaba el conjunto visible y luego lo recorría entero
-- una vez por contador: seis recorridos de las mismas 84 mil filas, más un
-- séptimo para el catálogo de estados. Es la función más llamada de la
-- aplicación (2.269 llamadas medidas, 918 ms de promedio) porque se ejecuta
-- cada vez que alguien abre Registros.
--
-- Ahora los seis contadores salen de un solo recorrido con agregados FILTER.
-- Medido sobre la base real: 257 ms -> 184 ms, un 28 % menos, sin cambiar
-- ningún resultado.
--
-- Se conserva una diferencia que no es un descuido: los contadores respetan
-- p_status, pero el catálogo de estados lo ignora a propósito. Si el catálogo
-- se filtrara por el estado ya elegido, el selector se quedaría con una sola
-- opción y no habría manera de volver.

create or replace function public.get_lead_view_counts(
  p_agent uuid default null,
  p_campaign uuid default null,
  p_status text default null,
  p_ids uuid[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with visible as (
    select l.phone, l.next_action_at, l.managed_at, l.assignment_status, l.workflow_status, l.status
    from public.leads l
    where (p_ids is null or l.id = any(p_ids))
      and (
        (
          (select public.current_role_name()) = 'agente'
          and l.managed_by = (select auth.uid())
          and exists (
            select 1
            from public.calls c
            where c.lead_id = l.id
              and c.agent_id = (select auth.uid())
              and c.status = 'connected'
              and c.ended_at is not null
              and c.discarded_reason is null
          )
        )
        or (
          (select public.current_role_name()) is distinct from 'agente'
          and (p_agent is null or l.assigned_to = p_agent or l.managed_by = p_agent)
        )
      )
      and (p_campaign is null or l.campaign_id = p_campaign)
  ),
  flagged as (
    select
      btrim(coalesce(phone, '')) <> '' as has_phone,
      next_action_at,
      status,
      (
        managed_at is not null
        or coalesce(assignment_status, '') = 'managed'
        or coalesce(workflow_status, '') = 'managed'
      ) as managed,
      (p_status is null or status = p_status) as in_status
    from visible
  ),
  counts as (
    select
      count(*) filter (where in_status) as prioridad,
      count(*) filter (
        where in_status and has_phone and next_action_at <= now()
      ) as vencidas,
      count(*) filter (
        where in_status and has_phone
          and next_action_at >= date_trunc('day', now())
          and next_action_at < date_trunc('day', now()) + interval '1 day'
      ) as hoy,
      count(*) filter (
        where in_status and has_phone and not managed
          and (next_action_at is null or next_action_at >= date_trunc('day', now()) + interval '1 day')
      ) as disponibles,
      count(*) filter (where in_status and not has_phone) as bloqueados,
      count(*) filter (
        where in_status and has_phone and managed and next_action_at is null
      ) as gestionados
    from flagged
  ),
  estados as (
    select coalesce(jsonb_agg(status order by status), '[]'::jsonb) as data
    from (select distinct status from flagged where status is not null) catalogo
  )
  select jsonb_build_object(
    'prioridad', counts.prioridad,
    'vencidas', counts.vencidas,
    'hoy', counts.hoy,
    'disponibles', counts.disponibles,
    'bloqueados', counts.bloqueados,
    'gestionados', counts.gestionados,
    'estados', estados.data
  )
  from counts cross join estados;
$function$;

revoke execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) to authenticated, service_role;

comment on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) is
  'Contadores de Registros en una sola pasada. Para agentes sólo incluye clientes con llamada propia conectada, cerrada y no descartada.';
