-- La operación de contact center de la demo: colas, flujos, estados, discador
-- y un momento en vivo.
--
-- Por qué existe: `sembrar-demos.sql` deja a Andes Contact Center con campañas,
-- registros y llamadas, pero sus pantallas de configuración y de monitoreo se
-- ven vacías ("Aún no hay colas configuradas", "No hay motivos configurados").
-- Un contact center sin colas ni flujos no se parece a un contact center, y esa
-- demo es lo que se muestra y se graba para el sitio.
--
-- Todo queda acotado a la empresa demo (`v_org`). No toca a ninguna otra:
--   * los códigos de estado y los nombres de cola llevan prefijo propio, porque
--     esas dos tablas exigen valores únicos en toda la base;
--   * el canal de WhatsApp de la demo sigue en pausa: nada puede salir;
--   * las extensiones y los teléfonos son del rango inventado de la demo.
--
-- Dos barreras para que el discador nunca marque de verdad con estos datos:
-- las campañas de la demo no tienen extensiones SIP asignadas (el motor pide
-- `get_active_campaign_agent_extensions` y recibe cero), y ninguna sesión de
-- ejecutivo queda en `available`, que es el otro requisito para originar. Si
-- alguna vez se le asignan extensiones a esta empresa, hay que apagar
-- `dialer_campaign_configs.is_active` antes.
--
-- Se corre entero y es repetible: vuelve a dejar el mismo estado si ya existe.
-- Para deshacerlo, `borrar-demos.sql` se lleva la empresa completa.

