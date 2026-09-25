-- El ejecutivo sigue sus cotizaciones enviadas y dice si se vendieron o no.
--
-- Pedido de operación (25-09-2026) para Secretaria Virtual: el ejecutivo
-- tipifica COTIZACION ENVIADA y la cotización se perdía entre sus registros;
-- no había dónde ver cuáles seguían abiertas ni cómo cerrar la que el cliente
-- aceptó o rechazó sin volver a llamarlo. Ahora «Mis registros › Cotizaciones»
-- las lista y cada una se resuelve en un paso:
--
--   * Vendida: deja una gestión VENTA EN VALIDACION (outcome 'sale'), la misma
--     que usa toda venta de Atlas 2.0. El disparador de sale_validations la
--     pone en la cola de Validación de ventas, el reporte la cuenta como venta
--     en su día y, al aprobarse, el registro pasa a convertido. «Contrata
--     Servicio», la opción del flujo de Secretaria Virtual, se graba como
--     'other' y ningún reporte la ve como venta: por eso no se usa aquí.
--   * No vendida: deja una gestión «no interesado» con un motivo del propio
--     flujo (las opciones de su paso «No Interesa»: no lo necesita, ya tiene el
--     servicio, por precio). Si la cotización estaba marcada como vendida y
--     supervisión no la había aprobado, esa venta se anula; una venta aprobada
--     solo la corrige supervisión.
--
-- Las dos son gestiones sin llamada (calls.management_channel, 20260924233000):
-- el cliente confirmó por WhatsApp, correo, presencial u otro canal. Resolver
-- la cotización cierra además su agenda de seguimiento.
--
-- El estado de cada cotización no se guarda aparte: sale del historial. Es la
-- última gestión decisiva (venta o no interesado) posterior a la cotización;
-- sin ella, la cotización sigue pendiente. Así también cuenta si el ejecutivo
-- la cerró llamando.
--
-- Alcance: campañas cuyo flujo tiene la opción «Cotización Enviada» y no
-- declaran el contrato Equifax. En Equifax la cotización y la venta exigen
-- productos y UF y se cierran desde la ficha, así que quedan fuera.

-- ---------------------------------------------------------------------------
-- ¿La campaña lleva seguimiento de cotizaciones?
-- ---------------------------------------------------------------------------
create or replace function private.campaign_tracks_quotations(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.campaigns campaign
    where campaign.id = p_campaign_id
      and campaign.workflow_id is not null
      and not public.management_requires_equifax_data(campaign.workflow_id, campaign.id)
      and exists (
        select 1
        from public.workflow_steps step
        cross join lateral jsonb_array_elements_text(coalesce(step.options, '[]'::jsonb)) as option(value)
        where step.workflow_id = campaign.workflow_id
          and public.normalize_management_text(option.value) = 'COTIZACION ENVIADA'
      )
  );
$$;

revoke all on function private.campaign_tracks_quotations(uuid) from public, anon, authenticated;

