-- Las ventas cuentan en el período en que se gestionaron, no en el que se
-- cargaron al sistema.
--
-- Pedido de operación (25-09-2026): se están ingresando ventas antiguas de
-- Equifax para normalizar el sistema (abril a agosto) y aparecían como ventas
-- de septiembre. Dos causas:
--
--   * Supervisión agrega la tipificación que faltaba (supervise_call_management)
--     y la gestión quedaba fechada hoy. El reporte cuenta ventas por la fecha
--     de la gestión, así que una venta de abril sumaba en septiembre. Ahora,
--     al agregar, supervisión indica la fecha en que ocurrió; y una venta ya
--     registrada sin llamada se puede fechar después (set_sale_validation_date).
--     Mover la fecha de la gestión mueve la venta en el reporte, porque el
--     disparador de métricas recalcula el día anterior y el nuevo.
--   * La validación filtraba por la fecha de la decisión: aprobar hoy una venta
--     de abril la sumaba a «aprobadas este mes». El buscador filtra ahora por la
--     fecha de la venta (p_date_field = 'venta'); la de la decisión sigue
--     disponible.
--
-- Una llamada real no se refecha: su fecha es la de la llamada. Solo se mueve
-- una gestión sin llamada (management_channel no nulo) de Atlas 2.0.

alter table public.sale_validations drop constraint if exists sale_validations_decision_source_check;
alter table public.sale_validations
  add constraint sale_validations_decision_source_check check (
    decision_source is null or decision_source in ('supervision', 'atlas1', 'revision', 'planilla')
  );

comment on column public.sale_validations.sold_at is
  'Cuándo se gestionó la venta: el cierre de la llamada o la fecha de la gestión sin llamada. Define el período en que la venta cuenta.';

-- ---------------------------------------------------------------------------
-- El disparador sigue a la gestión también en la fecha: si la gestión se
-- refecha, la venta cambia de período.
-- ---------------------------------------------------------------------------
create or replace function public.sale_validation_from_call()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_lead public.leads%rowtype;
  v_existing public.sale_validations%rowtype;
begin
  select * into v_existing from public.sale_validations where call_id = new.id;

  if public.call_is_sale_to_validate(new.outcome, new.reason, new.ended_at) then
    if v_existing.id is not null then
      update public.sale_validations
      set sold_at = coalesce(new.ended_at, new.started_at, new.created_at),
          products = new.equifax_products,
          uf_amount = new.equifax_uf_amount,
          recipient_email = new.equifax_recipient_email,
          agent_notes = new.notes,
          status = case when status = 'anulada' then 'pendiente' else status end,
          decided_by = case when status = 'anulada' then null else decided_by end,
          decided_at = case when status = 'anulada' then null else decided_at end,
          decision_note = case when status = 'anulada' then null else decision_note end,
          decision_source = case when status = 'anulada' then null else decision_source end,
          updated_at = now()
      where id = v_existing.id;
      return null;
    end if;

    select * into v_lead from public.leads where id = new.lead_id;
    if not found or v_lead.organization_id is null then
      return null;
    end if;

    insert into public.sale_validations (
      organization_id, call_id, lead_id, campaign_id, team_id, agent_id, historical_agent_id,
      sold_at, products, uf_amount, recipient_email, agent_notes
    )
    values (
      v_lead.organization_id, new.id, new.lead_id, v_lead.campaign_id, v_lead.team_id, new.agent_id,
      new.historical_agent_id, coalesce(new.ended_at, new.started_at, new.created_at),
      new.equifax_products, new.equifax_uf_amount, new.equifax_recipient_email, new.notes
    )
    on conflict (call_id) do nothing;
    return null;
  end if;

  if v_existing.id is not null and v_existing.status in ('pendiente', 'aprobada') then
    perform private.sale_validation_restore_lead(v_existing);
    update public.sale_validations
    set status = 'anulada',
        decided_by = null,
        decided_at = now(),
        decision_note = 'La tipificación de la llamada dejó de ser VENTA EN VALIDACION.',
        decision_source = 'revision',
        updated_at = now()
    where id = v_existing.id;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Supervisión agrega una gestión con la fecha en que ocurrió (p_managed_on).
-- ---------------------------------------------------------------------------
drop function if exists public.supervise_call_management(uuid, uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text, text);

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
  p_supervisor_note text,
  p_managed_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_today date := (now() at time zone 'America/Santiago')::date;
  -- Cuándo ocurrió la gestión que se agrega. Hoy (o sin fecha) es ahora; un
  -- día pasado queda a mediodía de Chile de ese día.
  v_managed_at timestamptz := now();
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
    if p_managed_on is not null then
      if p_managed_on > v_today then
        raise exception 'La fecha de la gestión no puede ser futura.';
      end if;
      if p_managed_on < date '2025-01-01' then
        raise exception 'La fecha de la gestión es demasiado antigua.';
      end if;
      if p_managed_on < v_today then
        v_managed_at := (p_managed_on + time '12:00') at time zone 'America/Santiago';
      end if;
    end if;
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
      v_managed_at, v_managed_at, 'supervision'
    )
    returning id into v_call_id;
    -- Una gestión con fecha pasada solo es la última si no hay otra después.
    v_is_latest := not exists (
      select 1 from public.calls newer
      where newer.lead_id = p_lead_id
        and newer.id <> v_call_id
        and newer.ended_at is not null
        and newer.discarded_reason is null
        and newer.ended_at > v_managed_at
    );
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
        managed_at = case when v_adding then v_managed_at else managed_at end,
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
      'managed_at', case when v_adding then v_managed_at end,
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
      'managed_at', case when v_adding then v_managed_at end,
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

