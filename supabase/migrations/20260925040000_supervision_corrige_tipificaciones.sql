-- Supervisión corrige una tipificación o agrega la última desde la ficha.
--
-- Pedido de operación (24-09-2026): hay ventas que el ejecutivo no marcó como
-- venta y que tienen que entrar a la validación de ventas
-- (20260925030000_supervision_valida_ventas). Hasta hoy solo el ejecutivo
-- dueño podía corregir su gestión (revise_call_management) y nunca una traída
-- de Atlas 1.
--
-- Dos caminos, los dos para admin o supervisor de los equipos del registro:
--
--   * Corregir una gestión cerrada de Atlas 2.0. Reescribe la tipificación de
--     esa llamada, que sigue siendo del ejecutivo que la hizo (una venta queda
--     a su nombre en la validación). Las de Atlas 1 no se reescriben, por la
--     misma razón que en 20260924180200: la versión original es la que se
--     concilia con Vocalcom y el histórico.
--   * Agregar una tipificación nueva, sin llamada: queda como una gestión con
--     management_channel = 'supervision', acreditada al ejecutivo que elige
--     supervisión. Es el camino para el historial de Atlas 1.
--
-- Las reglas de cierre son las mismas del ejecutivo (flujo de la campaña,
-- agenda, datos Equifax, VENTA EN VALIDACION para una venta). Se exige un
-- motivo, y la versión anterior queda en call_events y crm_audit_events.

alter table public.calls drop constraint if exists calls_management_channel_check;
alter table public.calls
  add constraint calls_management_channel_check
  check (management_channel is null or management_channel in ('whatsapp', 'correo', 'presencial', 'otro', 'supervision'));

comment on column public.calls.management_channel is
  'Canal de una gestión sin llamada (whatsapp, correo, presencial, otro) o supervision cuando la registró supervisión. null = gestión de una llamada.';

-- Alcance de supervisión sobre un registro: el mismo de
-- private.assert_can_manage_lead_phones, con su propio mensaje.
create or replace function private.assert_can_supervise_lead(p_lead public.leads)
returns void
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_role public.app_role := public.current_role_name();
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;
  if v_role is null or v_role not in ('admin'::public.app_role, 'supervisor'::public.app_role) then
    raise exception 'Solo supervisión o administración puede corregir tipificaciones.' using errcode = '42501';
  end if;
  perform public.assert_org_access(p_lead.organization_id);
  if v_role = 'supervisor'::public.app_role
    and p_lead.team_id is not null
    and not (p_lead.team_id = any (public.supervised_team_ids())) then
    raise exception 'Ese registro no es de tus equipos.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_can_supervise_lead(public.leads) from public, anon, authenticated;

-- Ejecutivos a los que supervisión puede acreditar una gestión del registro:
-- activos, de la empresa del registro y, para un supervisor, de sus equipos o
-- del equipo del registro.
create or replace function private.lead_supervision_agents(p_lead public.leads)
returns setof public.profiles
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select profile.*
  from public.profiles profile
  where profile.role = 'agente'::public.app_role
    and profile.active
    and exists (
      select 1 from public.organization_members member
      where member.profile_id = profile.id
        and member.organization_id = p_lead.organization_id
    )
    and (
      public.current_role_name() = 'admin'::public.app_role
      or profile.team_id = any (public.supervised_team_ids())
      or (p_lead.team_id is not null and profile.team_id = p_lead.team_id)
    );
$$;

