-- Una llamada manual no puede ser solo un log técnico: debe nacer como una
-- gestión tipificable, con campaña, responsable y trazabilidad. Esta RPC es
-- el único camino para que un agente cree esa gestión por sí mismo.
--
-- `before_dial` se permite únicamente en campañas configuradas en modo
-- manual. Así el teclado del CTI no compite con la Queue de una campaña
-- automática. `after_call` regulariza una llamada manual ya realizada cuando
-- el agente quedó en wrap-up; no origina ninguna llamada desde el CRM.
create or replace function public.begin_agent_manual_call_management(
  p_campaign_id uuid,
  p_phone text,
  p_full_name text default null,
  p_entry_mode text default 'before_dial'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor public.profiles%rowtype;
  v_campaign public.campaigns%rowtype;
  v_dial_mode text;
  v_session_status text;
  v_phone_digits text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_phone text;
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_lead public.leads%rowtype;
  v_lead_id uuid;
  v_call_id uuid;
  v_created boolean := false;
  v_reused boolean := false;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  if p_entry_mode not in ('before_dial', 'after_call') then
    raise exception 'Modo de registro manual inválido.';
  end if;

  select *
  into v_actor
  from public.profiles
  where id = v_actor_id
    and role = 'agente'
    and active
  for update;

  if not found then
    raise exception 'Solo un ejecutivo activo puede registrar una llamada manual.';
  end if;

  if v_actor.team_id is null then
    raise exception 'Tu usuario no tiene equipo asignado. Pide a un supervisor que lo configure antes de llamar.';
  end if;

  if p_entry_mode = 'before_dial'
    and v_actor.intercall_break_until is not null
    and v_actor.intercall_break_until > v_now then
    raise exception 'La interrupción legal sigue en curso. Espera antes de realizar otra llamada.';
  end if;

  if v_phone_digits is null or v_phone_digits !~ '^569[0-9]{8}$' then
    raise exception 'Ingresa un móvil chileno válido.';
  end if;
  v_phone := '+' || v_phone_digits;

  select c.*
  into v_campaign
  from public.campaigns c
  where c.id = p_campaign_id
    and c.is_active
    and exists (
      select 1
      from public.dialer_campaign_configs dc
      where dc.campaign_id = c.id
        and dc.is_active
    )
  for update of c;

  if not found then
    raise exception 'La campaña no está activa o no tiene discado operativo configurado.';
  end if;

  select dc.dial_mode
  into v_dial_mode
  from public.dialer_campaign_configs dc
  where dc.campaign_id = p_campaign_id
    and dc.is_active;

  if not exists (
    select 1
    from public.campaign_agents ca
    where ca.campaign_id = p_campaign_id
      and ca.profile_id = v_actor_id
  ) then
    raise exception 'No perteneces a la campaña seleccionada.';
  end if;

  if p_entry_mode = 'before_dial' and v_dial_mode <> 'manual' then
    raise exception 'Esta campaña es automática. Para marcar desde el CTI, configura la campaña en modo Manual.';
  end if;

  if p_entry_mode = 'after_call' and v_dial_mode <> 'manual' then
    select das.status
    into v_session_status
    from public.dialer_agent_sessions das
    where das.profile_id = v_actor_id
      and das.campaign_id = p_campaign_id
    for update;

    if v_session_status is distinct from 'wrap_up' then
      raise exception 'Solo puedes regularizar una llamada manual cuando esta campaña está en cierre.';
    end if;
  end if;

  -- Serializa por número para no crear dos gestiones manuales si el usuario
  -- hace doble clic o abre dos pestañas, incluso si son campañas distintas.
  perform pg_advisory_xact_lock(hashtextextended(v_phone_digits, 0));

  if exists (
    select 1
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.ended_at is null
      and c.started_at >= v_now - interval '4 hours'
      and public.normalize_lead_contact('phone', l.phone) = v_phone_digits
  ) or exists (
    select 1
    from public.dial_attempts da
    where da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      and regexp_replace(coalesce(da.phone, ''), '[^0-9]', '', 'g') = v_phone_digits
  ) then
    raise exception 'Este número ya tiene una llamada en curso.';
  end if;

  -- Nunca permitir dos gestiones abiertas del mismo ejecutivo. Es una
  -- invariante de capacidad y evita que una nueva llamada esconda una
  -- tipificación pendiente.
  select c.id
  into v_call_id
  from public.calls c
  where c.agent_id = v_actor_id
    and c.ended_at is null
    and c.started_at >= v_now - interval '4 hours'
  order by c.started_at desc
  limit 1
  for update;

  if v_call_id is not null then
    raise exception 'Tienes una gestión pendiente de tipificación. Ciérrala antes de registrar otra llamada manual.';
  end if;

  select l.*
  into v_lead
  from public.leads l
  left join public.lead_contacts lc
    on lc.lead_id = l.id
   and lc.contact_type = 'phone'
   and lc.normalized_value = v_phone_digits
  where l.campaign_id = p_campaign_id
    and (
      public.normalize_lead_contact('phone', l.phone) = v_phone_digits
      or lc.id is not null
    )
  order by
    case when l.assigned_to = v_actor_id or l.managed_by = v_actor_id then 0 else 1 end,
    l.updated_at desc
  limit 1
  for update of l;

  if found then
    if (v_lead.assigned_to is not null and v_lead.assigned_to is distinct from v_actor_id)
      or (v_lead.managed_by is not null and v_lead.managed_by is distinct from v_actor_id) then
      raise exception 'Este contacto ya está asignado a otro ejecutivo de la campaña.';
    end if;

    v_lead_id := v_lead.id;
    v_reused := true;

    if v_lead.assigned_to is null then
      update public.lead_assignments
      set
        is_active = false,
        ends_at = v_now,
        updated_at = v_now
      where lead_id = v_lead_id
        and is_active;

      insert into public.lead_assignments (
        lead_id, assigned_to, assigned_by, team_id, campaign_id,
        reason, source, is_active, starts_at
      )
      values (
        v_lead_id, v_actor_id, v_actor_id, v_actor.team_id, p_campaign_id,
        'Asignación al registrar llamada manual', 'cti.manual_call', true, v_now
      );

      update public.leads
      set
        assigned_to = v_actor_id,
        team_id = v_actor.team_id,
        assignment_status = 'assigned',
        updated_at = v_now
      where id = v_lead_id;
    end if;
  else
    insert into public.leads (
      full_name, phone, status, assigned_to, team_id, workflow_id,
      campaign_id, created_by, assignment_status, workflow_status, extra
    )
    values (
      coalesce(v_full_name, 'Contacto sin identificar'), v_phone, 'nuevo',
      v_actor_id, v_actor.team_id, v_campaign.workflow_id, p_campaign_id,
      v_actor_id, 'assigned', 'manual',
      jsonb_build_object(
        'source', 'cti_manual',
        'created_from', 'cti.manual_call',
        'entry_mode', p_entry_mode,
        'captured_at', v_now
      )
    )
    returning id into v_lead_id;

    insert into public.lead_assignments (
      lead_id, assigned_to, assigned_by, team_id, campaign_id,
      reason, source, is_active, starts_at
    )
    values (
      v_lead_id, v_actor_id, v_actor_id, v_actor.team_id, p_campaign_id,
      'Asignación al registrar llamada manual', 'cti.manual_call', true, v_now
    );

    v_created := true;
  end if;

  insert into public.lead_contacts (
    lead_id, contact_type, value, normalized_value, is_primary,
    source, created_by, metadata
  )
  values (
    v_lead_id, 'phone', v_phone, v_phone_digits, true,
    'cti.manual_call', v_actor_id,
    jsonb_build_object('captured_at', v_now, 'entry_mode', p_entry_mode)
  )
  on conflict (lead_id, contact_type, normalized_value) do nothing;

  insert into public.calls (lead_id, agent_id)
  values (v_lead_id, v_actor_id)
  returning id into v_call_id;

  insert into public.call_events (
    call_id, lead_id, agent_id, event_type, payload
  )
  values (
    v_call_id, v_lead_id, v_actor_id, 'cti.manual_call_started',
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'phone', v_phone,
      'source', 'cti_manual',
      'entry_mode', p_entry_mode,
      'lead_created', v_created,
      'lead_reused', v_reused
    )
  );

  insert into public.sensitive_access_log (
    actor_id, action, target_profile_id, metadata
  )
  values (
    v_actor_id, 'cti.manual_call', null,
    jsonb_build_object(
      'phone', v_phone,
      'lead_id', v_lead_id,
      'call_id', v_call_id,
      'campaign_id', p_campaign_id,
      'entry_mode', p_entry_mode
    )
  );

  insert into public.crm_audit_events (
    lead_id, crm_entity_id, actor_id, event_type, payload
  )
  select
    l.id, l.crm_entity_id, v_actor_id, 'lead.manual_call_registered',
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'call_id', v_call_id,
      'phone', v_phone,
      'entry_mode', p_entry_mode,
      'lead_created', v_created,
      'lead_reused', v_reused
    )
  from public.leads l
  where l.id = v_lead_id;

  return jsonb_build_object(
    'lead_id', v_lead_id,
    'call_id', v_call_id,
    'campaign_id', p_campaign_id,
    'lead_created', v_created,
    'lead_reused', v_reused
  );
end;
$function$;

revoke all on function public.begin_agent_manual_call_management(uuid, text, text, text)
  from public, anon;
grant execute on function public.begin_agent_manual_call_management(uuid, text, text, text)
  to authenticated;
