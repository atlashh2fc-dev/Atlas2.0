-- Cada número de "Resultado por canal de origen" lleva a los leads que cuenta.
--
-- La clasificación por canal y etapa vivía dentro del agregado. Se separa en
-- una función por lead, y tanto el embudo como la lista de Registros salen de
-- ella: el número de la celda y la lista que abre no pueden discrepar.

create or replace function public.get_secretaria_virtual_channel_leads(
  p_from timestamptz,
  p_to timestamptz
)
returns table(lead_id uuid, channel text, contacted boolean, interested boolean, sale boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.request_is_service_role()
     and coalesce((select public.current_role_name())::text, '') not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para ver este reporte.';
  end if;

  return query
  with
  canonical_campaign as (
    select id
    from public.campaigns
    where public.can_access_org(organization_id) and name = 'Secretaria Virtual'
    order by created_at
    limit 1
  ),
  whatsapp_campaign as (
    select id
    from public.campaigns
    where public.can_access_org(organization_id) and name = 'Meta Ads · WhatsApp · Secretaria Virtual Geimser'
    order by created_at
    limit 1
  ),
  canonical_leads as (
    select
      lead.id,
      case
        when lower(btrim(coalesce(lead.extra->>'source', lead.extra->>'external_source', ''))) = 'atlas_lead'
          or lower(btrim(coalesce(lead.external_last_source_code, ''))) = 'atlas_lead'
          or exists (
            select 1
            from public.lead_external_refs reference
            join public.integration_sources source on source.id = reference.source_id
            where reference.lead_id = lead.id
              and source.code = 'atlas_lead'
          )
          or exists (
            select 1
            from public.mail_campaign_lead_status mail_status
            where mail_status.lead_id = lead.id
          )
          or exists (
            select 1
            from public.lead_mail_messages mail_message
            where mail_message.lead_id = lead.id
          )
        then 'Mail'
        else 'Llamada / base'
      end as channel
    from public.leads lead
    join canonical_campaign campaign on campaign.id = lead.campaign_id
  ),
  canonical_calls as (
    select
      call.lead_id,
      bool_or(call.status = 'connected') as contacted,
      bool_or(
        call.outcome in ('interested', 'callback', 'sale')
        or call.reason in (
          'SE ENVIA INFORMACION',
          'VOLVER A LLAMAR',
          'CONTACTO CON TERCERO',
          'REUNION AGENDADA',
          'COTIZACION ENVIADA',
          'VENTA EN VALIDACION'
        )
      ) as interested,
      bool_or(call.outcome = 'sale' or call.reason = 'VENTA EN VALIDACION') as sale
    from public.calls call
    join canonical_leads lead on lead.id = call.lead_id
    where call.started_at >= p_from
      and call.started_at <= p_to
    group by call.lead_id
  ),
  whatsapp_leads as (
    select lead.id
    from public.leads lead
    join whatsapp_campaign campaign on campaign.id = lead.campaign_id
  )
  select
    lead.id,
    lead.channel,
    coalesce(calls.contacted, false),
    coalesce(calls.interested, false),
    coalesce(calls.sale, false)
  from canonical_leads lead
  left join canonical_calls calls on calls.lead_id = lead.id

  union all

  select
    lead.id,
    'WhatsApp'::text,
    exists (
      select 1
      from public.whatsapp_conversations conversation
      join public.whatsapp_messages message on message.conversation_id = conversation.id
      where conversation.lead_id = lead.id
        and message.direction = 'inbound'
        and coalesce(message.provider_timestamp, message.created_at) >= p_from
        and coalesce(message.provider_timestamp, message.created_at) <= p_to
    ),
    exists (
      select 1
      from public.whatsapp_conversations conversation
      join public.whatsapp_conversation_events event on event.conversation_id = conversation.id
      where conversation.lead_id = lead.id
        and event.event_type in ('ai_handoff', 'callback_scheduled', 'appointment_scheduled')
        and event.created_at >= p_from
        and event.created_at <= p_to
    )
    or exists (
      select 1
      from public.whatsapp_conversations conversation
      join public.whatsapp_closure_reasons reason on reason.id = conversation.close_reason_id
      where conversation.lead_id = lead.id
        and reason.code in ('qualified_followup', 'human_handoff')
        and conversation.closed_at >= p_from
        and conversation.closed_at <= p_to
    ),
    exists (
      select 1
      from public.calls call
      where call.lead_id = lead.id
        and call.started_at >= p_from
        and call.started_at <= p_to
        and (call.outcome = 'sale' or call.reason = 'VENTA EN VALIDACION')
    )
  from whatsapp_leads lead;
end
$function$;

revoke all on function public.get_secretaria_virtual_channel_leads(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_secretaria_virtual_channel_leads(timestamptz, timestamptz) to authenticated;

create or replace function public.get_secretaria_virtual_channel_funnel(
  p_from timestamptz,
  p_to timestamptz
)
returns table(channel text, base integer, contacted integer, interested integer, sales integer)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with
  per_lead as (
    select * from public.get_secretaria_virtual_channel_leads(p_from, p_to)
  ),
  desired_channels(channel, sort_order) as (
    values
      ('Mail'::text, 1),
      ('WhatsApp'::text, 2),
      ('Llamada / base'::text, 3)
  )
  select
    desired.channel,
    count(lead.lead_id)::integer,
    count(*) filter (where lead.contacted)::integer,
    count(*) filter (where lead.interested)::integer,
    count(*) filter (where lead.sale)::integer
  from desired_channels desired
  left join per_lead lead on lead.channel = desired.channel
  group by desired.channel, desired.sort_order
  order by desired.sort_order;
$function$;

revoke all on function public.get_secretaria_virtual_channel_funnel(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_secretaria_virtual_channel_funnel(timestamptz, timestamptz) to authenticated;

-- Ids de una celda del embudo. Devuelve un arreglo (un solo valor) para que el
-- límite de filas de la API no recorte la lista.
create or replace function public.get_secretaria_virtual_channel_lead_ids(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text,
  p_stage text
)
returns uuid[]
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select coalesce(array_agg(lead.lead_id), '{}'::uuid[])
  from public.get_secretaria_virtual_channel_leads(p_from, p_to) lead
  where (p_channel is null or lead.channel = p_channel)
    and case p_stage
      when 'contactados' then lead.contacted
      when 'interesados' then lead.interested
      when 'ventas' then lead.sale
      else true
    end;
$function$;

revoke all on function public.get_secretaria_virtual_channel_lead_ids(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.get_secretaria_virtual_channel_lead_ids(timestamptz, timestamptz, text, text) to authenticated;

-- Página de registros acotada a una lista grande de ids. Va por POST, así que
-- no choca con el largo máximo de la URL que tiene un filtro `in` de miles.
create or replace function public.leads_by_ids(p_ids uuid[])
returns setof public.leads
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select * from public.leads where id = any(p_ids);
$function$;

revoke all on function public.leads_by_ids(uuid[]) from public, anon;
grant execute on function public.leads_by_ids(uuid[]) to authenticated;
