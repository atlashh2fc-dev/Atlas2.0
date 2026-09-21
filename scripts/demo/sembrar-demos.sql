-- Empresas de demostración, una por edición: Center, Dental y Vet.
--
-- Todo es inventado y todo cuadra: los tableros de Atlas calculan en vivo desde
-- las filas, así que los totales, embudos y porcentajes salen de los mismos
-- pacientes, presupuestos, llamadas y conversaciones que se siembran acá.
--
-- Seguridad, porque esto vive en la base de producción:
--   * Nadie de la demo puede iniciar sesión: el equipo ficticio no tiene clave y
--     sus correos terminan en .invalid (dominio reservado, nunca entrega).
--   * Ningún WhatsApp puede salir: el canal queda en pausa, las conversaciones
--     con la IA en pausa y no se crea configuración de IA para estas campañas.
--   * Teléfonos con el patrón +56 9 0000 xxxx y correos en .example (reservado).
--   * Sin referencias externas (lead_external_refs): el outbox no las ve.
--
-- Se ve entrando con la cuenta del dueño de la plataforma y eligiendo la
-- empresa en el selector de arriba. Si una empresa demo ya existe, se salta:
-- para rehacerla, primero correr borrar-demos.sql.

-- Todo vive en un esquema de trabajo que no expone la API y se borra al final
-- (ver borrar-demos.sql). Se usa así:
--   1. correr este archivo (crea las funciones, no siembra nada);
--   2. select demo_seed.sembrar_todo();  -- siembra las tres empresas;
--   3. drop schema demo_seed cascade;
--

create schema if not exists demo_seed;
revoke all on schema demo_seed from public, anon, authenticated;

-- Utilidades -----------------------------------------------------------------

create or replace function demo_seed.azar(p_opciones text[]) returns text
language sql volatile as $$
  select p_opciones[1 + floor(random() * array_length(p_opciones, 1))::int];
$$;

-- Un instante en horario de atención (09:00 a 19:00 de Chile), hace N días.
-- Hoy nunca cae en el futuro.
create or replace function demo_seed.hora_habil(p_dias_atras int) returns timestamptz
language sql volatile as $$
  select least(
    (((now() at time zone 'America/Santiago')::date - p_dias_atras) + time '09:00'
      + random() * interval '10 hours') at time zone 'America/Santiago',
    now() - interval '7 minutes' - random() * interval '50 minutes'
  );
$$;

-- Un instante futuro en horario de atención, dentro de N días.
create or replace function demo_seed.hora_futura(p_dias int) returns timestamptz
language sql volatile as $$
  select (((now() at time zone 'America/Santiago')::date + greatest(p_dias, 1)) + time '09:30'
    + (floor(random() * 18) * interval '30 minutes')) at time zone 'America/Santiago';
$$;

-- Persona del equipo ficticio. Sin clave: existe para que las llamadas y los
-- presupuestos tengan dueño, no para entrar.
create or replace function demo_seed.persona(
  p_org uuid, p_nombre text, p_email text, p_rol text, p_equipo uuid
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email, '',
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', p_rol),
          jsonb_build_object('full_name', p_nombre), now(), now());
  -- El perfil nace en la empresa por defecto; se lo lleva a la demo.
  delete from public.organization_members where profile_id = v_id;
  update public.profiles
     set organization_id = p_org, team_id = p_equipo, full_name = p_nombre,
         role = p_rol::public.app_role, active = true
   where id = v_id;
  return v_id;
end;
$$;

create or replace function demo_seed.nueva_empresa(p_slug text, p_nombre text, p_edicion text) returns uuid
language plpgsql as $$
declare
  v_org uuid;
begin
  insert into public.organizations (slug, name, edicion) values (p_slug, p_nombre, p_edicion)
  returning id into v_org;
  insert into public.organization_members (organization_id, profile_id, role, is_default)
  select v_org, owner.profile_id, 'admin'::public.app_role, false from public.platform_owners owner
  on conflict (organization_id, profile_id) do nothing;
  -- Sin campañas de correo sembradas, Correo sería una pantalla vacía en la demo.
  update public.organization_modules set enabled = false where organization_id = v_org and module = 'correo';
  return v_org;
end;
$$;

create table if not exists demo_seed.nombres (tipo text, valor text);
truncate demo_seed.nombres;
insert into demo_seed.nombres
select 'f', unnest(array['Camila','Valentina','Javiera','Catalina','Fernanda','Constanza','Francisca','Daniela',
  'Antonia','Isidora','Martina','Josefa','Carolina','Paula','María José','Macarena','Trinidad','Florencia',
  'Sofía','Emilia','Bárbara','Gabriela','Natalia','Rocío'])
union all
select 'm', unnest(array['Matías','Benjamín','Tomás','Vicente','Joaquín','Diego','Sebastián','Nicolás',
  'Felipe','Cristóbal','Ignacio','Maximiliano','Agustín','Martín','Gonzalo','Rodrigo','Andrés','Pablo',
  'José Tomás','Álvaro','Francisco','Lucas','Gaspar','Esteban'])
union all
select 'a', unnest(array['González','Muñoz','Rojas','Díaz','Pérez','Soto','Contreras','Silva','Martínez',
  'Sepúlveda','Morales','Rodríguez','López','Fuentes','Hernández','Torres','Araya','Flores','Espinoza',
  'Valenzuela','Castillo','Tapia','Reyes','Gutiérrez','Castro','Pizarro','Álvarez','Vásquez','Sánchez',
  'Fernández','Ramírez','Carrasco','Gómez','Cortés','Herrera','Núñez','Jara','Vergara','Rivera','Figueroa']);

create or replace function demo_seed.nombre_persona() returns text
language sql volatile as $$
  select (select valor from demo_seed.nombres where tipo = case when random() < 0.55 then 'f' else 'm' end order by random() limit 1)
    || ' ' || (select valor from demo_seed.nombres where tipo = 'a' order by random() limit 1)
    || ' ' || (select valor from demo_seed.nombres where tipo = 'a' order by random() limit 1);
