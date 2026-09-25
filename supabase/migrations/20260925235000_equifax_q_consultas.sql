-- Q de Equifax: cantidad de consultas (o registros) que contrata el cliente.
--
-- Pedido de operación (25-09-2026): la columna Q de «NEGOCIOS EN CURSO» venía
-- de Atlas 1, que la pedía por producto (equifax_bolsa_ri_q_consultas,
-- equifax_bundle_q_consultas_ri, equifax_bbdd_cantidad_registros…). La
-- migración la dejó en mig_a1_calls.custom_fields pero nunca pasó a las
-- gestiones, y la ficha de Atlas 2.0 solo pedía productos y UF: desde el
-- 24-09 las cotizaciones y ventas nuevas quedaban sin Q.
--
--   * calls.equifax_q_consultas: la Q de la gestión. Se carga de Atlas 1 (el
--     primer campo de Q con valor entero positivo, en el orden en que la usaba
--     la planilla: 120 de 123 filas con Q calzan exacto) y desde ahora la pide
--     la ficha al cotizar o vender.
--   * sale_validations.q_consultas: la venta la copia de su gestión, igual que
--     productos y UF, y Validación de ventas la muestra y la exporta.
--   * set_call_equifax_q: fija la Q de una gestión ya cerrada. La usan la
--     corrección del ejecutivo y la de supervisión, cuyas RPC no la reciben.
--   * get_equifax_negocios devuelve la Q para la columna Q del reporte.

alter table public.calls
  add column if not exists equifax_q_consultas numeric;
alter table public.calls drop constraint if exists calls_equifax_q_consultas_check;
alter table public.calls
  add constraint calls_equifax_q_consultas_check check (equifax_q_consultas is null or equifax_q_consultas > 0);
comment on column public.calls.equifax_q_consultas is
  'Q de Equifax: cantidad de consultas o registros que contrata el cliente (columna Q de «Negocios en curso»).';

alter table public.sale_validations
  add column if not exists q_consultas numeric;
comment on column public.sale_validations.q_consultas is
  'Q de la venta Equifax, copiada de la gestión como productos y UF.';

-- ---------------------------------------------------------------------------
-- Q de Atlas 1. La Q no mueve ninguna métrica: el disparador del reporte de
-- supervisión (8 recálculos por fila) se apaga solo durante la carga.
-- ---------------------------------------------------------------------------
alter table public.calls disable trigger calls_touch_supervisor_report_metrics;

with q_atlas1 as (
  select
    migrated.legacy_call_id,
    (
      select (case when field.value ~ '^[0-9]+(\.0+)?$' then field.value::numeric end)
      from unnest(array[
        'equifax_bundle_q_consultas_ri',
        'equifax_bolsa_ri_q_consultas',
        'equifax_q_consultas',
        'equifax_bbdd_cantidad_registros',
        'equifax_datafinder_q_consultas',
        'equifax_malla_societaria_q_consultas',
        'equifax_mora_control_q_monitoreo',
        'equifax_q_monitoreo'
      ]) with ordinality as key(name, position)
      cross join lateral (select btrim(migrated.custom_fields->>key.name) as value) field
      where (case when field.value ~ '^[0-9]+(\.0+)?$' then field.value::numeric end) > 0
      order by key.position
      limit 1
    ) as q
  from public.mig_a1_calls migrated
  where jsonb_typeof(migrated.custom_fields) = 'object'
)
update public.calls call
set equifax_q_consultas = q_atlas1.q
from q_atlas1
where call.legacy_call_id = q_atlas1.legacy_call_id
  and q_atlas1.q is not null
  and call.equifax_q_consultas is null;

alter table public.calls enable trigger calls_touch_supervisor_report_metrics;