-- Motivos para una cotización no vendida: las opciones del paso «No Interesa»
-- del flujo. Si el flujo no tiene ese paso, las opciones que declaran falta de
-- interés en cualquier paso.
create or replace function private.quotation_lost_reasons(p_workflow_id uuid)
returns text[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with from_step as (
    select distinct option.value, step.step_order, option.ordinality
    from public.workflow_steps step
    cross join lateral jsonb_array_elements_text(coalesce(step.options, '[]'::jsonb)) with ordinality as option(value, ordinality)
    where step.workflow_id = p_workflow_id
      and public.normalize_management_text(step.name) like '%NO INTERES%'
  ),
  from_options as (
    select distinct option.value, step.step_order, option.ordinality
    from public.workflow_steps step
    cross join lateral jsonb_array_elements_text(coalesce(step.options, '[]'::jsonb)) with ordinality as option(value, ordinality)
    where step.workflow_id = p_workflow_id
      and public.normalize_management_text(option.value) like '%NO INTERES%'
  )
  select coalesce(
    (select array_agg(value order by step_order, ordinality) from from_step),
    (select array_agg(value order by step_order, ordinality) from from_options),
    array[]::text[]
  );
$$;

revoke all on function private.quotation_lost_reasons(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cotizaciones del ejecutivo, con su estado derivado del historial.
-- ---------------------------------------------------------------------------
create or replace function public.get_agent_quotations()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;
  if not exists (select 1 from public.profiles where id = v_actor_id and role = 'agente' and active) then
    raise exception 'Solo un ejecutivo activo tiene cotizaciones propias.';
  end if;

  with my_leads as (
    select lead.*
    from public.leads lead
    where (lead.assigned_to = v_actor_id or lead.managed_by = v_actor_id)
      and public.can_access_org(lead.organization_id)
  ),
  quoted as (
    select distinct on (lead.id)
      lead.id as lead_id,
      lead.full_name,
      lead.rut,
      lead.phone,
      lead.email,
      lead.next_action_at,
      lead.campaign_id,
      call.id as quote_call_id,
      call.ended_at as quoted_at,
      call.notes as quote_notes
    from my_leads lead
    join public.calls call on call.lead_id = lead.id
    where call.ended_at is not null
      and call.discarded_reason is null
      and public.normalize_management_text(call.reason) = 'COTIZACION ENVIADA'
    order by lead.id, call.ended_at desc
  ),
  tracked as (
    select quoted.*
    from quoted
    where private.campaign_tracks_quotations(quoted.campaign_id)
  ),
  resolved as (
    select
      tracked.*,
      decisive.id as decisive_call_id,
      decisive.outcome as decisive_outcome,
      decisive.reason as decisive_reason,
      decisive.notes as decisive_notes,
      decisive.ended_at as decided_at,
      decisive.management_channel as decisive_channel,
      validation.status as validation_status,
      validation.decision_note as validation_note
    from tracked
    left join lateral (
      select call.*
      from public.calls call
      where call.lead_id = tracked.lead_id
        and call.ended_at > tracked.quoted_at
        and call.discarded_reason is null
        and call.outcome in ('sale', 'not_interested')
      order by call.ended_at desc
      limit 1
    ) decisive on true
    left join public.sale_validations validation on validation.call_id = decisive.id
  ),
  my_campaigns as (
    select campaign.id, campaign.name, campaign.workflow_id
    from public.campaigns campaign
    where private.campaign_tracks_quotations(campaign.id)
      and (
        exists (
          select 1 from public.campaign_agents member
          where member.campaign_id = campaign.id and member.profile_id = v_actor_id
        )
        or campaign.id in (select tracked.campaign_id from tracked)
      )
      and public.can_access_org(campaign.organization_id)
  )
  select jsonb_build_object(
    'campaigns', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', campaign.id,
          'name', campaign.name,
          'lost_reasons', to_jsonb(private.quotation_lost_reasons(campaign.workflow_id))
        )
        order by campaign.name
      )
      from my_campaigns campaign
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lead_id', resolved.lead_id,
          'lead_name', resolved.full_name,
          'lead_rut', resolved.rut,
          'lead_phone', resolved.phone,
          'lead_email', resolved.email,
          'campaign_id', resolved.campaign_id,
          'quoted_at', resolved.quoted_at,
          'quote_notes', resolved.quote_notes,
          'follow_up_at', resolved.next_action_at,
          'state', case
            when resolved.decisive_outcome = 'sale' and coalesce(resolved.validation_status, 'pendiente') <> 'anulada' then 'vendida'
            when resolved.decisive_outcome = 'not_interested' then 'no_vendida'
            else 'pendiente'
          end,
          'decided_at', resolved.decided_at,
          'decision_reason', resolved.decisive_reason,
          'decision_notes', resolved.decisive_notes,
          'decision_channel', resolved.decisive_channel,
          'validation_status', resolved.validation_status,
          'validation_note', resolved.validation_note
        )
        order by resolved.quoted_at desc
      )
      from resolved
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_agent_quotations() from public, anon;
grant execute on function public.get_agent_quotations() to authenticated;

-- Liviana, para decidir si «Mis registros» muestra la pestaña.
create or replace function public.agent_tracks_quotations()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.campaign_agents member
    join public.campaigns campaign on campaign.id = member.campaign_id
    where member.profile_id = (select auth.uid())
      and public.can_access_org(campaign.organization_id)
      and private.campaign_tracks_quotations(campaign.id)
  );
$$;

revoke all on function public.agent_tracks_quotations() from public, anon;
grant execute on function public.agent_tracks_quotations() to authenticated;

