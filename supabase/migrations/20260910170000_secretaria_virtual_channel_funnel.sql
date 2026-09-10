-- Atribución comercial omnicanal de Secretaría Virtual.
--
-- "external_last_source_code" describe la última integración que tocó el
-- lead; no es necesariamente su origen. Este reporte usa señales inmutables
-- de creación/ingesta para separar Mail de la base telefónica y agrega la
-- campaña operativa de WhatsApp sin mezclar sus leads con la campaña canónica.

create or replace function public.get_secretaria_virtual_channel_funnel(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  channel text,
  base integer,
  contacted integer,
  interested integer,
  sales integer
)
language sql
stable
-- El reporte combina tablas operativas que no deben exponerse directamente al
-- rol authenticated. La función entrega solo agregados y es su única frontera
-- de lectura pública.
security definer
set search_path to 'public'
as $function$
  with
  canonical_campaign as (
    select id
    from public.campaigns
    where name = 'Secretaria Virtual'
    order by created_at
    limit 1
  ),
  whatsapp_campaign as (
    select id
    from public.campaigns
    where name = 'Meta Ads · WhatsApp · Secretaria Virtual Geimser'
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
      call.status,
      call.outcome,
      call.reason
    from public.calls call
    join canonical_leads lead on lead.id = call.lead_id
    where call.started_at >= p_from
      and call.started_at <= p_to
  ),
  canonical_metrics as (
    select
      lead.channel,
      count(*)::integer as base,
      count(*) filter (
        where exists (
          select 1
          from canonical_calls call
          where call.lead_id = lead.id
            and call.status = 'connected'
        )
      )::integer as contacted,
      count(*) filter (
        where exists (
          select 1
          from canonical_calls call
          where call.lead_id = lead.id
            and (
              call.outcome in ('interested', 'callback', 'sale')
              or call.reason in (
                'SE ENVIA INFORMACION',
                'VOLVER A LLAMAR',
                'CONTACTO CON TERCERO',
                'REUNION AGENDADA',
                'COTIZACION ENVIADA',
                'VENTA EN VALIDACION'
              )
            )
        )
      )::integer as interested,
      count(*) filter (
        where exists (
          select 1
          from canonical_calls call
          where call.lead_id = lead.id
            and (call.outcome = 'sale' or call.reason = 'VENTA EN VALIDACION')
        )
      )::integer as sales
    from canonical_leads lead
    group by lead.channel
  ),
  whatsapp_leads as (
    select lead.id
    from public.leads lead
    join whatsapp_campaign campaign on campaign.id = lead.campaign_id
  ),
  whatsapp_metrics as (
    select
      'WhatsApp'::text as channel,
      count(*)::integer as base,
      count(*) filter (
        where exists (
          select 1
          from public.whatsapp_conversations conversation
          join public.whatsapp_messages message on message.conversation_id = conversation.id
          where conversation.lead_id = lead.id
            and message.direction = 'inbound'
            and coalesce(message.provider_timestamp, message.created_at) >= p_from
            and coalesce(message.provider_timestamp, message.created_at) <= p_to
        )
      )::integer as contacted,
      count(*) filter (
        where exists (
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
        )
      )::integer as interested,
      count(*) filter (
        where exists (
          select 1
          from public.calls call
          where call.lead_id = lead.id
            and call.started_at >= p_from
            and call.started_at <= p_to
            and (call.outcome = 'sale' or call.reason = 'VENTA EN VALIDACION')
        )
      )::integer as sales
    from whatsapp_leads lead
  ),
  all_channels as (
    select * from canonical_metrics
    union all
    select * from whatsapp_metrics
  ),
  desired_channels(channel, sort_order) as (
    values
      ('Mail'::text, 1),
      ('WhatsApp'::text, 2),
      ('Llamada / base'::text, 3)
  )
  select
    desired.channel,
    coalesce(metrics.base, 0)::integer,
    coalesce(metrics.contacted, 0)::integer,
    coalesce(metrics.interested, 0)::integer,
    coalesce(metrics.sales, 0)::integer
  from desired_channels desired
  left join all_channels metrics on metrics.channel = desired.channel
  order by desired.sort_order;
$function$;

revoke all on function public.get_secretaria_virtual_channel_funnel(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_secretaria_virtual_channel_funnel(timestamptz, timestamptz)
  to authenticated;
