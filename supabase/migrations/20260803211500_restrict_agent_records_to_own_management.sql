-- Un agente no debe poder explorar la bolsa completa de su equipo desde
-- Registros ni mediante consultas directas a `leads`. La bolsa pertenece al
-- discador; el agente sólo necesita acceso a su cartera asignada/gestionada y
-- al registro que está atendiendo en este instante.
--
-- "Mis registros" aplica un alcance todavía más estricto en la aplicación:
-- managed_by = auth.uid() AND managed_at IS NOT NULL. Estas políticas son la
-- defensa en profundidad que evita exponer leads sin asignar.

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
for select to authenticated using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or public.has_active_dial_attempt(id)
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = any(public.supervised_team_ids())
  )
);

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
for update to authenticated using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or public.has_active_dial_attempt(id)
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = any(public.supervised_team_ids())
  )
) with check (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or public.has_active_dial_attempt(id)
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = any(public.supervised_team_ids())
  )
);

-- El screen-pop mantiene acceso a sus eventos mientras el intento está activo,
-- pero ya no hereda visibilidad sobre eventos de toda la bolsa del equipo.
drop policy if exists call_events_select on public.call_events;
create policy call_events_select on public.call_events
for select to authenticated using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and (
      lead_id in (
        select l.id
        from public.leads l
        where l.assigned_to = (select auth.uid())
           or l.managed_by = (select auth.uid())
      )
      or public.has_active_dial_attempt(lead_id)
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and lead_id in (
      select l.id
      from public.leads l
      where l.team_id = any(public.supervised_team_ids())
    )
  )
);

-- Los contadores deben usar exactamente el mismo universo que la tabla. RLS
-- permite además la cartera asignada por motivos operativos (integraciones y
-- screen-pop), por lo que el read model agrega el alcance de historial cuando
-- quien consulta es un agente.
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
          and l.managed_at is not null
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
    'estados', coalesce(
      (select jsonb_agg(distinct status order by status) from visible where status is not null),
      '[]'::jsonb
    )
  );
$function$;

revoke execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) to authenticated, service_role;

comment on policy leads_select on public.leads is
  'Admin: global. Supervisor: equipos supervisados. Agente: cartera propia o intento activo; nunca la bolsa sin asignar.';
comment on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) is
  'Contadores de Registros. Para agentes sólo incluye gestiones propias cerradas (managed_by + managed_at).';
