-- La demo de cobranza «Fundación Educacional Créate» se cargó el 09-09, antes
-- de que existieran empresas. Al llegar el multiempresa (17-09) todo quedó en
-- Geimser: 1.200 registros, 4 ejecutivas ficticias, su campaña y su cola
-- aparecían en Registros, Reportes y el equipo de Geimser.
--
-- Se mueve completa a una empresa propia. La demo se reconoce sin ambigüedad
-- por sus ids `fec?0000-0000-4000-8000-…`; lo que no tiene organization_id
-- (gestiones, llamadas, correos) cuelga de esos registros y los sigue.

do $$
declare
  geimser constant uuid := 'e64a8fa5-2f38-4460-97d8-f6b19634dccd';
  demo constant uuid := 'fec00000-0000-4000-8000-000000000000';
  canal_demo constant uuid := 'fec00000-0000-4000-8000-0000000000c1';
  patron constant text := 'fec_0000-0000-4000-8000-%';
  quedan bigint;
begin
  insert into public.organizations (id, slug, name, active, edicion, settings, plantilla_version)
  values (demo, 'demo-fundacion-create', 'Fundación Educacional Créate (demo)', true, 'center', '{}'::jsonb, 1)
  on conflict (id) do nothing;

  insert into public.organization_modules (organization_id, module, enabled)
  values (demo, 'leads', true), (demo, 'contact_center', true), (demo, 'correo', true), (demo, 'whatsapp', true)
  on conflict do nothing;

  -- Los chats de la demo colgaban del número real de Geimser. Pasan a un canal
  -- de demo en pausa: desde la demo no se le puede escribir a nadie.
  insert into public.whatsapp_channels (id, organization_id, canal, provider, status, business_name, waba_id, phone_number_id, display_phone_number)
  values (canal_demo, demo, 'whatsapp', 'meta', 'paused', 'Fundación Educacional Créate (demo)', 'demo-fec', 'demo-fec', '+56 9 0000 0000')
  on conflict (id) do nothing;

  update public.campaigns set organization_id = demo where organization_id = geimser and id::text like patron;
  update public.leads set organization_id = demo where organization_id = geimser and id::text like patron;
  update public.crm_entities set organization_id = demo where organization_id = geimser and id::text like patron;
  update public.lead_origins set organization_id = demo where organization_id = geimser and lead_id::text like patron;
  update public.teams set organization_id = demo where organization_id = geimser and id::text like patron;
  update public.contact_center_queues set organization_id = demo where organization_id = geimser and id::text like patron;
  update public.workflows set organization_id = demo where organization_id = geimser and id::text like patron;
  update public.integration_sources set organization_id = demo where organization_id = geimser and id::text like patron;
  update public.dialer_phone_suppressions set organization_id = demo where organization_id = geimser and id::text like patron;
  update public.whatsapp_conversations set organization_id = demo, channel_id = canal_demo where organization_id = geimser and id::text like patron;
  update public.whatsapp_campaign_routes set channel_id = canal_demo where campaign_id::text like patron;

  -- Cada perfil admite una sola membresía por defecto: se retira la de Geimser
  -- y el trigger de perfiles crea la de la empresa nueva.
  delete from public.organization_members where organization_id = geimser and profile_id::text like patron;
  update public.profiles set organization_id = demo where organization_id = geimser and id::text like patron;

  -- Hugo administra la demo como administra las otras empresas de muestra.
  insert into public.organization_members (organization_id, profile_id, role, is_default)
  values (demo, '8cdeef2f-12f5-449d-9bcb-6d0a60947833', 'admin', false)
  on conflict (organization_id, profile_id) do nothing;

  select count(*) into quedan from (
    select id from public.leads where organization_id = geimser and (id::text like patron or campaign_id::text like patron)
    union all select id from public.campaigns where organization_id = geimser and id::text like patron
    union all select profile_id from public.organization_members where organization_id = geimser and profile_id::text like patron
    union all select id from public.whatsapp_conversations where organization_id = geimser and id::text like patron
  ) resto;
  if quedan > 0 then
    raise exception 'La demo Créate sigue teniendo % filas en Geimser', quedan;
  end if;
end $$;
