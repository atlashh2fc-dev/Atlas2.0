-- Conversaciones de clínica.
--
-- Las conversaciones de WhatsApp nacieron para el call center: cada una
-- exigía un registro y una campaña. Una clínica no tiene campañas ni cola de
-- ejecutivos: conversa con tutores y pacientes que ya tienen ficha. Esta
-- migración abre el modelo a la ficha (`company_id`) sin tocar lo que el call
-- center ya usa, le pone empresa propia a cada conversación para que el
-- aislamiento no dependa del registro, y agrega la entrada y la apertura
-- de conversaciones de clínica.

alter table public.whatsapp_conversations
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists company_id uuid references public.sales_companies(id) on delete set null;

update public.whatsapp_conversations conversation
   set organization_id = coalesce(public.org_of_lead(conversation.lead_id), public.org_of_campaign(conversation.campaign_id))
 where conversation.organization_id is null;

alter table public.whatsapp_conversations alter column lead_id drop not null;
alter table public.whatsapp_conversations alter column campaign_id drop not null;
alter table public.whatsapp_conversations drop constraint if exists whatsapp_conversations_registro_o_ficha;
alter table public.whatsapp_conversations add constraint whatsapp_conversations_registro_o_ficha
  check ((lead_id is not null and campaign_id is not null) or company_id is not null);

create index if not exists whatsapp_conversations_org_activity_idx on public.whatsapp_conversations (organization_id, status, last_message_at desc);
create index if not exists whatsapp_conversations_company_idx on public.whatsapp_conversations (company_id) where company_id is not null;

create or replace function public.org_of_whatsapp_conversation(p_conversation_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(conversation.organization_id, public.org_of_lead(conversation.lead_id), public.org_of_campaign(conversation.campaign_id))
  from public.whatsapp_conversations conversation where conversation.id = p_conversation_id;
$$;

-- Una conversación de ficha la ven y la atienden administración y supervisión
-- de su empresa; las de campaña siguen con su regla de siempre.
create or replace function public.puede_atender_conversacion_de_clinica(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select p_company_id is not null
     and ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
          or public.is_platform_owner());
$$;

revoke all on function public.puede_atender_conversacion_de_clinica(uuid) from public, anon;
grant execute on function public.puede_atender_conversacion_de_clinica(uuid) to authenticated, service_role;

drop policy if exists whatsapp_conversations_organization_isolation on public.whatsapp_conversations;
create policy whatsapp_conversations_organization_isolation on public.whatsapp_conversations
  as restrictive for all to authenticated
  using (coalesce(organization_id, public.org_of_lead(lead_id)) = any (public.current_org_ids()))
  with check (coalesce(organization_id, public.org_of_lead(lead_id)) = any (public.current_org_ids()));

drop policy if exists whatsapp_conversations_select on public.whatsapp_conversations;
create policy whatsapp_conversations_select on public.whatsapp_conversations
  for select to authenticated
  using (public.puede_atender_conversacion_de_clinica(company_id)
         or (campaign_id is not null and public.can_access_whatsapp_campaign(campaign_id, assigned_to)));

drop policy if exists whatsapp_messages_select on public.whatsapp_messages;
create policy whatsapp_messages_select on public.whatsapp_messages
  for select to authenticated
  using (exists (
    select 1 from public.whatsapp_conversations conversation
     where conversation.id = whatsapp_messages.conversation_id
       and (public.puede_atender_conversacion_de_clinica(conversation.company_id)
            or (conversation.campaign_id is not null and public.can_access_whatsapp_campaign(conversation.campaign_id, conversation.assigned_to)))
  ));

drop policy if exists whatsapp_messages_workspace_content on public.whatsapp_messages;
create policy whatsapp_messages_workspace_content on public.whatsapp_messages
  for select to authenticated
  using (
    (select public.is_platform_owner())
    or exists (
      select 1 from public.whatsapp_conversations conversation
       where conversation.id = whatsapp_messages.conversation_id
         and (
           public.puede_atender_conversacion_de_clinica(conversation.company_id)
           or ((select public.current_role_name()) = any (array['agente'::public.app_role, 'supervisor'::public.app_role])
               and ((select public.current_role_name()) = 'supervisor'::public.app_role or conversation.assigned_to = (select auth.uid())))
         )
    )
  );

-- ---------------------------------------------------------------------------
-- Abrir (o encontrar) la conversación de una ficha en el canal de su empresa.
-- La usa el despacho antes de mandar un recordatorio, para que el mensaje
-- quede en el hilo desde el primer día.
-- ---------------------------------------------------------------------------
create or replace function public.abrir_conversacion_de_clinica(p_channel_id uuid, p_cuenta uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta public.sales_companies%rowtype;
  v_wa_id text;
  v_id uuid;
begin
  select * into v_cuenta from public.sales_companies where id = p_cuenta;
  if not found then
    raise exception 'No encontramos esa ficha' using errcode = 'P0002';
  end if;
  v_wa_id := regexp_replace(coalesce(v_cuenta.phone, ''), '\D', '', 'g');
  if v_wa_id = '' then
    raise exception 'La ficha no tiene celular' using errcode = '22023';
  end if;
  if length(v_wa_id) = 9 and left(v_wa_id, 1) = '9' then v_wa_id := '56' || v_wa_id; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_channel_id::text || ':' || v_wa_id, 0));
  select id into v_id from public.whatsapp_conversations where channel_id = p_channel_id and contact_wa_id = v_wa_id;
  if v_id is not null then
    update public.whatsapp_conversations set company_id = coalesce(company_id, p_cuenta), organization_id = coalesce(organization_id, v_cuenta.organization_id) where id = v_id;
    return v_id;
  end if;

  insert into public.whatsapp_conversations (channel_id, organization_id, company_id, contact_wa_id, contact_phone, contact_name, status, ai_state, last_message_at, unread_count)
  values (p_channel_id, v_cuenta.organization_id, p_cuenta, v_wa_id, '+' || v_wa_id, v_cuenta.name, 'open', 'handoff', now(), 0)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.abrir_conversacion_de_clinica(uuid, uuid) from public, anon, authenticated;
