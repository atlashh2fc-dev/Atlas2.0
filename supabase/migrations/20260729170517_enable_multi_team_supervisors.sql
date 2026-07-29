-- A supervisor owns every team whose supervisor_id points at their profile.
-- profiles.team_id remains the agent's single operational team; it is no
-- longer used to limit a supervisor to one team.
update public.teams t
set supervisor_id = p.id
from public.profiles p
where t.supervisor_id is null
  and p.role = 'supervisor'
  and p.team_id = t.id;

create or replace function public.supervised_team_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(t.id order by t.name), '{}'::uuid[])
  from public.teams t
  join public.profiles p on p.id = (select auth.uid())
  where p.role = 'supervisor'
    and p.active
    and t.supervisor_id = p.id;
$$;

revoke all on function public.supervised_team_ids() from public, anon;
grant execute on function public.supervised_team_ids() to authenticated;

-- Supervisor RLS scope: every team explicitly assigned to the supervisor.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or (select public.current_role_name()) = 'admin'
  or ((select public.current_role_name()) = 'supervisor'
      and team_id = any((select unnest(public.supervised_team_ids()))))
);

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated using (
  (select public.current_role_name()) = 'admin'
  or ((select public.current_role_name()) = 'agente' and (
    assigned_to = (select auth.uid()) or managed_by = (select auth.uid())
    or (assigned_to is null and managed_by is null and team_id = (select public.current_team_id()))
  ))
  or ((select public.current_role_name()) = 'supervisor'
      and team_id = any((select unnest(public.supervised_team_ids()))))
);

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated using (
  (select public.current_role_name()) = 'admin'
  or ((select public.current_role_name()) = 'agente' and (
    assigned_to = (select auth.uid()) or managed_by = (select auth.uid())
    or (assigned_to is null and managed_by is null and team_id = (select public.current_team_id()))
  ))
  or ((select public.current_role_name()) = 'supervisor'
      and team_id = any((select unnest(public.supervised_team_ids()))))
) with check (
  (select public.current_role_name()) = 'admin'
  or ((select public.current_role_name()) = 'agente' and (
    assigned_to = (select auth.uid()) or managed_by = (select auth.uid())
    or (assigned_to is null and managed_by is null and team_id = (select public.current_team_id()))
  ))
  or ((select public.current_role_name()) = 'supervisor'
      and team_id = any((select unnest(public.supervised_team_ids()))))
);

drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls for select to authenticated using (
  (select public.current_role_name()) = 'admin'
  or ((select public.current_role_name()) = 'agente' and lead_id in (
    select l.id from public.leads l where l.assigned_to = (select auth.uid()) or l.managed_by = (select auth.uid())
  ))
  or ((select public.current_role_name()) = 'supervisor' and lead_id in (
    select l.id from public.leads l where l.team_id = any((select unnest(public.supervised_team_ids())))
  ))
);

drop policy if exists interactions_select on public.interactions;
create policy interactions_select on public.interactions for select to authenticated using (
  (select public.current_role_name()) = 'admin'
  or ((select public.current_role_name()) = 'agente' and lead_id in (
    select l.id from public.leads l where l.assigned_to = (select auth.uid()) or l.managed_by = (select auth.uid())
  ))
  or ((select public.current_role_name()) = 'supervisor' and lead_id in (
    select l.id from public.leads l where l.team_id = any((select unnest(public.supervised_team_ids())))
  ))
);

-- Keep the mature assignment/manual-record RPCs, changing only their scope
-- checks so their existing audit and duplicate-handling behaviour is retained.
do $migration$
declare definition text;
begin
  select pg_get_functiondef('public.assign_lead(uuid,uuid,text,text,boolean,timestamptz)'::regprocedure) into definition;
  definition := replace(definition,
    'v_actor_team_id uuid := (select public.current_team_id());',
    'v_supervised_team_ids uuid[] := (select public.supervised_team_ids());');
  definition := replace(definition,
    'v_actor_team_id is null',
    'coalesce(array_length(v_supervised_team_ids, 1), 0) = 0');
  definition := replace(definition,
    'v_lead.team_id is distinct from v_actor_team_id',
    'not (v_lead.team_id = any(v_supervised_team_ids))');
  definition := replace(definition,
    'v_agent.team_id is distinct from v_actor_team_id',
    'not (v_agent.team_id = any(v_supervised_team_ids))');
  execute definition;

  select pg_get_functiondef('public.create_manual_lead_record(text,text,text,text,uuid,uuid,uuid,text)'::regprocedure) into definition;
  definition := replace(definition,
    'v_actor_team_id uuid := (select public.current_team_id());',
    'v_supervised_team_ids uuid[] := (select public.supervised_team_ids());');
  definition := replace(definition,
    'if v_actor_team_id is null then\n      raise exception ''Tu supervisor no tiene equipo asignado.'';\n    end if;\n    v_effective_team_id := v_actor_team_id;',
    'if coalesce(array_length(v_supervised_team_ids, 1), 0) = 0 then\n      raise exception ''Tu supervisor no tiene equipos asignados.'';\n    end if;\n    v_effective_team_id := coalesce(p_team_id, v_supervised_team_ids[1]);\n    if not (v_effective_team_id = any(v_supervised_team_ids)) then\n      raise exception ''No puedes crear un registro fuera de tus equipos.'';\n    end if;');
  definition := replace(definition,
    'v_agent.team_id is distinct from v_actor_team_id',
    'not (v_agent.team_id = any(v_supervised_team_ids))');
  definition := replace(definition,
    'v_existing_team_id is distinct from v_actor_team_id',
    'not (v_existing_team_id = any(v_supervised_team_ids))');
  execute definition;
end;
$migration$;

create or replace function public.get_lead_records(
  p_agent uuid default null, p_campaign uuid default null, p_status text default null, p_limit integer default 300
)
returns table (id uuid, full_name text, rut text, phone text, status text, assigned_to uuid, managed_by uuid, team_id uuid, campaign_id uuid, updated_at timestamptz, next_action_at timestamptz, tipificacion_actual text, assignment_status text, workflow_status text, managed_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select l.id, l.full_name, l.rut, l.phone, l.status, l.assigned_to, l.managed_by, l.team_id, l.campaign_id,
    l.updated_at, l.next_action_at, l.tipificacion_actual, l.assignment_status, l.workflow_status, l.managed_at
  from public.leads l
  where ((select public.current_role_name()) = 'admin'
    or ((select public.current_role_name()) = 'supervisor' and l.team_id = any((select unnest(public.supervised_team_ids()))))
    or ((select public.current_role_name()) = 'agente' and (l.assigned_to = (select auth.uid()) or l.managed_by = (select auth.uid()))))
    and (p_agent is null or (select public.current_role_name()) not in ('admin', 'supervisor') or l.assigned_to = p_agent or l.managed_by = p_agent)
    and (p_campaign is null or l.campaign_id = p_campaign) and (p_status is null or l.status = p_status)
  order by l.updated_at desc limit greatest(1, least(coalesce(p_limit, 300), 500));
$$;
