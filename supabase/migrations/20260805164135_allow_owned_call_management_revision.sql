-- Permite al ejecutivo corregir una gestión propia ya cerrada desde
-- "Mis registros". La fila de llamada se actualiza para que el snapshot
-- operativo y la agenda sean correctos, pero los valores anteriores quedan
-- preservados en call_events, interactions.metadata y crm_audit_events.

create or replace function public.revise_call_management(
  p_call_id uuid,
  p_lead_id uuid,
  p_status text,
  p_outcome text,
  p_reason text,
  p_notes text,
  p_next_action_at timestamptz,
  p_equifax_products text[],
  p_equifax_uf_amount numeric,
  p_equifax_recipient_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_now timestamptz := now();
  v_call public.calls%rowtype;
  v_lead public.leads%rowtype;
  v_workflow_id uuid;
  v_workflow_step_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_reason_norm text := public.normalize_management_text(p_reason);
  v_products text[] := coalesce(p_equifax_products, array[]::text[]);
  v_next_action_window text := public.infer_next_action_window(p_next_action_at);
  v_interaction_id uuid;
  v_previous jsonb;
  v_current jsonb;
begin
  if v_user_id is null then
    raise exception 'No autenticado.';
  end if;

  if v_role <> 'agente' then
    raise exception 'Sólo el ejecutivo puede corregir una gestión desde Mis registros.';
  end if;

  if v_reason is null or p_status is null or p_outcome is null then
    raise exception 'Selecciona una tipificación antes de guardar la corrección.';
  end if;

  if p_status not in ('connected', 'no_answer', 'busy', 'voicemail', 'out_of_service') then
    raise exception 'Estado de llamada inválido.';
  end if;

  if p_outcome not in ('sale', 'callback', 'interested', 'not_interested', 'other') then
    raise exception 'Resultado de llamada inválido.';
  end if;

  if exists (
    select 1
    from public.calls open_call
    where open_call.agent_id = v_user_id
      and open_call.ended_at is null
  ) then
    raise exception 'Completa primero la llamada activa antes de corregir una gestión anterior.';
  end if;

  if exists (
    select 1
    from public.dialer_agent_sessions session
    where session.profile_id = v_user_id
      and session.status in ('ringing', 'on_call', 'wrap_up')
  ) then
    raise exception 'No puedes corregir una gestión mientras tienes una llamada o tipificación en curso.';
  end if;

  select *
  into v_call
  from public.calls
  where id = p_call_id
    and lead_id = p_lead_id
    and agent_id = v_user_id
    and ended_at is not null
    and discarded_reason is null
  for update;

  if not found then
    raise exception 'La gestión no existe, sigue abierta o no pertenece a tu usuario.';
  end if;

  select *
  into v_lead
  from public.leads
  where id = p_lead_id
    and managed_by = v_user_id
  for update;

  if not found then
    raise exception 'El registro ya no pertenece a tu historial de gestión.';
  end if;

  select coalesce(v_lead.workflow_id, campaign.workflow_id)
  into v_workflow_id
  from public.campaigns campaign
  where campaign.id = v_lead.campaign_id;

  v_workflow_id := coalesce(v_workflow_id, v_lead.workflow_id);

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

  if v_reason_norm in ('VOLVER A LLAMAR', 'REUNION AGENDADA', 'COTIZACION ENVIADA', 'NO ES EL MOMENTO')
    and p_next_action_at is null then
    raise exception 'Esta tipificación requiere fecha y hora de agenda.';
  end if;

  if (p_outcome = 'sale' or v_reason_norm = 'COTIZACION ENVIADA')
    and cardinality(v_products) = 0 then
    raise exception 'Selecciona al menos un producto Equifax.';
  end if;

  if (p_outcome = 'sale' or v_reason_norm = 'COTIZACION ENVIADA')
    and p_equifax_uf_amount is null then
    raise exception 'Ingresa la UF mensual de la oportunidad.';
  end if;

  if v_reason_norm = 'COTIZACION ENVIADA'
    and nullif(btrim(coalesce(p_equifax_recipient_email, v_lead.email, '')), '') is null then
    raise exception 'Indica un email destinatario para la cotización.';
  end if;

  if p_outcome = 'sale' and v_reason_norm <> 'VENTA EN VALIDACION' then
    raise exception 'Para registrar venta usa la tipificación VENTA EN VALIDACION.';
  end if;

  if p_next_action_at is not null and exists (
    select 1
    from public.calls other_call
    where other_call.id <> p_call_id
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

  update public.calls
  set status = p_status,
      outcome = p_outcome,
      reason = v_reason,
      notes = nullif(p_notes, ''),
      next_action_at = p_next_action_at,
      next_action_window = v_next_action_window,
      callback_owner_user_id = case when p_next_action_at is not null then v_user_id else null end,
      equifax_products = case when cardinality(v_products) > 0 then v_products else null end,
      equifax_uf_amount = p_equifax_uf_amount,
      equifax_recipient_email = nullif(p_equifax_recipient_email, ''),
      updated_at = v_now
  where id = p_call_id;

  update public.leads
  set tipificacion_actual = v_reason,
      observacion_actual = nullif(p_notes, ''),
      next_action_at = p_next_action_at,
      workflow_status = case when p_next_action_at is not null then 'callback' else 'managed' end,
      assignment_status = 'managed',
      managed_at = v_now,
      managed_by = v_user_id,
      updated_at = v_now
  where id = p_lead_id;

  insert into public.interactions
    (lead_id, agent_id, result, notes, workflow_step_id, metadata)
  values (
    p_lead_id,
    v_user_id,
    v_reason,
    nullif(p_notes, ''),
    v_workflow_step_id,
    jsonb_build_object(
      'source', 'revise_call_management',
      'revision_of_call_id', p_call_id,
      'workflow_id', v_workflow_id,
      'previous', v_previous,
      'current', v_current
    )
  )
  returning id into v_interaction_id;

  insert into public.call_events
    (call_id, lead_id, agent_id, event_type, payload)
  values (
    p_call_id,
    p_lead_id,
    v_user_id,
    'call.management_revised',
    jsonb_build_object(
      'source', 'mis_registros',
      'interaction_id', v_interaction_id,
      'previous', v_previous,
      'current', v_current
    )
  );

  insert into public.crm_audit_events
    (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id,
    v_lead.crm_entity_id,
    v_user_id,
    'lead.management_revised',
    jsonb_build_object(
      'source', 'mis_registros',
      'call_id', p_call_id,
      'interaction_id', v_interaction_id,
      'previous', v_previous,
      'current', v_current
    )
  );

  return jsonb_build_object(
    'call_id', p_call_id,
    'lead_id', p_lead_id,
    'interaction_id', v_interaction_id,
    'managed_at', v_now,
    'next_action_at', p_next_action_at,
    'next_action_window', v_next_action_window
  );
end;
$function$;

revoke all on function public.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) from public, anon;

grant execute on function public.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) to authenticated;

comment on function public.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) is 'Corrige una gestión cerrada propia desde Mis registros y conserva la versión anterior en la auditoría.';