revoke all on function private.lead_supervision_agents(public.leads) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lo que la ficha necesita para supervisar: gestiones cerradas del registro,
-- si cada una se puede corregir, los ejecutivos elegibles y a quién acreditar
-- por defecto una gestión nueva.
-- ---------------------------------------------------------------------------
create or replace function public.lead_supervision_context(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_lead public.leads%rowtype;
  v_default uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform private.assert_can_supervise_lead(v_lead);

  -- Por defecto, quien hizo la última gestión: el perfil real o, en el
  -- historial de Atlas 1, el perfil enlazado al ejecutivo histórico.
  select coalesce(
      case when agent.role = 'agente'::public.app_role and agent.active then agent.id end,
      historical.linked_profile_id
    )
  into v_default
  from public.calls call
  left join public.profiles agent on agent.id = call.agent_id
  left join public.historical_agents historical on historical.id = call.historical_agent_id
  where call.lead_id = p_lead_id
    and call.ended_at is not null
    and call.discarded_reason is null
  order by call.ended_at desc
  limit 1;

  if v_default is null or not exists (
    select 1 from private.lead_supervision_agents(v_lead) agent where agent.id = v_default
  ) then
    select agent.id into v_default
    from private.lead_supervision_agents(v_lead) agent
    where agent.id in (v_lead.managed_by, v_lead.assigned_to)
    limit 1;
  end if;

  return jsonb_build_object(
    'default_agent_id', v_default,
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object('id', agent.id, 'name', coalesce(agent.full_name, agent.email)) order by coalesce(agent.full_name, agent.email))
      from private.lead_supervision_agents(v_lead) agent
    ), '[]'::jsonb),
    'managements', coalesce((
      select jsonb_agg(row_to_json(item) order by item.ended_at desc)
      from (
        select
          call.id,
          call.ended_at,
          call.status,
          call.outcome,
          call.reason,
          call.notes,
          call.management_channel,
          coalesce(historical.full_name, agent.full_name, agent.email) as agent_name,
          call.legacy_call_id is not null as from_atlas1
        from public.calls call
        left join public.profiles agent on agent.id = call.agent_id
        left join public.historical_agents historical on historical.id = call.historical_agent_id
        where call.lead_id = p_lead_id
          and call.ended_at is not null
          and call.discarded_reason is null
          and call.reason is not null
        order by call.ended_at desc
        limit 15
      ) item
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.lead_supervision_context(uuid) from public, anon;
grant execute on function public.lead_supervision_context(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Corrige (p_call_id) o agrega (p_call_id null, p_agent_id) una tipificación.
-- ---------------------------------------------------------------------------
create or replace function public.supervise_call_management(
  p_lead_id uuid,
  p_call_id uuid,
  p_agent_id uuid,
  p_status text,
  p_outcome text,
  p_reason text,
  p_notes text,
  p_next_action_at timestamptz,
  p_equifax_products text[],
  p_equifax_uf_amount numeric,
  p_equifax_recipient_email text,
  p_supervisor_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_adding boolean := p_call_id is null;
  v_agent_id uuid;
  v_call_id uuid;
  v_workflow_id uuid;
  v_workflow_step_id uuid;
  v_requires_equifax_data boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_reason_norm text := public.normalize_management_text(p_reason);
  v_note text := nullif(btrim(coalesce(p_supervisor_note, '')), '');
  v_products text[] := coalesce(p_equifax_products, array[]::text[]);
  v_next_action_window text := public.infer_next_action_window(p_next_action_at);
  v_is_latest boolean;
  v_interaction_id uuid;
  v_previous jsonb;
  v_current jsonb;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform private.assert_can_supervise_lead(v_lead);

  if v_note is null then
    raise exception 'Indica por qué supervisión corrige o agrega la tipificación.';
  end if;
  if v_reason is null or p_status is null or p_outcome is null then
    raise exception 'Selecciona una tipificación antes de guardar.';
  end if;
  if p_status not in ('connected', 'no_answer', 'busy', 'voicemail', 'out_of_service') then
    raise exception 'Estado de llamada inválido.';
  end if;
  if p_outcome not in ('sale', 'callback', 'interested', 'not_interested', 'other') then
    raise exception 'Resultado de llamada inválido.';
  end if;

  if v_adding then
    if p_agent_id is null or not exists (
      select 1 from private.lead_supervision_agents(v_lead) agent where agent.id = p_agent_id
    ) then
      raise exception 'Elige a qué ejecutivo de tus equipos se acredita la gestión.';
    end if;
    v_agent_id := p_agent_id;
  else
    select * into v_call
    from public.calls
    where id = p_call_id
      and lead_id = p_lead_id
      and ended_at is not null
      and discarded_reason is null
    for update;
    if not found then
      raise exception 'La gestión no existe, sigue abierta o fue descartada.';
    end if;
    if v_call.legacy_call_id is not null then
      raise exception 'Esta gestión viene de Atlas 1 y no se reescribe. Agrega una tipificación nueva.';
    end if;
    v_agent_id := v_call.agent_id;
  end if;

  select coalesce(v_lead.workflow_id, campaign.workflow_id)
  into v_workflow_id
  from public.campaigns campaign
  where campaign.id = v_lead.campaign_id;
  v_workflow_id := coalesce(v_workflow_id, v_lead.workflow_id);

  v_requires_equifax_data := public.management_requires_equifax_data(v_workflow_id, v_lead.campaign_id);

  if v_workflow_id is not null then
    select step.id
    into v_workflow_step_id
    from public.workflow_steps step
    where step.workflow_id = v_workflow_id
      and (
        public.normalize_management_text(step.name) = v_reason_norm
        or replace(public.normalize_management_text(step.name), 'CIERRE ', '') = v_reason_norm
        or exists (
          select 1
          from jsonb_array_elements_text(step.options) as option(value)
          where public.normalize_management_text(option.value) = v_reason_norm
        )
        or (
          public.normalize_management_text(step.name) like '%FUERA%SERVICIO%'
          and v_reason_norm = 'TELEFONO FUERA DE SERVICIO'
        )
        or (
          public.normalize_management_text(step.name) like '%VENTA%VALIDACION%'
          and v_reason_norm = 'VENTA EN VALIDACION'
        )
      )
    order by
      case
        when exists (
          select 1
          from jsonb_array_elements_text(step.options) as option(value)
          where public.normalize_management_text(option.value) = v_reason_norm
        ) then 0
        else 1
      end,
      step.step_order desc
    limit 1;

    if v_workflow_step_id is null then
      raise exception 'La tipificación seleccionada no pertenece al flujo de la campaña.';
    end if;
  end if;

  if p_outcome = 'callback' and p_next_action_at is null then
    raise exception 'Esta tipificación requiere fecha y hora de agenda.';
  end if;
  if public.management_agenda_requirement(v_reason_norm, p_outcome, v_requires_equifax_data) = 'required'
    and p_next_action_at is null then
    raise exception 'Esta tipificación requiere fecha y hora de agenda.';
  end if;
  if v_requires_equifax_data
    and (p_outcome = 'sale' or v_reason_norm = 'COTIZACION ENVIADA')
    and cardinality(v_products) = 0 then
    raise exception 'Selecciona al menos un producto Equifax.';
  end if;
  if v_requires_equifax_data
    and (p_outcome = 'sale' or v_reason_norm = 'COTIZACION ENVIADA')
    and p_equifax_uf_amount is null then
    raise exception 'Ingresa la UF mensual de la oportunidad.';
  end if;
  if v_requires_equifax_data
    and v_reason_norm = 'COTIZACION ENVIADA'
    and nullif(btrim(coalesce(p_equifax_recipient_email, v_lead.email, '')), '') is null then
    raise exception 'Indica un email destinatario para la cotización.';
  end if;
  if p_outcome = 'sale' and v_reason_norm <> 'VENTA EN VALIDACION' then
    raise exception 'Para registrar venta usa la tipificación VENTA EN VALIDACION.';
  end if;

  perform private.assert_management_closure_rules(
    v_lead.campaign_id,
    v_requires_equifax_data,
    v_reason,
    p_notes,
    p_next_action_at,
    case when v_adding then null else v_call.next_action_at end
  );

  if p_next_action_at is not null and exists (
    select 1
    from public.calls other_call
    where other_call.id is distinct from p_call_id
      and other_call.ended_at is not null
      and other_call.next_action_at = p_next_action_at
      and other_call.lead_id in (
        select related.id
        from public.leads related
        where (
            (v_lead.campaign_id is not null and related.campaign_id = v_lead.campaign_id)
            or (v_lead.campaign_id is null and related.team_id is not distinct from v_lead.team_id)
          )
          and (
            (v_lead.rut is not null and related.rut = v_lead.rut)
            or (v_lead.phone is not null and related.phone = v_lead.phone)
            or related.id = p_lead_id
          )
      )
  ) then
    raise exception 'Ya existe una agenda para este registro/contacto en esa fecha y hora exacta.';
  end if;

  v_current := jsonb_build_object(
    'status', p_status,
    'outcome', p_outcome,
    'reason', v_reason,
    'notes', nullif(p_notes, ''),
    'next_action_at', p_next_action_at,
    'next_action_window', v_next_action_window,
    'equifax_products', case when cardinality(v_products) > 0 then to_jsonb(v_products) else 'null'::jsonb end,
    'equifax_uf_amount', p_equifax_uf_amount,
    'equifax_recipient_email', nullif(p_equifax_recipient_email, '')
  );

  if v_adding then
    v_previous := null;
    insert into public.calls (
      lead_id, agent_id, status, outcome, reason, notes, next_action_at, next_action_window,
      callback_owner_user_id, equifax_products, equifax_uf_amount, equifax_recipient_email,
      started_at, ended_at, management_channel
    )
    values (
      p_lead_id, v_agent_id, p_status, p_outcome, v_reason, nullif(p_notes, ''), p_next_action_at,
      v_next_action_window,
      case when p_next_action_at is not null then v_agent_id end,
      case when cardinality(v_products) > 0 then v_products end,
      p_equifax_uf_amount, nullif(p_equifax_recipient_email, ''),
      v_now, v_now, 'supervision'
    )
    returning id into v_call_id;
    v_is_latest := true;
  else
    v_call_id := v_call.id;
    v_previous := jsonb_build_object(
      'status', v_call.status,
      'outcome', v_call.outcome,
      'reason', v_call.reason,
      'notes', v_call.notes,
      'next_action_at', v_call.next_action_at,
      'next_action_window', v_call.next_action_window,
      'equifax_products', v_call.equifax_products,
      'equifax_uf_amount', v_call.equifax_uf_amount,
      'equifax_recipient_email', v_call.equifax_recipient_email
    );
    update public.calls
    set status = p_status,
        outcome = p_outcome,
        reason = v_reason,
        notes = nullif(p_notes, ''),
        next_action_at = p_next_action_at,
        next_action_window = v_next_action_window,
        -- La agenda sigue siendo del ejecutivo que hizo la gestión.
        callback_owner_user_id = case when p_next_action_at is not null then coalesce(v_call.callback_owner_user_id, v_agent_id) end,
        equifax_products = case when cardinality(v_products) > 0 then v_products end,
        equifax_uf_amount = p_equifax_uf_amount,
        equifax_recipient_email = nullif(p_equifax_recipient_email, ''),
        updated_at = v_now
    where id = v_call.id;

    v_is_latest := not exists (
      select 1 from public.calls newer
      where newer.lead_id = p_lead_id
        and newer.id <> v_call.id
        and newer.ended_at is not null
        and newer.discarded_reason is null
        and newer.ended_at > v_call.ended_at
    );
  end if;

  -- La foto del registro sigue a su última gestión: corregir una anterior no
  -- la cambia.
  if v_is_latest then
    update public.leads
    set tipificacion_actual = v_reason,
        observacion_actual = nullif(p_notes, ''),
        next_action_at = p_next_action_at,
        workflow_status = case when p_next_action_at is not null then 'callback' else 'managed' end,
        assignment_status = 'managed',
        managed_at = case when v_adding then v_now else managed_at end,
        managed_by = case when v_adding then v_agent_id else managed_by end,
        updated_at = v_now
    where id = p_lead_id;
  end if;

  insert into public.interactions (lead_id, agent_id, result, notes, workflow_step_id, metadata)
  values (
    p_lead_id,
    v_actor,
    v_reason,
    nullif(p_notes, ''),
    v_workflow_step_id,
    jsonb_build_object(
      'source', 'supervise_call_management',
      'mode', case when v_adding then 'agregar' else 'corregir' end,
      'call_id', v_call_id,
      'credited_agent_id', v_agent_id,
      'supervisor_note', v_note,
      'workflow_id', v_workflow_id,
      'previous', v_previous,
      'current', v_current
    )
  )
  returning id into v_interaction_id;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call_id,
    p_lead_id,
    v_actor,
    case when v_adding then 'call.management_added_by_supervision' else 'call.management_revised_by_supervision' end,
    jsonb_build_object(
      'interaction_id', v_interaction_id,
      'credited_agent_id', v_agent_id,
      'supervisor_note', v_note,
      'previous', v_previous,
      'current', v_current
    )
  );

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id,
    v_lead.crm_entity_id,
    v_actor,
    case when v_adding then 'lead.management_added_by_supervision' else 'lead.management_revised_by_supervision' end,
    jsonb_build_object(
      'call_id', v_call_id,
      'interaction_id', v_interaction_id,
      'credited_agent_id', v_agent_id,
      'supervisor_note', v_note,
      'previous', v_previous,
      'current', v_current
    )
  );

  return jsonb_build_object(
    'call_id', v_call_id,
    'lead_id', p_lead_id,
    'interaction_id', v_interaction_id,
    'is_sale', public.call_is_sale_to_validate(p_outcome, v_reason, v_now)
  );
end;
$$;

revoke all on function public.supervise_call_management(uuid, uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text, text) from public, anon;
grant execute on function public.supervise_call_management(uuid, uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text, text) to authenticated;
