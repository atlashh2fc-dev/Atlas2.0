-- El botón «Aceptar la propuesta» abre un correo nuevo: no trae In-Reply-To.
-- Si además sale de otra dirección que la que recibió la propuesta (la copia
-- oculta, un colega del cliente, otro buzón), la respuesta quedaba sin ficha
-- y sin dueño. El asunto sí la identifica: es «Acepto la propuesta — » o
-- «Re: » más el asunto exacto de la cotización. Se liga por ahí, después del
-- In-Reply-To y antes de la dirección.

create or replace function public.ligar_respuesta_a_registro(p_email uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_email public.inbound_emails%rowtype;
  v_org uuid;
  v_campanas uuid[];
  v_ref text;
  v_asunto text;
  v_cotizacion public.equifax_cotizaciones%rowtype;
  v_lead public.leads%rowtype;
  v_lead_id uuid;
  v_dueno uuid;
  v_motivo text;
begin
  select * into v_email from public.inbound_emails where id = p_email;
  if not found or v_email.lead_id is not null then
    return v_email.lead_id;
  end if;

  select mailbox.organization_id into v_org
    from public.inbound_mailboxes mailbox
    join public.organizations organizacion on organizacion.id = mailbox.organization_id
   where mailbox.id = v_email.mailbox_id
     and mailbox.campaign_id is null
     and organizacion.edicion = 'center';
  if v_org is null then return null; end if;

  select nullif(array_agg(campaign_id), '{}') into v_campanas from public.buzon_campanas where mailbox_id = v_email.mailbox_id;

  v_ref := nullif(lower(btrim(coalesce(v_email.in_reply_to, ''), '<> ')), '');
  if v_ref is not null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
       and lower(btrim(coalesce(cotizacion.proveedor_id, ''), '<> ')) = v_ref
     limit 1;
    if v_cotizacion.id is not null then
      v_lead_id := v_cotizacion.lead_id;
    else
      select correo.lead_id into v_lead_id from public.correos_de_registro correo
       where correo.organization_id = v_org
         and lower(btrim(coalesce(correo.message_id, ''), '<> ')) = v_ref
       limit 1;
    end if;
  end if;

  if v_lead_id is null then
    v_asunto := nullif(btrim(regexp_replace(coalesce(v_email.subject, ''),
      '^\s*((re|rv|fw|fwd|aw)\s*:\s*|acepto la propuesta\s*[—–-]\s*)+', '', 'i')), '');
    if v_asunto is not null then
      select * into v_cotizacion from public.equifax_cotizaciones cotizacion
       where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
         and cotizacion.asunto = v_asunto
         and cotizacion.created_at >= now() - interval '180 days'
         and (v_campanas is null or cotizacion.campaign_id = any (v_campanas))
       order by cotizacion.created_at desc
       limit 1;
      v_lead_id := v_cotizacion.lead_id;
    end if;
  end if;

  if v_lead_id is null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
       and lower(btrim(cotizacion.destinatario)) = v_email.from_address
       and cotizacion.created_at >= now() - interval '180 days'
       and (v_campanas is null or cotizacion.campaign_id = any (v_campanas))
     order by cotizacion.created_at desc
     limit 1;
    v_lead_id := v_cotizacion.lead_id;
  end if;

  if v_lead_id is null then
    select lead.id into v_lead_id from public.leads lead
     where lead.organization_id = v_org
       and lower(btrim(coalesce(lead.email, ''))) = v_email.from_address
       and (v_campanas is null or lead.campaign_id = any (v_campanas))
     order by lead.updated_at desc
     limit 1;
  end if;

  if v_lead_id is null then return null; end if;
  select * into v_lead from public.leads where id = v_lead_id;

  if v_cotizacion.id is null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.lead_id = v_lead_id and cotizacion.canal = 'correo'
     order by cotizacion.created_at desc
     limit 1;
  end if;

  if v_lead.next_action_at is not null and v_lead.callback_mode = 'personal' then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = coalesce(v_lead.managed_by, v_lead.assigned_to) and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'agenda'; end if;
  end if;
  if v_dueno is null and v_cotizacion.id is not null then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = v_cotizacion.agent_id and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'cotizacion'; end if;
  end if;
  if v_dueno is null and v_lead.assigned_to is not null then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = v_lead.assigned_to and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'propietario'; end if;
  end if;

  update public.inbound_emails
     set lead_id = v_lead_id,
         organization_id = v_org,
         cotizacion_id = v_cotizacion.id,
         assigned_to = v_dueno,
         asignacion = v_motivo,
         asignado_at = case when v_dueno is not null then now() end,
         updated_at = now()
   where id = p_email;

  if v_cotizacion.id is not null then
    update public.equifax_cotizaciones
       set respondida_at = coalesce(respondida_at, v_email.received_at)
     where id = v_cotizacion.id;
  end if;

  return v_lead_id;
end;
$function$;

revoke all on function public.ligar_respuesta_a_registro(uuid) from public, anon, authenticated;
grant execute on function public.ligar_respuesta_a_registro(uuid) to service_role;

-- Las respuestas que ya llegaron y quedaron sueltas se vuelven a intentar.
select public.ligar_respuesta_a_registro(email.id)
  from public.inbound_emails email
 where email.lead_id is null
   and email.received_at >= now() - interval '30 days';
