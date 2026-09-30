-- Instagram Direct y Messenger entran por la misma bandeja que WhatsApp.
--
-- Son canales de Meta con la misma forma (un hilo por contacto, texto e
-- imágenes, ventana de 24 h), así que se generalizan las tablas whatsapp_* en
-- vez de duplicar bandeja, colas, IA y permisos: cada canal y cada conversación
-- dicen su `canal`. Los nombres de tabla se quedan; lo que cambia es que ya no
-- todo contacto tiene teléfono: en Instagram y Messenger el contacto es un
-- identificador de Meta por página (IGSID / PSID), guardado en contact_wa_id.

-- 1. Canal ------------------------------------------------------------------
alter table public.whatsapp_channels
  add column if not exists canal text not null default 'whatsapp',
  add column if not exists page_id text,
  add column if not exists ig_user_id text,
  add column if not exists cuenta text;

alter table public.whatsapp_channels
  drop constraint if exists whatsapp_channels_canal_check,
  add constraint whatsapp_channels_canal_check check (canal in ('whatsapp', 'instagram', 'messenger'));

-- Lo propio de WhatsApp (WABA y número) solo se exige en WhatsApp. Los checks
-- de «no vacío» existentes siguen valiendo: con null no fallan.
alter table public.whatsapp_channels
  alter column waba_id drop not null,
  alter column phone_number_id drop not null,
  alter column display_phone_number drop not null;

alter table public.whatsapp_channels
  drop constraint if exists whatsapp_channels_datos_del_canal,
  add constraint whatsapp_channels_datos_del_canal check (
    case canal
      when 'whatsapp' then waba_id is not null and phone_number_id is not null and display_phone_number is not null
      when 'messenger' then btrim(coalesce(page_id, '')) <> ''
      when 'instagram' then btrim(coalesce(page_id, '')) <> '' and btrim(coalesce(ig_user_id, '')) <> ''
    end
  );

create unique index if not exists whatsapp_channels_messenger_page_uidx
  on public.whatsapp_channels (page_id) where canal = 'messenger';
create unique index if not exists whatsapp_channels_instagram_cuenta_uidx
  on public.whatsapp_channels (ig_user_id) where canal = 'instagram';

-- 2. Conversación -----------------------------------------------------------
alter table public.whatsapp_conversations
  add column if not exists canal text not null default 'whatsapp';

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_canal_check,
  add constraint whatsapp_conversations_canal_check check (canal in ('whatsapp', 'instagram', 'messenger'));

alter table public.whatsapp_conversations
  alter column contact_phone drop not null;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_telefono_en_whatsapp,
  add constraint whatsapp_conversations_telefono_en_whatsapp check (canal <> 'whatsapp' or contact_phone is not null);

-- 3. El registro recuerda al contacto por su identificador en cada red --------
alter table public.lead_contacts
  drop constraint if exists lead_contacts_contact_type_check,
  add constraint lead_contacts_contact_type_check check (contact_type in ('phone', 'email', 'instagram', 'messenger'));

alter table public.contact_center_queue_sources
  drop constraint if exists contact_center_queue_sources_channel_type_check,
  add constraint contact_center_queue_sources_channel_type_check
    check (channel_type in ('voice', 'whatsapp', 'email', 'chat', 'instagram', 'messenger'));

-- 4. Reparto: un registro nuevo de Instagram o Messenger va a la cola de
-- mensajería de su campaña, igual que uno de WhatsApp. -----------------------
create or replace function public.route_new_whatsapp_lead_to_queue()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_queue public.contact_center_queues%rowtype;
  v_agent_id uuid;
  v_team_id uuid;
