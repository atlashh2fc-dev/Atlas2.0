-- El vigilante: busca silencios, no errores.
--
-- Los dos fallos de esta semana no gritaron. La campaña enviaba cero correos y
-- decía "éxito". El sincronizador del buzón reportaba verde sin credenciales.
-- Un sistema que trabaja solo no falla con una excepción: falla quedándose
-- callado, y nadie lo nota hasta que pasan semanas sin un cliente.
--
-- Cada revisión compara lo que debería estar pasando con lo que pasó. Si algo
-- debería moverse y no se movió, eso es la alarma.
--
-- El cuerpo aplicado en producción vive en la función; este archivo lo deja en
-- el repositorio para que la próxima base nazca igual.

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
  v_envios_24h int;
  v_ultimo_envio timestamptz;
  v_aperturas_sin_calificar int;
  v_leads_desalineados int;
  v_politicas_rotas int;
  v_vencidos int;
  v_lote_en_espera int;
begin
  if v_org is null then
    raise exception 'La empresa % no existe', p_organization_slug;
  end if;

  -- 1. Hay campañas de correo activas pero nadie recibió nada.
  select count(*) into v_campanas_activas
  from public.mail_campaigns mc
  join public.campaigns c on c.id = mc.campaign_id
  where c.organization_id = v_org and mc.status = 'active';

  select count(*), max(first_seen_at) into v_envios_24h, v_ultimo_envio
  from public.lead_mail_status lms
  join public.campaigns c on c.id = lms.campaign_id
  where c.organization_id = v_org and lms.first_seen_at > now() - interval '24 hours';

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Envíos de correo',
    'estado', case
      when v_campanas_activas = 0 then 'sin_datos'
      when v_envios_24h > 0 then 'ok'
      else 'alerta' end,
    'detalle', case
      when v_campanas_activas = 0 then 'No hay campañas de correo activas en esta empresa.'
      when v_envios_24h > 0 then v_envios_24h || ' contactos nuevos recibieron correo en las últimas 24 horas.'
      else 'Hay ' || v_campanas_activas || ' campaña(s) activa(s) y nadie recibió correo en 24 horas. Revisar que los leads tengan auditoría y que el envío no esté frenado.'
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

  -- 6. Campañas enlazadas al CRM pero sin recibir nada nunca.
  select count(*) into v_lote_en_espera
  from public.mail_campaigns mc
  join public.campaigns c on c.id = mc.campaign_id
  where c.organization_id = v_org and mc.status = 'active'
    and not exists (
      select 1 from public.lead_mail_status lms where lms.campaign_id = mc.campaign_id
    );

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Campañas que nunca enviaron',
    'estado', case when v_lote_en_espera = 0 then 'ok' else 'aviso' end,
    'detalle', case
      when v_lote_en_espera = 0 then 'Toda campaña activa ya entregó al menos un contacto.'
      else v_lote_en_espera || ' campaña(s) activas no han entregado un solo contacto desde que se crearon.'
    end
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

-- Lo que el equipo produjo, para poder decir si el día valió la pena.
create or replace function public.resumen_del_dia(p_organization_slug text)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with org as (select public.organization_id_by_slug(p_organization_slug) as id)
  select jsonb_build_object(
    'empresa', p_organization_slug,
    'contactos_nuevos', (
      select count(*) from public.lead_mail_status lms
      join public.campaigns c on c.id = lms.campaign_id
      where c.organization_id = (select id from org) and lms.first_seen_at > now() - interval '24 hours'),
    'aperturas', (
      select count(*) from public.lead_mail_status lms
      join public.campaigns c on c.id = lms.campaign_id
      where c.organization_id = (select id from org) and lms.opened
        and lms.updated_at > now() - interval '24 hours'),
    'clics', (
      select count(*) from public.lead_mail_status lms
      join public.campaigns c on c.id = lms.campaign_id
      where c.organization_id = (select id from org) and lms.clicked
        and lms.updated_at > now() - interval '24 hours'),
    'negocios_nuevos', (
      select count(*) from public.sales_opportunities
      where organization_id = (select id from org) and created_at > now() - interval '24 hours'),
    'reuniones_agendadas', (
      select count(*) from public.sales_activities
      where organization_id = (select id from org) and kind = 'reunion'
        and created_at > now() - interval '24 hours'),
    'negocios_abiertos', (
      select count(*) from public.sales_opportunities
      where organization_id = (select id from org) and status = 'abierta'),
    'para_hoy', (
      select count(*) from public.sales_opportunities
      where organization_id = (select id from org) and status = 'abierta'
        and next_action_at is not null and next_action_at < now() + interval '1 day')
  );
$$;

revoke all on function public.verificar_procesos_de_empresa(text) from public;
revoke all on function public.resumen_del_dia(text) from public;
revoke execute on function public.verificar_procesos_de_empresa(text) from anon;
revoke execute on function public.resumen_del_dia(text) from anon;
grant execute on function public.verificar_procesos_de_empresa(text) to authenticated, service_role;
grant execute on function public.resumen_del_dia(text) to authenticated, service_role;
