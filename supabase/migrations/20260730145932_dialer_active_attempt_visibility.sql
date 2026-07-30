-- Red de seguridad de visibilidad: entre que la cola timbra y el registro queda
-- asignado hay un instante en que el ejecutivo tiene la llamada pero todavía no
-- es el responsable. Sin esto, el screen-pop se perdía en esa ventana.
--
-- Solo alcanza a intentos ACTIVOS asignados a esa persona: no abre nada más.
create or replace function public.has_active_dial_attempt(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.dial_attempts da
    where da.lead_id = p_lead_id
      and da.agent_id = (select auth.uid())
      and da.status in ('ringing', 'answered', 'bridged')
      and da.updated_at >= now() - interval '15 minutes'
  );
$function$;

revoke execute on function public.has_active_dial_attempt(uuid) from public, anon;
grant execute on function public.has_active_dial_attempt(uuid) to authenticated, service_role;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select using (
    (select public.current_role_name()) = 'admin'
    or (
      (select public.current_role_name()) = 'agente'
      and (
        assigned_to = (select auth.uid())
        or managed_by = (select auth.uid())
        or (assigned_to is null and managed_by is null and team_id = (select public.current_team_id()))
        or public.has_active_dial_attempt(id)
      )
    )
    or (
      (select public.current_role_name()) = 'supervisor'
      and team_id in (select unnest(public.supervised_team_ids()))
    )
  );

drop policy if exists call_events_select on public.call_events;
create policy call_events_select on public.call_events
  for select using (
    (select public.current_role_name()) = 'admin'
    or (
      (select public.current_role_name()) = 'agente'
      and (
        lead_id in (
          select l.id from public.leads l
          where l.assigned_to = (select auth.uid())
             or l.managed_by = (select auth.uid())
             or (l.assigned_to is null and l.managed_by is null and l.team_id = (select public.current_team_id()))
        )
        or public.has_active_dial_attempt(lead_id)
      )
    )
    or (
      (select public.current_role_name()) = 'supervisor'
      and lead_id in (
        select l.id from public.leads l where l.team_id = (select public.current_team_id())
      )
    )
  );
