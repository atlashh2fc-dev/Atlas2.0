-- Supervisión libera un teléfono de la lista de no llamar desde la ficha.
--
-- La lista se cargó desde el historial (Atlas 1, tipificaciones y fichas):
-- CLIENTE MOLESTO, NÚMERO ERRÓNEO, etc. Operación pidió (24-09-2026) que el
-- supervisor, igual que agrega números, pueda devolver a la cola uno de esos
-- números cuando corresponde. Solo admin y supervisor de su equipo; el
-- ejecutivo no. No se borra: queda levantada con quién, cuándo y por qué, y el
-- disparador de dialer_phone_suppressions recalcula los leads de ese número.

create or replace function public.lift_lead_phone_suppression(p_lead_id uuid, p_phone text, p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_lead public.leads%rowtype;
  v_phone text := public.canonical_chile_phone(p_phone);
  v_client_key text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_lifted integer;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform private.assert_can_manage_lead_phones(v_lead);

  if v_phone is null then
    raise exception 'El teléfono no es válido.';
  end if;
  if v_reason is null then
    raise exception 'Indica por qué se libera el número.';
  end if;

  select campaign.dialer_client_key into v_client_key
  from public.campaigns campaign
  where campaign.id = v_lead.campaign_id;

  -- Las mismas filas que bloquean este número para la campaña del lead.
  update public.dialer_phone_suppressions suppression
  set lifted_at = now(),
      lifted_by = (select auth.uid()),
      lifted_reason = v_reason
  where suppression.organization_id = v_lead.organization_id
    and suppression.phone = v_phone
    and suppression.lifted_at is null
    and (
      (suppression.campaign_id is null and suppression.client_key is null)
      or suppression.campaign_id = v_lead.campaign_id
      or suppression.client_key = v_client_key
    );
  get diagnostics v_lifted = row_count;

  if v_lifted = 0 then
    raise exception 'Ese número no está en la lista de no llamar.';
  end if;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, (select auth.uid()), 'lead.phone_suppression_lifted',
    jsonb_build_object('phone', v_phone, 'reason', v_reason, 'rows', v_lifted)
  );

  return v_lifted;
end;
$$;

revoke all on function public.lift_lead_phone_suppression(uuid, text, text) from public, anon;
grant execute on function public.lift_lead_phone_suppression(uuid, text, text) to authenticated;
