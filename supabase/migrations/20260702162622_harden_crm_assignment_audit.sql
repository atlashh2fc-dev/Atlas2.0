-- Keep assignment audit append-only from application clients.
-- Writes happen through assign_lead(), which performs role/team checks.

drop policy if exists crm_audit_events_insert_authenticated on public.crm_audit_events;
drop policy if exists crm_audit_events_delete_admin on public.crm_audit_events;

revoke insert, update, delete on public.crm_audit_events from anon, authenticated;

create or replace function public.assign_lead(
  p_lead_id uuid,
  p_agent_id uuid default null,
  p_reason text default null,
  p_source text default 'manual',
  p_set_managed_by boolean default false,
  p_next_action_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_actor_team_id uuid := (select public.current_team_id());
  v_now timestamptz := now();
  v_lead public.leads%rowtype;
  v_agent public.profiles%rowtype;
  v_old_assigned_to uuid;
  v_effective_team_id uuid;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para asignar registros.';
  end if;

  select *
  into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'El registro no existe o no está disponible para tu usuario.';
  end if;

  if v_role = 'supervisor' and (v_actor_team_id is null or v_lead.team_id is distinct from v_actor_team_id) then
    raise exception 'No puedes asignar un registro fuera de tu equipo.';
  end if;

  v_old_assigned_to := v_lead.assigned_to;

  if p_agent_id is not null then
    select *
    into v_agent
    from public.profiles
    where id = p_agent_id
      and role = 'agente'
      and active
    limit 1;

    if not found then
      raise exception 'El ejecutivo destino no existe o no está activo.';
    end if;

    v_effective_team_id := coalesce(v_lead.team_id, v_agent.team_id);

    if v_effective_team_id is null or v_agent.team_id is distinct from v_effective_team_id then
      raise exception 'El ejecutivo destino no pertenece al equipo del registro.';
    end if;

    if v_role = 'supervisor' and v_agent.team_id is distinct from v_actor_team_id then
      raise exception 'El ejecutivo destino no pertenece a tu equipo.';
    end if;
  else
    v_effective_team_id := v_lead.team_id;
  end if;

  update public.lead_assignments
  set
    is_active = false,
    ends_at = v_now,
    updated_at = v_now
  where lead_id = p_lead_id
    and is_active;

  if p_agent_id is not null then
    insert into public.lead_assignments (
      lead_id,
      assigned_to,
      assigned_by,
      team_id,
      campaign_id,
      reason,
      source,
      is_active,
      starts_at
    )
    values (
      p_lead_id,
      p_agent_id,
      v_actor_id,
      v_effective_team_id,
      v_lead.campaign_id,
      nullif(btrim(coalesce(p_reason, '')), ''),
      coalesce(nullif(btrim(p_source), ''), 'manual'),
      true,
      v_now
    );
  end if;

  update public.leads
  set
    assigned_to = p_agent_id,
    managed_by = case when p_set_managed_by then p_agent_id else managed_by end,
    team_id = v_effective_team_id,
    next_action_at = coalesce(p_next_action_at, next_action_at),
    assignment_status = case when p_agent_id is null then 'unassigned' else 'assigned' end,
    updated_at = v_now
  where id = p_lead_id;

  insert into public.crm_audit_events (
    lead_id,
    crm_entity_id,
    actor_id,
    event_type,
    payload
  )
  values (
    p_lead_id,
    v_lead.crm_entity_id,
    v_actor_id,
    case when p_agent_id is null then 'lead.unassigned' else 'lead.assigned' end,
    jsonb_build_object(
      'old_assigned_to', v_old_assigned_to,
      'new_assigned_to', p_agent_id,
      'team_id', v_effective_team_id,
      'campaign_id', v_lead.campaign_id,
      'set_managed_by', p_set_managed_by,
      'next_action_at', p_next_action_at,
      'reason', nullif(btrim(coalesce(p_reason, '')), ''),
      'source', coalesce(nullif(btrim(p_source), ''), 'manual')
    )
  );

  return jsonb_build_object(
    'lead_id', p_lead_id,
    'old_assigned_to', v_old_assigned_to,
    'assigned_to', p_agent_id,
    'team_id', v_effective_team_id,
    'set_managed_by', p_set_managed_by,
    'next_action_at', p_next_action_at
  );
end;
$function$;

revoke all on function public.assign_lead(uuid, uuid, text, text, boolean, timestamptz) from public, anon;
grant execute on function public.assign_lead(uuid, uuid, text, text, boolean, timestamptz) to authenticated;