grant execute on function public.abrir_conversacion_de_clinica(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Un mensaje de WhatsApp de una clínica, entrante o saliente. Busca la ficha
-- por el celular; si nadie tiene ese número, nace una ficha nueva con lo que
-- WhatsApp dice de la persona. Una respuesta cierra el círculo de los
-- recordatorios que la motivaron: quedan como "respondió".
-- ---------------------------------------------------------------------------
create or replace function public.ingest_whatsapp_mensaje_de_clinica(
  p_channel_id uuid,
  p_organization_id uuid,
  p_provider_message_id text,
  p_direction text,
  p_contact_wa_id text,
  p_contact_phone text,
  p_contact_name text,
  p_message_type text,
  p_text_body text,
  p_provider_timestamp timestamptz,
  p_sender_wa_id text default null,
  p_context_provider_message_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_cuenta uuid;
  v_message_id uuid;
  v_digitos text := regexp_replace(coalesce(p_contact_phone, ''), '\D', '', 'g');
  v_cola text;
  v_creada boolean := false;
begin
  if p_direction not in ('inbound', 'outbound') then
    raise exception 'invalid_whatsapp_direction';
  end if;
  if btrim(coalesce(p_contact_wa_id, '')) = '' or v_digitos = '' then
    raise exception 'invalid_whatsapp_contact';
  end if;
  v_cola := right(v_digitos, 8);

  perform pg_advisory_xact_lock(hashtextextended(p_channel_id::text || ':' || p_contact_wa_id, 0));

  if p_provider_message_id is not null then
    select m.id, c.id into v_message_id, v_conversation.id
      from public.whatsapp_messages m join public.whatsapp_conversations c on c.id = m.conversation_id
     where m.provider_message_id = p_provider_message_id;
    if v_message_id is not null then
      return jsonb_build_object('duplicate', true, 'message_id', v_message_id, 'conversation_id', v_conversation.id);
    end if;
  end if;

  select * into v_conversation from public.whatsapp_conversations where channel_id = p_channel_id and contact_wa_id = p_contact_wa_id;

  if v_conversation.id is null then
    select cuenta.id into v_cuenta
      from public.sales_companies cuenta
     where cuenta.organization_id = p_organization_id
       and right(regexp_replace(coalesce(cuenta.phone, ''), '\D', '', 'g'), 8) = v_cola
     order by cuenta.updated_at desc
     limit 1;

    if v_cuenta is null then
      insert into public.sales_companies (organization_id, name, phone, source, metadata)
      values (p_organization_id, coalesce(nullif(btrim(p_contact_name), ''), 'WhatsApp ' || p_contact_phone), p_contact_phone, 'whatsapp',
              jsonb_build_object('origen', 'whatsapp', 'whatsapp_id', p_contact_wa_id))
      returning id into v_cuenta;
      v_creada := true;
    end if;

    insert into public.whatsapp_conversations (channel_id, organization_id, company_id, contact_wa_id, contact_phone, contact_name, status, ai_state,
                                               last_message_at, last_inbound_at, last_outbound_at, unread_count)
    values (p_channel_id, p_organization_id, v_cuenta, p_contact_wa_id, p_contact_phone, nullif(btrim(p_contact_name), ''), 'open', 'handoff',
            coalesce(p_provider_timestamp, now()),
            case when p_direction = 'inbound' then coalesce(p_provider_timestamp, now()) end,
            case when p_direction = 'outbound' then coalesce(p_provider_timestamp, now()) end,
            0)
    returning * into v_conversation;
  elsif v_conversation.company_id is null then
    -- Existía como conversación de campaña en la misma empresa: no se toca.
    null;
  end if;

  insert into public.whatsapp_messages (conversation_id, provider_message_id, direction, message_type, text_body, status, sender_wa_id,
                                        context_provider_message_id, provider_payload, provider_timestamp)
  values (v_conversation.id, p_provider_message_id, p_direction, coalesce(nullif(p_message_type, ''), 'unknown'), p_text_body,
          case when p_direction = 'inbound' then 'received' else 'sent' end, p_sender_wa_id, p_context_provider_message_id,
          coalesce(p_payload, '{}'::jsonb), p_provider_timestamp)
  on conflict (provider_message_id) where provider_message_id is not null do nothing
  returning id into v_message_id;

  if v_message_id is null and p_provider_message_id is not null then
    select id into v_message_id from public.whatsapp_messages where provider_message_id = p_provider_message_id;
  end if;

  update public.whatsapp_conversations
     set contact_name = coalesce(nullif(btrim(p_contact_name), ''), contact_name),
         status = case when p_direction = 'inbound' then 'open' else status end,
         last_message_at = greatest(last_message_at, coalesce(p_provider_timestamp, now())),
         last_inbound_at = case when p_direction = 'inbound' then greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), coalesce(p_provider_timestamp, now())) else last_inbound_at end,
         last_outbound_at = case when p_direction = 'outbound' then greatest(coalesce(last_outbound_at, '-infinity'::timestamptz), coalesce(p_provider_timestamp, now())) else last_outbound_at end,
         unread_count = case when p_direction = 'inbound' then unread_count + 1 else unread_count end,
         updated_at = now()
   where id = v_conversation.id;

  if p_direction = 'inbound' and v_conversation.company_id is not null then
    update public.mensajes_salientes
       set estado = 'respondido', updated_at = now()
     where cuenta_id = v_conversation.company_id
       and estado in ('enviado', 'entregado', 'leido')
       and coalesce(enviado_at, created_at) >= now() - interval '7 days';
  end if;

  return jsonb_build_object('duplicate', false, 'message_id', v_message_id, 'conversation_id', v_conversation.id,
                            'company_id', v_conversation.company_id, 'ficha_creada', v_creada);