$$;

create or replace function demo_seed.correo_de(p_nombre text, p_n int) returns text
language sql immutable as $$
  select lower(translate(split_part(p_nombre, ' ', 1) || '.' || split_part(p_nombre, ' ', array_length(string_to_array(p_nombre, ' '), 1) - 1),
    'áéíóúñÁÉÍÓÚÑ ', 'aeiounAEIOUN')) || p_n || '@correo.example';
$$;

-- Correo del equipo ficticio: nombre.apellido en un dominio que nunca entrega.
create or replace function demo_seed.correo_equipo(p_nombre text, p_dominio text) returns text
language sql immutable as $$
  select lower(translate(replace(p_nombre, ' ', '.'), 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')) || '@' || p_dominio;
$$;

create or replace function demo_seed.telefono(p_n int) returns text
language sql immutable as $$
  select '+56 9 0000 ' || lpad(p_n::text, 4, '0');
$$;

-- Clínicas: Dental y Vet comparten la mecánica ----------------------------------
--
-- Cada paciente (o tutor) es un registro en Registros y una cuenta persona en
-- Presupuestos. Tiene llamadas de la coordinación, conversaciones de WhatsApp y
-- un presupuesto que avanza por el embudo de la edición.

create or replace function demo_seed.sembrar_clinica(
  p_slug text, p_nombre text, p_edicion text, p_marca text, p_dominio text,
  p_equipo_nombre text, p_campana_nombre text,
  p_coordinacion text[], p_supervisora text,
  p_profesionales text[], p_precios jsonb, p_casos jsonb,
  p_pacientes int, p_mascotas boolean,
  p_guiones jsonb, p_siguientes text[]
) returns text
language plpgsql as $$
declare
  v_org uuid; v_equipo uuid; v_supervisora uuid; v_campana uuid; v_canal uuid;
  v_cierre_agendado uuid; v_cierre_resuelto uuid;
  v_agentes uuid[] := '{}'; v_agente uuid; v_nombre_agente text;
  v_i int; v_n int; v_paciente text; v_lead uuid; v_cuenta uuid; v_contacto uuid; v_opp uuid;
  v_caso jsonb; v_producto uuid; v_monto numeric; v_etapa uuid; v_etapa_key text; v_estado text;
  v_creado timestamptz; v_proxima timestamptz; v_r float; v_origen text; v_profesional text;
  v_meta jsonb; v_mascota text; v_especie text; v_raza text; v_nombre_negocio text;
  v_llamada timestamptz; v_status text; v_outcome text; v_reason text; v_ultima text; v_prox_llamada timestamptz;
  v_conv uuid; v_guion jsonb; v_msg jsonb; v_t timestamptz; v_cerrada boolean; v_k int;
  v_stages jsonb;
begin
  if exists (select 1 from public.organizations where slug = p_slug) then
    return p_slug || ': ya existe, se salta';
  end if;

  v_org := demo_seed.nueva_empresa(p_slug, p_nombre, p_edicion);

  insert into public.teams (name, organization_id) values (p_equipo_nombre, v_org) returning id into v_equipo;
  v_supervisora := demo_seed.persona(v_org, p_supervisora, demo_seed.correo_equipo(p_supervisora, p_dominio), 'supervisor', v_equipo);
  -- Desde acá se siembra con la sesión de la supervisora: las funciones que
  -- cuidan la frontera de empresa (agenda de una llamada, por ejemplo) exigen
  -- una sesión que llegue a la empresa, y la del dueño solo llega a la que tiene
  -- elegida en el selector.
  perform set_config('request.jwt.claims', json_build_object('sub', v_supervisora, 'role', 'authenticated')::text, true);
  update public.teams set supervisor_id = v_supervisora where id = v_equipo;
  insert into public.team_supervisors (team_id, supervisor_id) values (v_equipo, v_supervisora) on conflict do nothing;

  foreach v_nombre_agente in array p_coordinacion loop
    v_agentes := v_agentes || demo_seed.persona(v_org, v_nombre_agente,
      demo_seed.correo_equipo(v_nombre_agente, p_dominio), 'agente', v_equipo);
  end loop;

  insert into public.campaigns (name, description, is_active, vertical, organization_id)
  values (p_campana_nombre, 'Pacientes en tratamiento, presupuestos y reactivación.', true, 'ventas', v_org)
  returning id into v_campana;
  insert into public.campaign_channels (campaign_id, channel, enabled)
  values (v_campana, 'phone', true), (v_campana, 'whatsapp', true);
  insert into public.campaign_agents (campaign_id, profile_id)
  select v_campana, unnest(v_agentes);

  -- Precios propios de la clínica sobre el catálogo que trajo la plantilla.
  update public.sales_products producto
     set one_time_price = (p_precios ->> producto.code)::numeric
   where producto.organization_id = v_org and p_precios ? producto.code;

  -- WhatsApp en pausa: se ve, pero no puede enviar nada.
  insert into public.whatsapp_channels (waba_id, phone_number_id, display_phone_number, business_name, status, organization_id)
  values ('demo-' || p_slug, 'demo-' || p_slug || '-0001', '+56 9 0000 0000', p_marca, 'paused', v_org)
  returning id into v_canal;
  insert into public.whatsapp_closure_reasons (campaign_id, code, label, sort_order)
  values (v_campana, 'agendado', 'Cita agendada', 10) returning id into v_cierre_agendado;
  insert into public.whatsapp_closure_reasons (campaign_id, code, label, sort_order)
  values (v_campana, 'resuelto', 'Consulta resuelta', 20) returning id into v_cierre_resuelto;

  select jsonb_object_agg(key, id) into v_stages from public.sales_stages where organization_id = v_org;

  for v_i in 1 .. p_pacientes loop
    v_paciente := demo_seed.nombre_persona();
    v_agente := v_agentes[1 + floor(random() * array_length(v_agentes, 1))::int];
    v_profesional := demo_seed.azar(p_profesionales);
    v_creado := demo_seed.hora_habil(3 + floor(random() * 70)::int);
    v_origen := demo_seed.azar(array['instagram','instagram','google','google','referido','referido','whatsapp','convenio','web']);
    v_meta := jsonb_build_object('profesional', v_profesional,
      'prevision', demo_seed.azar(array['Fonasa','Fonasa','Isapre Colmena','Isapre Banmédica','Isapre Cruz Blanca','Isapre Consalud','Particular']));
    if p_mascotas then
      v_especie := case when random() < 0.62 then 'Perro' else 'Gato' end;
      v_mascota := demo_seed.azar(array['Luna','Toby','Simba','Kira','Max','Nala','Rocky','Mía','Coco','Milo','Olivia','Bruno','Canela','Thor','Frida','Oreo','Pelusa','Chester','Lola','Zeus']);
      v_raza := case when v_especie = 'Perro'
        then demo_seed.azar(array['Mestizo','Mestizo','Labrador','Golden Retriever','Poodle','Beagle','Bulldog Francés','Schnauzer','Yorkshire','Border Collie'])
        else demo_seed.azar(array['Mestizo','Mestizo','Siamés','Persa','Maine Coon','Bengalí']) end;
      v_meta := jsonb_build_object('profesional', v_profesional, 'mascota', v_mascota, 'especie', v_especie, 'raza', v_raza);
    end if;

    insert into public.leads (full_name, phone, email, campaign_id, organization_id, team_id, assigned_to,
                              managed_by, managed_at, status, workflow_status, assignment_status, created_at, extra)
    values (v_paciente, demo_seed.telefono(v_i + case when p_mascotas then 3000 else 1000 end),
            demo_seed.correo_de(v_paciente, v_i), v_campana, v_org, v_equipo, v_agente,
            v_agente, v_creado, 'nuevo', 'managed', 'managed', v_creado, v_meta)
    returning id into v_lead;

    -- Llamadas de la coordinación: la primera al llegar y seguimientos después.
    v_ultima := null; v_prox_llamada := null;
    v_n := 1 + floor(random() * 3)::int;
    for v_k in 1 .. v_n loop
      v_llamada := v_creado + (v_k - 1) * interval '4 days' + random() * interval '2 days';
      exit when v_llamada > now() - interval '10 minutes';
      v_r := random();
      if v_r < 0.28 then
        v_status := 'no_answer'; v_outcome := 'other'; v_reason := 'NO CONTESTA';
      elsif v_r < 0.36 then
        v_status := 'voicemail'; v_outcome := 'other'; v_reason := 'BUZON DE VOZ';
      elsif v_r < 0.66 then
        v_status := 'connected'; v_outcome := 'interested';
        v_reason := case when p_mascotas then demo_seed.azar(array['PLAN ENVIADO','AGENDA CONTROL','CONFIRMA HORA'])
                         else demo_seed.azar(array['PRESUPUESTO ENVIADO','AGENDA EVALUACION','CONFIRMA CITA']) end;
      elsif v_r < 0.86 then
        v_status := 'connected'; v_outcome := 'not_interested';
        v_reason := demo_seed.azar(array['PRECIO','LO VA A PENSAR','SE ATIENDE EN OTRO LUGAR']);
      else
        v_status := 'connected'; v_outcome := 'sale'; v_reason := 'ACEPTA TRATAMIENTO';
      end if;
      insert into public.calls (lead_id, agent_id, status, outcome, reason, started_at, ended_at, created_at)
      values (v_lead, v_agente, v_status, v_outcome, v_reason, v_llamada,
              v_llamada + (20 + floor(random() * case when v_status = 'connected' then 360 else 25 end)) * interval '1 second',
              v_llamada);
      insert into public.interactions (lead_id, agent_id, result, created_at)
      values (v_lead, v_agente, v_reason, v_llamada + interval '5 minutes');
      v_ultima := v_reason;
    end loop;

    -- Cuatro de cada cinco tienen presupuesto.
    if random() < 0.8 then
      v_caso := p_casos -> floor(random() * jsonb_array_length(p_casos))::int;
      select id into v_producto from public.sales_products
       where organization_id = v_org and code = v_caso ->> 'codigo';
      v_monto := round(((v_caso ->> 'monto')::numeric * (0.85 + random() * 0.35)) / 5000) * 5000;
      v_nombre_negocio := (v_caso ->> 'nombre') || case when p_mascotas then ' · ' || v_mascota else '' end;

      v_r := random();
      if v_r < 0.12 then v_etapa_key := case when p_mascotas then 'consulta' else 'evaluacion' end; v_estado := 'abierta';
      elsif v_r < 0.40 then v_etapa_key := case when p_mascotas then 'plan_enviado' else 'presupuesto_enviado' end; v_estado := 'abierta';
      elsif v_r < 0.60 then v_etapa_key := 'seguimiento'; v_estado := 'abierta';
      elsif v_r < 0.88 then v_etapa_key := 'aceptado'; v_estado := 'ganada';
      else v_etapa_key := case when p_mascotas then 'no_aceptado' else 'rechazado' end; v_estado := 'perdida';
      end if;
      v_etapa := (v_stages ->> v_etapa_key)::uuid;

      v_proxima := null;
      if v_estado = 'abierta' then
        v_r := random();
        v_proxima := case
          when v_r < 0.30 then now() - (1 + floor(random() * 25)) * interval '1 day'   -- sin respuesta hace días
          when v_r < 0.50 then least(demo_seed.hora_habil(0) + interval '3 hours', now() + interval '2 hours')
          else demo_seed.hora_futura(1 + floor(random() * 12)::int) end;
      end if;

      insert into public.sales_companies (organization_id, name, phone, email, commune, region, source, owner_id, metadata, created_at)
      values (v_org, v_paciente, demo_seed.telefono(v_i + case when p_mascotas then 3000 else 1000 end),
              demo_seed.correo_de(v_paciente, v_i),
              demo_seed.azar(array['Providencia','Ñuñoa','Las Condes','Santiago','La Reina','Vitacura','Macul','San Miguel']),
              'Metropolitana', v_origen, v_agente, v_meta, v_creado)
      returning id into v_cuenta;
      insert into public.sales_contacts (organization_id, company_id, full_name, email, phone, whatsapp, lead_id, is_decision_maker)
      values (v_org, v_cuenta, v_paciente, demo_seed.correo_de(v_paciente, v_i),
              demo_seed.telefono(v_i + case when p_mascotas then 3000 else 1000 end),
              demo_seed.telefono(v_i + case when p_mascotas then 3000 else 1000 end), v_lead, true)
      returning id into v_contacto;

      insert into public.sales_opportunities (organization_id, company_id, contact_id, name, stage_id, status,
        one_time_amount, expected_close_date, closed_at, lost_reason, owner_id, source, lead_id,
        next_action_at, next_action_note, created_at)
      values (v_org, v_cuenta, v_contacto, v_nombre_negocio, v_etapa, v_estado, v_monto,
        (v_creado + interval '21 days')::date,
        case when v_estado <> 'abierta' then least(v_creado + (3 + floor(random() * 20)) * interval '1 day', now() - interval '1 hour') end,
        case when v_estado = 'perdida' then demo_seed.azar(array['Precio','Lo va a pensar','Se atendió en otra clínica','Sin financiamiento','Dejó de responder']) end,
        v_agente, v_origen, v_lead, v_proxima,
        case when v_estado = 'abierta' then demo_seed.azar(p_siguientes) end,
        v_creado)
      returning id into v_opp;

      insert into public.sales_opportunity_items (organization_id, opportunity_id, product_id, description, quantity, one_time_price)
      values (v_org, v_opp, v_producto, v_caso ->> 'nombre', 1, v_monto);

      insert into public.sales_activities (organization_id, opportunity_id, company_id, contact_id, kind, subject, occurred_at, done, owner_id)
      values
        (v_org, v_opp, v_cuenta, v_contacto, 'nota',
         'Evaluación con ' || v_profesional || ': ' || lower(v_caso ->> 'nombre'), v_creado, true, v_agente),
        (v_org, v_opp, v_cuenta, v_contacto, 'whatsapp',
         case when p_mascotas then 'Plan de tratamiento enviado al tutor por WhatsApp' else 'Presupuesto enviado por WhatsApp' end,
         v_creado + interval '2 hours', true, v_agente);
      if v_estado <> 'abierta' or random() < 0.5 then
        insert into public.sales_activities (organization_id, opportunity_id, company_id, contact_id, kind, subject, occurred_at, done, owner_id)
        values (v_org, v_opp, v_cuenta, v_contacto, 'llamada',
          case v_estado
            when 'ganada' then 'Acepta el tratamiento; agenda primera sesión'
            when 'perdida' then 'Cierra sin aceptar el presupuesto'
            else 'Seguimiento: resolver dudas y opciones de pago' end,
          least(v_creado + interval '4 days', now() - interval '30 minutes'), true, v_agente);
      end if;
      if v_estado <> 'abierta' then
        insert into public.sales_activities (organization_id, opportunity_id, company_id, contact_id, kind, subject, occurred_at, done, owner_id)
        values (v_org, v_opp, v_cuenta, v_contacto, 'etapa',
          case v_estado when 'ganada' then 'Pasó a Aceptado' else 'Pasó a ' || case when p_mascotas then 'No aceptado' else 'Rechazado' end end,
          least(v_creado + interval '5 days', now() - interval '20 minutes'), true, v_agente);
      end if;

      update public.leads
         set status = case v_estado when 'ganada' then 'convertido' else 'nuevo' end,
             tipificacion_actual = coalesce(v_ultima, 'PRESUPUESTO ENVIADO'),
             next_action_at = v_proxima,
             next_action_channel = case when v_proxima is not null then 'whatsapp' else 'phone' end
       where id = v_lead;
    else
      update public.leads set tipificacion_actual = coalesce(v_ultima, 'NO CONTESTA') where id = v_lead;
    end if;

    -- Uno de cada tres conversa por WhatsApp.
    if random() < 0.36 then
      v_guion := p_guiones -> floor(random() * jsonb_array_length(p_guiones))::int;
      v_cerrada := random() < 0.6;
      v_t := greatest(v_creado, now() - interval '20 days') + random() * interval '3 days';
      if v_t > now() - interval '2 hours' then v_t := now() - interval '2 hours' - random() * interval '20 hours'; end if;
      insert into public.whatsapp_conversations (channel_id, campaign_id, lead_id, contact_wa_id, contact_phone, contact_name,
        assigned_to, status, unread_count, ai_state, created_at, close_reason_id, closed_at, closed_by)
      values (v_canal, v_campana, v_lead, '5690000' || lpad((v_i + case when p_mascotas then 3000 else 1000 end)::text, 4, '0'),
        demo_seed.telefono(v_i + case when p_mascotas then 3000 else 1000 end), v_paciente, v_agente,
        case when v_cerrada then 'closed' else 'open' end, 0, 'paused', v_t,
        case when v_cerrada then case when random() < 0.6 then v_cierre_agendado else v_cierre_resuelto end end,
        case when v_cerrada then v_t + interval '40 minutes' end,
        case when v_cerrada then v_agente end)
      returning id into v_conv;

      for v_msg in select * from jsonb_array_elements(v_guion) loop
        v_t := v_t + (2 + floor(random() * 9)) * interval '1 minute';
        insert into public.whatsapp_messages (conversation_id, provider_message_id, direction, message_type, text_body,
          status, sender_wa_id, sent_by, provider_timestamp, created_at)
        values (v_conv, 'demo-' || gen_random_uuid(), v_msg ->> 'd', 'text',
          replace(replace(replace(replace(v_msg ->> 't',
            '{nombre}', split_part(v_paciente, ' ', 1)),
            '{agente}', split_part((select full_name from public.profiles where id = v_agente), ' ', 1)),
            '{profesional}', v_profesional),
            '{mascota}', coalesce(v_mascota, '')),
          case when v_msg ->> 'd' = 'inbound' then 'received' else 'read' end,
          case when v_msg ->> 'd' = 'inbound' then '5690000' || lpad((v_i + case when p_mascotas then 3000 else 1000 end)::text, 4, '0') end,
          case when v_msg ->> 'd' = 'outbound' then v_agente end,
          v_t, v_t);
      end loop;

      update public.whatsapp_conversations
         set last_message_at = (select max(created_at) from public.whatsapp_messages where conversation_id = v_conv),
             last_inbound_at = (select max(created_at) from public.whatsapp_messages where conversation_id = v_conv and direction = 'inbound'),
             last_outbound_at = (select max(created_at) from public.whatsapp_messages where conversation_id = v_conv and direction = 'outbound')
       where id = v_conv;
    end if;
  end loop;

  return p_slug || ': ' || p_pacientes || ' personas sembradas';
end;
$$;

-- Atlas Dental -----------------------------------------------------------------

create or replace function demo_seed.sembrar_dental() returns text
language plpgsql as $sembrar$
begin
  return demo_seed.sembrar_clinica(
  'demo-dental', 'Clínica Dental Sonríe', 'dental', 'Clínica Dental Sonríe', 'sonrie.invalid',
  'Sonríe · Coordinación de pacientes', 'Sonríe · Pacientes',
  array['Francisca Leiva','Tomás Herrera','Constanza Pino'], 'Daniela Fuentes',
  array['Dra. Carolina Vidal','Dr. Matías Soto','Dra. Paula Ríos'],
  '{"evaluacion":25000,"limpieza":45000,"restauracion":55000,"endodoncia":220000,"implante":1350000,
    "ortodoncia":1900000,"blanqueamiento":180000,"protesis":650000}'::jsonb,
  '[{"codigo":"implante","nombre":"Implante pieza 36","monto":1350000},
    {"codigo":"implante","nombre":"Implante con corona pieza 14","monto":1550000},
    {"codigo":"ortodoncia","nombre":"Ortodoncia brackets estéticos","monto":1900000},
    {"codigo":"ortodoncia","nombre":"Ortodoncia con alineadores","monto":2800000},
    {"codigo":"endodoncia","nombre":"Endodoncia molar 46","monto":220000},
    {"codigo":"protesis","nombre":"Rehabilitación con prótesis removible","monto":650000},
    {"codigo":"blanqueamiento","nombre":"Blanqueamiento en clínica","monto":180000},
    {"codigo":"restauracion","nombre":"Tres restauraciones de resina","monto":165000},
    {"codigo":"limpieza","nombre":"Limpieza y destartraje","monto":45000}]'::jsonb,
  96, false,
  '[[{"d":"inbound","t":"Hola, ¿cuánto cuesta un implante?"},
     {"d":"outbound","t":"¡Hola {nombre}! Soy {agente}, de Clínica Sonríe. El valor exacto depende de la evaluación, que cuesta $25.000 y se descuenta del tratamiento. ¿Te acomoda el jueves a las 16:00?"},
     {"d":"inbound","t":"Sí, perfecto"},
     {"d":"outbound","t":"Listo, quedaste agendada el jueves a las 16:00 con {profesional}. Te enviaremos un recordatorio el día anterior."}],
    [{"d":"outbound","t":"Hola {nombre}, te recordamos tu cita de mañana a las 10:30 con {profesional}. Responde SÍ para confirmar o escríbenos si necesitas cambiarla."},
     {"d":"inbound","t":"Sí, confirmo"},
     {"d":"outbound","t":"¡Gracias! Te esperamos. Recuerda llegar 10 minutos antes."}],
    [{"d":"outbound","t":"Hola {nombre}, ¿alcanzaste a revisar el presupuesto que te enviamos? Podemos ofrecerte hasta 12 cuotas sin interés."},
     {"d":"inbound","t":"Lo estoy viendo con mi pareja, les aviso esta semana"},
     {"d":"outbound","t":"Perfecto, quedo atenta. Cualquier duda me escribes por acá."}],
    [{"d":"inbound","t":"Hola, me duele una muela desde ayer, ¿tienen hora hoy?"},
     {"d":"outbound","t":"Hola {nombre}, sí: tenemos una hora de urgencia hoy a las 18:15. ¿Te la reservo?"},
     {"d":"inbound","t":"Sí, porfa"},
     {"d":"outbound","t":"Reservada ✅ Llega 10 minutos antes y trae tu carnet."}],
    [{"d":"outbound","t":"Hola {nombre}, ya van 6 meses desde tu última limpieza. ¿Te agendo una hora este mes?"},
     {"d":"inbound","t":"Ya, ¿tienen algo el sábado en la mañana?"},
     {"d":"outbound","t":"Tengo el sábado a las 10:00 con {profesional}. ¿Te sirve?"},
     {"d":"inbound","t":"Perfecto"}]]'::jsonb,
  array['Llamar para resolver dudas del presupuesto','Enviar alternativas de pago en cuotas',
        'Confirmar hora de evaluación','Enviar recordatorio del presupuesto por WhatsApp',
        'Ofrecer convenio con su isapre','Agendar primera sesión']
);
end;
$sembrar$;

