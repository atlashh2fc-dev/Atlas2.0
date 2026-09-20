-- El vigilante estaba midiendo la cosa equivocada, y tapando lo que buscaba.
--
-- Contaba "envíos" con lead_mail_status.first_seen_at, que sólo se mueve la
-- primera vez que un contacto aparece. Una campaña de seguimiento a gente ya
-- conocida no mueve ese campo nunca: el vigilante la daba por muerta. Y al
-- revés, reingerir un lote viejo la habría dado por viva.
--
-- Peor: la revisión 6, la que existe justamente para cazar campañas mudas,
-- correlacionaba por mc.campaign_id — el id INTERNO del CRM. Las seis campañas
-- externas de altius cuelgan del mismo campaign_id interno, así que bastaba que
-- una hubiera enviado para que las seis pasaran. Hoy hay cuatro campañas que no
-- han enviado un solo correo desde que se crearon, y el informe las daba en
-- verde: "Toda campaña activa ya entregó al menos un contacto."
--
-- La proyección hermana mail_campaign_lead_status sí distingue por campaña
-- externa (mail_campaign_id). Es la tabla que había que mirar desde el principio.
--
-- También: 'ultimo_movimiento' salía siempre nulo cuando había alerta, porque el
-- max() se calculaba dentro del mismo select ya filtrado a 24 horas. Sin filas,
-- no hay máximo. Justo el dato que convierte "nadie recibió correo" en "el
-- último envío fue hace siete días" era el que nunca llegaba.
--
-- Y la ventana de 24 horas era insatisfacible: Atlas Lead no reporta a diario,
-- reporta en ráfagas cada varios días. Rojo permanente enseña a ignorar el
-- informe. Ahora 24h sigue siendo verde, 24-72h es aviso, y sólo más de 72h
-- es alerta.

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
  v_campanas_activas int;
  v_campanas_con_envio int;
  v_campanas_mudas text[];
  v_ultimo_envio timestamptz;
  v_horas_sin_envio numeric;
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

  -- 1. Envíos: se mide por campaña externa y por last_seen_at, que sí se mueve
  --    en cada reporte. Y se nombra a la campaña muda, porque "6 campañas
  --    activas" sin decir cuál no le sirve a nadie a las siete de la mañana.
  select
    count(*),
    count(*) filter (
      where exists (
        select 1 from public.mail_campaign_lead_status s
        where s.mail_campaign_id = mc.id
          and s.sent_count > 0
          and s.last_seen_at > now() - interval '24 hours'
      )
    ),
    max((select max(s.last_seen_at) from public.mail_campaign_lead_status s
         where s.mail_campaign_id = mc.id and s.sent_count > 0)),
    coalesce(
      array_agg(mc.name order by mc.name) filter (
        where not exists (
          select 1 from public.mail_campaign_lead_status s
          where s.mail_campaign_id = mc.id and s.sent_count > 0
        )
      ),
      '{}'::text[]
    )
  into v_campanas_activas, v_campanas_con_envio, v_ultimo_envio, v_campanas_mudas
  from public.mail_campaigns mc
  join public.campaigns c on c.id = mc.campaign_id
  where c.organization_id = v_org and mc.status = 'active';

  v_horas_sin_envio := case
    when v_ultimo_envio is null then null
    else round(extract(epoch from (now() - v_ultimo_envio)) / 3600.0)
  end;

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Envíos de correo',
    'estado', case
      when v_campanas_activas = 0 then 'sin_datos'
      when v_campanas_con_envio > 0 then 'ok'
      when v_ultimo_envio > now() - interval '72 hours' then 'aviso'
      else 'alerta' end,
    'detalle', case
      when v_campanas_activas = 0 then
        'No hay campañas de correo activas en esta empresa.'
      when v_campanas_con_envio > 0 then
        v_campanas_con_envio || ' de ' || v_campanas_activas ||
        ' campaña(s) activa(s) movieron envío en las últimas 24 horas.'
      when v_ultimo_envio is null then
        'Ninguna de las ' || v_campanas_activas ||
        ' campaña(s) activa(s) ha enviado un solo correo desde que se creó: ' ||
        array_to_string(v_campanas_mudas, '; ') ||
        '. Revisar que los leads tengan auditoría y que el envío no esté frenado.'
      else
        'Ninguna campaña movió envío en 24 horas; el último fue hace ' ||
        v_horas_sin_envio || ' horas.' ||
        case when cardinality(v_campanas_mudas) > 0
          then ' Sin enviar nunca: ' || array_to_string(v_campanas_mudas, '; ') || '.'
          else '' end
    end,
    'ultimo_movimiento', v_ultimo_envio
  );

  -- 2. Interés detectado que el calificador no convirtió en negocio.
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

  -- 3. Frontera de empresa: un lead viviendo en la empresa equivocada.
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

  -- 4. Políticas apuntando a la función sin guardia (el fallo que tumbó Correo).
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

  -- 5. Trabajo vencido: negocios con la próxima acción pasada.
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

  -- 6. Campañas que nunca entregaron nada. Se correlaciona por mail_campaign_id:
  --    por campaña externa, no por el id interno que comparten todas.
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

  -- 7. El puente con Atlas Lead. El canario lo sabía hace días y nadie lo leía:
  --    un circuito abierto no se nota en las cifras, se nota en que no llega
  --    nada. Es infraestructura compartida, por eso no va filtrado por empresa.
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
