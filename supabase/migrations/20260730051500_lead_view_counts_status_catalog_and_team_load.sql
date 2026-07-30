-- 1) El catálogo de estados se calculaba sobre el mismo conjunto ya filtrado por
--    p_status, así que al elegir un estado el desplegable se quedaba con ese
--    único valor y no había forma de saltar a otro.
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
      and (p_agent is null or l.assigned_to = p_agent or l.managed_by = p_agent)
      and (p_campaign is null or l.campaign_id = p_campaign)
  ),
  flagged as (
    select
      btrim(coalesce(phone, '')) <> '' as has_phone,
      next_action_at,
      (
        managed_at is not null
        or coalesce(assignment_status, '') = 'managed'
        or coalesce(workflow_status, '') = 'managed'
      ) as managed
    from visible
    where (p_status is null or status = p_status)
  )
  select jsonb_build_object(
    'prioridad', (select count(*) from flagged),
    'vencidas', (select count(*) from flagged where has_phone and next_action_at <= now()),
    'hoy', (
      select count(*) from flagged
      where has_phone
        and next_action_at >= date_trunc('day', now())
        and next_action_at < date_trunc('day', now()) + interval '1 day'
    ),
    'disponibles', (
      select count(*) from flagged
      where has_phone
        and not managed
        and (next_action_at is null or next_action_at >= date_trunc('day', now()) + interval '1 day')
    ),
    'bloqueados', (select count(*) from flagged where not has_phone),
    'gestionados', (select count(*) from flagged where has_phone and managed and next_action_at is null),
    -- El catálogo se calcula antes de aplicar p_status: si no, el filtro se
    -- quedaba sin las demás opciones.
    'estados', coalesce(
      (select jsonb_agg(distinct status order by status) from visible where status is not null),
      '[]'::jsonb
    )
  );
$function$;

revoke execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) to authenticated, service_role;

-- 2) La carga por ejecutivo de "Mi equipo" se calculaba en memoria sobre las
--    primeras 20.000 filas: con una base mayor los números por persona eran
--    incompletos y nada lo advertía. Ahora se agrupa en la base.
create or replace function public.get_team_agent_load()
returns table(
  profile_id uuid,
  full_name text,
  assigned bigint,
  unmanaged bigint,
  today bigint,
  overdue bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select
    p.id as profile_id,
    p.full_name,
    count(l.id) as assigned,
    count(l.id) filter (where l.managed_at is null) as unmanaged,
    count(l.id) filter (
      where l.next_action_at > now()
        and l.next_action_at < date_trunc('day', now()) + interval '1 day'
    ) as today,
    count(l.id) filter (where l.next_action_at <= now()) as overdue
  from public.profiles p
  left join public.leads l on l.assigned_to = p.id
  where p.role = 'agente' and p.active = true
  group by p.id, p.full_name
  order by p.full_name;
$function$;

revoke execute on function public.get_team_agent_load() from public, anon;
grant execute on function public.get_team_agent_load() to authenticated, service_role;

comment on function public.get_team_agent_load() is 'Carga por ejecutivo (cartera, sin gestionar, agendas de hoy y vencidas) agrupada en la base. Respeta RLS.';
