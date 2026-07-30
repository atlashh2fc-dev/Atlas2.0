-- La cola de registros disparaba seis `count exact` por carga (uno por
-- pestaña) sobre una tabla de 61 mil filas. Esta función los resuelve en un
-- solo recorrido y además devuelve los estados realmente presentes, para que
-- el filtro de estado deje de ofrecer valores que no existen en la base.
--
-- SECURITY INVOKER a propósito: así la visibilidad la sigue aplicando la
-- política RLS `leads_select` y no hay que replicar las reglas acá.
--
-- NOTA: la lógica de `managed` se corrige en
-- 20260730042140_fix_lead_view_counts_null_logic.sql.
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
  with flagged as (
    select
      btrim(coalesce(l.phone, '')) <> '' as has_phone,
      l.next_action_at,
      (
        l.managed_at is not null
        or coalesce(l.assignment_status, '') = 'managed'
        or coalesce(l.workflow_status, '') = 'managed'
      ) as managed,
      l.status
    from public.leads l
    where (p_ids is null or l.id = any(p_ids))
      and (p_agent is null or l.assigned_to = p_agent or l.managed_by = p_agent)
      and (p_campaign is null or l.campaign_id = p_campaign)
      and (p_status is null or l.status = p_status)
  )
  select jsonb_build_object(
    'prioridad', count(*),
    'vencidas', count(*) filter (where has_phone and next_action_at <= now()),
    'hoy', count(*) filter (
      where has_phone
        and next_action_at >= date_trunc('day', now())
        and next_action_at < date_trunc('day', now()) + interval '1 day'
    ),
    'disponibles', count(*) filter (
      where has_phone
        and not managed
        and (next_action_at is null or next_action_at >= date_trunc('day', now()) + interval '1 day')
    ),
    'bloqueados', count(*) filter (where not has_phone),
    'gestionados', count(*) filter (where has_phone and managed and next_action_at is null),
    'estados', coalesce(
      (select jsonb_agg(distinct status order by status) from flagged where status is not null),
      '[]'::jsonb
    )
  )
  from flagged;
$function$;

revoke execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) to authenticated, service_role;

comment on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) is 'Contadores de las seis vistas de la cola de registros en un solo recorrido, más los estados presentes. Respeta RLS (security invoker).';