-- Atlas Vet --------------------------------------------------------------------

create or replace function demo_seed.sembrar_vet() returns text
language plpgsql as $sembrar$
begin
  return demo_seed.sembrar_clinica(
  'demo-vet', 'Veterinaria Patitas', 'vet', 'Veterinaria Patitas', 'patitas.invalid',
  'Patitas · Atención a tutores', 'Patitas · Tutores',
  array['Valentina Castro','Benjamín Reyes'], 'Ignacio Morales',
  array['Dra. Fernanda Lagos','Dr. Cristóbal Vega'],
  '{"consulta":22000,"vacuna":18000,"desparasitacion":12000,"esterilizacion":160000,"limpieza_dental":120000,
    "cirugia":450000,"examenes":55000,"peluqueria":25000}'::jsonb,
  '[{"codigo":"esterilizacion","nombre":"Esterilización","monto":160000},
    {"codigo":"limpieza_dental","nombre":"Limpieza dental con anestesia","monto":120000},
    {"codigo":"cirugia","nombre":"Cirugía de ligamento cruzado","monto":890000},
    {"codigo":"cirugia","nombre":"Extracción de masa cutánea","monto":380000},
    {"codigo":"vacuna","nombre":"Plan anual de vacunas","monto":54000},
    {"codigo":"examenes","nombre":"Exámenes preoperatorios","monto":55000},
    {"codigo":"examenes","nombre":"Chequeo senior con perfil bioquímico","monto":85000},
    {"codigo":"desparasitacion","nombre":"Plan de desparasitación anual","monto":48000}]'::jsonb,
  82, true,
  '[[{"d":"outbound","t":"Hola {nombre} 🐾 A {mascota} le toca su vacuna anual este mes. ¿Te agendo una hora con {profesional}?"},
     {"d":"inbound","t":"Sí, ¿puede ser el martes en la tarde?"},
     {"d":"outbound","t":"Listo: martes a las 17:30. Te llegará un recordatorio el día antes."}],
    [{"d":"inbound","t":"Hola, ¿cuánto cuesta esterilizar a mi gata?"},
     {"d":"outbound","t":"¡Hola {nombre}! Soy {agente}, de Veterinaria Patitas. La esterilización de gata cuesta $160.000 e incluye los controles posteriores. Antes hacemos exámenes preoperatorios. ¿Quieres que te agende?"},
     {"d":"inbound","t":"Lo voy a pensar, gracias"},
     {"d":"outbound","t":"Dale, te dejo el plan por acá para que lo revises con calma."}],
    [{"d":"outbound","t":"Hola {nombre}, te recordamos la hora de {mascota} mañana a las 11:00 con {profesional}. Responde SÍ para confirmar."},
     {"d":"inbound","t":"SÍ"},
     {"d":"outbound","t":"¡Gracias! Los esperamos."}],
    [{"d":"inbound","t":"{mascota} no ha querido comer desde ayer, ¿lo pueden ver hoy?"},
     {"d":"outbound","t":"Hola {nombre}, sí: tenemos un sobrecupo a las 19:00. Tráelo en ayunas, por favor."},
     {"d":"inbound","t":"Gracias, allá estaremos"}],
    [{"d":"outbound","t":"Hola {nombre}, ¿pudiste revisar el plan de tratamiento de {mascota}? Lo podemos dividir en 3 cuotas sin interés."},
     {"d":"inbound","t":"Sí, lo vamos a hacer. ¿Qué día hay cupo?"},
     {"d":"outbound","t":"Te propongo el viernes a las 9:00, en ayunas desde la noche anterior."}]]'::jsonb,
  array['Llamar al tutor para resolver dudas del plan','Enviar opciones de pago en cuotas',
        'Confirmar hora de cirugía','Recordar exámenes preoperatorios',
        'Enviar recordatorio de vacuna','Agendar control postoperatorio']
);
end;
$sembrar$;

