-- Las campañas de correo de Geimser creadas desde el CRM llegan a Correo.
--
-- «Campaña_SV_Profesionales independientes_Octubre» (66 contactados, 42
-- aperturas al 15-10), «Campaña_SV_Nuevas Empresas_Octubre»,
-- «Campaña_SV_Administración condominio_Octubre» y «Correo profesional para
-- empresas - promo octubre 2026» se armaron y lanzaron desde Campañas de
-- correo, que nunca registraba el vínculo con una campaña del CRM. Sin vínculo
-- Atlas Lead no exporta eventos: no aparecían en el filtro de Correo y nadie
-- que las abrió se podía asignar. Hugo (15-10): «no podemos tener el CRM no
-- sincronizado».
--
-- Van a «Secretaria Virtual» con el equipo Secretaria Virtual, como las
-- Variantes A y B (mismo remitente ventas@geimser.cl). Del lado de Atlas Lead
-- se enciende la exportación y se reenvía la historia. Desde ahora la pantalla
-- de la campaña conecta sola al lanzar (src/lib/vinculo-correo-crm.server.ts).

do $$
declare
  v_fuente uuid := (select id from public.integration_sources where code = 'atlas_lead' and is_active);
  v_campana uuid := '111cb0ed-6e72-4c68-a83f-236d3c86b60b'; -- Secretaria Virtual (Geimser)
  v_equipo text := (
    select metadata->>'routing_team_id' from public.mail_campaigns
    where campaign_id = '111cb0ed-6e72-4c68-a83f-236d3c86b60b'
      and metadata ? 'routing_team_id'
    order by created_at
    limit 1
  );
  v_fila record;
begin
  if v_fuente is null or v_equipo is null
     or not exists (select 1 from public.campaigns where id = v_campana) then
    raise exception 'Falta la fuente de Atlas Lead, la campaña Secretaria Virtual o su equipo.';
  end if;

  for v_fila in
    select * from (values
      ('cb25b8de-7aa0-4448-a488-cefa5dff2acd', 'Campaña_SV_Profesionales independientes_Octubre'),
      ('60aa29f0-b164-499d-8d1d-62891d473593', 'Campaña_SV_Nuevas Empresas_Octubre'),
      ('3d3c2aa7-203c-4cfd-a26f-2c57f0fc51c4', 'Campaña_SV_Administración condominio_Octubre'),
      ('7e54232c-6f75-41ff-9820-f048981280ad', 'Correo profesional para empresas - promo octubre 2026')
    ) as t(clave, nombre)
  loop
    insert into public.mail_campaigns (source_id, external_campaign_key, name, umbrella_key, status, campaign_id, metadata)
    values (
      v_fuente,
      v_fila.clave,
      v_fila.nombre,
      'atlas_lead',
      'active',
      v_campana,
      jsonb_build_object(
        'brand_name', 'Geimser',
        'sender_email', 'ventas@geimser.cl',
        'mapped_from', 'campanas_correo',
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
