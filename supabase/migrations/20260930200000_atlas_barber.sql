-- Atlas Barber: la cuarta edición.
--
-- Una barbería atiende como una clínica: por agenda, por barbero, con caja y
-- con recordatorios. Así que Barber hereda todo lo de Dental y Vet (agenda,
-- caja, pagos, recordatorios, campañas, conversaciones, reportes) y solo
-- cambia la plantilla con la que nace: etapas de paquetes, servicios de
-- barbería con precio y duración, productos e insumos, y un recordatorio
-- propio: la mantención del corte a las cinco semanas.
--
-- Además deja sembrada la empresa de demostración `demo-barber`.

-- ---------------------------------------------------------------------------
-- La edición y a qué se aplica un servicio.
-- ---------------------------------------------------------------------------
alter table public.organizations drop constraint if exists organizations_edicion_check;
alter table public.organizations add constraint organizations_edicion_check
  check (edicion in ('center', 'dental', 'vet', 'barber'));

alter table public.sales_products drop constraint if exists sales_products_aplica_a_check;
alter table public.sales_products add constraint sales_products_aplica_a_check
  check (aplica_a in ('boca', 'pieza', 'superficie', 'mascota', 'region', 'cliente', 'zona_cabeza'));

-- ---------------------------------------------------------------------------
-- Plantilla: módulos, etapas y catálogo con los que nace una empresa.
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_plantilla_de_edicion(p_organization_id uuid, p_edicion text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if p_edicion not in ('center', 'dental', 'vet', 'barber') then
    raise exception 'Edición desconocida: %', p_edicion using errcode = '22023';
  end if;

  insert into public.organization_modules (organization_id, module)
  select p_organization_id, modulo
  from unnest(case p_edicion
    when 'center' then array['leads', 'contact_center', 'correo', 'whatsapp']
    else array['leads', 'ventas_b2c', 'whatsapp', 'correo']
  end) as modulo
  on conflict do nothing;

  insert into public.sales_stages (organization_id, key, name, position, probability, is_won, is_lost)
  select p_organization_id, etapa.key, etapa.name, etapa.position, etapa.probability, etapa.is_won, etapa.is_lost
  from (
    select * from (values
      ('center', 'prospecto', 'Prospecto', 1, 10, false, false),
      ('center', 'contactado', 'Contactado', 2, 25, false, false),
      ('center', 'reunion', 'Reunión agendada', 3, 45, false, false),
      ('center', 'propuesta', 'Propuesta enviada', 4, 65, false, false),
      ('center', 'negociacion', 'Negociación', 5, 80, false, false),
      ('center', 'ganada', 'Ganada', 6, 100, true, false),
      ('center', 'perdida', 'Perdida', 7, 0, false, true),

      ('dental', 'evaluacion', 'Evaluación', 1, 15, false, false),
      ('dental', 'presupuesto_enviado', 'Presupuesto enviado', 2, 35, false, false),
      ('dental', 'seguimiento', 'En seguimiento', 3, 55, false, false),
      ('dental', 'aceptado', 'Aceptado', 4, 100, true, false),
      ('dental', 'rechazado', 'Rechazado', 5, 0, false, true),

      ('vet', 'consulta', 'Consulta', 1, 15, false, false),
      ('vet', 'plan_enviado', 'Plan de tratamiento enviado', 2, 40, false, false),
      ('vet', 'seguimiento', 'En seguimiento', 3, 60, false, false),
      ('vet', 'aceptado', 'Aceptado', 4, 100, true, false),
      ('vet', 'no_aceptado', 'No aceptado', 5, 0, false, true),

      ('barber', 'ofrecido', 'Ofrecido', 1, 30, false, false),
      ('barber', 'seguimiento', 'En seguimiento', 2, 55, false, false),
      ('barber', 'aceptado', 'Aceptado', 3, 100, true, false),
      ('barber', 'no_aceptado', 'No aceptado', 4, 0, false, true)
    ) as fila(edicion, key, name, position, probability, is_won, is_lost)
    where fila.edicion = p_edicion
  ) as etapa
  on conflict (organization_id, key) do nothing;

  insert into public.sales_products (organization_id, code, name)
  select p_organization_id, producto.code, producto.name
  from (
    select * from (values
      ('dental', 'evaluacion', 'Evaluación'),
      ('dental', 'limpieza', 'Limpieza y profilaxis'),
      ('dental', 'restauracion', 'Restauración (tapadura)'),
      ('dental', 'endodoncia', 'Endodoncia'),
      ('dental', 'implante', 'Implante'),
      ('dental', 'ortodoncia', 'Ortodoncia'),
      ('dental', 'blanqueamiento', 'Blanqueamiento'),
      ('dental', 'protesis', 'Prótesis'),

      ('vet', 'consulta', 'Consulta'),
      ('vet', 'vacuna', 'Vacunación'),
      ('vet', 'desparasitacion', 'Desparasitación'),
      ('vet', 'esterilizacion', 'Esterilización'),
      ('vet', 'limpieza_dental', 'Limpieza dental'),
      ('vet', 'cirugia', 'Cirugía'),
      ('vet', 'examenes', 'Exámenes de laboratorio'),
      ('vet', 'peluqueria', 'Peluquería')
    ) as fila(edicion, code, name)
    where fila.edicion = p_edicion
  ) as producto
  on conflict (organization_id, code) do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Servicios de la barbería, con precio de referencia en Santiago y duración.
-- Se puede volver a correr: no pisa precios ni duraciones que la barbería ya
-- cambió.
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_arancel_de_barberia(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  insert into public.sales_products (organization_id, code, name, one_time_price, categoria, duracion_min, es_urgencia, aplica_a, orden)
  select p_organization_id, item.code, item.name, item.precio, item.categoria, item.duracion, false, item.aplica, item.orden
  from (values
    ('corte_clasico', 'Corte clásico', 12000, 'Cortes', 30, 'cliente', 10),
    ('fade', 'Fade (low, mid o high)', 15000, 'Cortes', 40, 'cliente', 11),
    ('skin_fade', 'Skin fade', 16000, 'Cortes', 45, 'cliente', 12),
    ('taper', 'Taper fade', 14000, 'Cortes', 40, 'cliente', 13),
    ('corte_tijera', 'Corte a tijera', 15000, 'Cortes', 45, 'cliente', 14),
    ('texturizado', 'Crop texturizado', 15000, 'Cortes', 40, 'cliente', 15),
    ('buzz', 'Buzz cut', 9000, 'Cortes', 20, 'cliente', 16),
    ('mullet', 'Mullet moderno', 16000, 'Cortes', 45, 'cliente', 17),
    ('perfilado_barba', 'Perfilado de barba', 8000, 'Barba', 20, 'cliente', 20),
    ('barba_completa', 'Barba completa con toalla caliente', 12000, 'Barba', 30, 'cliente', 21),
    ('afeitado', 'Afeitado clásico a navaja', 14000, 'Barba', 35, 'cliente', 22),
    ('corte_barba', 'Corte + barba', 20000, 'Combos', 60, 'cliente', 30),
    ('fade_barba', 'Fade + barba completa', 24000, 'Combos', 70, 'cliente', 31),
    ('experiencia', 'Experiencia completa (corte, barba, lavado y mascarilla)', 32000, 'Combos', 90, 'cliente', 32),
    ('diseno', 'Diseño o líneas', 4000, 'Diseño', 15, 'zona_cabeza', 40),
    ('cejas', 'Perfilado de cejas', 4000, 'Diseño', 10, 'cliente', 41),
    ('tinte', 'Tinte o cubre canas', 18000, 'Color', 45, 'cliente', 50),
    ('decoloracion', 'Decoloración', 35000, 'Color', 90, 'cliente', 51),
    ('platinado', 'Platinado', 45000, 'Color', 120, 'cliente', 52),
    ('lavado', 'Lavado y masaje capilar', 6000, 'Tratamientos', 15, 'cliente', 60),
    ('mascarilla', 'Mascarilla facial de carbón', 8000, 'Tratamientos', 20, 'cliente', 61),
    ('keratina', 'Alisado con keratina', 35000, 'Tratamientos', 90, 'cliente', 62),
    ('corte_nino', 'Corte niño (hasta 12 años)', 10000, 'Niños', 30, 'cliente', 70)
  ) as item(code, name, precio, categoria, duracion, aplica, orden)
  on conflict (organization_id, code) do update
    set categoria = excluded.categoria,
        duracion_min = coalesce(public.sales_products.duracion_min, excluded.duracion_min),
        aplica_a = excluded.aplica_a,
        orden = excluded.orden,
        one_time_price = coalesce(public.sales_products.one_time_price, excluded.one_time_price);
end;
$function$;

-- Insumos y productos de venta. Los cobrables (pomadas, aceites) se venden
-- en la misma atención y descuentan stock.
create or replace function public.aplicar_insumos_de_barberia(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  insert into public.insumos (organization_id, codigo, nombre, categoria, unidad, costo, precio_venta, cobrable, stock, stock_minimo)
  select p_organization_id, item.codigo, item.nombre, item.categoria, item.unidad, item.costo, item.precio, item.cobrable, item.stock, item.minimo
  from (values
    ('cuchilla', 'Hoja de navaja', 'Desechables', 'unidad', 150, null::numeric, false, 200, 50),
    ('cuello', 'Cuello desechable', 'Desechables', 'unidad', 40, null, false, 500, 100),
    ('toalla', 'Toalla caliente (lavandería)', 'Desechables', 'unidad', 300, null, false, null, null),
    ('gel_afeitar', 'Gel de afeitar', 'Barba', 'ml', 12, null, false, 2000, 500),
    ('after_shave', 'After shave', 'Barba', 'ml', 18, null, false, 1500, 300),
    ('polvo_decolorante', 'Polvo decolorante', 'Color', 'g', 25, null, false, 1500, 300),
    ('oxidante', 'Oxidante 30 vol', 'Color', 'ml', 8, null, false, 3000, 600),
    ('tinte', 'Tinte (pomo)', 'Color', 'unidad', 3500, null, false, 20, 5),
    ('pomada_mate', 'Pomada mate 100 g', 'Productos', 'unidad', 6500, 14990, true, 24, 6),
    ('cera_brillo', 'Cera brillo 100 g', 'Productos', 'unidad', 6000, 13990, true, 18, 6),
    ('aceite_barba', 'Aceite para barba 30 ml', 'Productos', 'unidad', 5500, 12990, true, 15, 5),
    ('shampoo', 'Shampoo anticaspa 250 ml', 'Productos', 'unidad', 5200, 11990, true, 12, 4)
  ) as item(codigo, nombre, categoria, unidad, costo, precio, cobrable, stock, minimo)
  on conflict (organization_id, codigo) do nothing;

  insert into public.procedimiento_insumos (organization_id, producto_id, insumo_id, cantidad)
  select p_organization_id, producto.id, insumo.id, receta.cantidad
  from (values
    ('corte_clasico', 'cuello', 1), ('fade', 'cuello', 1), ('skin_fade', 'cuello', 1), ('skin_fade', 'cuchilla', 1),
    ('taper', 'cuello', 1), ('corte_tijera', 'cuello', 1), ('texturizado', 'cuello', 1), ('buzz', 'cuello', 1), ('mullet', 'cuello', 1),
    ('perfilado_barba', 'cuchilla', 1), ('perfilado_barba', 'after_shave', 5),
    ('barba_completa', 'toalla', 1), ('barba_completa', 'cuchilla', 1), ('barba_completa', 'gel_afeitar', 10), ('barba_completa', 'after_shave', 5),
    ('afeitado', 'toalla', 1), ('afeitado', 'cuchilla', 1), ('afeitado', 'gel_afeitar', 15), ('afeitado', 'after_shave', 5),
    ('corte_barba', 'cuello', 1), ('corte_barba', 'toalla', 1), ('corte_barba', 'cuchilla', 1), ('corte_barba', 'after_shave', 5),
    ('fade_barba', 'cuello', 1), ('fade_barba', 'toalla', 1), ('fade_barba', 'cuchilla', 1), ('fade_barba', 'gel_afeitar', 10), ('fade_barba', 'after_shave', 5),
    ('experiencia', 'cuello', 1), ('experiencia', 'toalla', 2), ('experiencia', 'cuchilla', 1), ('experiencia', 'gel_afeitar', 10), ('experiencia', 'after_shave', 5),
    ('tinte', 'tinte', 1), ('decoloracion', 'polvo_decolorante', 40), ('decoloracion', 'oxidante', 80),
    ('platinado', 'polvo_decolorante', 60), ('platinado', 'oxidante', 120)
  ) as receta(producto, insumo, cantidad)
  join public.sales_products producto on producto.organization_id = p_organization_id and producto.code = receta.producto
  join public.insumos insumo on insumo.organization_id = p_organization_id and insumo.codigo = receta.insumo
  on conflict (producto_id, insumo_id) do nothing;
end;
$function$;

revoke all on function public.aplicar_arancel_de_barberia(uuid) from public, anon, authenticated;
revoke all on function public.aplicar_insumos_de_barberia(uuid) from public, anon, authenticated;

create or replace function public.sembrar_modulos_de_empresa()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  perform public.aplicar_plantilla_de_edicion(new.id, new.edicion);
  if new.edicion in ('dental', 'vet') then
    perform public.aplicar_arancel_de_edicion(new.id, new.edicion);
    perform public.aplicar_arancel_ampliado(new.id, new.edicion);
    perform public.aplicar_insumos_de_edicion(new.id, new.edicion);
  elsif new.edicion = 'barber' then
    perform public.aplicar_arancel_de_barberia(new.id);
    perform public.aplicar_insumos_de_barberia(new.id);
  end if;
  return new;
end;
$function$;

create or replace function public.crear_organizacion(p_slug text, p_name text, p_edicion text default 'center')
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'Solo el dueño de la plataforma crea empresas' using errcode = '42501';
  end if;

  if coalesce(p_edicion, '') not in ('center', 'dental', 'vet', 'barber') then
    raise exception 'Elige una edición: Center, Dental, Vet o Barber' using errcode = '22023';
  end if;

  insert into public.organizations (slug, name, edicion)
  values (lower(btrim(p_slug)), btrim(p_name), p_edicion)
  returning id into v_id;

  insert into public.organization_members (organization_id, profile_id, role, is_default)
  select v_id, owner.profile_id, 'admin'::public.app_role, false
  from public.platform_owners owner
  on conflict (organization_id, profile_id) do nothing;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Recordatorios: Barber entra a las reglas de citas y paquetes, y la regla de
-- "no vuelve" se vuelve mantención a las cinco semanas.
-- ---------------------------------------------------------------------------
create or replace function public.generar_recordatorios()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_manana date := (now() at time zone 'America/Santiago')::date + 1;
  v_semana text := to_char(now() at time zone 'America/Santiago', 'IYYY-IW');
  v_mes text := to_char(now() at time zone 'America/Santiago', 'YYYY-MM');
  v_citas integer := 0; v_vacunas integer := 0; v_presupuestos integer := 0; v_controles integer := 0;
begin
  with nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select cita.organization_id, case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           cita.cuenta_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name, 'cita_manana', cita.id, 'cita_manana:' || cita.id,
           case when cita.estado = 'reservada' then 'cita_confirmar' else 'cita_recordatorio' end,
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'hora', to_char(cita.inicio at time zone 'America/Santiago', 'HH24:MI'), 'profesional', profesional.nombre, 'motivo', cita.motivo, 'mascota', mascota.nombre, 'clinica', organizacion.name)
      from public.citas cita
      join public.organizations organizacion on organizacion.id = cita.organization_id and organizacion.edicion in ('vet', 'dental', 'barber')
      join public.sales_companies cuenta on cuenta.id = cita.cuenta_id
      join public.profesionales profesional on profesional.id = cita.profesional_id
      left join public.mascotas mascota on mascota.id = cita.mascota_id
     where cita.estado in ('reservada', 'confirmada') and (cita.inicio at time zone 'America/Santiago')::date = v_manana
       and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_citas from nuevas;

  with nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select mascota.organization_id, case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           mascota.cuenta_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name, 'vacuna', mascota.id, 'vacuna:' || mascota.id || ':' || v_mes, 'vacuna',
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'mascota', mascota.nombre, 'fecha', to_char(mascota.proxima_vacuna, 'DD/MM'), 'vencida', mascota.proxima_vacuna < v_hoy, 'clinica', organizacion.name)
      from public.mascotas mascota
      join public.organizations organizacion on organizacion.id = mascota.organization_id and organizacion.edicion = 'vet'
      join public.sales_companies cuenta on cuenta.id = mascota.cuenta_id
     where mascota.proxima_vacuna is not null and mascota.proxima_vacuna between v_hoy - 60 and v_hoy + 30
       and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_vacunas from nuevas;

  with nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select negocio.organization_id, case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           negocio.company_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name, 'presupuesto', negocio.id, 'presupuesto:' || negocio.id || ':' || v_semana, 'presupuesto',
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'presupuesto', negocio.name, 'monto', to_char(coalesce(negocio.one_time_amount, 0), 'FM$999G999G999'), 'clinica', organizacion.name)
      from public.sales_opportunities negocio
      join public.organizations organizacion on organizacion.id = negocio.organization_id and organizacion.edicion in ('vet', 'dental', 'barber')
      join public.sales_companies cuenta on cuenta.id = negocio.company_id
     where negocio.status = 'abierta' and negocio.next_action_at is not null and negocio.next_action_at <= now() - interval '7 days'
       and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_presupuestos from nuevas;

  -- Quien no vuelve: control a los 6 meses (Dental), 12 (Vet) o mantención a
  -- las 5 semanas (Barber). Como mucho uno al mes por persona.
  with ultima as (
    select atencion.organization_id, atencion.cuenta_id, max(atencion.fecha) as fecha from public.atenciones atencion group by 1, 2
  ), candidatos as (
    select ultima.organization_id, ultima.cuenta_id, ultima.fecha, organizacion.edicion,
           row_number() over (partition by ultima.organization_id order by ultima.fecha) as orden
      from ultima join public.organizations organizacion on organizacion.id = ultima.organization_id and organizacion.edicion in ('vet', 'dental', 'barber')
     where ultima.fecha < v_hoy - (case organizacion.edicion when 'vet' then 365 when 'barber' then 35 else 180 end)
       -- Barber: pasado el trimestre ya no es mantención, es otra campaña.
       and (organizacion.edicion <> 'barber' or ultima.fecha >= v_hoy - 90)
  ), nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select candidato.organization_id, case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           candidato.cuenta_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name,
           case when candidato.edicion = 'barber' then 'mantencion' else 'control' end, candidato.cuenta_id,
           case when candidato.edicion = 'barber' then 'mantencion:' else 'control:' end || candidato.cuenta_id || ':' || v_mes,
           case when candidato.edicion = 'barber' then 'mantencion' else 'control' end,
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'meses', case candidato.edicion when 'vet' then 12 else 6 end,
                              'semanas', ((v_hoy - candidato.fecha) / 7), 'clinica', organizacion.name)
      from candidatos candidato
      join public.organizations organizacion on organizacion.id = candidato.organization_id
      join public.sales_companies cuenta on cuenta.id = candidato.cuenta_id
     where candidato.orden <= 40 and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_controles from nuevas;

  return jsonb_build_object('citas', v_citas, 'vacunas', v_vacunas, 'presupuestos', v_presupuestos, 'controles', v_controles);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Demostración: Barbería El Filo.
