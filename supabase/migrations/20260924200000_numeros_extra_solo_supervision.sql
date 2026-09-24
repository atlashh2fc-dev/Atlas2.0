-- Números fuera de base: solo supervisión los agrega; el ejecutivo elige cuál
-- marcar al llamar desde su agenda o desde la ficha.
--
-- Pedido de operación (24-09-2026, Equifax): cuando un cliente da otro
-- número, el supervisor lo agrega al registro vigente y el ejecutivo, al
-- llamar su compromiso, elige a cuál marcar. Hasta hoy:
--   * lead_contacts dejaba insertar y editar a cualquiera que viera el lead,
--     ejecutivos incluidos. Nadie en la aplicación lo usaba, pero la puerta
--     estaba abierta. Todas las funciones que hoy escriben ahí son SECURITY
--     DEFINER (cargas, migraciones, WhatsApp), así que cerrar la política no
--     las toca.
--   * La llamada desde la agenda o la ficha marcaba siempre leads.phone y solo
--     si era un móvil (+569XXXXXXXX). Los fijos de empresa, que son la mayoría
--     en Equifax, no se podían llamar a mano. Asterisk (agents-outbound) ya
--     acepta cualquier número; el límite estaba solo aquí y en el CTI.

-- Número chileno marcable en dígitos 56XXXXXXXXX: móvil (569) o fijo con
-- código de área (562 Santiago, 5632 Valparaíso...). 8 dígitos sueltos se
-- leen como móvil, igual que lo hacía la llamada de agenda. null = no se
-- puede marcar.
create or replace function public.agent_dial_digits(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
  with normalized as (
    select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits
  )
  select case
    when digits ~ '^56[2-9][0-9]{8}$' then digits
    when digits ~ '^[2-9][0-9]{8}$' then '56' || digits
    when digits ~ '^[0-9]{8}$' then '569' || digits
    else null
  end
  from normalized;
$$;

revoke all on function public.agent_dial_digits(text) from public, anon;
grant execute on function public.agent_dial_digits(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Escritura de lead_contacts: solo admin y supervisor (el supervisor, además,
-- pasa por add_lead_phone, que acota a sus equipos).
-- ---------------------------------------------------------------------------
drop policy if exists lead_contacts_insert on public.lead_contacts;
create policy lead_contacts_insert on public.lead_contacts
  for insert to authenticated
  with check (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    and exists (select 1 from public.leads l where l.id = lead_contacts.lead_id)
  );

drop policy if exists lead_contacts_update on public.lead_contacts;
create policy lead_contacts_update on public.lead_contacts
  for update to authenticated
  using (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    and exists (select 1 from public.leads l where l.id = lead_contacts.lead_id)
  )
  with check (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    and exists (select 1 from public.leads l where l.id = lead_contacts.lead_id)
  );

-- ¿Puede quien llama administrar los números de este lead? Admin de la
-- empresa, o supervisor de su equipo.
create or replace function private.assert_can_manage_lead_phones(p_lead public.leads)
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
    raise exception 'Solo supervisión o administración puede agregar o quitar números de un registro.'
      using errcode = '42501';
  end if;
  perform public.assert_org_access(p_lead.organization_id);
  if v_role = 'supervisor'::public.app_role
    and p_lead.team_id is not null
    and not (p_lead.team_id = any (public.supervised_team_ids())) then
    raise exception 'Ese registro no es de tus equipos.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_can_manage_lead_phones(public.leads) from public, anon;
grant execute on function private.assert_can_manage_lead_phones(public.leads) to authenticated;

create or replace function public.add_lead_phone(p_lead_id uuid, p_phone text, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_lead public.leads%rowtype;
  v_digits text;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_id uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform private.assert_can_manage_lead_phones(v_lead);

  v_digits := public.agent_dial_digits(p_phone);
  if v_digits is null then
    raise exception 'Ingresa un teléfono chileno válido: móvil (9 XXXX XXXX) o fijo con código de área (2 XXXX XXXX).';
  end if;

  if public.agent_dial_digits(v_lead.phone) = v_digits or exists (
    select 1 from public.lead_contacts contact
    where contact.lead_id = p_lead_id
      and contact.contact_type = 'phone'
      and contact.is_valid is distinct from false
      and public.agent_dial_digits(contact.value) = v_digits
  ) then
    raise exception 'Ese número ya está en el registro.';
  end if;

  -- Un número que alguien dio de baja vuelve a quedar vigente.
  insert into public.lead_contacts (
    lead_id, contact_type, value, normalized_value, label, is_primary, is_valid, source, created_by, metadata
  )
  values (
    p_lead_id, 'phone', '+' || v_digits, v_digits, v_label, false, true, 'supervision', (select auth.uid()),
    jsonb_build_object('added_by_role', public.current_role_name())
  )
  on conflict (lead_id, contact_type, normalized_value) do update
    set is_valid = true,
        value = excluded.value,
        label = coalesce(excluded.label, public.lead_contacts.label),
        metadata = public.lead_contacts.metadata || jsonb_build_object(
          'reactivated_by', (select auth.uid()), 'reactivated_at', now()
        ),
        updated_at = now()
  returning id into v_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, (select auth.uid()), 'lead.phone_added',
    jsonb_build_object('contact_id', v_id, 'phone', '+' || v_digits, 'label', v_label)
  );

  return jsonb_build_object('id', v_id, 'phone', '+' || v_digits, 'label', v_label);
end;
$$;

create or replace function public.deactivate_lead_phone(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_contact public.lead_contacts%rowtype;
  v_lead public.leads%rowtype;
begin
  select * into v_contact from public.lead_contacts where id = p_contact_id and contact_type = 'phone';
  if not found then
    raise exception 'El número no existe.';
  end if;
  select * into v_lead from public.leads where id = v_contact.lead_id;
  perform private.assert_can_manage_lead_phones(v_lead);

  -- No se borra: queda dado de baja, con quién y cuándo.
  update public.lead_contacts
  set is_valid = false,
      metadata = metadata || jsonb_build_object('deactivated_by', (select auth.uid()), 'deactivated_at', now()),
      updated_at = now()
  where id = p_contact_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    v_lead.id, v_lead.crm_entity_id, (select auth.uid()), 'lead.phone_deactivated',
    jsonb_build_object('contact_id', p_contact_id, 'phone', v_contact.value)
  );
end;
$$;

-- Deja un número como principal: pasa a leads.phone (lo que marca el
-- discador y la opción 1 del ejecutivo) y el principal anterior queda como
-- número adicional vigente, para no perderlo.
create or replace function public.set_lead_primary_phone(p_lead_id uuid, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_lead public.leads%rowtype;
  v_digits text := public.agent_dial_digits(p_phone);
  v_previous text;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform private.assert_can_manage_lead_phones(v_lead);

  if v_digits is null then
    raise exception 'El número elegido no es un teléfono chileno válido.';
  end if;
  v_previous := public.agent_dial_digits(v_lead.phone);
  if v_previous = v_digits then
    return jsonb_build_object('phone', '+' || v_digits, 'changed', false);
  end if;
  if not exists (
    select 1 from public.lead_contacts contact
    where contact.lead_id = p_lead_id
      and contact.contact_type = 'phone'
      and contact.is_valid is distinct from false
      and public.agent_dial_digits(contact.value) = v_digits
  ) then
    raise exception 'Ese número no está en la ficha. Agrégalo primero.';
  end if;

  if v_previous is not null then
    insert into public.lead_contacts (
      lead_id, contact_type, value, normalized_value, label, is_primary, is_valid, source, created_by, metadata
    )
    values (
      p_lead_id, 'phone', '+' || v_previous, v_previous, 'Principal anterior', false, true, 'supervision',
      (select auth.uid()), jsonb_build_object('replaced_as_primary_at', now())
    )
    on conflict (lead_id, contact_type, normalized_value) do update
      set is_valid = true,
          is_primary = false,
          label = coalesce(public.lead_contacts.label, excluded.label),
          updated_at = now();
  end if;

  update public.lead_contacts
  set is_primary = (public.agent_dial_digits(value) = v_digits),
      updated_at = now()
  where lead_id = p_lead_id
    and contact_type = 'phone'
    and is_primary is distinct from (public.agent_dial_digits(value) = v_digits);

  update public.leads
  set phone = '+' || v_digits,
      updated_at = now()
  where id = p_lead_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, (select auth.uid()), 'lead.primary_phone_changed',
    jsonb_build_object('phone', '+' || v_digits, 'previous_phone', v_lead.phone)
  );

  return jsonb_build_object('phone', '+' || v_digits, 'changed', true);
end;
$$;

revoke all on function public.set_lead_primary_phone(uuid, text) from public, anon;
grant execute on function public.set_lead_primary_phone(uuid, text) to authenticated;

revoke all on function public.add_lead_phone(uuid, text, text) from public, anon;
revoke all on function public.deactivate_lead_phone(uuid) from public, anon;
grant execute on function public.add_lead_phone(uuid, text, text) to authenticated;
grant execute on function public.deactivate_lead_phone(uuid) to authenticated;

-- Los números que se pueden marcar para un lead: el principal primero y
-- después los vigentes de lead_contacts, sin repetir, con el motivo si está
-- en la lista de no llamar. SECURITY INVOKER: quien no ve el lead no ve nada.
create or replace function public.lead_dial_phones(p_lead_id uuid)
returns table(
  contact_id uuid,
  dial_digits text,
  phone text,
  label text,
  source text,
  is_primary boolean,
  blocked_reason text
)
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public'
as $$
  with lead as (
    select l.id, l.phone, l.campaign_id
    from public.leads l
    where l.id = p_lead_id
  ), candidates as (
    select null::uuid as contact_id, public.agent_dial_digits(lead.phone) as dial_digits,
           lead.phone, 'Principal'::text as label, 'ficha'::text as source, true as is_primary,
           0 as rank, null::timestamptz as created_at
    from lead
    union all
    select contact.id, public.agent_dial_digits(contact.value), contact.value,
           coalesce(contact.label, case contact.source when 'supervision' then 'Agregado por supervisión' else null end),
           contact.source, contact.is_primary,
           case when contact.source = 'supervision' then 1 when contact.is_primary then 2 else 3 end,
           contact.created_at
    from public.lead_contacts contact
    join lead on lead.id = contact.lead_id
    where contact.contact_type = 'phone'
      and contact.is_valid is distinct from false
  ), unique_numbers as (
    select distinct on (candidates.dial_digits) candidates.*
    from candidates
    where candidates.dial_digits is not null
    order by candidates.dial_digits, candidates.rank, candidates.created_at desc nulls last
  )
  select
    unique_numbers.contact_id,
    unique_numbers.dial_digits,
    unique_numbers.phone,
    unique_numbers.label,
    unique_numbers.source,
    unique_numbers.is_primary,
    case when lead.campaign_id is not null
      then public.dialer_phone_block_reason(lead.campaign_id, unique_numbers.dial_digits)
    end
  from unique_numbers
  cross join lead
  order by unique_numbers.rank, unique_numbers.created_at desc nulls last;
$$;

revoke all on function public.lead_dial_phones(uuid) from public, anon;
grant execute on function public.lead_dial_phones(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Llamar desde la agenda o la ficha con el número elegido. p_phone null =
-- el principal, como antes. El número tiene que ser del lead (principal o uno
-- vigente de lead_contacts) y no estar en la lista de no llamar.
-- ---------------------------------------------------------------------------
create or replace function private.agent_call_target_digits(p_lead public.leads, p_phone text)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_digits text := public.agent_dial_digits(coalesce(nullif(btrim(p_phone), ''), p_lead.phone));
begin
  if v_digits is null then
    raise exception 'El teléfono elegido no es un número chileno válido.';
  end if;
  if nullif(btrim(p_phone), '') is not null
    and v_digits is distinct from public.agent_dial_digits(p_lead.phone)
    and not exists (
      select 1 from public.lead_contacts contact
      where contact.lead_id = p_lead.id
        and contact.contact_type = 'phone'
        and contact.is_valid is distinct from false
        and public.agent_dial_digits(contact.value) = v_digits
    ) then
    raise exception 'Ese número no está en la ficha. Pide a tu supervisor que lo agregue.';
  end if;
  if public.dialer_phone_is_suppressed(p_lead.organization_id, p_lead.campaign_id, v_digits) then
    raise exception 'Ese número está en la lista de no llamar.';
  end if;
  return v_digits;
end;
$$;

revoke all on function private.agent_call_target_digits(public.leads, text) from public, anon;
grant execute on function private.agent_call_target_digits(public.leads, text) to authenticated;

drop function if exists public.begin_agent_agenda_callback(uuid);
drop function if exists public.begin_agent_agenda_callback_sin_empresa(uuid);
drop function if exists public.begin_agent_assigned_lead_call(uuid);
drop function if exists public.begin_agent_assigned_lead_call_sin_empresa(uuid);

create or replace function public.begin_agent_agenda_callback_sin_empresa(p_lead_id uuid, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_digits text;
  v_subscriber text;
  v_phone text;
  v_call_id uuid;
  v_open_call_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  select *
  into v_actor
  from public.profiles
  where id = v_actor_id
    and role = 'agente'
    and active
  for update;

  if not found then
    raise exception 'Solo un ejecutivo activo puede llamar desde su agenda.';
  end if;

  if v_actor.team_id is null then
    raise exception 'Tu usuario no tiene equipo asignado. Pide a un supervisor que lo configure antes de llamar.';
  end if;

  if v_actor.intercall_break_until is not null and v_actor.intercall_break_until > v_now then
    raise exception 'La interrupción legal sigue en curso. Espera antes de realizar otra llamada.';
  end if;

  select *
  into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'El registro no existe.';
  end if;

  if coalesce(v_lead.managed_by, v_lead.assigned_to) is distinct from v_actor_id then
    raise exception 'Este compromiso no está en tu agenda.';
  end if;

  if v_lead.next_action_at is null then
    raise exception 'Este registro no tiene un compromiso agendado.';
  end if;

  if not exists (
    select 1
    from public.campaigns c
    join public.dialer_campaign_configs dc
      on dc.campaign_id = c.id
     and dc.is_active
    where c.id = v_lead.campaign_id
      and c.is_active
  ) then
    raise exception 'La campaña no está activa o no tiene discado operativo configurado.';
  end if;

  -- El número elegido (o el principal), validado contra la ficha y la lista
  -- de no llamar. Móvil o fijo.
  v_digits := private.agent_call_target_digits(v_lead, p_phone);
  v_phone := '+' || v_digits;
  v_subscriber := case when v_digits ~ '^569[0-9]{8}$' then right(v_digits, 8) else v_digits end;

  perform pg_advisory_xact_lock(hashtextextended(v_digits, 0));

  select c.id
  into v_open_call_id
  from public.calls c
  where c.agent_id = v_actor_id
    and c.ended_at is null
    and c.started_at >= v_now - interval '4 hours'
  order by c.started_at desc
  limit 1
  for update;

  if v_open_call_id is not null then
    raise exception 'Tienes una gestión pendiente de tipificación. Ciérrala antes de llamar desde tu agenda.';
  end if;

  if exists (
    select 1
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.ended_at is null
      and c.started_at >= v_now - interval '4 hours'
      and public.agent_dial_digits(l.phone) = v_digits
  ) or exists (
    select 1
    from public.dial_attempts da
    where da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      and public.agent_dial_digits(da.phone) = v_digits
  ) then
    raise exception 'Este número ya tiene una llamada en curso.';
  end if;

  update public.leads
  set
    callback_attempts = coalesce(callback_attempts, 0) + 1,
    callback_last_attempt_at = v_now,
    managed_by = coalesce(managed_by, v_actor_id),
    updated_at = v_now
  where id = p_lead_id;

  insert into public.calls (lead_id, agent_id)
  values (p_lead_id, v_actor_id)
  returning id into v_call_id;

  insert into public.call_events (
    call_id, lead_id, agent_id, event_type, payload
  )
  values (
    v_call_id, p_lead_id, v_actor_id, 'cti.agenda_callback_started',
    jsonb_build_object(
      'campaign_id', v_lead.campaign_id,
      'phone', v_phone,
      'phone_is_primary', v_digits is not distinct from public.agent_dial_digits(v_lead.phone),
      'source', 'agenda',
      'next_action_at', v_lead.next_action_at,
      'overdue', v_lead.next_action_at < v_now,
      'attempts', coalesce(v_lead.callback_attempts, 0) + 1
    )
  );

  insert into public.sensitive_access_log (
    actor_id, action, target_profile_id, metadata
  )
  values (
    v_actor_id, 'cti.agenda_callback', null,
    jsonb_build_object(
      'phone', v_phone,
      'lead_id', p_lead_id,
      'call_id', v_call_id,
      'campaign_id', v_lead.campaign_id
    )
  );

  insert into public.crm_audit_events (
    lead_id, crm_entity_id, actor_id, event_type, payload
  )
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'lead.agenda_callback_started',
    jsonb_build_object(
      'campaign_id', v_lead.campaign_id,
      'call_id', v_call_id,
      'phone', v_phone,
      'next_action_at', v_lead.next_action_at
    )
  );

  return jsonb_build_object(
    'lead_id', p_lead_id,
    'call_id', v_call_id,
    'campaign_id', v_lead.campaign_id,
    'phone', v_phone,
    'subscriber', v_subscriber,
    'dial_digits', v_digits,
    'full_name', v_lead.full_name
  );
end;
$function$;

create or replace function public.begin_agent_assigned_lead_call_sin_empresa(p_lead_id uuid, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_digits text;
  v_subscriber text;
  v_phone text;
  v_call_id uuid;
  v_open_call_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is null or not coalesce(public.is_current_app_session_valid(), false) then
    raise exception 'No autenticado.';
  end if;
  select * into v_actor
  from public.profiles actor
  where actor.id = v_actor_id
    and actor.role = 'agente'::public.app_role
    and actor.active
  for update;
  if not found then raise exception 'Solo un ejecutivo activo puede llamar este registro.'; end if;
  if v_actor.team_id is null then raise exception 'Tu usuario no tiene equipo asignado.'; end if;
  if v_actor.intercall_break_until is not null and v_actor.intercall_break_until > v_now then
    raise exception 'La interrupción legal sigue en curso. Espera antes de realizar otra llamada.';
  end if;

  select * into v_lead
  from public.leads lead
  where lead.id = p_lead_id
  for update;
  if not found then raise exception 'El registro no existe.'; end if;
  if v_lead.assigned_to is distinct from v_actor_id then
    raise exception 'Solo el ejecutivo asignado puede llamar este registro.';
  end if;
  if not exists (
    select 1
    from public.campaigns campaign
    join public.dialer_campaign_configs config
      on config.campaign_id = campaign.id and config.is_active
    where campaign.id = v_lead.campaign_id and campaign.is_active
  ) then
    raise exception 'La campaña no está activa o no tiene discado operativo configurado.';
  end if;

  v_digits := private.agent_call_target_digits(v_lead, p_phone);
  v_phone := '+' || v_digits;
  v_subscriber := case when v_digits ~ '^569[0-9]{8}$' then right(v_digits, 8) else v_digits end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_digits, 0));

  select call.id into v_open_call_id
  from public.calls call
  where call.agent_id = v_actor_id
    and call.ended_at is null
    and call.started_at >= v_now - interval '4 hours'
  order by call.started_at desc
  limit 1
  for update;
  if v_open_call_id is not null then
    raise exception 'Tienes una gestión pendiente de tipificación. Ciérrala antes de llamar.';
  end if;
  if exists (
    select 1 from public.calls call
    join public.leads lead on lead.id = call.lead_id
    where call.ended_at is null
      and call.started_at >= v_now - interval '4 hours'
      and public.agent_dial_digits(lead.phone) = v_digits
  ) or exists (
    select 1 from public.dial_attempts attempt
    where attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      and public.agent_dial_digits(attempt.phone) = v_digits
  ) then
    raise exception 'Este número ya tiene una llamada en curso.';
  end if;

  update public.leads
  set managed_by = v_actor_id, updated_at = v_now
  where id = p_lead_id;
  insert into public.calls (lead_id, agent_id)
  values (p_lead_id, v_actor_id)
  returning id into v_call_id;
  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call_id, p_lead_id, v_actor_id, 'cti.assigned_lead_call_started',
    jsonb_build_object(
      'campaign_id', v_lead.campaign_id,
      'phone', v_phone,
      'phone_is_primary', v_digits is not distinct from public.agent_dial_digits(v_lead.phone),
      'source', 'assigned_lead'
    )
  );
  insert into public.sensitive_access_log (actor_id, action, target_profile_id, metadata)
  values (
    v_actor_id, 'cti.assigned_lead_call', null,
    jsonb_build_object('lead_id', p_lead_id, 'call_id', v_call_id, 'campaign_id', v_lead.campaign_id, 'phone', v_phone)
  );
  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'lead.assigned_call_started',
    jsonb_build_object('campaign_id', v_lead.campaign_id, 'call_id', v_call_id, 'phone', v_phone)
  );
  return jsonb_build_object(
    'lead_id', p_lead_id,
    'call_id', v_call_id,
    'campaign_id', v_lead.campaign_id,
    'phone', v_phone,
    'subscriber', v_subscriber,
    'dial_digits', v_digits,
    'full_name', v_lead.full_name
  );
