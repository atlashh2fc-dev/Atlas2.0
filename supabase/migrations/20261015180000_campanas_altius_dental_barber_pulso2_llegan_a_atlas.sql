-- Las campañas de correo de Altius que faltaban llegan a Atlas.
--
-- «Altius · Atlas CRM Dental · Clínicas dentales · Bigdata ola 1», «Altius ·
-- Atlas CRM Barber · Barberías y peluquerías · Bigdata ola 1» y «Altius · Pulso
-- · Pymes RM · Bigdata ola 2» salen de Atlas Lead sin vínculo con el CRM: sus
-- aperturas no aparecían en Correo ni en Por contactar, y no les llegaba el
-- WhatsApp automático. Hugo (15-10) pidió conectarlas y traer su historia.
--
-- Igual que Vet (20261015140000): Dental y Barber tienen su propia campaña en
-- la empresa Altius; Pulso ola 2 va con la ola 1 en «Altius Web + IA ·
-- Septiembre 2026». Todas con el equipo que atiende la campaña de pymes. Del
-- lado de Atlas Lead se enciende la exportación y se reenvía la historia.

do $$
declare
  v_org uuid := (select id from public.organizations where slug = 'altius');
  v_fuente uuid := (select id from public.integration_sources where code = 'atlas_lead' and is_active);
  v_equipo text := (
    select metadata->>'routing_team_id' from public.mail_campaigns
    where umbrella_key = 'altius_web_ia' and metadata ? 'routing_team_id'
    order by created_at
    limit 1
  );
  v_pymes uuid := (select campaign_id from public.mail_campaigns where umbrella_key = 'altius_pulso' order by created_at limit 1);
  v_dental uuid;
  v_barber uuid;
  v_fila record;
begin
  if v_org is null or v_fuente is null or v_equipo is null or v_pymes is null then
    raise exception 'Falta la empresa Altius, la fuente de Atlas Lead, el equipo o la campaña de pymes.';
  end if;
  -- Altius y Geimser son empresas distintas: nada de esto puede caer en otra.
  if (select organization_id from public.teams where id = v_equipo::uuid) is distinct from v_org
     or (select organization_id from public.campaigns where id = v_pymes) is distinct from v_org then
    raise exception 'El equipo o la campaña de pymes no son de Altius.';
  end if;

  select id into v_dental from public.campaigns where organization_id = v_org and name = 'Altius · Atlas CRM Dental · Octubre 2026';
  if v_dental is null then
    insert into public.campaigns (name, description, is_active, vertical, organization_id, modalidad)
    values ('Altius · Atlas CRM Dental · Octubre 2026',
            'Campaña de correo de Altius Ignite a clínicas dentales, enviada desde Atlas Lead (Bigdata, ola 1).',
            true, 'ventas', v_org, 'remota')
    returning id into v_dental;
  end if;

  select id into v_barber from public.campaigns where organization_id = v_org and name = 'Altius · Atlas CRM Barber · Octubre 2026';
  if v_barber is null then
    insert into public.campaigns (name, description, is_active, vertical, organization_id, modalidad)
    values ('Altius · Atlas CRM Barber · Octubre 2026',
            'Campaña de correo de Altius Ignite a barberías y peluquerías, enviada desde Atlas Lead (Bigdata, ola 1).',
            true, 'ventas', v_org, 'remota')
    returning id into v_barber;
  end if;

  for v_fila in
    select * from (values
      ('ba83139b-e2c1-44cc-885d-45799046188b', 'Altius · Atlas CRM Dental · Clínicas dentales', 'altius_crm_dental', v_dental),
      ('0c949674-44b8-480a-bf74-c0f5816e587c', 'Altius · Atlas CRM Barber · Barberías y peluquerías', 'altius_crm_barber', v_barber),
      ('14db0425-2085-42f1-8ae9-03f11668d77e', 'Altius · Pulso · Pymes RM · Bigdata ola 2', 'altius_pulso', v_pymes)
    ) as t(clave, nombre, paraguas, campana)
  loop
    insert into public.mail_campaigns (source_id, external_campaign_key, name, umbrella_key, status, campaign_id, metadata)
    values (
      v_fuente, v_fila.clave, v_fila.nombre, v_fila.paraguas, 'active', v_fila.campana,
      jsonb_build_object(
        'brand_name', 'Altius Ignite',
        'sender_email', 'noreply@altiusignite.com',
        'mapped_from', 'atlas_crm_admin',
        'mapping_mode', 'explicit',
        'mapping_status', 'registered',
        'readiness', 'ready',
        'source_project', 'atlas-lead-engine',
        'source_campaign_id', v_fila.clave,
        'routing_team_id', v_equipo,
        'mapping_confirmed_at', now()
      )
    )
    on conflict (source_id, external_campaign_key) do update
      set campaign_id = excluded.campaign_id,
          status = 'active',
          metadata = public.mail_campaigns.metadata || excluded.metadata,
          updated_at = now();
  end loop;
end;
$$;