-- ---------------------------------------------------------------------------
-- La venta copia la Q de su gestión.
-- ---------------------------------------------------------------------------
create or replace function public.sale_validation_from_call()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
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
          q_consultas = new.equifax_q_consultas,
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
      sold_at, products, uf_amount, q_consultas, recipient_email, agent_notes
    )
    values (
      v_lead.organization_id, new.id, new.lead_id, v_lead.campaign_id, v_lead.team_id, new.agent_id,
      new.historical_agent_id, coalesce(new.ended_at, new.started_at, new.created_at),
      new.equifax_products, new.equifax_uf_amount, new.equifax_q_consultas, new.equifax_recipient_email, new.notes
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
$function$;

drop trigger if exists calls_sale_validation on public.calls;
create trigger calls_sale_validation
  after insert or update of reason, outcome, ended_at, equifax_products, equifax_uf_amount,
    equifax_q_consultas, equifax_recipient_email, notes
  on public.calls
  for each row execute function public.sale_validation_from_call();

-- Las ventas existentes toman la Q de su gestión sin pasar por el disparador
-- (no hay que tocar su estado ni su fecha).
update public.sale_validations validation
set q_consultas = call.equifax_q_consultas
from public.calls call
where call.id = validation.call_id
  and call.equifax_q_consultas is not null
  and validation.q_consultas is distinct from call.equifax_q_consultas;

-- ---------------------------------------------------------------------------
-- El cierre del ejecutivo guarda la Q. Parámetro nuevo al final y con valor
-- por omisión: la versión anterior de la aplicación sigue cerrando igual
-- mientras se despliega.
-- ---------------------------------------------------------------------------
drop function if exists public.save_call_management(uuid, uuid, text, text, text, text, timestamp with time zone, text, text[], numeric, text);

create function public.save_call_management(
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
  p_equifax_recipient_email text,
  p_equifax_q_consultas numeric default null
)
returns jsonb
language plpgsql
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
  v_requires_equifax_data boolean := false;
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

  if p_equifax_q_consultas is not null and p_equifax_q_consultas <= 0 then
    raise exception 'La Q (consultas o registros) debe ser mayor que cero.';
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

  v_requires_equifax_data := public.management_requires_equifax_data(
    v_workflow_id,
    v_lead.campaign_id
  );

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

  if public.management_agenda_requirement(
      v_reason_norm,
      p_outcome,
      v_requires_equifax_data
    ) = 'required' and p_next_action_at is null then
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

  -- Reglas de Atlas 1: franja de agenda de la campaña y nota en SE ENVIA
  -- INFORMACION sin agenda (20260924180100).
  perform private.assert_management_closure_rules(
    v_lead.campaign_id,
    v_requires_equifax_data,
    v_reason,
    p_notes,
    p_next_action_at,
    null
  );

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
    equifax_q_consultas = p_equifax_q_consultas,
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
      'equifax_q_consultas', p_equifax_q_consultas,
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

revoke all on function public.save_call_management(uuid, uuid, text, text, text, text, timestamp with time zone, text, text[], numeric, text, numeric) from public, anon;
grant execute on function public.save_call_management(uuid, uuid, text, text, text, text, timestamp with time zone, text, text[], numeric, text, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Q de una gestión ya cerrada: la corrección del ejecutivo (solo su gestión)
-- y la de supervisión (registros de sus equipos; el admin, de su empresa).
-- ---------------------------------------------------------------------------
create or replace function public.set_call_equifax_q(p_call_id uuid, p_q numeric)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role public.app_role := public.current_role_name();
  v_call public.calls%rowtype;
  v_lead public.leads%rowtype;
begin
  if v_user_id is null or v_role is null then
    raise exception 'No autenticado.';
  end if;
  if p_q is not null and p_q <= 0 then
    raise exception 'La Q (consultas o registros) debe ser mayor que cero.';
  end if;

  select * into v_call from public.calls where id = p_call_id;
  if not found or v_call.ended_at is null or v_call.discarded_reason is not null then
    raise exception 'La gestión no existe o no está cerrada.';
  end if;
  select * into v_lead from public.leads where id = v_call.lead_id;
  if not found or not (v_lead.organization_id = any (public.current_org_ids())) then
    raise exception 'No tienes acceso a esta gestión.';
  end if;

  if not (
    v_role = 'admin'
    or (v_role = 'supervisor' and v_lead.team_id = any (coalesce(public.supervised_team_ids(), '{}'::uuid[])))
    or (v_role = 'agente' and v_call.agent_id = v_user_id and v_call.legacy_call_id is null)
  ) then
    raise exception 'No puedes cambiar la Q de esta gestión.';
  end if;

  update public.calls
  set equifax_q_consultas = p_q,
      updated_at = now()
  where id = p_call_id
    and equifax_q_consultas is distinct from p_q;
end;
$function$;

revoke all on function public.set_call_equifax_q(uuid, numeric) from public, anon;
grant execute on function public.set_call_equifax_q(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Validación de ventas muestra y exporta la Q.
-- ---------------------------------------------------------------------------
drop function if exists public.list_sale_validations(text, integer);

create function public.list_sale_validations(p_status text default 'pendiente'::text, p_limit integer default 200)
returns table(
  id uuid, status text, sold_at timestamp with time zone, lead_id uuid, lead_name text, lead_rut text,
  lead_phone text, lead_email text, lead_status text, campaign_name text, team_name text, agent_name text,
  products text[], uf_amount numeric, recipient_email text, agent_notes text, decided_at timestamp with time zone,
  decided_by_name text, decision_note text, decision_source text, management_channel text, q_consultas numeric
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select
    v.id, v.status, v.sold_at, v.lead_id,
    lead.full_name, lead.rut, lead.phone, lead.email, lead.status,
    campaign.name, team.name,
    coalesce(historical.full_name, agent.full_name, agent.email),
    v.products, v.uf_amount, v.recipient_email, v.agent_notes,
    v.decided_at, coalesce(decider.full_name, decider.email), v.decision_note, v.decision_source,
    case when call.legacy_call_id is null then call.management_channel end,
    v.q_consultas
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
$function$;

revoke all on function public.list_sale_validations(text, integer) from public, anon;
grant execute on function public.list_sale_validations(text, integer) to authenticated, service_role;

drop function if exists public.search_sale_validations(text, text, date, date, text, text, integer, text);

create function public.search_sale_validations(
  p_status text default 'aprobada'::text,
  p_query text default null::text,
  p_from date default null::date,
  p_to date default null::date,
  p_agent text default null::text,
  p_product text default null::text,
  p_limit integer default 1000,
  p_date_field text default 'venta'::text
)
returns table(
  id uuid, status text, sold_at timestamp with time zone, lead_id uuid, lead_name text, lead_rut text,
  lead_phone text, lead_email text, lead_status text, campaign_name text, team_name text, agent_name text,
  products text[], uf_amount numeric, recipient_email text, agent_notes text, decided_at timestamp with time zone,
  decided_by_name text, decision_note text, decision_source text, management_channel text, q_consultas numeric
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
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
      v.q_consultas,
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
    base.decided_by_name, base.decision_note, base.decision_source, base.management_channel,
    base.q_consultas
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
$function$;

revoke all on function public.search_sale_validations(text, text, date, date, text, text, integer, text) from public, anon;
grant execute on function public.search_sale_validations(text, text, date, date, text, text, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El reporte de negocios trae la Q: la de la venta aprobada, la de la gestión
-- vigente o, si esa no la trae, la última informada en el negocio.
-- ---------------------------------------------------------------------------
drop function if exists public.get_equifax_negocios(uuid);

create function public.get_equifax_negocios(p_campaign_id uuid default null)
returns table (
  lead_id uuid,
  campana text,
  origen text,
  asesor text,
  rut text,
  empresa text,
  productos text[],
  uf numeric,
  q_consultas numeric,
  id_audio text,
  estado text,
  observacion text,
  nombre_cliente text,
  telefono text,
  email text,
  observaciones_equipo text,
  fecha_seguimiento timestamptz,
  fecha_gestion date,
  fecha_ok_contrato date,
  ultima_gestion text,
  fecha_ultima_gestion date
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
#variable_conflict use_column
declare
  v_rol public.app_role := public.current_role_name();
  v_empresas uuid[] := public.current_org_ids();
  v_equipos uuid[] := coalesce(public.supervised_team_ids(), '{}'::uuid[]);
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;
  if v_rol is null or v_rol not in ('admin', 'supervisor') then
    raise exception 'Solo administración y supervisión descargan el reporte de negocios.';
  end if;

  return query
  with campanas as (
    select campaign.id, campaign.name
    from public.campaigns campaign
    where public.management_requires_equifax_data(campaign.workflow_id, campaign.id)
      and (p_campaign_id is null or campaign.id = p_campaign_id)
  ),
  -- Solo los registros que el usuario puede ver: el admin, los de su
  -- empresa; el supervisor, los de sus equipos (la misma regla de leads).
  visibles as (
    select lead.id
    from public.leads lead
    where lead.campaign_id in (select campanas.id from campanas)
      and lead.organization_id = any (v_empresas)
      and (
        v_rol = 'admin'
        or lead.team_id = any (v_equipos)
      )
  ),
  gestiones as (
    select call.id, call.lead_id, call.agent_id, call.historical_agent_id, call.legacy_call_id,
           call.ended_at, call.notes, call.equifax_products, call.equifax_uf_amount, call.equifax_q_consultas,
           call.equifax_recipient_email
    from public.calls call
    where call.lead_id in (select visibles.id from visibles)
      and call.reason ~* '(cotiz|venta)'
      and call.ended_at is not null
      and call.discarded_reason is null
      and public.normalize_management_text(call.reason) in ('COTIZACION ENVIADA', 'VENTA EN VALIDACION')
  ),
  negocios as (
    select gestiones.lead_id, min(gestiones.ended_at) as abierto, max(gestiones.ended_at) as ultima
    from gestiones
    group by gestiones.lead_id
  )
  select
    lead.id as lead_id,
    campanas.name as campana,
    case
      when lead.extra ? 'fuera_de_base' or lead.extra ? 'ingreso_manual' then 'Ingreso fuera de base'
      when lead.extra->>'external_source' = 'atlas_lead' then campanas.name
      when lead.extra->>'origen' like 'planilla_ventas%' then 'Planilla ventas Equifax'
      when lead.extra ? 'atlas1' then 'Base Atlas 1'
      when lead.extra->'base_discado'->>'base' like 'vocalcom%' then 'Base Vocalcom'
      else coalesce(lead.extra->>'origen', campanas.name)
    end as origen,
    coalesce(agente.full_name, historico.full_name) as asesor,
    lead.rut as rut,
    lead.full_name as empresa,
    coalesce(case when venta.status = 'aprobada' then venta.products end, vigente.equifax_products, '{}'::text[]) as productos,
    coalesce(case when venta.status = 'aprobada' then venta.uf_amount end, vigente.equifax_uf_amount) as uf,
    coalesce(
      case when venta.status = 'aprobada' then venta.q_consultas end,
      vigente.equifax_q_consultas,
      q_previa.equifax_q_consultas
    ) as q_consultas,
    coalesce(apertura.legacy_call_id, apertura.id::text) as id_audio,
    case
      when venta.status = 'aprobada' then 'APROBADO DEFINITIVO'
      when venta.status = 'pendiente' then 'REVISION EQUIFAX'
      when rechazo.ended_at is not null then 'RECHAZO DEFINITIVO'
      when venta.status = 'rechazada' and venta.call_id = vigente.id then 'RECHAZO DEFINITIVO'
      else 'PDTE RESPUESTA CLIENTE'
    end as estado,
    nullif(btrim(apertura.notes), '') as observacion,
    coalesce(
      nullif(nullif(btrim(lead.extra->'atlas1'->>'nombre_cliente'), ''), lead.full_name),
      nullif(btrim(lead.extra->'contacto'->>'nombre'), ''),
      nullif(btrim(lead.extra->>'contact_name'), ''),
      nullif(btrim(lead.extra->'atlas1'->>'nombre_cliente'), '')
    ) as nombre_cliente,
    lead.phone as telefono,
    coalesce(nullif(btrim(vigente.equifax_recipient_email), ''), nullif(btrim(lead.email), '')) as email,
    historial.observaciones as observaciones_equipo,
    lead.next_action_at as fecha_seguimiento,
    (apertura.ended_at at time zone 'America/Santiago')::date as fecha_gestion,
    case when venta.status = 'aprobada' then (coalesce(venta.decided_at, venta.sold_at) at time zone 'America/Santiago')::date end as fecha_ok_contrato,
    ultima.reason as ultima_gestion,
    (ultima.ended_at at time zone 'America/Santiago')::date as fecha_ultima_gestion
  from negocios
  join public.leads lead on lead.id = negocios.lead_id
  join campanas on campanas.id = lead.campaign_id
  join lateral (
    select gestiones.* from gestiones
    where gestiones.lead_id = negocios.lead_id
    order by gestiones.ended_at asc
    limit 1
  ) apertura on true
  join lateral (
    select gestiones.* from gestiones
    where gestiones.lead_id = negocios.lead_id
    order by gestiones.ended_at desc
    limit 1
  ) vigente on true
  -- La última Q informada del negocio, por si la cotización vigente no la trae.
  left join lateral (
    select gestiones.equifax_q_consultas from gestiones
    where gestiones.lead_id = negocios.lead_id
      and gestiones.equifax_q_consultas is not null
    order by gestiones.ended_at desc
    limit 1
  ) q_previa on true
  left join lateral (
    select validation.status, validation.products, validation.uf_amount, validation.q_consultas, validation.call_id,
           validation.sold_at, validation.decided_at
    from public.sale_validations validation
    where validation.lead_id = negocios.lead_id
    order by (validation.status = 'aprobada') desc, validation.sold_at desc
    limit 1
  ) venta on true
  left join lateral (
    select call.ended_at
    from public.calls call
    where call.lead_id = negocios.lead_id
      and call.ended_at > negocios.ultima
      and call.discarded_reason is null
      and call.outcome = 'not_interested'
    order by call.ended_at desc
    limit 1
  ) rechazo on true
  left join lateral (
    select call.reason, call.ended_at
    from public.calls call
    where call.lead_id = negocios.lead_id
      and call.ended_at is not null
      and call.discarded_reason is null
      and nullif(btrim(call.reason), '') is not null
    order by call.ended_at desc
    limit 1
  ) ultima on true
  left join lateral (
    select string_agg(
      to_char(call.ended_at at time zone 'America/Santiago', 'DD-MM-YYYY') || ': ' || btrim(call.notes),
      ' / ' order by call.ended_at
    ) as observaciones
    from public.calls call
    where call.lead_id = negocios.lead_id
      and call.ended_at >= negocios.abierto
      and call.discarded_reason is null
      and nullif(btrim(call.notes), '') is not null
  ) historial on true
  left join public.profiles agente on agente.id = vigente.agent_id
  left join public.historical_agents historico on historico.id = vigente.historical_agent_id
  order by apertura.ended_at desc, lead.full_name;
end;
$function$;

revoke all on function public.get_equifax_negocios(uuid) from public, anon;
grant execute on function public.get_equifax_negocios(uuid) to authenticated;
