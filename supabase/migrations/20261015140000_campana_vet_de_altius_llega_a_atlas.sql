-- La campaña de correo de Altius a clínicas veterinarias llega a Atlas.
--
-- «Altius · Atlas CRM Vet · Clínicas veterinarias · Bigdata ola 1» sale de
-- Atlas Lead desde el 02-10-2026 (84 clínicas, 27 aperturas al 15-10), pero
-- nunca se conectó a una campaña del CRM: Atlas Lead no exporta eventos de una
-- campaña sin ese vínculo, así que nadie que la abrió apareció en Por contactar
-- ni le llegó el WhatsApp automático. Hugo (15-10) pidió que los primeros
-- WhatsApp vayan a veterinarias.
--
-- Igual que «Altius Web + IA»: una campaña del CRM en la empresa Altius y el
-- vínculo de Atlas Lead (mail_campaigns) por la clave de la campaña externa.
-- Del lado de Atlas Lead se enciende la exportación y se reenvía la historia.

do $$
declare
  v_org uuid := (select id from public.organizations where slug = 'altius');
  v_fuente uuid := (
    select source_id from public.mail_campaigns
    where umbrella_key = 'altius_web_ia'
    order by created_at
    limit 1
  );
  v_campana uuid;
begin
  if v_org is null or v_fuente is null then
    raise exception 'Falta la empresa Altius o la fuente de Atlas Lead.';
  end if;

  select id into v_campana
  from public.campaigns
  where organization_id = v_org and name = 'Altius · Atlas CRM Vet · Octubre 2026';

  if v_campana is null then
    insert into public.campaigns (name, description, is_active, vertical, organization_id, modalidad)
    values (
      'Altius · Atlas CRM Vet · Octubre 2026',
      'Campaña de correo de Altius Ignite a clínicas veterinarias, enviada desde Atlas Lead (Bigdata, ola 1).',
      true, 'ventas', v_org, 'remota'
    )
    returning id into v_campana;
  end if;

  insert into public.mail_campaigns (source_id, external_campaign_key, name, umbrella_key, status, campaign_id, metadata)
  values (
    v_fuente,
    '42d54ede-05f6-464b-a110-09191bb8a398',
    'Altius · Atlas CRM Vet · Clínicas veterinarias',
    'altius_crm_vet',
    'active',
    v_campana,
    jsonb_build_object(
      'brand_name', 'Altius Ignite',
      'mapped_from', 'atlas_crm_admin',
      'mapping_mode', 'explicit',
      'sender_email', 'noreply@altiusignite.com',
      'mapping_status', 'registered',
      'source_project', 'atlas-lead-engine',
      'source_campaign_id', '42d54ede-05f6-464b-a110-09191bb8a398',
      -- El mismo equipo que atiende la campaña de pymes de Altius.
      'routing_team_id', (select metadata->>'routing_team_id' from public.mail_campaigns where umbrella_key = 'altius_web_ia' order by created_at limit 1),
      'mapping_confirmed_at', now()
    )
  )
  on conflict (source_id, external_campaign_key) do update
    set campaign_id = excluded.campaign_id,
        status = 'active',
        metadata = public.mail_campaigns.metadata || excluded.metadata,
        updated_at = now();
end;
$$;
