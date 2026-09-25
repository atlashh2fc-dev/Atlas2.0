-- Ingreso de registros fuera de base, como en Atlas 1.
--
-- En Atlas 1 el supervisor creaba a mano un cliente que no venía en la base
-- (llamó por su cuenta, lo refirieron, se cayó de la carga): RUT, nombre,
-- teléfonos, comuna, región y producto, dentro de la campaña activa. Atlas 2
-- ya tenía create_manual_lead_record, pero:
--   * aceptaba cualquier RUT, aunque el dígito verificador no cuadrara;
--   * si el RUT existía en cualquier otra campaña, reutilizaba ese registro y
--     no creaba nada en la campaña elegida, aunque el índice único es por
--     campaña (un cliente de "Equifax Imagen" no podía entrar a "Equifax");
--   * no guardaba contacto, comuna, región, producto ni un segundo teléfono,
--     y no dejaba marca de que el registro se ingresó fuera de base.

create or replace function public.rut_es_valido(p_rut text)
returns boolean
language plpgsql
immutable
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_rut text := upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g'));
  v_cuerpo text;
  v_suma integer := 0;
  v_factor integer := 2;
  v_dv integer;
  v_esperado text;
begin
  if v_rut !~ '^[0-9]{7,8}[0-9K]$' then
    return false;
  end if;
  v_cuerpo := left(v_rut, -1);
  if v_cuerpo ~ '^0+$' then
    return false;
  end if;
  for i in reverse length(v_cuerpo) .. 1 loop
    v_suma := v_suma + substr(v_cuerpo, i, 1)::integer * v_factor;
    v_factor := case when v_factor = 7 then 2 else v_factor + 1 end;
  end loop;
  v_dv := 11 - (v_suma % 11);
  v_esperado := case v_dv when 11 then '0' when 10 then 'K' else v_dv::text end;
  return v_esperado = right(v_rut, 1);
end;
$$;

grant execute on function public.rut_es_valido(text) to authenticated, service_role;