-- Tres barberos, setenta clientes con su historia de cortes y dos semanas de
-- agenda alrededor de hoy. Solo se siembra si la empresa no existe.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_nombres text[] := array['Matías', 'Benjamín', 'Vicente', 'Martín', 'Agustín', 'Joaquín', 'Tomás', 'Maximiliano', 'Lucas', 'Cristóbal',
                            'Diego', 'Felipe', 'Sebastián', 'Nicolás', 'Ignacio', 'Gabriel', 'Bastián', 'Francisco', 'Javier', 'Rodrigo',
                            'Camilo', 'Alonso', 'Renato', 'Emilio', 'Gaspar', 'Pedro', 'Andrés', 'Pablo', 'Simón', 'Álvaro'];
  v_apellidos text[] := array['González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva', 'Martínez', 'Sepúlveda',
                              'Morales', 'Rodríguez', 'López', 'Fuentes', 'Hernández', 'Torres', 'Araya', 'Flores', 'Espinoza', 'Valenzuela',
                              'Castillo', 'Tapia', 'Reyes', 'Gutiérrez', 'Castro', 'Pizarro', 'Álvarez', 'Vásquez', 'Sánchez', 'Fernández'];
  v_origenes text[] := array['instagram', 'instagram', 'instagram', 'google', 'whatsapp', 'referido', 'referido', 'web'];
  v_comunas text[] := array['Providencia', 'Ñuñoa', 'Santiago', 'Las Condes', 'La Reina', 'Macul', 'San Miguel', 'Vitacura'];
  v_barberos text[] := array['Nico Rivas', 'Pancho Salas', 'Jota Díaz'];
  v_cuenta uuid;
  v_barbero text;
  v_fecha date;
  v_producto record;
  v_prof record;
  v_dia date;
  v_slot integer;
  v_inicio timestamptz;
  v_libre_hasta timestamptz;
  v_estado text;
  i integer;
  j integer;
