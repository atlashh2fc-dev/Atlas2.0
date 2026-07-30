-- `assign_lead` exige un usuario autenticado (es la acción del supervisor desde
-- la interfaz), así que el motor no puede reutilizarla: la primera versión de
-- esta función habría fallado en producción con "No autenticado".
--
-- Se replica acá lo que importa —histórico de asignación, actualización del
-- registro y evento de auditoría— dejando constancia de que el cambio lo hizo
-- el discador y no una persona.
--
-- Con esto, el ejecutivo que atiende la llamada queda como responsable del
-- registro en la misma operación en que toma el intento: no existe un instante
-- en que esté hablando con un cliente cuya ficha no puede abrir.
create or replace function public.claim_dial_attempt_for_agent(
  p_dial_attempt_id uuid,
  p_agent_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_lead public.leads%rowtype;
  v_agent public.profiles%rowtype;
  v_lead_id uuid;
  v_team_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is not null then
    raise exception 'claim_dial_attempt_for_agent solo puede ser llamada por el motor de discado.';
  end if;

  select * into v_agent
  from public.profiles
  where id = p_agent_id and role = 'agente' and active
  limit 1;
  if not found then
    raise exception 'El ejecutivo % no existe o no está activo.', p_agent_id;
  end if;

  -- Solo gana el primero: si otro ejecutivo ya tomó el intento, no se toca nada.
  update public.dial_attempts da
     set agent_id = p_agent_id,
         updated_at = v_now
   where da.id = p_dial_attempt_id
     and da.agent_id is null
  returning da.lead_id into v_lead_id;

  if v_lead_id is null then
    return false;
  end if;

  select * into v_lead from public.leads where id = v_lead_id for update;
  if not found then
    return false;
  end if;

  v_team_id := coalesce(v_lead.team_id, v_agent.team_id);

  update public.lead_assignments
     set is_active = false, ends_at = v_now, updated_at = v_now
   where lead_id = v_lead_id and is_active;

  insert into public.lead_assignments
    (lead_id, assigned_to, assigned_by, team_id, campaign_id, reason, source, is_active, starts_at)
  values
    (v_lead_id, p_agent_id, null, v_team_id, v_lead.campaign_id,
     'Atendió la llamada del discador', 'dialer.answer', true, v_now);

  update public.leads
     set assigned_to = p_agent_id,
         managed_by = p_agent_id,
         team_id = v_team_id,
         assignment_status = 'assigned',
         updated_at = v_now
   where id = v_lead_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    v_lead_id,
    v_lead.crm_entity_id,
    null,
    'lead.assigned',
    jsonb_build_object(
      'old_assigned_to', v_lead.assigned_to,
      'new_assigned_to', p_agent_id,
      'team_id', v_team_id,
      'campaign_id', v_lead.campaign_id,
      'source', 'dialer.answer',
      'dial_attempt_id', p_dial_attempt_id
    )
  );

  return true;
end;
$function$;

revoke execute on function public.claim_dial_attempt_for_agent(uuid, uuid) from public, anon, authenticated;

comment on function public.claim_dial_attempt_for_agent(uuid, uuid) is 'Entrega el intento y el registro al primer ejecutivo que lo toma. Devuelve false si otro llegó antes.';
