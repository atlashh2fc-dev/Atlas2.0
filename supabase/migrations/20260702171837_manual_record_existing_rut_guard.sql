create or replace function public.create_manual_lead_record(
  p_full_name text,
  p_rut text default null,
  p_phone text default null,
  p_email text default null,
  p_team_id uuid default null,
  p_campaign_id uuid default null,
  p_assigned_to uuid default null,
  p_notes text default null
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

  if v_role = 'supervisor' then
    if v_actor_team_id is null then
      raise exception 'Tu supervisor no tiene equipo asignado.';
    end if;
    v_effective_team_id := v_actor_team_id;
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

    if v_role = 'supervisor' and v_agent.team_id is distinct from v_actor_team_id then
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
    select e.id, l.id, l.team_id
    into v_entity_id, v_existing_lead_id, v_existing_team_id
    from public.crm_entities e
    join public.leads l on l.crm_entity_id = e.id
    where e.normalized_rut = v_normalized_rut
    order by
      (l.team_id = v_effective_team_id) desc,
      l.updated_at desc nulls last,
      l.created_at desc
    limit 1;

    if v_existing_lead_id is null then
      select l.crm_entity_id, l.id, l.team_id
      into v_entity_id, v_existing_lead_id, v_existing_team_id
      from public.leads l
      where public.normalize_lead_rut(l.rut) = v_normalized_rut
      order by
        (l.team_id = v_effective_team_id) desc,
        l.updated_at desc nulls last,
        l.created_at desc
      limit 1;
    end if;

    if v_existing_lead_id is not null then
      if v_role = 'supervisor' and v_existing_team_id is distinct from v_actor_team_id then
        raise exception 'Este RUT ya existe en otro equipo. Solicita revisión a un administrador antes de gestionarlo.';
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
          display_name = coalesce(nullif(excluded.display_name, ''), public.crm_entities.display_name),
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
        display_name = coalesce(nullif(v_full_name, ''), display_name),
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
      display_name = coalesce(nullif(excluded.display_name, ''), public.crm_entities.display_name),
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
    jsonb_build_object(
      'source', 'manual_supervisor_record',
      'notes', v_notes,
      'created_by_role', v_role,
      'created_from', 'dashboard.leads.new'
    )
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

revoke all on function public.create_manual_lead_record(text, text, text, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.create_manual_lead_record(text, text, text, text, uuid, uuid, uuid, text) to authenticated;