begin
  if exists (select 1 from public.organizations where slug = 'demo-barber') then
    return;
  end if;

  insert into public.organizations (slug, name, edicion)
  values ('demo-barber', 'Barbería El Filo', 'barber')
  returning id into v_org;

  insert into public.organization_members (organization_id, profile_id, role, is_default)
  select v_org, owner.profile_id, 'admin'::public.app_role, false
    from public.platform_owners owner
  on conflict (organization_id, profile_id) do nothing;

  insert into public.profesionales (organization_id, nombre, especialidad, color, orden)
  values (v_org, 'Nico Rivas', 'Fades y diseño', '#8a5a1f', 1),
         (v_org, 'Pancho Salas', 'Tijera y texturizados', '#0f766e', 2),
         (v_org, 'Jota Díaz', 'Barba y afeitado clásico', '#7c3aed', 3);

  for i in 1..70 loop
    v_barbero := v_barberos[1 + (i % 3)];
    insert into public.sales_companies (organization_id, name, phone, email, commune, source, metadata)
    values (
      v_org,
      v_nombres[1 + ((i * 7) % 30)] || ' ' || v_apellidos[1 + ((i * 11) % 30)],
      '+569' || lpad(((i * 7919 + 13579) % 90000000 + 10000000)::text, 8, '0'),
      case when i % 3 = 0 then lower(translate(v_nombres[1 + ((i * 7) % 30)], 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')) || '.' || i || '@correo.invalid' end,
      v_comunas[1 + (i % 8)],
      v_origenes[1 + (i % 8)],
      jsonb_build_object('profesional', v_barbero, 'nacimiento', (date '1985-01-01' + ((i * 97) % 6000))::text, 'origen', v_origenes[1 + (i % 8)])
    )
    returning id into v_cuenta;

    -- Historia: entre una y cinco visitas, cada 3 a 6 semanas hacia atrás.
    v_fecha := v_hoy - (3 + (i * 5) % 50);
    for j in 1..(1 + (i % 5)) loop
      select code, name, one_time_price into v_producto
        from public.sales_products
       where organization_id = v_org and categoria in ('Cortes', 'Barba', 'Combos')
       order by md5(i::text || j::text) limit 1;
      insert into public.atenciones (organization_id, cuenta_id, producto_id, descripcion, precio, pagado, profesional, fecha)
      select v_org, v_cuenta, producto.id, v_producto.name, v_producto.one_time_price,
             v_fecha < v_hoy - 5 or (i % 4 <> 0), v_barbero, v_fecha
        from public.sales_products producto where producto.organization_id = v_org and producto.code = v_producto.code;
      v_fecha := v_fecha - (21 + (i * j * 3) % 22);
    end loop;
  end loop;

  -- Dos paquetes abiertos para que Caja > Paquetes y los recordatorios cuenten algo.
  insert into public.sales_opportunities (organization_id, company_id, name, stage_id, one_time_amount, next_action_at, source)
  select v_org, cuenta.id, paquete.nombre, etapa.id, paquete.monto, now() - interval '9 days', 'whatsapp'
    from (values (1, 'Plan mensual corte + barba', 60000), (2, 'Platinado + 2 mantenciones', 75000)) as paquete(n, nombre, monto)
    join lateral (select id from public.sales_companies where organization_id = v_org order by name offset paquete.n * 5 limit 1) cuenta on true
    join public.sales_stages etapa on etapa.organization_id = v_org and etapa.key = 'ofrecido';

  -- Agenda: dos semanas alrededor de hoy, de 10:00 a 20:00, domingo cerrado.
  for v_prof in select id, nombre from public.profesionales where organization_id = v_org loop
    for v_dia in select d::date from generate_series(v_hoy - 6, v_hoy + 8, interval '1 day') d loop
      if extract(isodow from v_dia) = 7 then continue; end if;
      v_libre_hasta := null;
      for v_slot in 0..19 loop
        v_inicio := ((v_dia::text || ' 10:00')::timestamp + (v_slot * interval '30 minutes')) at time zone 'America/Santiago';
        if v_libre_hasta is not null and v_inicio < v_libre_hasta then continue; end if;
        if random() > (case when extract(isodow from v_dia) in (5, 6) then 0.8 else 0.55 end) then continue; end if;

        select id into v_cuenta from public.sales_companies where organization_id = v_org order by random() limit 1;
        select name, coalesce(duracion_min, 30) as duracion into v_producto
          from public.sales_products
         where organization_id = v_org and active and categoria in ('Cortes', 'Barba', 'Combos', 'Color')
         order by random() limit 1;
        v_libre_hasta := v_inicio + make_interval(mins => greatest(20, least(90, v_producto.duracion)));
        if v_libre_hasta > ((v_dia::text || ' 20:00')::timestamp at time zone 'America/Santiago') then exit; end if;

        v_estado := case
          when v_dia < v_hoy then (case when random() < 0.9 then 'atendida' when random() < 0.6 then 'no_vino' else 'cancelada' end)
          when v_dia = v_hoy and v_libre_hasta < now() then 'atendida'
          when v_dia = v_hoy and v_inicio <= now() then 'en_sala'
          when v_dia = v_hoy then (case when random() < 0.75 then 'confirmada' else 'reservada' end)
          when v_dia = v_hoy + 1 then (case when random() < 0.5 then 'confirmada' else 'reservada' end)
          else 'reservada' end;

        insert into public.citas (organization_id, cuenta_id, profesional_id, inicio, fin, motivo, estado)
        values (v_org, v_cuenta, v_prof.id, v_inicio, v_libre_hasta, v_producto.name, v_estado);
      end loop;
    end loop;
  end loop;
end;
$$;

-- Auto-verificación.
do $$
declare v_org uuid;
begin
  select id into v_org from public.organizations where slug = 'demo-barber';
  if v_org is null then raise exception 'No quedó sembrada demo-barber'; end if;
  if (select count(*) from public.sales_products where organization_id = v_org and one_time_price > 0) < 20 then
    raise exception 'demo-barber quedó sin arancel';
  end if;
  if not exists (select 1 from public.organization_modules where organization_id = v_org and module = 'ventas_b2c') then
    raise exception 'demo-barber quedó sin el módulo de clínica';
  end if;
  if (select count(*) from public.citas where organization_id = v_org) < 50 then
    raise exception 'demo-barber quedó sin agenda';
  end if;
end;
$$;