revoke all on function public.supervise_call_management(uuid, uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text, text, date) from public, anon;
grant execute on function public.supervise_call_management(uuid, uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Fechar una venta registrada sin llamada. Mueve la gestión (y con ella la
-- venta y el reporte) al mediodía de Chile del día indicado. Mismo alcance y
-- rol que decidir la venta; exige motivo y deja auditoría.
-- ---------------------------------------------------------------------------
create or replace function public.set_sale_validation_date(p_validation_id uuid, p_sold_on date, p_note text)
returns public.sale_validations
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_role public.app_role := public.current_role_name();
  v_actor uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.sale_validations%rowtype;
  v_call public.calls%rowtype;
  v_lead public.leads%rowtype;
  v_at timestamptz;
  v_result public.sale_validations%rowtype;
begin
  if v_actor is null then
    raise exception 'No autenticado.';
  end if;
  if v_role is null or v_role not in ('admin'::public.app_role, 'supervisor'::public.app_role) then
    raise exception 'Solo supervisión o administración puede cambiar la fecha de una venta.' using errcode = '42501';
  end if;
  if p_sold_on is null then
    raise exception 'Indica la fecha de la venta.';
  end if;
  if p_sold_on > (now() at time zone 'America/Santiago')::date then
    raise exception 'La fecha de la venta no puede ser futura.';
  end if;
  if p_sold_on < date '2025-01-01' then
    raise exception 'La fecha de la venta es demasiado antigua.';
  end if;
  if v_note is null then
    raise exception 'Indica por qué cambias la fecha de la venta.';
  end if;

  select * into v_row from public.sale_validations where id = p_validation_id for update;
  if not found or not private.sale_validation_in_scope(v_row) then
    raise exception 'La venta no existe.';
  end if;

  select * into v_call from public.calls where id = v_row.call_id for update;
  if v_call.management_channel is null or v_call.legacy_call_id is not null then
    raise exception 'Esta venta viene de una llamada: su fecha es la de la llamada y no se cambia.';
  end if;

  v_at := (p_sold_on + time '12:00') at time zone 'America/Santiago';
  if (v_call.ended_at at time zone 'America/Santiago')::date = p_sold_on then
    raise exception 'La venta ya tiene esa fecha.';
  end if;

  -- El disparador de la venta copia la nueva fecha y el de métricas recalcula
  -- el día anterior y el nuevo.
  update public.calls
  set started_at = v_at,
      ended_at = v_at,
      updated_at = now()
  where id = v_call.id;

  select * into v_result from public.sale_validations where id = v_row.id;
  select * into v_lead from public.leads where id = v_row.lead_id;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call.id, v_row.lead_id, v_actor, 'call.management_redated_by_supervision',
    jsonb_build_object('previous_ended_at', v_call.ended_at, 'ended_at', v_at, 'note', v_note)
  );
  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    v_row.lead_id, v_lead.crm_entity_id, v_actor, 'sale_validation.redated',
    jsonb_build_object(
      'sale_validation_id', v_row.id,
      'call_id', v_call.id,
      'previous_sold_at', v_row.sold_at,
      'sold_at', v_at,
      'note', v_note
    )
  );

  return v_result;
end;
$$;

