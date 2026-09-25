-- Ventas Equifax de abril a agosto de 2026, aprobadas en definitiva por
-- Equifax (planilla de operación entregada el 25-09-2026, 58 filas).
--
-- Cada fila queda como una venta aprobada en su período, no en septiembre:
--
--   * Si el registro ya tenía la venta (pendiente o aprobada), se usa esa: se
--     aprueba si estaba pendiente y la UF queda la de la planilla, que es la
--     que Equifax aprobó. Una llamada real conserva su fecha.
--   * Si la venta la había registrado supervisión hoy (gestión sin llamada),
--     se lleva a la fecha y al ejecutivo de la planilla.
--   * Si el registro no tenía la venta, se agrega la gestión VENTA EN
--     VALIDACION con la fecha de la planilla (mediodía de Chile), acreditada al
--     ejecutivo de la planilla, y se aprueba. El reporte la cuenta en ese día.
--   * Tres empresas no estaban en la base (M V Gestión Inteligente, Geoadvisors
--     y Credhipo): se crean en la campaña Equifax, ya gestionadas.
--
-- Las ventas pendientes que sobran en esos registros (la misma venta
-- tipificada dos veces) no se tocan: quedan en la cola para que supervisión
-- las rechace.
--
-- Casos resueltos a mano: «SBO Servicios Administrativos» (78.008.955-5) es la
-- venta DataFinder tipificada en «De La Cruz SpA» (77.810.964-6, mismo
-- teléfono); «Procel Servicios» está en un registro sin RUT. Tres fechas de la
-- planilla decían 2027 (REPIN, Comercial Monkey, Autocolor Paez): son 2026.
--
-- La carga corre a nombre del admin que la pidió (Hugo): las reglas de cierre
-- de una gestión validan la empresa del usuario. La decisión queda con
-- decision_source = 'planilla', la fila de la planilla en la nota
-- («[fila n]») y en crm_audit_events. Idempotente: una fila ya
-- cargada no se vuelve a cargar.

create temp table planilla_equifax (
  n integer primary key,
  ejecutivo text not null,
  rut_key text not null,
  rut text not null,
  razon_social text not null,
  tipo_contrato text,
  producto text,
  productos text[] not null,
  uf numeric not null,
  contacto text,
  telefono text,
  fecha_venta date not null,
  mes_cierre text,
  rut_registro text,
  nombre_registro text
) on commit drop;

