create policy "whatsapp_webhook_events_service_only"
on public.whatsapp_webhook_events
for all
to service_role
using (true)
with check (true);

create index whatsapp_campaign_routes_created_by_idx
  on public.whatsapp_campaign_routes(created_by);

create index whatsapp_channels_created_by_idx
  on public.whatsapp_channels(created_by);

create index whatsapp_channels_updated_by_idx
  on public.whatsapp_channels(updated_by);

create index whatsapp_messages_sent_by_idx
  on public.whatsapp_messages(sent_by);
