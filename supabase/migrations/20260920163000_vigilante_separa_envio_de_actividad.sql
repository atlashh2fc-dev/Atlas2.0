-- Una apertura no es un envío.
--
-- La revisión anterior daba por viva una campaña si alguna de sus filas tenía
-- last_seen_at reciente y sent_count > 0. Suena razonable hasta que pasa lo que
-- pasó hoy: a las 15:48 llegó una apertura de un correo enviado seis días antes.
-- sent_count seguía en 74, exactamente igual que el día anterior. Nadie envió
-- nada. Y el informe se puso verde.
--
-- Recibir y enviar son dos cosas distintas y hay que medirlas por separado:
--   - envío     -> first_seen_at, que marca cuándo se alcanzó a ese contacto
--   - actividad -> last_seen_at, que se mueve con cualquier apertura o clic
--
-- Y el estado intermedio merece existir. "El circuito recibe pero no envía" es
-- un diagnóstico, no un rojo ni un verde: dice que el puente está vivo y que lo
-- detenido es el envío. Mandar eso a rojo junto con todo lo demás pierde la
-- única parte útil de la frase.

create or replace function public.verificar_envios_de_correo(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_activas int;
  v_con_envio int;
  v_con_actividad int;
  v_ultimo_envio timestamptz;
  v_ultima_actividad timestamptz;
  v_mudas text[];
  v_horas numeric;
begin
  select
    count(*),
    count(*) filter (
      where exists (
        select 1 from public.mail_campaign_lead_status s
        where s.mail_campaign_id = mc.id
          and s.sent_count > 0
          and s.first_seen_at > now() - interval '24 hours'
      )
    ),
    count(*) filter (
      where exists (
        select 1 from public.mail_campaign_lead_status s
        where s.mail_campaign_id = mc.id
          and s.last_seen_at > now() - interval '24 hours'
      )
    ),
    max((select max(s.first_seen_at) from public.mail_campaign_lead_status s
         where s.mail_campaign_id = mc.id and s.sent_count > 0)),
    max((select max(s.last_seen_at) from public.mail_campaign_lead_status s
         where s.mail_campaign_id = mc.id)),
    coalesce(
      array_agg(mc.name order by mc.name) filter (
        where not exists (
          select 1 from public.mail_campaign_lead_status s
          where s.mail_campaign_id = mc.id and s.sent_count > 0
        )
      ),
      '{}'::text[]
    )
  into v_activas, v_con_envio, v_con_actividad, v_ultimo_envio, v_ultima_actividad, v_mudas
  from public.mail_campaigns mc
  join public.campaigns c on c.id = mc.campaign_id
  where c.organization_id = p_org and mc.status = 'active';

  v_horas := case
    when v_ultimo_envio is null then null
    else round(extract(epoch from (now() - v_ultimo_envio)) / 3600.0)
  end;

  return jsonb_build_object(
    'revision', 'Envíos de correo',
    'estado', case
      when v_activas = 0 then 'sin_datos'
      when v_con_envio > 0 then 'ok'
      when v_ultimo_envio > now() - interval '72 hours' then 'aviso'
      when v_con_actividad > 0 then 'aviso'
      else 'alerta' end,
    'detalle', case
      when v_activas = 0 then
        'No hay campañas de correo activas en esta empresa.'
      when v_con_envio > 0 then
        v_con_envio || ' de ' || v_activas ||
        ' campaña(s) activa(s) alcanzaron contactos nuevos en las últimas 24 horas.'
      when v_ultimo_envio is null then
        'Ninguna de las ' || v_activas ||
        ' campaña(s) activa(s) ha enviado un solo correo desde que se creó: ' ||
        array_to_string(v_mudas, '; ') ||
        '. Revisar que los leads tengan auditoría y que el envío no esté frenado.'
      else
        'Ninguna campaña alcanzó un contacto nuevo en 24 horas; el último envío fue hace ' ||
        v_horas || ' horas.' ||
        case when v_con_actividad > 0
          then ' Sí hubo aperturas o clics sobre correos ya enviados, así que el circuito recibe, pero no envía.'
          else '' end ||
        case when cardinality(v_mudas) > 0
          then ' Sin enviar nunca: ' || array_to_string(v_mudas, '; ') || '.'
          else '' end
    end,
    'ultimo_movimiento', v_ultimo_envio,
    'ultima_actividad', v_ultima_actividad
  );
end;
$$;

-- La revisión de envíos sale del cuerpo principal: era el bloque más largo y el
-- que más va a seguir cambiando mientras Atlas Lead no reporte a diario.

create or replace function public.verificar_procesos_de_empresa(p_organization_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid := public.organization_id_by_slug(p_organization_slug);
  v_revisiones jsonb := '[]'::jsonb;
  v_campanas_mudas text[];
  v_aperturas_sin_calificar int;
  v_leads_desalineados int;
  v_politicas_rotas int;
  v_vencidos int;
  v_lote_en_espera int;
  v_circuitos_abiertos int;
  v_ultimo_lote timestamptz;
  v_dias_sin_lote numeric;
begin
  if v_org is null then
    raise exception 'La empresa % no existe', p_organization_slug;
  end if;

  select coalesce(
    array_agg(mc.name order by mc.name) filter (
      where not exists (
        select 1 from public.mail_campaign_lead_status s
        where s.mail_campaign_id = mc.id and s.sent_count > 0
      )
    ),
    '{}'::text[]
  )
  into v_campanas_mudas
  from public.mail_campaigns mc
  join public.campaigns c on c.id = mc.campaign_id
  where c.organization_id = v_org and mc.status = 'active';

  v_revisiones := v_revisiones || public.verificar_envios_de_correo(v_org);

  select count(*) into v_aperturas_sin_calificar
  from public.lead_mail_status lms
  join public.campaigns c on c.id = lms.campaign_id
  join public.leads l on l.id = lms.lead_id
  where c.organization_id = v_org
    and (lms.opened or lms.clicked)
    and lms.updated_at < now() - interval '2 hours'
    and not exists (
      select 1 from public.sales_activities a
      where a.organization_id = v_org and a.metadata->>'lead_id' = l.id::text
    );

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Interés convertido en negocio',
    'estado', case when v_aperturas_sin_calificar = 0 then 'ok' else 'alerta' end,
    'detalle', case
      when v_aperturas_sin_calificar = 0 then 'Toda apertura o clic con más de dos horas ya está en el embudo.'
      else v_aperturas_sin_calificar || ' persona(s) mostraron interés hace más de dos horas y no tienen negocio en el embudo. El calificador no está corriendo.'
    end
  );

  select count(*) into v_leads_desalineados
  from public.leads l
  join public.campaigns c on c.id = l.campaign_id
  where l.organization_id is distinct from c.organization_id;

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Frontera entre empresas',
    'estado', case when v_leads_desalineados = 0 then 'ok' else 'alerta' end,
    'detalle', case
      when v_leads_desalineados = 0 then 'Ningún registro quedó en una empresa distinta a la de su campaña.'
      else v_leads_desalineados || ' registro(s) están marcados con otra empresa: datos visibles para quien no corresponde.'
    end
  );

  select count(*) into v_politicas_rotas
  from pg_policies
  where schemaname = 'public'
    and (qual like '%\_sin\_empresa%' or with_check like '%\_sin\_empresa%');

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Permisos de lectura',
    'estado', case when v_politicas_rotas = 0 then 'ok' else 'alerta' end,
    'detalle', case
      when v_politicas_rotas = 0 then 'Ninguna política apunta a una función sin permiso de ejecución.'
      else v_politicas_rotas || ' política(s) llaman a una función que nadie puede ejecutar: esas pantallas van a responder error.'
    end
  );

  select count(*) into v_vencidos
  from public.sales_opportunities
  where organization_id = v_org and status = 'abierta'
    and next_action_at is not null and next_action_at < now();

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Trabajo pendiente',
    'estado', case when v_vencidos = 0 then 'ok' when v_vencidos <= 10 then 'aviso' else 'alerta' end,
    'detalle', case
      when v_vencidos = 0 then 'Ningún negocio tiene la próxima acción vencida.'
      else v_vencidos || ' negocio(s) tienen la próxima acción vencida y esperan gestión.'
    end
  );

  select count(*) into v_lote_en_espera
  from public.mail_campaigns mc
  join public.campaigns c on c.id = mc.campaign_id
  where c.organization_id = v_org
    and mc.status = 'active'
    and mc.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.mail_campaign_lead_status s
      where s.mail_campaign_id = mc.id
    );

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Campañas que nunca enviaron',
    'estado', case when v_lote_en_espera = 0 then 'ok' else 'alerta' end,
    'detalle', case
      when v_lote_en_espera = 0 then 'Toda campaña activa ya entregó al menos un contacto.'
      else v_lote_en_espera || ' campaña(s) activas no han entregado un solo contacto desde que se crearon: ' ||
           array_to_string(v_campanas_mudas, '; ') || '.'
    end
  );

  select count(*) filter (where cs.state = 'open')
  into v_circuitos_abiertos
  from public.integration_circuit_states cs;

  select max(b.accepted_at) into v_ultimo_lote
  from public.integration_inbox_batches b
  where b.campaign_key is not null;

  v_dias_sin_lote := case
    when v_ultimo_lote is null then null
    else round(extract(epoch from (now() - v_ultimo_lote)) / 86400.0)
  end;

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Puente con Atlas Lead',
    'estado', case
      when v_circuitos_abiertos > 0 then 'alerta'
      when v_ultimo_lote is null or v_dias_sin_lote > 3 then 'aviso'
      else 'ok' end,
    'detalle', case
      when v_circuitos_abiertos > 0 then
        v_circuitos_abiertos || ' circuito(s) de salida abiertos: lo que Atlas devuelve a Atlas Lead no está llegando. Revisar INTEGRATION_OUTBOX_DESTINATIONS_JSON.'
      when v_ultimo_lote is null then
        'Atlas Lead nunca ha reportado un lote de campaña.'
      when v_dias_sin_lote > 3 then
        'Atlas Lead no reporta un lote con campaña desde hace ' || v_dias_sin_lote || ' días.'
      else
        'El puente responde; último lote con campaña hace ' || v_dias_sin_lote || ' día(s).'
    end,
    'ultimo_movimiento', v_ultimo_lote
  );

  return jsonb_build_object(
    'empresa', p_organization_slug,
    'revisado_at', now(),
    'alertas', (select count(*) from jsonb_array_elements(v_revisiones) r where r->>'estado' = 'alerta'),
    'avisos', (select count(*) from jsonb_array_elements(v_revisiones) r where r->>'estado' = 'aviso'),
    'revisiones', v_revisiones
  );
end;
$$;