insert into planilla_equifax values
  (1, 'Elsa Calderon', '766817211', '76.681.721-1', 'SERVICIOS Y PROYECTOS DE TECNOLOGIA PRORED ZONA NORTE LIMITADA', 'PAGO ANTICIPADO BOLSA', 'BOLSA REPORTE INTERACTIVO', array['Bolsa RI'], 3, null, null, date '2026-04-06', 'ABRIL', null, null),
  (2, 'Elsa Calderon', '762328097', '76.232.809-7', 'IMPERMEABILIZACIONES RUDY ECHEVERRIA POBLETE EMPRESA INDIVIDUAL DE RESPONSABILID', 'RECURRENTE', 'BUNDLE ILIMITADO', array['Bundle MC Ilimitado'], 3, null, null, date '2026-04-07', 'ABRIL', null, null),
  (3, 'Karen Ordoñez', '777255436', '77.725.543-6', 'M V GESTION INTELIGENTE SPA', 'ONE TIME', 'BBDD', array['BBDD'], 12, null, null, date '2026-04-10', 'ABRIL', null, null),
  (4, 'Andrea Soledad Zuñiga Bustos', '770863015', '77.086.301-5', 'DZF CERTIFICA', 'RECURRENTE', 'BUNDLE ILIMITADO', array['Bundle MC Ilimitado'], 3.4, 'Daniel Zambrano F', '56(9) 51699440', date '2026-04-14', 'ABRIL', null, null),
  (5, 'Andrea Soledad Zuñiga Bustos', '771321526', '77.132.152-6', 'ELECTROMECANICA E INGENIERIA ESEM SPA', 'RECURRENTE', 'RI', array['Q Consultas'], 1, null, '991586772', date '2026-04-14', 'ABRIL', null, null),
  (6, 'Karen Ordoñez', '768068569', '76.806.856-9', 'TRANSPORTES KORTMANN SPA', 'RECURRENTE', 'BUNDLE ILIMITADO', array['Bundle MC Ilimitado'], 3, 'Paola Kortmann', '998861462', date '2026-04-14', 'ABRIL', null, null),
  (7, 'Cristian Rodriguez', '771798942', '77.179.894-2', 'GEOADVISORS SPA', 'ONE TIME', 'BBDD', array['BBDD'], 25, null, null, date '2026-04-16', 'ABRIL', null, null),
  (8, 'Isabel Zamorano', '774277811', '77.427.781-1', 'ICONEXION CAPITAL SPA', 'RECURRENTE', 'BUNDLE ILIMITADO + 10 RI', array['Bundle MC Ilimitado','Reporte Interactivo'], 3, 'ICONEXION CAPITAL SPA', '981392926', date '2026-04-22', 'ABRIL', null, null),
  (9, 'Ximena Cofre', '764273192', '76.427.319-2', 'INVERSIONES JJM SPA', 'RECURRENTE', 'BUNDLE ILIMITADO+RI', array['Bundle MC Ilimitado','Reporte Interactivo'], 4.5, 'INVERSIONES JJM SPA', null, date '2026-04-24', 'ABRIL', null, null),
  (10, 'Marcela Liliana Mora Morales', '765451728', '76.545.172-8', 'IXXOS SPA', 'RECURRENTE', 'BUNDLE ILIMITADO+ RI10', array['Bundle MC Ilimitado','Reporte Interactivo'], 3.5, null, null, date '2026-04-27', 'ABRIL', null, null),
  (11, 'Isabel Zamorano', '760036110', '76.003.611-0', 'SOCIEDAD DE INVERSIONES Y TRANSPORTES BARRAZA LIMITADA', 'RECURRENTE', 'BUNDLE ILIMITADO', array['Bundle MC Ilimitado'], 3, null, '977496092', date '2026-04-20', 'MAYO', null, null),
  (12, 'Jose Miguel Sanhueza Villegas', '762275066', '76.227.506-6', 'IMPORTADORA DISTRIBUIDORA Y COMERCIALIZADORA DE ARTICULOS PROMOCIONALES Y SERVICIOS PUBLICITARIOS ARANDANO LIMITADA', 'PUBLICACION UNICA', 'PUBLICACION UNICA', array['Documento Unico'], 0.8, null, null, date '2026-04-17', 'MAYO', null, null),
  (13, 'Marcelo Enrique Araneda Bravo', '777840304', '77.784.030-4', 'SOC CASTRO Y RETAMAL LIMITADA', 'ONE TIME', 'Bolsa RI', array['Bolsa RI'], 5, 'SOC CASTRO Y RETAMAL LIMITADA', '+56225589447', date '2026-05-13', 'MAYO', null, null),
  (14, 'Jenny Pozo Correa ok', '763130444', '76.313.044-4', 'COMPRA Y VENTA DE FIERROS Y METALES ACEROPRO LIMITADA', 'ONE TIME', 'Documento Unico', array['Documento Unico'], 0.7, 'COMPRA Y VENTA DE FIERROS Y METALES ACEROPRO LIMITADA', '+56977125976', date '2026-05-14', 'MAYO', null, null),
  (15, 'Karen Ordoñez', '761486969', '76.148.696-9', 'PRODUCTOS SERVICIOS WEBSUMINISTROS LIMITADA', 'RECURRENTE', 'MC Ilimitado', array['MC Ilimitado'], 3, 'PRODUCTOS SERVICIOS WEBSUMINISTROS LIMITADA', '+56226656395', date '2026-05-19', 'MAYO', null, null),
  (16, 'Karen Ordoñez', '778442493', '77.844.249-3', 'INVERSIONES SANTA TERESITA LIMITADA', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 3.8, 'INVERSIONES SANTA TERESITA LIMITADA', '+56992343721', date '2026-05-26', 'MAYO', null, null),
  (17, 'Isabel Zamorano', '771326366', '77.132.636-6', 'REPIN S.A', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 3, null, '56998700470', date '2026-05-26', 'MAYO', null, null),
  (18, 'Andres Vildosola', '761418173', '76.141.817-3', 'SOCIEDAD COMERCIAL GRILLO SPA', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 3, 'SOCIEDAD COMERCIAL GRILLO SPA', '56226244714', date '2026-05-27', 'JUNIO', null, null),
  (19, 'Marcela Liliana Mora Morales', '761368249', '76.136.824-9', 'COMERCIALIZADORA Y FABRICA DE PRODUCTOS DE MADERA E INSUMOS PARA LA DECORACION Y', 'PUBLICACION UNICA', 'Documento Unico', array['Documento Unico'], 1.3, 'COMERCIALIZADORA Y FABRICA DE PRODUCTOS DE MADERA E INSUMOS PARA LA DECORACION Y', '+56223124593', date '2026-05-28', 'JUNIO', null, null),
  (20, 'Karen Ordoñez', '76899403K', '76.899.403-K', 'TECNOLOGIAS DE ACCESIBILIDAD UNIVERSAL SPA', 'ONE TIME', 'Bolsa RI', array['Bolsa RI'], 3, 'TECNOLOGIAS DE ACCESIBILIDAD UNIVERSAL SPA', '56934556273', date '2026-05-28', 'JUNIO', null, null),
  (21, 'Jenny Pozo Correa ok', '769096264', '76.909.626-4', 'LLANOS INGENIERIA SPA', 'PUBLICACION UNICA', 'Documento Unico', array['Documento Unico'], 9, 'LLANOS INGENIERIA SPA', '+56958366009', date '2026-05-28', 'JUNIO', null, null),
  (22, 'Jenny Pozo Correa ok', '775354771', '77.535.477-1', 'SOCIEDAD COMERCIAL E INVERSIONES ISLA QUINCHAO SPA', 'PUBLICACION UNICA', 'Documento Unico', array['Documento Unico'], 4.6, 'belfor', '+56982763754', date '2026-05-28', 'JUNIO', null, null),
  (23, 'Claudia Ester Peña Garces', '764206460', '76.420.646-0', 'AMBIENTA EVENTOS SPA', 'ONE TIME', 'Bolsa RI', array['Bolsa RI'], 3, 'PATRICIO MEDIN OPAZO OSSES CONTRUCTORA EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIM', '+56996314774', date '2026-06-22', 'JUNIO', null, null),
  (24, 'Karen Ordoñez', '760298611', '76.029.861-1', 'PROCEL SERVICIOS SPA', 'RECURRENTE', 'Portfolio Monitor y reporte RI', array['Portfolio Monitor','Reporte Interactivo'], 3, 'PROCEL SERVICIOS SPA', '+56979579130', date '2026-06-03', 'JUNIO', null, 'PROCEL SERVICIOS%'),
  (25, 'Catherine Gaete', '763226719', '76.322.671-9', 'CENTRA INGENIERIA ADQUISICIONES Y CONSTRUCCION SPA', 'RECURRENTE', 'bundle', array['Bundle'], 4.3, '763226719', null, date '2026-06-04', 'JUNIO', null, null),
  (26, 'Rodrigo Figueroa', '780089555', '78.008.955-5', 'SBO SERVICIOS ADMINISTRATIVOS SPA', 'RECURRENTE', 'DataFinder', array['DataFinder'], 1, 'De La Cruz SpA', '+56988035191', date '2026-06-16', 'JUNIO', '778109646', null),
  (27, 'Karina Halaby', '760748072', '76.074.807-2', 'Certa Chile SA', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 4, 'Certa Chile SA', '56966776997', date '2026-06-16', 'JUNIO', null, null),
  (28, 'Catherine Gaete', '77189951K', '77.189.951-K', 'TOPOGRAFIA Y GEOMENSURA GEOINTEL LIMITAD', 'ONE TIME', 'Documento Unico', array['Documento Unico'], 25, 'Sergio Aravena', '+56952926354', date '2026-06-17', 'JUNIO', null, null),
  (29, 'Jose Miguel Sanhueza Villegas', '76878406K', '76.878.406-K', 'MAQUINARIA RENTSCOOP SpA', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 3.5, 'MAQUINARIA RENTSCOOP SpA', '+56990963548', date '2026-06-17', 'JUNIO', null, null),
  (30, 'Andrea Soledad Zuñiga Bustos', '774905294', '77.490.529-4', 'CREDHIPO SPA', 'RECURRENTE', 'bundle datos comerciales+RI', array['Bundle','Reporte Interactivo'], 2, null, null, date '2026-06-17', 'JUNIO', null, null),
  (31, 'Marcela Liliana Mora Morales', '995171902', '99.517.190-2', 'SERVIEX S A', 'ONE TIME', 'Bolsa RI', array['Bolsa RI'], 3.5, null, '+56227191700', date '2026-06-17', 'JUNIO', null, null),
  (32, 'Claudia Ester Peña Garces', '768015279', '76.801.527-9', 'TRANSPORTE Y LOGISTICA RAQUEL MENDOZA SPA', 'RECURRENTE', 'MC Ilimitado', array['MC Ilimitado'], 3, 'TRANSPORTE Y LOGISTICA RAQUEL MENDOZA SPA', '+56976042800', date '2026-06-22', 'JUNIO', null, null),
  (33, 'Marcela Liliana Mora Morales', '799801302', '79.980.130-2', 'TERMINACIONES EN CONSTRUCCION SPA', 'ONE TIME', 'Bolsa RI', array['Bolsa RI'], 5.5, 'FERNANDO QUEVEDO MÉNDEZ', '+56226227155', date '2026-06-23', 'JUNIO', null, null),
  (34, 'Claudia Ester Peña Garces', '912650006', '91.265.000-6', 'MOLINOS IDEAL S A C', 'ONE TIME', 'Bolsa RI', array['Bolsa RI'], 3, 'necesitan comprar informes, bolsa ri , plan ri', '+56222074563', date '2026-05-29', 'JULIO', null, null),
  (35, 'Rodrigo Figueroa', '778140861', '77.814.086-1', 'constructoratrapen', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 4, null, '+56936288685', date '2026-06-18', 'JULIO', null, null),
  (36, 'Karina Halaby', '87991407', '8.799.140-7', 'MAURICIO JONAS MOLINA VARGAS', 'ONE TIME', 'Bolsa RI', array['Bolsa RI'], 2, null, null, date '2026-06-26', 'JULIO', null, null),
  (37, 'Eduardo Perez', '764209265', '76.420.926-5', 'COMERCIAL MONKEY SPA', 'ONE TIME', 'Documento Unico', array['Documento Unico'], 1.1, null, '+56962093805', date '2026-07-02', 'JULIO', null, null),
  (38, 'Ana Morales', '77742937K', '77.742.937-K', 'SOCIEDAD KML SPA', 'RECURRENTE', 'RI', array['Q Consultas'], 3.66, 'Felipe Nuñez', '+56931729556', date '2026-08-11', 'AGOSTO', null, null),
  (39, 'Claudia Ester Peña Garces', '781047295', '78.104.729-5', 'OTRO MODO LIMITADA', 'ONE TIME', 'BBDD', array['BBDD'], 4, 'OTRO MODO LIMITADA', '+56958902072', date '2026-08-04', 'AGOSTO', null, null),
  (40, 'Jenny Pozo Correa ok', '781437689', '78.143.768-9', 'Agroservicios don julian SPA', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 2.8, 'Camilo naranjo', '+56944506690', date '2026-08-11', 'AGOSTO', null, null),
  (41, 'Jenny Pozo Correa ok', '760781126', '76.078.112-6', 'FRUTICOLA OLMUE SPA', 'RECURRENTE', 'RI', array['Q Consultas'], 1, ': JAIME MANUEL ROESSLER FERNANDEZ', '+56422427140', date '2026-08-06', 'AGOSTO', null, null),
  (42, 'Karen Ordoñez', '773746397', '77.374.639-7', 'CONSULTORES CHANG Y ASOCIADOS SPA', 'RECURRENTE', 'MC Ilimitado', array['MC Ilimitado'], 3.5, 'CONSULTORES CHANG Y ASOCIADOS SPA', '+56990570715', date '2026-08-10', 'AGOSTO', null, null),
  (43, 'Karen Ordoñez', '766247164', '76.624.716-4', 'EQUIPMENT SOLUTIONS CHILE SPA', 'RECURRENTE', 'MC Ilimitado', array['MC Ilimitado'], 3, 'EQUIPMENT SOLUTIONS CHILE SPA', '+56988196781', date '2026-08-05', 'AGOSTO', null, null),
  (44, 'Karina Halaby', '760536040', '76.053.604-0', 'INGENIERIA Y CONSTRUCCION ESPACIO CUBIERTO LIMITADA', 'ONE TIME', 'Bolsa RI', array['Bolsa RI'], 2, null, '+56412134557', date '2026-07-31', 'AGOSTO', null, null),
  (45, 'Karina Halaby', '781642088', '78.164.208-8', 'GoCab', 'RECURRENTE', 'Bundle MC 4100', array['Bundle MC 4100'], 2.06, 'Andrés Cerda Waak', '+56973727414', date '2026-08-11', 'AGOSTO', null, null),
  (46, 'Marcela Liliana Mora Morales', '966680903', '96.668.090-3', 'PENTACROM S.A.', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 3.5, null, null, date '2026-07-10', 'AGOSTO', null, null),
  (47, 'Marcelo Enrique Araneda Bravo', '969626705', '96.962.670-5', 'Autocolor Paez SPA', 'RECURRENTE', 'Portfolio', array['Portfolio Monitor'], 1.17, null, null, date '2026-08-12', 'AGOSTO', null, null),
  (48, 'Rodrigo Figueroa', '780762780', '78.076.278-0', 'COMERCIAL FERRECOM LIMITADA', 'PUBLICACION UNICA', 'Documento Unico', array['Documento Unico'], 0.8, 'Cristhian Gonzalez', '+56966298672', date '2026-08-25', 'AGOSTO', null, null),
  (49, 'Rodrigo Figueroa', '817300006', '81.730.000-6', 'SOC AGRICOLA Y GANADERA DE OSORNO', 'RECURRENTE', 'RI', array['Q Consultas'], 1, 'SOC AGRICOLA Y GANADERA DE OSORNO', '+56949062872', date '2026-08-26', 'AGOSTO', null, null),
  (50, 'Rodrigo Figueroa', '766441718', '76.644.171-8', 'GOMAS LACOT LIMITADA', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 3, 'Juan Andres Lobos', '+56953429477', date '2026-08-25', 'AGOSTO', null, null),
  (51, 'Rodrigo Figueroa', '776190489', '77.619.048-9', 'Salvarez SPA', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 3, null, null, date '2026-08-21', 'AGOSTO', null, null),
  (52, 'Rodrigo Figueroa', '771399363', '77.139.936-3', 'SOCIEDAD AMERICA LIMITADA', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 4, 'Carlos calahuana', '+56966166030', date '2026-08-18', 'AGOSTO', null, null),
  (53, 'Rodrigo Figueroa', '771399363', '77.139.936-3', 'SOCIEDAD AMERICA LIMITADA', 'RECURRENTE', 'Portfolio', array['Portfolio Monitor'], 0.5, 'Carlos calahuana', '+56966166030', date '2026-08-18', 'AGOSTO', null, null),
  (54, 'Rodrigo Figueroa', '770977207', '77.097.720-7', 'SOC CONSULTORA PROFESIONAL LIMITADA', 'RECURRENTE', 'Bundle MC iimitado', array['Bundle MC Ilimitado'], 4, null, null, date '2026-08-12', 'AGOSTO', null, null),
  (55, 'Ximena Cofre', '771157459', '77.115.745-9', 'RUTATEL SPA', 'PUBLICACION UNICA', 'Documento Unico', array['Documento Unico'], 7, null, null, date '2026-08-20', 'AGOSTO', null, null),
  (56, 'Ximena Cofre', '77866948K', '77.866.948-K', 'MAGNO SPA', 'RECURRENTE', 'Bundle MC 4100', array['Bundle MC 4100'], 2.5, 'MAGNO', '+56945118627', date '2026-08-13', 'AGOSTO', null, null),
  (57, 'Ximena Cofre', '768915504', '76.891.550-4', 'TRANSPORTES LOPEZ E HIJOS SPA', 'RECURRENTE', 'Bundle ilimitado', array['Bundle MC Ilimitado'], 4, 'TRANSPORTES LOPEZ E HIJOS SPA', '+56994196319', date '2026-08-07', 'AGOSTO', null, null),
  (58, 'Isabel Zamorano', '764499549', '76.449.954-9', 'REPARACIONES Y MANTENCIONES ARLUFE SPA', 'RECURRENTE', 'Bundle MC Ilimitado', array['Bundle MC Ilimitado'], 3, null, null, date '2026-08-20', 'AGOSTO', null, null);