end;
$$;

revoke all on function public.ingest_whatsapp_mensaje_de_clinica(uuid, uuid, text, text, text, text, text, text, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_mensaje_de_clinica(uuid, uuid, text, text, text, text, text, text, text, timestamptz, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Demostración: algunas respuestas de tutores y pacientes, para que la
-- bandeja de la clínica cuente la historia completa.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org record;
  v_canal uuid;
  v_mensaje record;
  v_respuestas text[] := array['Sí, confirmo. ¡Gracias!', 'Hola, ¿puedo cambiar la hora para más tarde?', 'Perfecto, ahí estaremos', 'Gracias por avisar, agendo la próxima semana', '¿Tienen hora el sábado?', 'Sí, vamos mañana'];
  v_n integer := 0;
begin
  for v_org in select o.id, o.slug from public.organizations o where o.slug in ('demo-vet', 'demo-dental') loop
    select id into v_canal from public.whatsapp_channels where organization_id = v_org.id order by created_at limit 1;
    if v_canal is null then continue; end if;
    if exists (select 1 from public.whatsapp_conversations where organization_id = v_org.id and company_id is not null) then continue; end if;
    for v_mensaje in
      select m.id, m.cuenta_id, m.destinatario, m.nombre_destinatario, m.cuerpo, m.enviado_at
        from public.mensajes_salientes m
       where m.organization_id = v_org.id and m.estado in ('entregado', 'enviado') and m.cuenta_id is not null
       order by random() limit 6
    loop
      perform public.ingest_whatsapp_mensaje_de_clinica(
        v_canal, v_org.id, 'demo-out-' || v_mensaje.id, 'outbound',
        regexp_replace(v_mensaje.destinatario, '\D', '', 'g'), v_mensaje.destinatario, v_mensaje.nombre_destinatario,
        'text', v_mensaje.cuerpo, coalesce(v_mensaje.enviado_at, now()) - interval '2 hours');
      perform public.ingest_whatsapp_mensaje_de_clinica(
        v_canal, v_org.id, 'demo-in-' || v_mensaje.id, 'inbound',
        regexp_replace(v_mensaje.destinatario, '\D', '', 'g'), v_mensaje.destinatario, v_mensaje.nombre_destinatario,
        'text', v_respuestas[1 + (v_n % array_length(v_respuestas, 1))], coalesce(v_mensaje.enviado_at, now()) - interval '1 hour');
      v_n := v_n + 1;
    end loop;
  end loop;
end;
$$;