-- ---------------------------------------------------------------------------
-- Resolver una cotización: vendida o no vendida.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_agent_quotation(
  p_lead_id uuid,
  p_result text,
  p_channel text,
  p_reason text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  -- El reloj, no el inicio de la transacción: el estado de la cotización es la
  -- última gestión decisiva y dos resoluciones seguidas no pueden empatar.
  v_now timestamptz := clock_timestamp();
  v_lead public.leads%rowtype;
  v_workflow_id uuid;
  v_quote public.calls%rowtype;
  v_previous_sale public.calls%rowtype;
  v_validation public.sale_validations%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_reason text;
  v_outcome text;
  v_workflow_step_id uuid;
  v_call_id uuid;
  v_interaction_id uuid;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;
  if p_result is null or p_result not in ('vendida', 'no_vendida') then
    raise exception 'Indica si la cotización se vendió o no.';
  end if;
  if p_channel is null or p_channel not in ('whatsapp', 'correo', 'presencial', 'otro') then
    raise exception 'Elige por qué canal te confirmó el cliente.';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_actor_id and role = 'agente' and active
  ) then
    raise exception 'Solo un ejecutivo activo puede resolver una cotización.';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform public.assert_org_access(v_lead.organization_id);

  if v_actor_id is distinct from v_lead.managed_by and v_actor_id is distinct from v_lead.assigned_to then
    raise exception 'Este registro no está a tu nombre. Pide a tu supervisor que te lo asigne.';
  end if;

  if not private.campaign_tracks_quotations(v_lead.campaign_id) then
    raise exception 'La campaña de este registro no lleva seguimiento de cotizaciones.';
  end if;

  select workflow_id into v_workflow_id from public.campaigns where id = v_lead.campaign_id;

  select * into v_quote
  from public.calls
  where lead_id = p_lead_id
    and ended_at is not null
    and discarded_reason is null
    and public.normalize_management_text(reason) = 'COTIZACION ENVIADA'
  order by ended_at desc
  limit 1;
  if not found then
    raise exception 'Este registro no tiene una cotización enviada.';
  end if;

  if exists (
    select 1 from public.calls
    where lead_id = p_lead_id and ended_at is null and started_at >= v_now - interval '4 hours'
  ) then
    raise exception 'Este registro tiene una gestión abierta. Ciérrala antes de resolver la cotización.';
  end if;

  -- La venta que ya se hubiera marcado sobre esta cotización.
  select call.* into v_previous_sale
  from public.calls call
  where call.lead_id = p_lead_id
    and call.ended_at > v_quote.ended_at
    and call.discarded_reason is null
    and call.outcome = 'sale'
  order by call.ended_at desc
  limit 1;
  if v_previous_sale.id is not null then
    select * into v_validation from public.sale_validations where call_id = v_previous_sale.id for update;
  end if;

  if p_result = 'vendida' then
    if v_validation.id is not null and v_validation.status in ('pendiente', 'aprobada') then
      raise exception 'Esta cotización ya está marcada como vendida.';
    end if;
    v_reason := 'VENTA EN VALIDACION';
    v_outcome := 'sale';
    v_notes := coalesce(v_notes, 'Cotización aceptada por el cliente.');
  else
    v_reason := public.normalize_management_text(p_reason);
    if v_reason = '' or not exists (
      select 1
      from unnest(private.quotation_lost_reasons(v_workflow_id)) as allowed(value)
      where public.normalize_management_text(allowed.value) = v_reason
    ) then
      raise exception 'Elige el motivo por el que no se vendió.';
    end if;
    v_outcome := 'not_interested';

    select step.id into v_workflow_step_id
    from public.workflow_steps step
    where step.workflow_id = v_workflow_id
      and exists (
        select 1
        from jsonb_array_elements_text(coalesce(step.options, '[]'::jsonb)) as option(value)
        where public.normalize_management_text(option.value) = v_reason
      )
    order by step.step_order desc
    limit 1;

    if v_validation.id is not null and v_validation.status = 'aprobada' then
      raise exception 'Supervisión ya aprobó esta venta. Pídele que la corrija si el cliente se arrepintió.';
    end if;
    if v_validation.id is not null and v_validation.status = 'pendiente' then
      update public.sale_validations
      set status = 'anulada',
          decided_by = v_actor_id,
          decided_at = v_now,
          decision_note = 'El ejecutivo marcó la cotización como no vendida.',
          decision_source = 'revision',
          updated_at = v_now
      where id = v_validation.id;
    end if;
  end if;

  insert into public.calls (
    lead_id, agent_id, status, outcome, reason, notes, started_at, ended_at, management_channel
  )
  values (
    p_lead_id, v_actor_id, 'connected', v_outcome, v_reason, v_notes, v_now, v_now, p_channel
  )
  returning id into v_call_id;

  -- Resolver la cotización también cierra su agenda de seguimiento.
  update public.leads
  set tipificacion_actual = v_reason,
      observacion_actual = v_notes,
      next_action_at = null,
      workflow_status = 'managed',
      assignment_status = 'managed',
      managed_at = v_now,
      managed_by = v_actor_id,
      updated_at = v_now
  where id = p_lead_id;

  insert into public.interactions (lead_id, agent_id, result, notes, workflow_step_id, metadata)
  values (
    p_lead_id, v_actor_id, v_reason, v_notes, v_workflow_step_id,
    jsonb_build_object(
      'source', 'resolve_agent_quotation',
      'call_id', v_call_id,
      'status', 'connected',
      'outcome', v_outcome,
      'workflow_id', v_workflow_id,
      'quote_call_id', v_quote.id,
      'channel', p_channel
    )
  )
  returning id into v_interaction_id;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call_id, p_lead_id, v_actor_id, 'call.closed',
    jsonb_build_object(
      'status', 'connected',
      'outcome', v_outcome,
      'reason', v_reason,
      'channel', p_channel,
      'quote_call_id', v_quote.id,
      'interaction_id', v_interaction_id
    )
  );

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'lead.quotation_resolved',
    jsonb_build_object(
      'call_id', v_call_id,
      'quote_call_id', v_quote.id,
      'result', p_result,
      'reason', v_reason,
      'channel', p_channel,
      'annulled_sale_validation_id', case when p_result = 'no_vendida' and v_validation.status = 'pendiente' then v_validation.id end
    )
  );

  return jsonb_build_object('call_id', v_call_id, 'lead_id', p_lead_id, 'result', p_result, 'reason', v_reason);
end;
$function$;

revoke all on function public.resolve_agent_quotation(uuid, text, text, text, text) from public, anon;
grant execute on function public.resolve_agent_quotation(uuid, text, text, text, text) to authenticated;