begin
  if coalesce(new.external_last_source_code, '') not in ('meta_whatsapp', 'meta_instagram', 'meta_messenger')
     or new.campaign_id is null then
    return new;
  end if;

  select queue.* into v_queue
  from public.contact_center_queues queue
  join public.contact_center_queue_sources source on source.queue_id = queue.id
  where source.channel_type = 'whatsapp'
    and source.campaign_id = new.campaign_id
    and source.is_active
    and queue.is_active
  order by source.created_at
  limit 1;

  if v_queue.id is null then
    return new;
  end if;

  if v_queue.routing_mode = 'manual' then
    new.assigned_to := null;
    return new;
  end if;

  select member.profile_id, profile.team_id
  into v_agent_id, v_team_id
  from public.contact_center_queue_members member
  join public.profiles profile on profile.id = member.profile_id
  left join public.whatsapp_conversations active_conversation
    on active_conversation.queue_id = member.queue_id
   and active_conversation.assigned_to = member.profile_id
   and active_conversation.status in ('open', 'pending')
  where member.queue_id = v_queue.id
    and member.is_active
    and profile.active
    and profile.role = 'agente'::public.app_role
  group by member.profile_id, profile.team_id, member.joined_at,
    member.max_concurrent, v_queue.max_concurrent_per_agent
  having coalesce(member.max_concurrent, v_queue.max_concurrent_per_agent) is null
      or count(active_conversation.id) < coalesce(member.max_concurrent, v_queue.max_concurrent_per_agent)
  order by public.agente_disponible_para(member.profile_id, 'whatsapp') desc,
    count(active_conversation.id), member.joined_at, member.profile_id
  limit 1;

  new.assigned_to := v_agent_id;
  if v_team_id is not null then new.team_id := v_team_id; end if;
  return new;
end;
$function$;