-- Atlas Center -----------------------------------------------------------------
--
-- Un contact center con tres campañas (dos de venta y una de cobranza), un
-- equipo de ocho ejecutivos y 30 días de llamadas tipificadas. El estado en
-- vivo de los agentes se siembra con el último latido al momento de sembrar.

create or replace function demo_seed.sembrar_center() returns text
language plpgsql as $$
declare
  v_org uuid; v_equipo uuid; v_super uuid; v_canal uuid; v_cierre uuid;
  v_agentes uuid[] := '{}'; v_nombre text;
  v_campanas uuid[] := '{}'; v_campana uuid; v_vertical text; v_c int;
  v_lead uuid; v_i int; v_n int; v_k int; v_d int; v_agente uuid; v_equipo_campana uuid[];
  v_horas timestamptz[]; v_t timestamptz; v_r float;
  v_status text; v_outcome text; v_reason text; v_proxima timestamptz; v_venta boolean;
  v_persona text; v_conv uuid; v_guion jsonb; v_msg jsonb; v_cerrada boolean;
  v_razones jsonb;
  v_guiones jsonb := '[
    [{"d":"inbound","t":"Hola, vi el aviso de portabilidad. ¿Cuánto sale el plan de 40 GB?"},
     {"d":"outbound","t":"¡Hola {nombre}! Soy {agente}, de Andes. El plan de 40 GB queda en $9.990 los primeros 6 meses y mantienes tu número. ¿Te llamo para hacer la portabilidad?"},
     {"d":"inbound","t":"Sí, llámame después de las 6"},
     {"d":"outbound","t":"Perfecto, te llamo hoy a las 18:15."}],
    [{"d":"outbound","t":"Hola {nombre}, te escribe {agente} de Andes. Tu solicitud de portabilidad quedó ingresada ✅ El cambio se hace efectivo en 48 horas."},
     {"d":"inbound","t":"Genial, gracias"}],
    [{"d":"inbound","t":"¿El plan incluye roaming en Argentina?"},
     {"d":"outbound","t":"Hola {nombre}, sí: incluye 5 GB de roaming en Sudamérica. ¿Quieres que te envíe el detalle por correo?"},
     {"d":"inbound","t":"Dale"}]
  ]'::jsonb;
