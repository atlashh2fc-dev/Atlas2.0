-- Secretaría Virtual es una sola operación con motores nativos por canal.
-- Esta migración no copia leads ni crea puentes: registra Voz y Correo como
-- fuentes de la cola ACD existente y reconcilia su membresía desde la campaña.

begin;

create unique index if not exists contact_center_queue_sources_non_routed_campaign_uidx
  on public.contact_center_queue_sources (channel_type, campaign_id)
  where campaign_id is not null
    and channel_type in ('voice', 'email');

-- Estas funciones son puntos de trigger internos, no endpoints RPC.
revoke all on function public.route_new_whatsapp_lead_to_queue()
  from public, anon, authenticated;
revoke all on function public.scope_new_whatsapp_conversation_to_queue()
  from public, anon, authenticated;

do $migration$
declare
  v_queue_id uuid;
  v_campaign_id uuid;
begin
  select queue.id
  into v_queue_id
  from public.contact_center_queues queue
  where queue.name = 'Secretaría Virtual · Atención Digital';

  select campaign.id
  into v_campaign_id
  from public.campaigns campaign
  where campaign.name = 'Secretaria Virtual';

  if v_queue_id is null then
    raise exception 'No existe la cola canónica de Secretaría Virtual.';
  end if;
  if v_campaign_id is null then
    raise exception 'No existe la campaña CRM canónica Secretaria Virtual.';
  end if;

  insert into public.contact_center_queue_sources (
    queue_id,
    channel_type,
    campaign_id,
    is_active
  )
  select v_queue_id, channel.channel_type, v_campaign_id, true
  from (values ('voice'::text), ('email'::text)) channel(channel_type)
  where not exists (
    select 1
    from public.contact_center_queue_sources existing
    where existing.channel_type = channel.channel_type
      and existing.campaign_id = v_campaign_id
  );

  update public.contact_center_queue_sources source
  set queue_id = v_queue_id,
      is_active = true
  where source.campaign_id = v_campaign_id
    and source.channel_type in ('voice', 'email');

  insert into public.campaign_channels (campaign_id, channel, enabled)
  values
    (v_campaign_id, 'phone', true),
    (v_campaign_id, 'mail', true)
  on conflict (campaign_id, channel) do update
  set enabled = true,
      updated_at = now();

  update public.contact_center_queues
  set description = 'Cola omnicanal de Secretaría Virtual: WhatsApp entrante, correo saliente y llamadas salientes.',
      updated_at = now()
  where id = v_queue_id;
end;
$migration$;

commit;