-- Misma firma y mismos permisos: la envoltura con guardia de empresa
-- (create_manual_lead_record) sigue llamando a esta.
create or replace function public.create_manual_lead_record_sin_empresa(
  p_full_name text,
  p_rut text default null::text,
  p_phone text default null::text,
  p_email text default null::text,
  p_team_id uuid default null::uuid,
  p_campaign_id uuid default null::uuid,
  p_assigned_to uuid default null::uuid,
  p_notes text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_supervised_team_ids uuid[] := (select public.supervised_team_ids());
  v_now timestamptz := now();
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_rut text := nullif(btrim(coalesce(p_rut, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_normalized_rut text := nullif(public.normalize_lead_rut(p_rut), '');
  v_campaign public.campaigns%rowtype;
  v_agent public.profiles%rowtype;
  v_effective_team_id uuid;
  v_entity_id uuid;
  v_lead_id uuid;
  v_existing_lead_id uuid;
  v_existing_team_id uuid;
  v_campaign_agent_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para crear registros manuales.';
  end if;

  if v_full_name is null then
    raise exception 'Indica el nombre o razón social del registro.';
  end if;

  if v_rut is null and v_phone is null then
    raise exception 'Indica al menos RUT o teléfono.';
  end if;

  if v_rut is not null and not public.rut_es_valido(v_rut) then
    raise exception 'El RUT % no es válido: revisa los números y el dígito verificador.', v_rut;
  end if;

  if v_role = 'supervisor' then
    if coalesce(array_length(v_supervised_team_ids, 1), 0) = 0 then
      raise exception 'Tu supervisor no tiene equipo asignado.';
    end if;
    v_effective_team_id := coalesce(p_team_id, v_supervised_team_ids[1]);
    if not (v_effective_team_id = any(v_supervised_team_ids)) then
      raise exception 'No puedes crear un registro fuera de tus equipos.';
    end if;
  else
    v_effective_team_id := p_team_id;
  end if;

  if p_campaign_id is not null then
    select *
    into v_campaign
    from public.campaigns
    where id = p_campaign_id
      and is_active
    limit 1;

    if not found then
      raise exception 'La campaña seleccionada no existe o no está activa.';
    end if;
  end if;

  if p_assigned_to is not null then
    select *
    into v_agent
    from public.profiles
    where id = p_assigned_to
      and role = 'agente'
      and active
    limit 1;

    if not found then
      raise exception 'El ejecutivo destino no existe o no está activo.';
    end if;

    v_effective_team_id := coalesce(v_effective_team_id, v_agent.team_id);

    if v_effective_team_id is null or v_agent.team_id is distinct from v_effective_team_id then
      raise exception 'El ejecutivo destino no pertenece al equipo del registro.';
    end if;

    if v_role = 'supervisor' and not (v_agent.team_id = any(v_supervised_team_ids)) then
      raise exception 'El ejecutivo destino no pertenece a tu equipo.';
    end if;

    if p_campaign_id is not null then
      select count(*)
      into v_campaign_agent_count
      from public.campaign_agents ca
      where ca.campaign_id = p_campaign_id;

      if v_campaign_agent_count > 0 and not exists (
        select 1
        from public.campaign_agents ca
        where ca.campaign_id = p_campaign_id
          and ca.profile_id = p_assigned_to
      ) then
        raise exception 'El ejecutivo destino no pertenece a la campaña seleccionada.';
      end if;
    end if;
  end if;

  if v_effective_team_id is null then
    raise exception 'Selecciona un equipo o un ejecutivo destino.';
  end if;

  if v_normalized_rut is not null then
    -- Duplicado es el mismo RUT en la misma campaña: lo que dice el índice
    -- único leads_dedup_rut_idx (y la expresión que lo usa).
    select l.crm_entity_id, l.id, l.team_id
    into v_entity_id, v_existing_lead_id, v_existing_team_id
    from public.leads l
    where coalesce(l.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(p_campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and l.rut is not null
      and btrim(l.rut) <> ''
      and upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')) = v_normalized_rut
    limit 1;

    if v_existing_lead_id is not null then
      if v_role = 'supervisor' and not (v_existing_team_id = any(v_supervised_team_ids)) then
        raise exception 'Este RUT ya está en la campaña, en otro equipo. Solicita revisión a un administrador antes de gestionarlo.';
      end if;

      if v_entity_id is null then
        insert into public.crm_entities (
          normalized_rut,
          display_name,
          primary_lead_id,
          metadata
        )
        values (
          v_normalized_rut,
          v_full_name,
          v_existing_lead_id,
          jsonb_build_object(
            'source', 'manual_supervisor_record_duplicate_repair',
            'created_by', v_actor_id,
            'created_at', v_now
          )
        )
        on conflict (normalized_rut) do update
        set
          primary_lead_id = coalesce(public.crm_entities.primary_lead_id, excluded.primary_lead_id),
          metadata = public.crm_entities.metadata || jsonb_build_object(
            'last_manual_duplicate_by', v_actor_id,
            'last_manual_duplicate_at', v_now
          ),
          updated_at = v_now
        returning id into v_entity_id;
      end if;

      update public.crm_entities
      set
        primary_lead_id = coalesce(primary_lead_id, v_existing_lead_id),
        metadata = metadata || jsonb_build_object(
          'last_manual_duplicate_by', v_actor_id,
          'last_manual_duplicate_at', v_now
        ),
        updated_at = v_now
      where id = v_entity_id;

      update public.leads
      set
        phone = coalesce(public.leads.phone, v_phone),
        email = coalesce(public.leads.email, v_email),
        crm_entity_id = coalesce(public.leads.crm_entity_id, v_entity_id),
        updated_at = v_now,
        extra = coalesce(public.leads.extra, '{}'::jsonb) || jsonb_build_object(
          'last_manual_duplicate_attempt_at', v_now,
          'last_manual_duplicate_attempt_by', v_actor_id
        )
      where id = v_existing_lead_id;

      if v_phone is not null then
        insert into public.lead_contacts (
          lead_id,
          contact_type,
          value,
          normalized_value,
          source,
          created_by,
          metadata
        )
        select
          v_existing_lead_id,
          'phone',
          v_phone,
          public.normalize_lead_contact('phone', v_phone),
          'manual_supervisor_record_duplicate',
          v_actor_id,
          jsonb_build_object('captured_at', v_now)
        where public.normalize_lead_contact('phone', v_phone) <> ''
        on conflict (lead_id, contact_type, normalized_value) do nothing;
      end if;

      if v_email is not null then
        insert into public.lead_contacts (
          lead_id,
          contact_type,
          value,
          normalized_value,
          source,
          created_by,
          metadata
        )
        select
          v_existing_lead_id,
          'email',
          v_email,
          public.normalize_lead_contact('email', v_email),
          'manual_supervisor_record_duplicate',
          v_actor_id,
          jsonb_build_object('captured_at', v_now)
        where public.normalize_lead_contact('email', v_email) <> ''
        on conflict (lead_id, contact_type, normalized_value) do nothing;
      end if;

      insert into public.crm_audit_events (
        lead_id,
        crm_entity_id,
        actor_id,
        event_type,
        payload
      )
      values (
        v_existing_lead_id,
        v_entity_id,
        v_actor_id,
        'lead.manual_duplicate_detected',
        jsonb_build_object(
          'source', 'dashboard.leads.new',
          'normalized_rut', v_normalized_rut,
          'requested_full_name', v_full_name,
          'requested_team_id', v_effective_team_id,
          'existing_team_id', v_existing_team_id,
          'campaign_id', p_campaign_id,
          'assigned_to', p_assigned_to,
          'notes', v_notes
        )
      );

      if p_assigned_to is not null then
        perform public.assign_lead(
          v_existing_lead_id,
          p_assigned_to,
          'Asignación sobre RUT existente al intentar crear registro manual',
          'dashboard.leads.new.duplicate_rut',
          false,
          null
        );
      end if;

      return jsonb_build_object(
        'lead_id', v_existing_lead_id,
        'crm_entity_id', v_entity_id,
        'assigned_to', p_assigned_to,
        'team_id', v_existing_team_id,
        'campaign_id', p_campaign_id,
        'duplicate', true,
        'action', 'existing_lead_reused'
      );
    end if;
  end if;

  -- La ficha maestra por RUT es una sola: si el cliente ya existía en otra
  -- campaña, el registro nuevo se cuelga de ella sin pisarle el nombre.
  if v_normalized_rut is not null then
    insert into public.crm_entities (
      normalized_rut,
      display_name,
      metadata
    )
    values (
      v_normalized_rut,
      v_full_name,
      jsonb_build_object(
        'source', 'manual_supervisor_record',
        'created_by', v_actor_id,
        'created_at', v_now
      )
    )
    on conflict (normalized_rut) do update
    set
      display_name = coalesce(nullif(public.crm_entities.display_name, ''), excluded.display_name),
      metadata = public.crm_entities.metadata || jsonb_build_object(
        'last_manual_record_by', v_actor_id,
        'last_manual_record_at', v_now
      ),
      updated_at = v_now
    returning id into v_entity_id;
  end if;

  insert into public.leads (
    full_name,
    rut,
    phone,
    email,
    status,
    team_id,
    workflow_id,
    campaign_id,
    created_by,
    crm_entity_id,
    assignment_status,
    workflow_status,
    extra
  )
  values (
    v_full_name,
    v_rut,
    v_phone,
    v_email,
    'nuevo',
    v_effective_team_id,
    v_campaign.workflow_id,
    p_campaign_id,
    v_actor_id,
    v_entity_id,
    case when p_assigned_to is null then 'unassigned' else 'pending_assignment' end,
    'manual',
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'manual_supervisor_record',
      'fuera_de_base', true,
      'notes', v_notes,
      'created_by_role', v_role,
      'created_from', 'dashboard.leads.new'
    ))
  )
  returning id into v_lead_id;

  if v_entity_id is not null then
    update public.crm_entities
    set primary_lead_id = coalesce(primary_lead_id, v_lead_id)
    where id = v_entity_id;
  end if;

  insert into public.crm_audit_events (
    lead_id,
    crm_entity_id,
    actor_id,
    event_type,
    payload
  )
  values (
    v_lead_id,
    v_entity_id,
    v_actor_id,
    'lead.created_manual',
    jsonb_build_object(
      'source', 'dashboard.leads.new',
      'fuera_de_base', true,
      'team_id', v_effective_team_id,
      'campaign_id', p_campaign_id,
      'assigned_to', p_assigned_to,
      'notes', v_notes
    )
  );

  if p_assigned_to is not null then
    perform public.assign_lead(
      v_lead_id,
      p_assigned_to,
      'Asignación al crear registro manual',
      'dashboard.leads.new',
      false,
      null
    );
  end if;

  return jsonb_build_object(
    'lead_id', v_lead_id,
    'crm_entity_id', v_entity_id,
    'assigned_to', p_assigned_to,
    'team_id', v_effective_team_id,
    'campaign_id', p_campaign_id
  );
end;
$function$;

-- Lo que usa la pantalla: la envoltura con guardia de empresa más los datos
-- que Atlas 1 pedía. Todo en una transacción: o entra completo o no entra.
create or replace function public.ingresar_lead_fuera_de_base(
  p_campaign_id uuid,
  p_full_name text,
  p_rut text,
  p_phone text default null,
  p_phone_alt text default null,
  p_email text default null,
  p_team_id uuid default null,
  p_assigned_to uuid default null,
  p_notes text default null,
  p_detalle jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_result jsonb;
  v_lead public.leads%rowtype;
  v_detalle jsonb;
  v_alt_digits text := public.agent_dial_digits(nullif(btrim(coalesce(p_phone_alt, '')), ''));
begin
  if p_campaign_id is null then
    raise exception 'Elige la campaña a la que entra el registro.';
  end if;
  if nullif(btrim(coalesce(p_rut, '')), '') is null then
    raise exception 'Indica el RUT del registro.';
  end if;
  if nullif(btrim(coalesce(p_phone_alt, '')), '') is not null and v_alt_digits is null then
    raise exception 'El teléfono adicional no es un número chileno válido.';
  end if;

  v_result := public.create_manual_lead_record(
    p_full_name, p_rut, p_phone, p_email, p_team_id, p_campaign_id, p_assigned_to, p_notes
  );
  select * into v_lead from public.leads where id = (v_result ->> 'lead_id')::uuid;

  -- Solo claves conocidas y con texto: el formulario no escribe lo que quiera en extra.
  select coalesce(jsonb_object_agg(item.key, btrim(item.value #>> '{}')), '{}'::jsonb)
  into v_detalle
  from jsonb_each(coalesce(p_detalle, '{}'::jsonb)) item
  where item.key in ('nombre_contacto', 'comuna', 'region', 'producto')
    and jsonb_typeof(item.value) = 'string'
    and btrim(item.value #>> '{}') <> '';

  -- Un registro que ya estaba en la base conserva lo que trajo la carga.
  if not coalesce((v_result ->> 'duplicate')::boolean, false) and v_detalle <> '{}'::jsonb then
    update public.leads
    set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('ingreso_manual', v_detalle)
    where id = v_lead.id;
  end if;

  if v_alt_digits is not null
     and public.agent_dial_digits(v_lead.phone) is distinct from v_alt_digits
     and not exists (
       select 1 from public.lead_contacts contact
       where contact.lead_id = v_lead.id
         and contact.contact_type = 'phone'
         and contact.is_valid is distinct from false
         and public.agent_dial_digits(contact.value) = v_alt_digits
     ) then
    perform public.add_lead_phone(v_lead.id, p_phone_alt, 'Teléfono adicional');
  end if;

  return v_result;
end;
$$;

revoke all on function public.ingresar_lead_fuera_de_base(uuid, text, text, text, text, text, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.ingresar_lead_fuera_de_base(uuid, text, text, text, text, text, uuid, uuid, text, jsonb) to authenticated;