do $$
declare
  v_org uuid := '35c33c83-82e9-4465-9e24-9d5c8da72f4c';  -- Andes Contact Center
  v_equipo uuid;
  v_canal_wa uuid;
  v_hogar uuid;
  v_movil uuid;
  v_cobranza uuid;
  v_flujo uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
  v_cola uuid;
  v_agentes uuid[];
  v_ruta uuid;
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'La empresa demo no existe; corre antes sembrar-demos.sql';
    return;
  end if;

  select id into v_equipo from public.teams where organization_id = v_org limit 1;
  select id into v_canal_wa from public.whatsapp_channels where organization_id = v_org limit 1;
  select id into v_hogar from public.campaigns where organization_id = v_org and name like '%Seguro Hogar%';
  select id into v_movil from public.campaigns where organization_id = v_org and name like '%Portabilidad%';
  select id into v_cobranza from public.campaigns where organization_id = v_org and name like '%Cobranza%';

  select array_agg(id order by full_name) into v_agentes
    from public.profiles where organization_id = v_org and role = 'agente';

  -- 1. Estados de agente -----------------------------------------------------
  -- Lo que el ejecutivo elige en el CTI y lo que después se cuenta en adherencia.
  insert into public.agent_status_reasons
    (organization_id, code, label, is_pause, is_productive, is_system, sort_order, max_seconds, excludes_from_adherence)
  values
    (v_org, 'andes_disponible',   'Disponible',           false, true,  false,  0, null,  false),
    (v_org, 'andes_llamada',      'Llamada manual',       true,  true,  true,  10, null,  false),
    (v_org, 'andes_gestion',      'Gestión posterior',    true,  true,  false, 20, 600,   false),
    (v_org, 'andes_descanso',     'Descanso',             true,  false, false, 30, 900,   false),
    (v_org, 'andes_almuerzo',     'Almuerzo / colación',  true,  false, false, 40, 2700,  false),
    (v_org, 'andes_capacitacion', 'Capacitación',         true,  false, false, 50, null,  false),
    (v_org, 'andes_reunion',      'Reunión de equipo',    true,  false, false, 60, null,  false),
    (v_org, 'andes_desconectado', 'Desconectado',         true,  false, true,  99, null,  true)
  on conflict (code) do update
    set label = excluded.label, is_pause = excluded.is_pause, is_productive = excluded.is_productive,
        sort_order = excluded.sort_order, max_seconds = excluded.max_seconds;

  -- 2. Flujos de gestión -----------------------------------------------------
  -- Un flujo por campaña: lo que el ejecutivo responde mientras habla, y de ahí
  -- salen las tipificaciones que después se leen en los reportes.

  -- Venta de seguro de hogar.
  select id into v_flujo from public.workflows where organization_id = v_org and name = 'Andes · Venta seguro hogar';
  if v_flujo is null then
    insert into public.workflows (organization_id, name, description, status, is_active)
    values (v_org, 'Andes · Venta seguro hogar', 'Contacto, oferta y cierre de la venta telefónica.', 'published', true)
    returning id into v_flujo;

    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y)
    values (v_flujo, 1, 'Estado de la llamada', 'single_choice',
            '["Conecta con el titular","No conecta","Número equivocado"]'::jsonb,
            array['Conecta con el titular','No conecta','Número equivocado'], true, 0, 0)
    returning id into v_p1;
    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y, result_kind)
    values (v_flujo, 2, 'Interés en la oferta', 'combobox',
            '["Acepta la cotización","Pide pensarlo","No le interesa","Ya tiene seguro"]'::jsonb,
            array['Acepta la cotización','Pide pensarlo','No le interesa','Ya tiene seguro'], false, 320, -80, 'interesado')
    returning id into v_p2;
    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y, result_kind)
    values (v_flujo, 3, 'Motivo de no contacto', 'combobox',
            '["No contesta","Buzón de voz","Fuera de servicio","Corta la llamada"]'::jsonb,
            array['No contesta','Buzón de voz','Fuera de servicio','Corta la llamada'], false, 320, 120, 'no_contacto')
    returning id into v_p3;
    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y)
    values (v_flujo, 4, 'Próxima acción', 'single_choice',
            '["Enviar cotización por WhatsApp","Agendar llamada","Pasar a validación","Cerrar sin venta"]'::jsonb,
            array['Enviar cotización por WhatsApp','Agendar llamada','Pasar a validación','Cerrar sin venta'], false, 660, 0)
    returning id into v_p4;

    insert into public.workflow_step_branches (workflow_id, from_step_id, from_option, to_step_id) values
      (v_flujo, v_p1, 'Conecta con el titular', v_p2),
      (v_flujo, v_p1, 'No conecta', v_p3),
      (v_flujo, v_p2, 'Acepta la cotización', v_p4),
      (v_flujo, v_p2, 'Pide pensarlo', v_p4);
  end if;
  update public.campaigns set workflow_id = v_flujo where id = v_hogar;

  -- Portabilidad móvil, que vive entre la llamada y el WhatsApp.
  select id into v_flujo from public.workflows where organization_id = v_org and name = 'Andes · Portabilidad móvil';
  if v_flujo is null then
    insert into public.workflows (organization_id, name, description, status, is_active)
    values (v_org, 'Andes · Portabilidad móvil', 'Captación de líneas con continuidad por WhatsApp.', 'published', true)
    returning id into v_flujo;

    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y)
    values (v_flujo, 1, 'Estado de la llamada', 'single_choice',
            '["Conecta","No conecta"]'::jsonb, array['Conecta','No conecta'], true, 0, 0)
    returning id into v_p1;
    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y, result_kind)
    values (v_flujo, 2, 'Resultado de la gestión', 'combobox',
            '["Acepta portar","Pide más información","Contrato con otra compañía","No le interesa"]'::jsonb,
            array['Acepta portar','Pide más información','Contrato con otra compañía','No le interesa'], false, 320, -60, 'interesado')
    returning id into v_p2;
    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y)
    values (v_flujo, 3, 'Continuidad por WhatsApp', 'single_choice',
            '["Enviar requisitos","Enviar contrato","Sin envío"]'::jsonb,
            array['Enviar requisitos','Enviar contrato','Sin envío'], false, 660, 0)
    returning id into v_p3;

    insert into public.workflow_step_branches (workflow_id, from_step_id, from_option, to_step_id) values
      (v_flujo, v_p1, 'Conecta', v_p2),
      (v_flujo, v_p2, 'Acepta portar', v_p3);
  end if;
  update public.campaigns set workflow_id = v_flujo where id = v_movil;

  -- Cobranza temprana.
  select id into v_flujo from public.workflows where organization_id = v_org and name = 'Andes · Cobranza temprana';
  if v_flujo is null then
    insert into public.workflows (organization_id, name, description, status, is_active)
    values (v_org, 'Andes · Cobranza temprana', 'Contacto, acuerdo de pago y seguimiento del compromiso.', 'published', true)
    returning id into v_flujo;

    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y)
    values (v_flujo, 1, 'Contacto con el titular', 'single_choice',
            '["Habla el titular","Habla un tercero","No conecta"]'::jsonb,
            array['Habla el titular','Habla un tercero','No conecta'], true, 0, 0)
    returning id into v_p1;
    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y, result_kind)
    values (v_flujo, 2, 'Resultado de la gestión', 'combobox',
            '["Compromiso de pago","Paga en el acto","Pide convenio","Se niega a pagar"]'::jsonb,
            array['Compromiso de pago','Paga en el acto','Pide convenio','Se niega a pagar'], false, 320, -60, 'interesado')
    returning id into v_p2;
    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y)
    values (v_flujo, 3, 'Fecha del compromiso', 'single_choice',
            '["Hoy","Dentro de 48 horas","Esta semana","Próximo pago"]'::jsonb,
            array['Hoy','Dentro de 48 horas','Esta semana','Próximo pago'], false, 660, -60)
    returning id into v_p3;
    insert into public.workflow_steps (workflow_id, step_order, name, field_type, options, allowed_results, is_start, pos_x, pos_y, result_kind)
    values (v_flujo, 4, 'Motivo de no contacto', 'combobox',
            '["No contesta","Buzón de voz","Teléfono fuera de servicio"]'::jsonb,
            array['No contesta','Buzón de voz','Teléfono fuera de servicio'], false, 320, 140, 'no_contacto')
    returning id into v_p4;

    insert into public.workflow_step_branches (workflow_id, from_step_id, from_option, to_step_id) values
      (v_flujo, v_p1, 'Habla el titular', v_p2),
      (v_flujo, v_p1, 'No conecta', v_p4),
      (v_flujo, v_p2, 'Compromiso de pago', v_p3);
  end if;
  update public.campaigns set workflow_id = v_flujo where id = v_cobranza;

  -- 3. Colas y enrutamiento --------------------------------------------------
  -- La cola es lo que reparte: por canal, por campaña y entre quienes atienden.

  -- Cola de ventas: voz y WhatsApp sobre las dos campañas comerciales.
  select id into v_cola from public.contact_center_queues where name = 'Andes · Ventas';
  if v_cola is null then
    insert into public.contact_center_queues
      (organization_id, name, description, routing_mode, service_level_seconds, max_concurrent_per_agent)
    values (v_org, 'Andes · Ventas', 'Voz saliente y WhatsApp de las campañas comerciales.', 'least_loaded', 180, 3)
    returning id into v_cola;
  end if;
  insert into public.contact_center_queue_members (queue_id, profile_id, max_concurrent)
  select v_cola, unnest(v_agentes[1:5]), 3
  on conflict (queue_id, profile_id) do nothing;
  insert into public.contact_center_queue_sources (queue_id, channel_type, campaign_id)
  select v_cola, 'voice', c from unnest(array[v_hogar, v_movil]) c
  where not exists (
    select 1 from public.contact_center_queue_sources s
    where s.queue_id = v_cola and s.channel_type = 'voice' and s.campaign_id = c
  );
  if v_canal_wa is not null then
    select id into v_ruta from public.whatsapp_campaign_routes where campaign_id = v_movil;
    if v_ruta is null then
      insert into public.whatsapp_campaign_routes (channel_id, campaign_id, is_default, is_active)
      values (v_canal_wa, v_movil, true, true) returning id into v_ruta;
    end if;
    insert into public.contact_center_queue_sources (queue_id, channel_type, campaign_id, whatsapp_route_id)
    values (v_cola, 'whatsapp', v_movil, v_ruta)
    on conflict (whatsapp_route_id) do nothing;
  end if;

  -- Cola de cobranza: voz y correo, con menos simultaneidad por ejecutivo.
  select id into v_cola from public.contact_center_queues where name = 'Andes · Cobranza';
  if v_cola is null then
    insert into public.contact_center_queues
      (organization_id, name, description, routing_mode, service_level_seconds, max_concurrent_per_agent)
    values (v_org, 'Andes · Cobranza', 'Cartera temprana de retail: voz y correo.', 'least_loaded', 300, 2)
    returning id into v_cola;
  end if;
  insert into public.contact_center_queue_members (queue_id, profile_id, max_concurrent)
  select v_cola, unnest(v_agentes[5:9]), 2
  on conflict (queue_id, profile_id) do nothing;
  insert into public.contact_center_queue_sources (queue_id, channel_type, campaign_id)
  select v_cola, ch, v_cobranza from unnest(array['voice','email']) ch
  where not exists (
    select 1 from public.contact_center_queue_sources s
    where s.queue_id = v_cola and s.channel_type = ch and s.campaign_id = v_cobranza
  );

  -- 4. Discador ---------------------------------------------------------------
  -- Cada campaña marca distinto: la cobranza predice, la venta va de a una.
  insert into public.dialer_campaign_configs
    (campaign_id, dial_mode, max_dial_ratio, caller_id, trunk_context, queue_name, is_active,
     wrapup_seconds, max_redial_attempts, abandon_timeout_seconds, target_abandonment_rate, amd_enabled,
     personal_callback_enabled, personal_callback_window_minutes)
  values
    (v_hogar,    'progressive', 1.0, '+56 2 0000 1001', 'from-dialer-outbound', 'andes_ventas',   true, 45, 4, 25, 0.03, true,  true, 120),
    (v_movil,    'preview',     1.0, '+56 2 0000 1002', 'from-dialer-outbound', 'andes_ventas',   true, 60, 3, 25, 0.03, false, true, 180),
    (v_cobranza, 'predictive',  1.6, '+56 2 0000 1003', 'from-dialer-outbound', 'andes_cobranza', true, 30, 6, 20, 0.05, true,  false, 60)
  on conflict (campaign_id) do update
    set dial_mode = excluded.dial_mode, max_dial_ratio = excluded.max_dial_ratio,
        caller_id = excluded.caller_id, queue_name = excluded.queue_name,
        wrapup_seconds = excluded.wrapup_seconds, amd_enabled = excluded.amd_enabled;

  -- 5. Un momento en vivo -----------------------------------------------------
  -- El monitoreo sin nadie conectado no muestra nada. Acá el turno está en
  -- marcha: la mayoría hablando, alguien en gestión posterior y uno almorzando.
  insert into public.dialer_agent_sessions (profile_id, campaign_id, extension, status, last_state_change_at)
  select a.id,
         case when a.n <= 5 then v_hogar else v_cobranza end,
         (9000 + a.n)::text,
         -- Nunca 'available': ese estado es el que autoriza al motor a marcar.
         (array['on_call','on_call','wrap_up','on_call','wrap_up','on_call','wrap_up','ringing','on_call'])[a.n],
         now() - (a.n * interval '37 seconds')
    from (select id, row_number() over (order by full_name) n from public.profiles
           where organization_id = v_org and role = 'agente') a
  on conflict (profile_id, campaign_id) do update
    set status = excluded.status, extension = excluded.extension,
        last_state_change_at = excluded.last_state_change_at, updated_at = now();

  insert into public.agent_current_status (profile_id, reason_id, since, last_heartbeat_at)
  select a.id,
         (select id from public.agent_status_reasons
           where organization_id = v_org
             and code = (array['andes_llamada','andes_llamada','andes_disponible','andes_llamada',
                               'andes_gestion','andes_llamada','andes_disponible','andes_disponible',
                               'andes_almuerzo'])[a.n]),
         now() - (a.n * interval '2 minutes'),
         now() - interval '5 seconds'
    from (select id, row_number() over (order by full_name) n from public.profiles
           where organization_id = v_org and role = 'agente') a
  on conflict (profile_id) do update
    set reason_id = excluded.reason_id, since = excluded.since,
        last_heartbeat_at = excluded.last_heartbeat_at, updated_at = now();

  raise notice 'Operación de la demo Center sembrada.';
end $$;
