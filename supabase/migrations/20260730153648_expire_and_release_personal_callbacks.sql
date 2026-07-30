-- Barrido de compromisos que se pasaron de la ventana sin poder entregarse.
-- Con la política `release_to_pool` se sueltan a la campaña; con
-- `keep_in_agenda` quedan vencidos en la agenda de su ejecutivo y el supervisor
-- decide qué hacer.
create or replace function public.expire_personal_callbacks(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_cfg public.dialer_campaign_configs%rowtype;
  v_count integer := 0;
begin
  if v_actor_id is not null then
    raise exception 'expire_personal_callbacks solo puede ser llamada por el motor de discado.';
  end if;

  select * into v_cfg from public.dialer_campaign_configs where campaign_id = p_campaign_id;
  if not found or v_cfg.personal_callback_on_expiry <> 'release_to_pool' then
    return 0;
  end if;

  with vencidos as (
    select l.id
    from public.leads l
    where l.campaign_id = p_campaign_id
      and l.workflow_status = 'callback'
      and l.callback_mode = 'personal'
      and l.next_action_at is not null
      and l.next_action_at < now() - make_interval(mins => v_cfg.personal_callback_window_minutes)
    for update skip locked
  ), soltados as (
    update public.leads l
       set callback_mode = 'campaign',
           callback_released_at = now(),
           assigned_to = null,
           managed_by = null,
           assignment_status = 'unassigned',
           updated_at = now()
      from vencidos v
     where l.id = v.id
    returning l.id as released_id, l.crm_entity_id as entity_id
  ), auditado as (
    insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
    select s.released_id, s.entity_id, null, 'callback.released_to_pool',
           jsonb_build_object('campaign_id', p_campaign_id, 'source', 'dialer.expiry')
    from soltados s
    returning 1
  )
  select count(*)::integer into v_count from auditado;

  return coalesce(v_count, 0);
end;
$function$;

revoke execute on function public.expire_personal_callbacks(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Control del supervisor sobre las agendas.
-- ---------------------------------------------------------------------------

-- Reagendar en lote: "el ejecutivo X no vino, muevo sus 30 compromisos".
-- Puede además traspasarlos a otro ejecutivo.
create or replace function public.reschedule_callbacks(
  p_lead_ids uuid[],
  p_next_action_at timestamptz,
  p_agent_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_teams uuid[] := (select public.supervised_team_ids());
  v_count integer := 0;
  v_agent public.profiles%rowtype;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;
  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para reagendar compromisos.';
  end if;
  if p_next_action_at is null then
    raise exception 'Indica la nueva fecha y hora.';
  end if;

  if p_agent_id is not null then
    select * into v_agent from public.profiles
    where id = p_agent_id and role = 'agente' and active limit 1;
    if not found then
      raise exception 'El ejecutivo destino no existe o no está activo.';
    end if;
  end if;

  with permitidos as (
    select l.id, l.crm_entity_id
    from public.leads l
    where l.id = any(p_lead_ids)
      and (
        v_role = 'admin'
        or (l.team_id = any(v_teams))
      )
    for update
  ), actualizados as (
    update public.leads l
       set next_action_at = p_next_action_at,
           workflow_status = 'callback',
           callback_mode = 'personal',
           callback_attempts = 0,
           callback_last_attempt_at = null,
           managed_by = coalesce(p_agent_id, l.managed_by),
           assigned_to = coalesce(p_agent_id, l.assigned_to),
           updated_at = now()
      from permitidos p
     where l.id = p.id
    returning l.id as lead_ref, l.crm_entity_id as entity_ref
  ), auditado as (
    insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
    select a.lead_ref, a.entity_ref, v_actor_id, 'callback.rescheduled',
           jsonb_build_object(
             'next_action_at', p_next_action_at,
             'new_owner', p_agent_id,
             'source', 'supervisor'
           )
    from actualizados a
    returning 1
  )
  select count(*)::integer into v_count from auditado;

  return coalesce(v_count, 0);
end;
$function$;

-- Derivar compromisos al discador: "tengo 30 agendas que nadie tocó, que caigan
-- al pool y las tome cualquiera".
create or replace function public.release_callbacks_to_pool(
  p_lead_ids uuid[],
  p_keep_schedule boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_teams uuid[] := (select public.supervised_team_ids());
  v_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;
  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para derivar compromisos al discador.';
  end if;

  with permitidos as (
    select l.id
    from public.leads l
    where l.id = any(p_lead_ids)
      and (v_role = 'admin' or l.team_id = any(v_teams))
    for update
  ), soltados as (
    update public.leads l
       set callback_mode = 'campaign',
           callback_released_at = now(),
           callback_attempts = 0,
           callback_last_attempt_at = null,
           -- Sin responsable: la propiedad la define quien atienda la llamada.
           assigned_to = null,
           managed_by = null,
           assignment_status = 'unassigned',
           -- Sin hora comprometida deja de ser un compromiso y entra al pool
           -- como cualquier registro pendiente, salvo que se pida conservarla.
           next_action_at = case when p_keep_schedule then l.next_action_at else null end,
           workflow_status = case when p_keep_schedule then 'callback' else null end,
           updated_at = now()
      from permitidos p
     where l.id = p.id
    returning l.id as lead_ref, l.crm_entity_id as entity_ref
  ), auditado as (
    insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
    select s.lead_ref, s.entity_ref, v_actor_id, 'callback.released_to_pool',
           jsonb_build_object('keep_schedule', p_keep_schedule, 'source', 'supervisor')
    from soltados s
    returning 1
  )
  select count(*)::integer into v_count from auditado;

  return coalesce(v_count, 0);
end;
$function$;

revoke execute on function public.reschedule_callbacks(uuid[], timestamptz, uuid) from public, anon;
revoke execute on function public.release_callbacks_to_pool(uuid[], boolean) from public, anon;
grant execute on function public.reschedule_callbacks(uuid[], timestamptz, uuid) to authenticated, service_role;
grant execute on function public.release_callbacks_to_pool(uuid[], boolean) to authenticated, service_role;