-- 5. Ingesta ------------------------------------------------------------------
-- Gemela de ingest_whatsapp_message sin teléfono: el registro se reconoce por
-- el identificador del contacto en esa red (lead_contacts) y, si no existe, se
-- crea con su nombre de perfil.
create or replace function public.ingest_mensaje_social(
  p_channel_id uuid,
  p_campaign_id uuid,
  p_provider_message_id text,
  p_direction text,
  p_contact_id text,
  p_contact_name text,
  p_message_type text,
  p_text_body text,
  p_provider_timestamp timestamptz,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canal text;
  v_conversation public.whatsapp_conversations%rowtype;
  v_lead public.leads%rowtype;
  v_campaign public.campaigns%rowtype;
  v_assigned_to uuid;
  v_team_id uuid;
  v_message_id uuid;
  v_created boolean := false;
  v_fuente text;
  v_etiqueta text;
  v_at timestamptz := coalesce(p_provider_timestamp, now());
begin
  if p_direction not in ('inbound', 'outbound') then
    raise exception 'invalid_social_direction';
  end if;
  if btrim(coalesce(p_contact_id, '')) = '' then
    raise exception 'invalid_social_contact';
  end if;

  select canal into v_canal from public.whatsapp_channels where id = p_channel_id;
  if v_canal is null or v_canal = 'whatsapp' then
    raise exception 'social_channel_not_found';
  end if;
  v_fuente := 'meta_' || v_canal;
  v_etiqueta := case v_canal when 'instagram' then 'Instagram' else 'Messenger' end;

  perform pg_advisory_xact_lock(hashtextextended(p_channel_id::text || ':' || p_contact_id, 0));

  if p_provider_message_id is not null then
    select m.id, c.id, c.lead_id, c.assigned_to
    into v_message_id, v_conversation.id, v_conversation.lead_id, v_conversation.assigned_to
    from public.whatsapp_messages m
    join public.whatsapp_conversations c on c.id = m.conversation_id
    where m.provider_message_id = p_provider_message_id;

    if v_message_id is not null then
      return jsonb_build_object(
        'duplicate', true,
        'message_id', v_message_id,
        'conversation_id', v_conversation.id,
        'lead_id', v_conversation.lead_id,
        'assigned_to', v_conversation.assigned_to
      );
    end if;
  end if;

  select * into v_conversation
  from public.whatsapp_conversations
  where channel_id = p_channel_id
    and campaign_id = p_campaign_id
    and contact_wa_id = p_contact_id;

  if v_conversation.id is null then
    select * into v_campaign from public.campaigns where id = p_campaign_id and is_active;
    if v_campaign.id is null then
      raise exception 'social_campaign_not_active';
    end if;

    select l.* into v_lead
    from public.leads l
    join public.lead_contacts contact on contact.lead_id = l.id
    where l.campaign_id = p_campaign_id
      and contact.contact_type = v_canal
      and contact.normalized_value = p_contact_id
    order by l.updated_at desc
    limit 1;

    if v_lead.id is null then
      select membership.profile_id, agent.team_id
      into v_assigned_to, v_team_id
      from public.campaign_agents membership
      join public.profiles agent on agent.id = membership.profile_id
      left join public.whatsapp_conversations open_conversation
        on open_conversation.assigned_to = membership.profile_id
       and open_conversation.status in ('open', 'pending')
      where membership.campaign_id = p_campaign_id
        and agent.active
        and agent.role = 'agente'::public.app_role
      group by membership.profile_id, agent.team_id, membership.assigned_at
      order by count(open_conversation.id), membership.assigned_at, membership.profile_id
      limit 1;

      insert into public.leads (
        full_name, status, assigned_to, team_id, workflow_id, campaign_id,
        external_last_source_code, external_last_seen_at, extra
      ) values (
        coalesce(nullif(btrim(p_contact_name), ''), v_etiqueta || ' ' || right(p_contact_id, 4)),
        'nuevo',
        v_assigned_to,
        v_team_id,
        v_campaign.workflow_id,
        p_campaign_id,
        v_fuente,
        v_at,
        jsonb_build_object('source', v_fuente, v_canal || '_id', p_contact_id)
      ) returning * into v_lead;

      insert into public.lead_contacts (
        lead_id, contact_type, value, normalized_value, label, is_primary, is_valid, source, metadata
      ) values (
        v_lead.id, v_canal, coalesce(nullif(btrim(p_contact_name), ''), p_contact_id), p_contact_id,
        v_etiqueta, true, true, v_fuente, '{}'::jsonb
      ) on conflict (lead_id, contact_type, normalized_value) do nothing;

      v_created := true;
    else
      v_assigned_to := coalesce(v_lead.managed_by, v_lead.assigned_to);
      v_team_id := v_lead.team_id;
    end if;

    insert into public.whatsapp_conversations (
      channel_id, campaign_id, lead_id, canal, contact_wa_id, contact_phone, contact_name,
      assigned_to, status, last_message_at, last_inbound_at, last_outbound_at, unread_count, referral
    ) values (
      p_channel_id, p_campaign_id, v_lead.id, v_canal, p_contact_id, null, nullif(btrim(p_contact_name), ''),
      v_assigned_to, 'open', v_at,
      case when p_direction = 'inbound' then v_at end,
      case when p_direction = 'outbound' then v_at end,
      0, '{}'::jsonb
    ) returning * into v_conversation;
  end if;

  insert into public.whatsapp_messages (
    conversation_id, provider_message_id, direction, message_type, text_body, status,
    sender_wa_id, referral, provider_payload, provider_timestamp
  ) values (
    v_conversation.id,
    p_provider_message_id,
    p_direction,
    coalesce(nullif(p_message_type, ''), 'unknown'),
    p_text_body,
    case when p_direction = 'inbound' then 'received' else 'sent' end,
    case when p_direction = 'inbound' then p_contact_id end,
    '{}'::jsonb,
    coalesce(p_payload, '{}'::jsonb),
    p_provider_timestamp
  )
  on conflict (provider_message_id) where provider_message_id is not null do nothing
  returning id into v_message_id;

  if v_message_id is null and p_provider_message_id is not null then
    select id into v_message_id from public.whatsapp_messages where provider_message_id = p_provider_message_id;
  end if;

  update public.whatsapp_conversations
  set contact_name = coalesce(nullif(btrim(p_contact_name), ''), contact_name),
      status = case when p_direction = 'inbound' then 'open' else status end,
      last_message_at = greatest(last_message_at, v_at),
      last_inbound_at = case
        when p_direction = 'inbound' then greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), v_at)
        else last_inbound_at
      end,
      last_outbound_at = case
        when p_direction = 'outbound' then greatest(coalesce(last_outbound_at, '-infinity'::timestamptz), v_at)
        else last_outbound_at
      end,
      unread_count = unread_count + case when p_direction = 'inbound' and v_message_id is not null then 1 else 0 end
  where id = v_conversation.id;

  update public.leads
  set external_last_source_code = v_fuente,
      external_last_seen_at = greatest(coalesce(external_last_seen_at, '-infinity'::timestamptz), v_at),
      assigned_to = coalesce(assigned_to, v_conversation.assigned_to),
      team_id = coalesce(team_id, v_team_id)
  where id = v_conversation.lead_id;

  return jsonb_build_object(
    'duplicate', false,
    'created_lead', v_created,
    'message_id', v_message_id,
    'conversation_id', v_conversation.id,
    'lead_id', v_conversation.lead_id,
    'assigned_to', v_conversation.assigned_to
  );
end;
$$;

revoke all on function public.ingest_mensaje_social(uuid, uuid, text, text, text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_mensaje_social(uuid, uuid, text, text, text, text, text, text, timestamptz, jsonb)
  to service_role;
