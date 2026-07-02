-- Los leads migrados desde CRM legado pueden estar disponibles para un equipo
-- pero sin ejecutivo asignado. Un agente del mismo equipo debe poder buscarlos,
-- abrirlos e iniciar gestion sin que RLS los oculte.

drop policy if exists leads_select on public.leads;
create policy leads_select
on public.leads
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or (
        assigned_to is null
        and managed_by is null
        and team_id = (select public.current_team_id())
      )
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = (select public.current_team_id())
  )
);

drop policy if exists leads_update on public.leads;
create policy leads_update
on public.leads
for update
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or (
        assigned_to is null
        and managed_by is null
        and team_id = (select public.current_team_id())
      )
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = (select public.current_team_id())
  )
)
with check (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or (
        assigned_to is null
        and managed_by is null
        and team_id = (select public.current_team_id())
      )
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = (select public.current_team_id())
  )
);

drop policy if exists calls_select on public.calls;
create policy calls_select
on public.calls
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and lead_id in (
      select l.id
      from public.leads l
      where l.assigned_to = (select auth.uid())
        or l.managed_by = (select auth.uid())
        or (
          l.assigned_to is null
          and l.managed_by is null
          and l.team_id = (select public.current_team_id())
        )
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and lead_id in (select l.id from public.leads l where l.team_id = (select public.current_team_id()))
  )
);

drop policy if exists calls_insert on public.calls;
create policy calls_insert
on public.calls
for insert
to authenticated
with check (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and agent_id = (select auth.uid())
    and lead_id in (
      select l.id
      from public.leads l
      where l.assigned_to = (select auth.uid())
        or l.managed_by = (select auth.uid())
        or (
          l.assigned_to is null
          and l.managed_by is null
          and l.team_id = (select public.current_team_id())
        )
    )
  )
);

drop policy if exists interactions_select on public.interactions;
create policy interactions_select
on public.interactions
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and lead_id in (
      select l.id
      from public.leads l
      where l.assigned_to = (select auth.uid())
        or l.managed_by = (select auth.uid())
        or (
          l.assigned_to is null
          and l.managed_by is null
          and l.team_id = (select public.current_team_id())
        )
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and lead_id in (select l.id from public.leads l where l.team_id = (select public.current_team_id()))
  )
);

drop policy if exists interactions_insert on public.interactions;
create policy interactions_insert
on public.interactions
for insert
to authenticated
with check (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and agent_id = (select auth.uid())
    and lead_id in (
      select l.id
      from public.leads l
      where l.assigned_to = (select auth.uid())
        or l.managed_by = (select auth.uid())
        or (
          l.assigned_to is null
          and l.managed_by is null
          and l.team_id = (select public.current_team_id())
        )
    )
  )
);

drop policy if exists call_events_select on public.call_events;
create policy call_events_select
on public.call_events
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'agente'
    and lead_id in (
      select l.id
      from public.leads l
      where l.assigned_to = (select auth.uid())
        or l.managed_by = (select auth.uid())
        or (
          l.assigned_to is null
          and l.managed_by is null
          and l.team_id = (select public.current_team_id())
        )
    )
  )
  or (
    (select public.current_role_name()) = 'supervisor'
    and lead_id in (select l.id from public.leads l where l.team_id = (select public.current_team_id()))
  )
);
