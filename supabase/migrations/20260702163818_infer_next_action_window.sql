create or replace function public.infer_next_action_window(value timestamptz)
returns text
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select case
    when value is null then null
    else
      to_char(date_trunc('hour', value at time zone 'America/Santiago'), 'HH24:MI')
      || '-'
      || to_char(date_trunc('hour', value at time zone 'America/Santiago') + interval '1 hour', 'HH24:MI')
  end;
$function$;

create or replace function public.save_call_management(
  p_call_id uuid,
  p_lead_id uuid,
  p_status text,
  p_outcome text,
  p_reason text,
  p_notes text,
  p_next_action_at timestamp with time zone,
  p_next_action_window text,
  p_equifax_products text[],
  p_equifax_uf_amount numeric,
  p_equifax_recipient_email text
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role text := coalesce(public.current_role_name()::text, '');
  v_now timestamp with time zone := now();
  v_call public.calls%rowtype;
  v_lead public.leads%rowtype;
  v_workflow_id uuid;
  v_workflow_step_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_reason_norm text := public.normalize_management_text(p_reason);
  v_products text[] := coalesce(p_equifax_products, array[]::text[]);
  v_next_action_window text := public.infer_next_action_window(p_next_action_at);
  v_interaction_id uuid;
begin
  if v_user_id is null then
    raise exception 'No autenticado.';
  end if;

  if v_reason is null or p_status is null or p_outcome is null then
    raise exception 'Selecciona una tipificación antes de cerrar.';
  end if;

  if p_status not in ('connected', 'no_answer', 'busy', 'voicemail', 'out_of_service') then
    raise exception 'Estado de llamada inválido.';
  end if;

  if p_outcome not in ('sale', 'callback', 'interested', 'not_interested', 'other') then
    raise exception 'Resultado de llamada inválido.';
  end if;

  select *
  into v_call
  from public.calls
  where id = p_call_id
    and lead_id = p_lead_id
  for update;

  if not found then
    raise exception 'La llamada no existe o no pertenece al lead.';
  end if;

  if v_call.ended_at is not null then
    raise exception 'La llamada ya fue cerrada.';
  end if;

  if v_role <> 'admin' and v_call.agent_id <> v_user_id then
    raise exception 'No puedes cerrar una llamada de otro ejecutivo.';
  end if;

  select *
  into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'El lead no existe o no está disponible para tu usuario.';
  end if;

  select coalesce(v_lead.workflow_id, c.workflow_id)
  into v_workflow_id
  from public.campaigns c
  where c.id = v_lead.campaign_id;

  v_workflow_id := coalesce(v_workflow_id, v_lead.workflow_id);

  if v_workflow_id is not null then
    select s.id
    into v_workflow_step_id
    from public.workflow_steps s
    where s.workflow_id = v_workflow_id
      and (
        public.normalize_management_text(s.name) = v_reason_norm
        or replace(public.normalize_management_text(s.name), 'CIERRE ', '') = v_reason_norm
        or exists (
          select 1
          from jsonb_array_elements_text(s.options) as option(value)
          where public.normalize_management_text(option.value) = v_reason_norm
        )
        or (
          public.normalize_management_text(s.name) like '%FUERA%SERVICIO%'
          and v_reason_norm = 'TELEFONO FUERA DE SERVICIO'
        )
        or (
          public.normalize_management_text(s.name) like '%VENTA%VALIDACION%'
          and v_reason_norm = 'VENTA EN VALIDACION'
        )
      )
    order by
      case
        when exists (
          select 1
          from jsonb_array_elements_text(s.options) as option(value)
          where public.normalize_management_text(option.value) = v_reason_norm
        ) then 0
        else 1
      end,
      s.step_order desc
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
    from public.calls c
    where c.id <> p_call_id
      and c.ended_at is not null
      and c.next_action_at = p_next_action_at
      and c.lead_id in (
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
    raise exception 'Ya existe una agenda cerrada para este lead/contacto, en la misma campaña, para esa fecha y hora exacta.';
  end if;

  update public.calls
  set
    ended_at = v_now,
    status = p_status,
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
  set
    tipificacion_actual = v_reason,
    observacion_actual = nullif(p_notes, ''),
    next_action_at = p_next_action_at,
    workflow_status = case when p_next_action_at is not null then 'callback' else 'managed' end,
    assignment_status = 'managed',
    managed_at = v_now,
    managed_by = v_user_id,
    updated_at = v_now
  where id = p_lead_id;

  insert into public.interactions (
    lead_id,
    agent_id,
    result,
    notes,
    workflow_step_id,
    metadata
  )
  values (
    p_lead_id,
    v_user_id,
    v_reason,
    nullif(p_notes, ''),
    v_workflow_step_id,
    jsonb_build_object(
      'source', 'save_call_management',
      'call_id', p_call_id,
      'status', p_status,
      'outcome', p_outcome,
      'workflow_id', v_workflow_id,
      'next_action_at', p_next_action_at,
      'next_action_window', v_next_action_window,
      'equifax_products', v_products,
      'equifax_uf_amount', p_equifax_uf_amount,
      'equifax_recipient_email', nullif(p_equifax_recipient_email, '')
    )
  )
  returning id into v_interaction_id;

  insert into public.call_events (
    call_id,
    lead_id,
    agent_id,
    event_type,
    payload
  )
  values (
    p_call_id,
    p_lead_id,
    v_user_id,
    'call.closed',
    jsonb_build_object(
      'status', p_status,
      'outcome', p_outcome,
      'reason', v_reason,
      'next_action_at', p_next_action_at,
      'next_action_window', v_next_action_window,
      'interaction_id', v_interaction_id
    )
  );

  return jsonb_build_object(
    'call_id', p_call_id,
    'lead_id', p_lead_id,
    'interaction_id', v_interaction_id,
    'workflow_id', v_workflow_id,
    'workflow_step_id', v_workflow_step_id,
    'managed_at', v_now,
    'next_action_window', v_next_action_window
  );
end;
$function$;

grant execute on function public.infer_next_action_window(timestamptz)
  to authenticated;

grant execute on function public.save_call_management(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  text,
  text[],
  numeric,
  text
) to authenticated;