end;
$function$;

create or replace function public.begin_agent_agenda_callback(p_lead_id uuid, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  perform public.assert_org_access(public.org_of_lead(p_lead_id));
  return public.begin_agent_agenda_callback_sin_empresa(p_lead_id, p_phone);
end;
$function$;

create or replace function public.begin_agent_assigned_lead_call(p_lead_id uuid, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  perform public.assert_org_access(public.org_of_lead(p_lead_id));
  return public.begin_agent_assigned_lead_call_sin_empresa(p_lead_id, p_phone);
end;
$function$;

revoke all on function public.begin_agent_agenda_callback_sin_empresa(uuid, text) from public, anon, authenticated;
revoke all on function public.begin_agent_assigned_lead_call_sin_empresa(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_agent_agenda_callback_sin_empresa(uuid, text) to service_role;
grant execute on function public.begin_agent_assigned_lead_call_sin_empresa(uuid, text) to service_role;
revoke all on function public.begin_agent_agenda_callback(uuid, text) from public, anon;
revoke all on function public.begin_agent_assigned_lead_call(uuid, text) from public, anon;
grant execute on function public.begin_agent_agenda_callback(uuid, text) to authenticated, service_role;
grant execute on function public.begin_agent_assigned_lead_call(uuid, text) to authenticated, service_role;
