-- El cotizador Equifax también está en la ficha sin gestión abierta: el
-- ejecutivo cotiza un registro que tiene a su nombre (lo asignado o lo que
-- gestionó) aunque no esté hablando con el cliente. Con gestión, esa gestión
-- tiene que ser suya y seguir abierta, como antes.

create or replace function public.registrar_cotizacion_equifax(
  p_lead_id uuid,
  p_call_id uuid,
  p_canal text,
  p_destinatario text,
  p_asunto text,
  p_lineas jsonb,
  p_productos text[],
  p_uf_mensual numeric,
  p_uf_unico numeric,
  p_uf_anual numeric,
  p_clp_total numeric,
  p_valor_uf numeric
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'No autenticado.';
  end if;
  select role into v_role from public.profiles where id = v_actor and active;
  if v_role is null then
    raise exception 'Tu usuario no está activo.';
  end if;
  if p_canal not in ('correo', 'whatsapp') then
    raise exception 'La propuesta sale por correo o por WhatsApp.';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform public.assert_org_access(v_lead.organization_id);

  if not public.management_requires_equifax_data(
    coalesce(v_lead.workflow_id, (select workflow_id from public.campaigns where id = v_lead.campaign_id)),
    v_lead.campaign_id
  ) then
    raise exception 'La campaña de este registro no es de Equifax.';
  end if;

  if p_call_id is not null then
    select * into v_call from public.calls where id = p_call_id and lead_id = p_lead_id;
    if not found then
      raise exception 'La gestión no corresponde a este registro.';
    end if;
  end if;

  if v_role = 'agente' then
    if v_call.id is not null then
      if v_call.agent_id is distinct from v_actor or v_call.ended_at is not null then
        raise exception 'Esa gestión ya no está abierta a tu nombre.';
      end if;
    elsif v_actor is distinct from v_lead.assigned_to and v_actor is distinct from v_lead.managed_by then
      raise exception 'Este registro no está a tu nombre. Pide a tu supervisor que te lo asigne.';
    end if;
  end if;

  insert into public.equifax_cotizaciones (
    organization_id, lead_id, campaign_id, call_id, agent_id, canal, destinatario, asunto,
    lineas, productos, uf_mensual, uf_unico, uf_anual, clp_total, valor_uf, estado, enviada_at
  )
  values (
    v_lead.organization_id, p_lead_id, v_lead.campaign_id, p_call_id, v_actor, p_canal,
    left(btrim(p_destinatario), 320), left(p_asunto, 500),
    p_lineas, coalesce(p_productos, '{}'),
    coalesce(p_uf_mensual, 0), coalesce(p_uf_unico, 0), coalesce(p_uf_anual, 0), coalesce(p_clp_total, 0),
    p_valor_uf,
    case when p_canal = 'whatsapp' then 'whatsapp_abierto' else 'enviando' end,
    case when p_canal = 'whatsapp' then v_now end
  )
  returning id into v_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor, 'lead.equifax_quote_sent',
    jsonb_build_object(
      'cotizacion_id', v_id,
      'call_id', p_call_id,
      'canal', p_canal,
      'productos', to_jsonb(coalesce(p_productos, '{}')),
      'uf_mensual', p_uf_mensual
    )
  );

  return v_id;
end;
$$;

revoke all on function public.registrar_cotizacion_equifax(uuid, uuid, text, text, text, jsonb, text[], numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.registrar_cotizacion_equifax(uuid, uuid, text, text, text, jsonb, text[], numeric, numeric, numeric, numeric, numeric) to authenticated;