do $$
declare
  v_campaign uuid;
  v_org uuid;
  v_team uuid;
  v_sentinel uuid;
  v_actor uuid;
  r record;
  v_lead public.leads%rowtype;
  v_sale public.sale_validations%rowtype;
  v_call public.calls%rowtype;
  v_hist uuid;
  v_agent uuid;
  v_at timestamptz;
  v_call_id uuid;
  v_loaded uuid;
  v_note text;
  v_claimed uuid[] := array[]::uuid[];
  v_created_leads integer := 0;
  v_created_sales integer := 0;
  v_approved integer := 0;
  v_already integer := 0;
begin
  select id, organization_id into v_campaign, v_org
  from public.campaigns where name = 'Equifax' order by created_at limit 1;
  if v_campaign is null then
    raise exception 'No existe la campaña Equifax.';
  end if;
  select team_id into v_team
  from public.leads where campaign_id = v_campaign and team_id is not null
  group by team_id order by count(*) desc limit 1;
  select id into v_sentinel from public.profiles where full_name = 'Migración Histórica' limit 1;
  select id into v_actor from public.profiles
  where email = 'hh2fc24@gmail.com' and role = 'admin'::public.app_role;
  if v_actor is null then
    raise exception 'No existe el admin que carga la planilla.';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  -- Registros candidatos por RUT, en una sola pasada sobre la base.
  create temp table planilla_registros (id uuid, rut_key text) on commit drop;
  insert into planilla_registros
  select lead.id, upper(regexp_replace(lead.rut, '[^0-9kK]', '', 'g'))
  from public.leads lead
  where lead.organization_id = v_org
    and lead.rut is not null
    and upper(regexp_replace(lead.rut, '[^0-9kK]', '', 'g')) in (
      select coalesce(p.rut_registro, p.rut_key) from planilla_equifax p
    );

  for r in select * from planilla_equifax order by n loop
    v_at := (r.fecha_venta + time '12:00') at time zone 'America/Santiago';

    select id into v_hist from public.historical_agents where full_name = r.ejecutivo;
    if v_hist is null then
      raise exception 'Fila %: no existe el ejecutivo %.', r.n, r.ejecutivo;
    end if;
    select coalesce(
      historical.linked_profile_id,
      (
        select profile.id from public.profiles profile
        where profile.full_name = historical.full_name and profile.role = 'agente'::public.app_role
        order by profile.active desc limit 1
      ),
      v_sentinel
    )
    into v_agent
    from public.historical_agents historical where historical.id = v_hist;

    -- El registro: por nombre en los casos a mano; si no, por RUT (el que ya
    -- tiene ventas, luego el de la campaña Equifax, luego el más antiguo).
    v_lead := null;
    if r.nombre_registro is not null then
      select lead.* into v_lead
      from public.leads lead
      where lead.organization_id = v_org
        and lead.full_name ilike r.nombre_registro
      order by exists (select 1 from public.sale_validations v where v.lead_id = lead.id) desc, lead.created_at
      limit 1;
    end if;
    if v_lead.id is null then
      select lead.* into v_lead
      from planilla_registros candidate
      join public.leads lead on lead.id = candidate.id
      where candidate.rut_key = coalesce(r.rut_registro, r.rut_key)
      order by
        exists (select 1 from public.sale_validations v where v.lead_id = lead.id) desc,
        (lead.campaign_id = v_campaign) desc,
        lead.created_at
      limit 1;
    end if;

    if v_lead.id is null then
      insert into public.leads (
        full_name, rut, phone, organization_id, campaign_id, team_id, status,
        assignment_status, workflow_status, tipificacion_actual, managed_at, extra
      )
      values (
        r.razon_social, r.rut, r.telefono, v_org, v_campaign, v_team, 'nuevo',
        'managed', 'managed', 'VENTA EN VALIDACION', v_at,
        jsonb_build_object('origen', 'planilla_ventas_equifax_2026_09_25')
      )
      returning * into v_lead;
      v_created_leads := v_created_leads + 1;
    end if;

    -- Re-ejecución: la fila ya quedó cargada.
    v_loaded := null;
    select v.id into v_loaded
    from public.sale_validations v
    where v.lead_id = v_lead.id
      and v.decision_note like '%' || format('[fila %s]', r.n) || '%';
    if v_loaded is not null then
      v_claimed := v_claimed || v_loaded;
      v_already := v_already + 1;
      continue;
    end if;

    v_note := format(
      'Aprobada en definitiva por Equifax (planilla de ventas, %s%s) [fila %s].',
      coalesce(lower(r.tipo_contrato), 'venta'),
      case when r.mes_cierre is not null then ', cierre ' || lower(r.mes_cierre) else '' end,
      r.n
    );

    -- La venta que ya existe: primero una aprobada, luego la pendiente más
    -- cercana a la fecha de la planilla.
    v_sale := null;
    select v.* into v_sale
    from public.sale_validations v
    where v.lead_id = v_lead.id
      and v.status in ('aprobada', 'pendiente')
      and not (v.id = any (v_claimed))
    order by (v.status = 'aprobada') desc, abs(extract(epoch from v.sold_at - v_at))
    limit 1;

    if v_sale.id is null then
      insert into public.calls (
        lead_id, agent_id, historical_agent_id, status, outcome, reason, notes,
        equifax_products, equifax_uf_amount, started_at, ended_at, management_channel
      )
      values (
        v_lead.id, v_agent, v_hist, 'connected', 'sale', 'VENTA EN VALIDACION',
        concat_ws(' · ',
          'Venta cargada desde la planilla Equifax',
          r.tipo_contrato,
          r.producto,
          case when r.contacto is not null then 'Contacto: ' || r.contacto end,
          case when r.telefono is not null then 'Teléfono: ' || r.telefono end,
          case when r.mes_cierre is not null then 'Cierre: ' || r.mes_cierre end
        ),
        r.productos, r.uf, v_at, v_at, 'supervision'
      )
      returning id into v_call_id;
      select * into v_sale from public.sale_validations where call_id = v_call_id;
      if v_sale.id is null then
        raise exception 'Fila %: la gestión no generó la venta.', r.n;
      end if;
      v_created_sales := v_created_sales + 1;
    else
      select * into v_call from public.calls where id = v_sale.call_id;
      -- Registrada por supervisión con otra fecha: a la fecha y al ejecutivo
      -- de la planilla.
      if v_call.management_channel is not null
        and v_call.legacy_call_id is null
        and (v_call.ended_at at time zone 'America/Santiago')::date <> r.fecha_venta then
        update public.calls
        set started_at = v_at,
            ended_at = v_at,
            agent_id = v_agent,
            historical_agent_id = v_hist,
            updated_at = now()
        where id = v_call.id;
        update public.sale_validations
        set agent_id = v_agent,
            historical_agent_id = v_hist
        where id = v_sale.id;
        v_note := v_note || format(
          ' Fecha llevada del %s al %s.',
          to_char(v_call.ended_at at time zone 'America/Santiago', 'DD-MM-YYYY'),
          to_char(r.fecha_venta, 'DD-MM-YYYY')
        );
      end if;
      if v_sale.uf_amount is distinct from r.uf then
        v_note := v_note || format(' UF según planilla: %s (tipificada: %s).', r.uf, coalesce(v_sale.uf_amount::text, 'sin UF'));
      end if;
    end if;

    update public.sale_validations
    set status = 'aprobada',
        decided_by = case when status = 'aprobada' then decided_by else v_actor end,
        decided_at = case when status = 'aprobada' then decided_at else now() end,
        decision_source = case when status = 'aprobada' then decision_source else 'planilla' end,
        decision_note = case when status = 'aprobada' then concat_ws(' ', decision_note, v_note) else v_note end,
        uf_amount = r.uf,
        products = case when coalesce(cardinality(products), 0) = 0 then r.productos else products end,
        lead_status_before = case
          when status = 'aprobada' then lead_status_before
          when v_lead.status is distinct from 'convertido' then v_lead.status
          else lead_status_before
        end,
        updated_at = now()
    where id = v_sale.id;

    if v_sale.status <> 'aprobada' then
      v_approved := v_approved + 1;
      insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
      values (
        v_lead.id, v_lead.crm_entity_id, v_actor, 'sale_validation.approved',
        jsonb_build_object(
          'sale_validation_id', v_sale.id,
          'call_id', v_sale.call_id,
          'previous_status', v_sale.status,
          'source', 'planilla',
          'note', v_note
        )
      );
    end if;

    update public.leads
    set status = 'convertido',
        updated_at = now()
    where id = v_lead.id
      and status is distinct from 'convertido';

    v_claimed := v_claimed || v_sale.id;
  end loop;

  raise notice 'Planilla Equifax: % registros creados, % ventas agregadas, % pendientes aprobadas, % ya cargadas.',
    v_created_leads, v_created_sales, v_approved, v_already;
end;
$$;