begin
  if exists (select 1 from public.organizations where slug = 'demo-center') then
    return 'demo-center: ya existe, se salta';
  end if;

  v_org := demo_seed.nueva_empresa('demo-center', 'Andes Contact Center', 'center');

  -- Estados de agente: el código es único en toda la base (no por empresa), así
  -- que la demo usa los que ya existen.
  select jsonb_object_agg(code, id) into v_razones
  from public.agent_status_reasons
  where code in ('disponible', 'almuerzo', 'descanso', 'desconectado');

  insert into public.teams (name, organization_id) values ('Andes · Plataforma comercial', v_org) returning id into v_equipo;
  v_super := demo_seed.persona(v_org, 'Rodrigo Paredes', demo_seed.correo_equipo('Rodrigo Paredes', 'andes.invalid'), 'supervisor', v_equipo);
  perform set_config('request.jwt.claims', json_build_object('sub', v_super, 'role', 'authenticated')::text, true);
  update public.teams set supervisor_id = v_super where id = v_equipo;
  insert into public.team_supervisors (team_id, supervisor_id) values (v_equipo, v_super) on conflict do nothing;

  foreach v_nombre in array array['Camila Araya','Diego Tapia','Javiera Soto','Matías Pizarro',
                                  'Fernanda Núñez','Sebastián Vergara','Antonia Carrasco','Nicolás Jara'] loop
    v_agentes := v_agentes || demo_seed.persona(v_org, v_nombre, demo_seed.correo_equipo(v_nombre, 'andes.invalid'), 'agente', v_equipo);
  end loop;

  -- Tres campañas. Cada ejecutivo trabaja una o dos.
  insert into public.campaigns (name, description, is_active, vertical, organization_id)
  values ('Andes · Seguro Hogar', 'Venta telefónica de seguro de hogar a base de clientes de retail.', true, 'ventas', v_org)
  returning id into v_campana; v_campanas := v_campanas || v_campana;
  insert into public.campaigns (name, description, is_active, vertical, organization_id)
  values ('Andes · Portabilidad Móvil', 'Captación de líneas móviles por portabilidad, con WhatsApp.', true, 'ventas', v_org)
  returning id into v_campana; v_campanas := v_campanas || v_campana;
  insert into public.campaigns (name, description, is_active, vertical, organization_id)
  values ('Andes · Cobranza Retail', 'Cobranza temprana de cartera de tarjetas de retail (30 a 90 días).', true, 'cobranza', v_org)
  returning id into v_campana; v_campanas := v_campanas || v_campana;

  insert into public.campaign_channels (campaign_id, channel, enabled)
  select unnest(v_campanas), 'phone', true;
  insert into public.campaign_channels (campaign_id, channel, enabled) values (v_campanas[2], 'whatsapp', true);

  insert into public.campaign_agents (campaign_id, profile_id)
  select v_campanas[1], unnest(v_agentes[1:3]) union all
  select v_campanas[2], unnest(v_agentes[3:6]) union all
  select v_campanas[3], unnest(v_agentes[6:8]);

  for v_c in 1 .. 3 loop
    v_campana := v_campanas[v_c];
    v_vertical := case when v_c = 3 then 'cobranza' else 'ventas' end;
    v_equipo_campana := case v_c when 1 then v_agentes[1:3] when 2 then v_agentes[3:6] else v_agentes[6:8] end;

    for v_i in 1 .. 320 loop
      v_persona := demo_seed.nombre_persona();
      insert into public.leads (full_name, phone, email, campaign_id, organization_id, team_id, status,
                                workflow_status, assignment_status, created_at)
      values (v_persona, demo_seed.telefono(5000 + v_c * 1000 + v_i - 1000), demo_seed.correo_de(v_persona, v_c * 1000 + v_i),
              v_campana, v_org, v_equipo, 'nuevo', 'pending', 'unassigned',
              now() - interval '32 days' + random() * interval '2 days')
      returning id into v_lead;

      -- Una de cada cinco sigue sin gestionar: es la base que queda por llamar.
      continue when random() < 0.2;

      v_agente := v_equipo_campana[1 + floor(random() * array_length(v_equipo_campana, 1))::int];
      v_n := 1 + floor(random() * 4)::int;
      select array_agg(h order by h) into v_horas from (
        select demo_seed.hora_habil(d + case extract(isodow from (now() at time zone 'America/Santiago')::date - d)
                                           when 6 then 1 when 7 then 2 else 0 end) as h
        from (select floor(power(random(), 1.4) * 29)::int as d from generate_series(1, v_n)) dias
      ) horas;

      v_venta := false; v_proxima := null;
      for v_k in 1 .. array_length(v_horas, 1) loop
        v_t := v_horas[v_k];
        v_r := random();
        if v_r < 0.30 then v_status := 'no_answer'; v_outcome := 'other'; v_reason := 'NO CONTESTA';
        elsif v_r < 0.40 then v_status := 'voicemail'; v_outcome := 'other'; v_reason := 'BUZON DE VOZ';
        elsif v_r < 0.44 then v_status := 'busy'; v_outcome := 'other'; v_reason := 'TELEFONO OCUPADO';
        elsif v_r < 0.46 then v_status := 'out_of_service'; v_outcome := 'other'; v_reason := 'TELEFONO FUERA DE SERVICIO';
        elsif v_r < 0.70 then
          v_status := 'connected'; v_outcome := 'not_interested';
          v_reason := case when v_vertical = 'cobranza'
            then demo_seed.azar(array['SIN CAPACIDAD DE PAGO','NO RECONOCE DEUDA','CONTACTO CON TERCERO'])
            else demo_seed.azar(array['NO INTERESA','NO LO NECESITA','YA TIENE EL SERVICIO','PRECIO']) end;
        elsif v_r < 0.82 then
          v_status := 'connected'; v_outcome := 'interested';
          -- Negociación exige agenda: solo si es reciente, con su seguimiento.
          v_reason := case when v_vertical = 'cobranza' and v_t > now() - interval '4 days' then 'NEGOCIACION EN CURSO'
                           when v_vertical = 'cobranza' then 'SE ENVIA INFORMACION'
            else demo_seed.azar(array['COTIZACION ENVIADA','SE ENVIA INFORMACION']) end;
        elsif v_r < 0.90 and v_t > now() - interval '4 days' then
          v_status := 'connected'; v_outcome := 'callback';
          v_reason := case when v_vertical = 'cobranza' then 'COMPROMISO DE PAGO' else 'VOLVER A LLAMAR' end;
        elsif v_r < 0.90 then
          v_status := 'connected'; v_outcome := 'not_interested'; v_reason := 'NO DA MOTIVO';
        else
          v_status := 'connected'; v_outcome := 'sale';
          v_reason := case when v_vertical = 'cobranza'
            then demo_seed.azar(array['CONVENIO SUSCRITO','PAGO YA REALIZADO']) else 'VENTA CERRADA' end;
          v_venta := true;
        end if;
        v_proxima := case when v_outcome = 'callback' or v_reason = 'NEGOCIACION EN CURSO' then demo_seed.hora_futura(1 + floor(random() * 3)::int) end;

        insert into public.calls (lead_id, agent_id, status, outcome, reason, started_at, ended_at, next_action_at, created_at)
        values (v_lead, v_agente, v_status, v_outcome, v_reason, v_t,
                v_t + (15 + floor(random() * case when v_status = 'connected' then 420 else 30 end)) * interval '1 second',
                v_proxima, v_t);
        insert into public.interactions (lead_id, agent_id, result, created_at)
        values (v_lead, v_agente, v_reason, v_t + interval '3 minutes');
        exit when v_venta or v_outcome = 'not_interested';
      end loop;

      update public.leads
         set assigned_to = v_agente, managed_by = v_agente, managed_at = v_t,
             status = case when v_venta then 'convertido' else 'nuevo' end,
             workflow_status = case when v_proxima is not null then 'callback' else 'managed' end,
             assignment_status = 'managed',
             tipificacion_actual = v_reason,
             next_action_at = v_proxima,
             next_action_channel = 'phone'
       where id = v_lead;

      -- En portabilidad, uno de cada ocho además conversa por WhatsApp.
      if v_c = 2 and random() < 0.13 then
        if v_canal is null then
          insert into public.whatsapp_channels (waba_id, phone_number_id, display_phone_number, business_name, status, organization_id)
          values ('demo-demo-center', 'demo-demo-center-0001', '+56 9 0000 0000', 'Andes Contact Center', 'paused', v_org)
          returning id into v_canal;
          insert into public.whatsapp_closure_reasons (campaign_id, code, label, sort_order)
          values (v_campana, 'resuelto', 'Consulta resuelta', 10) returning id into v_cierre;
        end if;
        v_guion := v_guiones -> floor(random() * jsonb_array_length(v_guiones))::int;
        v_cerrada := random() < 0.55;
        v_t := least(v_t, now() - interval '3 hours');
        insert into public.whatsapp_conversations (channel_id, campaign_id, lead_id, contact_wa_id, contact_phone, contact_name,
          assigned_to, status, unread_count, ai_state, created_at, close_reason_id, closed_at, closed_by)
        values (v_canal, v_campana, v_lead, '5690000' || lpad((5000 + v_c * 1000 + v_i - 1000)::text, 4, '0'),
          demo_seed.telefono(5000 + v_c * 1000 + v_i - 1000), v_persona, v_agente,
          case when v_cerrada then 'closed' else 'open' end, 0, 'paused', v_t,
          case when v_cerrada then v_cierre end, case when v_cerrada then v_t + interval '30 minutes' end,
          case when v_cerrada then v_agente end)
        returning id into v_conv;
        for v_msg in select * from jsonb_array_elements(v_guion) loop
          v_t := v_t + (1 + floor(random() * 6)) * interval '1 minute';
          insert into public.whatsapp_messages (conversation_id, provider_message_id, direction, message_type, text_body,
            status, sender_wa_id, sent_by, provider_timestamp, created_at)
          values (v_conv, 'demo-' || gen_random_uuid(), v_msg ->> 'd', 'text',
            replace(replace(v_msg ->> 't', '{nombre}', split_part(v_persona, ' ', 1)),
              '{agente}', split_part((select full_name from public.profiles where id = v_agente), ' ', 1)),
            case when v_msg ->> 'd' = 'inbound' then 'received' else 'read' end,
            case when v_msg ->> 'd' = 'inbound' then '5690000' || lpad((5000 + v_c * 1000 + v_i - 1000)::text, 4, '0') end,
            case when v_msg ->> 'd' = 'outbound' then v_agente end, v_t, v_t);
        end loop;
        update public.whatsapp_conversations
           set last_message_at = (select max(created_at) from public.whatsapp_messages where conversation_id = v_conv),
               last_inbound_at = (select max(created_at) from public.whatsapp_messages where conversation_id = v_conv and direction = 'inbound'),
               last_outbound_at = (select max(created_at) from public.whatsapp_messages where conversation_id = v_conv and direction = 'outbound')
         where id = v_conv;
      end if;
    end loop;
  end loop;

  -- Cómo está el piso al momento de sembrar: cinco disponibles, dos en pausa, uno fuera.
  insert into public.agent_current_status (profile_id, reason_id, since, updated_at, last_heartbeat_at)
  select agente, (v_razones ->> estado)::uuid, now() - (5 + floor(random() * 70)) * interval '1 minute', now(), now()
  from unnest(v_agentes, array['disponible','disponible','almuerzo','disponible','descanso','disponible','disponible','desconectado'])
       as piso(agente, estado);

  return 'demo-center: 960 registros en 3 campañas, 8 ejecutivos';
end;
$$;

-- Las tres juntas ----------------------------------------------------------------

create or replace function demo_seed.sembrar_todo() returns text
language plpgsql as $$
begin
  perform setseed(0.2109);
  return demo_seed.sembrar_dental() || E'\n' || demo_seed.sembrar_vet() || E'\n' || demo_seed.sembrar_center();
end;
$$;

revoke all on all functions in schema demo_seed from public, anon, authenticated;