revoke all on function public.set_sale_validation_date(uuid, date, text) from public, anon;
grant execute on function public.set_sale_validation_date(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cola y buscador devuelven el canal de la gestión (para saber si la fecha se
-- puede corregir) y el buscador filtra por la fecha de la venta o de la
-- decisión.
-- ---------------------------------------------------------------------------
drop function if exists public.list_sale_validations(text, integer);
create function public.list_sale_validations(p_status text default 'pendiente', p_limit integer default 200)
returns table (
  id uuid,
  status text,
  sold_at timestamptz,
  lead_id uuid,
  lead_name text,
  lead_rut text,
  lead_phone text,
  lead_email text,
  lead_status text,
  campaign_name text,
  team_name text,
  agent_name text,
  products text[],
  uf_amount numeric,
  recipient_email text,
  agent_notes text,
  decided_at timestamptz,
  decided_by_name text,
  decision_note text,
  decision_source text,
  management_channel text
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select
    v.id, v.status, v.sold_at, v.lead_id,
    lead.full_name, lead.rut, lead.phone, lead.email, lead.status,
    campaign.name, team.name,
    -- El historial de Atlas 1 se cargó con un perfil centinela; el nombre
    -- real del ejecutivo está en historical_agents.
    coalesce(historical.full_name, agent.full_name, agent.email),
    v.products, v.uf_amount, v.recipient_email, v.agent_notes,
    v.decided_at, coalesce(decider.full_name, decider.email), v.decision_note, v.decision_source,
    case when call.legacy_call_id is null then call.management_channel end
  from public.sale_validations v
  join public.leads lead on lead.id = v.lead_id
  join public.calls call on call.id = v.call_id
  left join public.campaigns campaign on campaign.id = v.campaign_id
  left join public.teams team on team.id = v.team_id
  left join public.profiles agent on agent.id = v.agent_id
  left join public.historical_agents historical on historical.id = v.historical_agent_id
  left join public.profiles decider on decider.id = v.decided_by
  where v.status = coalesce(p_status, v.status)
    and private.sale_validation_in_scope(v)
  order by
    case when v.status = 'pendiente' then v.sold_at end asc,
    coalesce(v.decided_at, v.sold_at) desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

revoke all on function public.list_sale_validations(text, integer) from public, anon;
grant execute on function public.list_sale_validations(text, integer) to authenticated;

drop function if exists public.search_sale_validations(text, text, date, date, text, text, integer);
create function public.search_sale_validations(
  p_status text default 'aprobada',
  p_query text default null,
  p_from date default null,
  p_to date default null,
  p_agent text default null,
  p_product text default null,
  p_limit integer default 1000,
  p_date_field text default 'venta'
)
returns table (
  id uuid,
  status text,
  sold_at timestamptz,
  lead_id uuid,
  lead_name text,
  lead_rut text,
  lead_phone text,
  lead_email text,
  lead_status text,
  campaign_name text,
  team_name text,
  agent_name text,
  products text[],
  uf_amount numeric,
  recipient_email text,
  agent_notes text,
  decided_at timestamptz,
  decided_by_name text,
  decision_note text,
  decision_source text,
  management_channel text
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with base as (
    select
      v.id, v.status, v.sold_at, v.lead_id,
      lead.full_name as lead_name, lead.rut as lead_rut, lead.phone as lead_phone,
      lead.email as lead_email, lead.status as lead_status,
      campaign.name as campaign_name, team.name as team_name,
      coalesce(historical.full_name, agent.full_name, agent.email) as agent_name,
      v.products, v.uf_amount, v.recipient_email, v.agent_notes,
      v.decided_at, coalesce(decider.full_name, decider.email) as decided_by_name,
      v.decision_note, v.decision_source,
      case when call.legacy_call_id is null then call.management_channel end as management_channel,
      -- 'venta': el período en que se gestionó la venta (lo que cuenta en el
      -- reporte). 'decision': cuándo se aprobó o rechazó.
      (case
        when p_date_field = 'decision' then coalesce(v.decided_at, v.sold_at)
        else v.sold_at
      end at time zone 'America/Santiago')::date as fecha_filtro
    from public.sale_validations v
    join public.leads lead on lead.id = v.lead_id
    join public.calls call on call.id = v.call_id
    left join public.campaigns campaign on campaign.id = v.campaign_id
    left join public.teams team on team.id = v.team_id
    left join public.profiles agent on agent.id = v.agent_id
    left join public.historical_agents historical on historical.id = v.historical_agent_id
    left join public.profiles decider on decider.id = v.decided_by
    where (nullif(p_status, '') is null or v.status = p_status)
      and private.sale_validation_in_scope(v)
  ),
  termino as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as texto,
      nullif(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '') as digitos
  )
  select
    base.id, base.status, base.sold_at, base.lead_id, base.lead_name, base.lead_rut, base.lead_phone,
    base.lead_email, base.lead_status, base.campaign_name, base.team_name, base.agent_name,
    base.products, base.uf_amount, base.recipient_email, base.agent_notes, base.decided_at,
    base.decided_by_name, base.decision_note, base.decision_source, base.management_channel
  from base, termino
  where (p_from is null or base.fecha_filtro >= p_from)
    and (p_to is null or base.fecha_filtro <= p_to)
    and (nullif(p_agent, '') is null or base.agent_name = p_agent)
    and (nullif(p_product, '') is null or p_product = any (base.products))
    and (
      termino.texto is null
      or base.lead_name ilike '%' || termino.texto || '%'
      or base.agent_name ilike '%' || termino.texto || '%'
      or base.campaign_name ilike '%' || termino.texto || '%'
      or base.lead_email ilike '%' || termino.texto || '%'
      or array_to_string(base.products, ' ') ilike '%' || termino.texto || '%'
      -- RUT y teléfono se comparan solo por dígitos: 76.123.456-7, 761234567
      -- y +56 9 … encuentran lo mismo. Con menos de 4 dígitos no se intenta.
      or (
        length(termino.digitos) >= 4
        and (
          regexp_replace(coalesce(base.lead_rut, ''), '\D', '', 'g') like '%' || termino.digitos || '%'
          or regexp_replace(coalesce(base.lead_phone, ''), '\D', '', 'g') like '%' || termino.digitos || '%'
        )
      )
    )
  order by coalesce(base.decided_at, base.sold_at) desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

revoke all on function public.search_sale_validations(text, text, date, date, text, text, integer, text) from public, anon;
grant execute on function public.search_sale_validations(text, text, date, date, text, text, integer, text) to authenticated;
