-- Arancel ampliado e insumos.
--
-- 1. El arancel de partida crece a lo que ofrece una clínica real: en Dental,
--    odontopediatría, periodoncia, prótesis fija y removible, implantología
--    avanzada, ortodoncia por tipo, ATM y más urgencias; en Vet, laboratorio
--    por examen, imagenología, anestesia, hospitalización, rehabilitación y
--    muchas más cirugías.
-- 2. Insumos: los materiales de la clínica con su costo, su precio si se cobran
--    aparte (un injerto óseo, una placa de TPLO, un collar isabelino) y su stock.
-- 3. Receta: qué materiales usa normalmente cada procedimiento. Al atender, la
--    receta se precarga y se ajusta; lo usado queda en la atención con su costo
--    y su precio de ese día, y alimenta el cobro final, el margen y el consumo.

-- Arancel ampliado -------------------------------------------------------------

create or replace function public.aplicar_arancel_ampliado(p_organization_id uuid, p_edicion text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  insert into public.sales_products (organization_id, code, name, one_time_price, categoria, duracion_min, es_urgencia, aplica_a, resultado_odontograma, orden)
  select p_organization_id, item.code, item.name, item.precio, item.categoria, item.duracion, item.urgencia, item.aplica, item.resultado, item.orden
  from (values
    -- Dental · Diagnóstico
    ('dental', 'consulta_especialista', 'Consulta de especialista', 35000, 'Diagnóstico', 30, false, 'boca', null, 13),
    ('dental', 'radiografia_bitewing', 'Radiografía bite-wing', 10000, 'Diagnóstico', 10, false, 'boca', null, 14),
    ('dental', 'cbct', 'Tomografía cone beam (CBCT)', 85000, 'Diagnóstico', 20, false, 'boca', null, 15),
    ('dental', 'telerradiografia', 'Telerradiografía lateral', 25000, 'Diagnóstico', 15, false, 'boca', null, 16),
    ('dental', 'fotografias', 'Set de fotografías clínicas', 15000, 'Diagnóstico', 15, false, 'boca', null, 17),
    ('dental', 'modelos_estudio', 'Modelos de estudio', 25000, 'Diagnóstico', 20, false, 'boca', null, 18),
    -- Dental · Urgencias
    ('dental', 'recementado', 'Recementación de corona', 30000, 'Urgencias', 30, true, 'pieza', null, 23),
    ('dental', 'drenaje_absceso', 'Drenaje de absceso', 50000, 'Urgencias', 30, true, 'pieza', null, 24),
    ('dental', 'pulpectomia_urgencia', 'Pulpectomía de urgencia', 60000, 'Urgencias', 45, true, 'pieza', null, 25),
    ('dental', 'ferulizacion', 'Ferulización por trauma', 70000, 'Urgencias', 45, true, 'boca', null, 26),
    -- Dental · Prevención
    ('dental', 'educacion_higiene', 'Educación en higiene oral', 10000, 'Prevención', 20, false, 'boca', null, 34),
    ('dental', 'fluor_barniz', 'Barniz de flúor', 18000, 'Prevención', 15, false, 'boca', null, 35),
    -- Dental · Operatoria
    ('dental', 'restauracion_vidrio', 'Restauración de vidrio ionómero', 35000, 'Operatoria', 35, false, 'superficie', 'obturacion', 44),
    ('dental', 'incrustacion_resina', 'Incrustación de resina', 180000, 'Operatoria', 75, false, 'superficie', 'obturacion', 45),
    ('dental', 'reconstruccion_perno', 'Reconstrucción con perno de fibra', 90000, 'Operatoria', 60, false, 'pieza', 'obturacion', 46),
    ('dental', 'ajuste_oclusal', 'Ajuste oclusal', 30000, 'Operatoria', 30, false, 'boca', null, 47),
    -- Dental · Endodoncia
    ('dental', 'retratamiento', 'Retratamiento endodóntico', 300000, 'Endodoncia', 120, false, 'pieza', 'endodoncia', 53),
    ('dental', 'apicectomia', 'Apicectomía', 250000, 'Endodoncia', 90, false, 'pieza', null, 54),
    ('dental', 'blanqueamiento_interno', 'Blanqueamiento interno', 90000, 'Endodoncia', 45, false, 'pieza', null, 55),
    -- Dental · Periodoncia
    ('dental', 'periodontograma', 'Periodontograma', 30000, 'Periodoncia', 30, false, 'boca', null, 61),
    ('dental', 'destartraje_subgingival', 'Destartraje subgingival por cuadrante', 55000, 'Periodoncia', 50, false, 'boca', null, 62),
    ('dental', 'mantencion_perio', 'Mantención periodontal', 45000, 'Periodoncia', 45, false, 'boca', null, 63),
    ('dental', 'cirugia_colgajo', 'Cirugía periodontal a colgajo', 280000, 'Periodoncia', 90, false, 'boca', null, 64),
    ('dental', 'injerto_encia', 'Injerto de encía', 350000, 'Periodoncia', 90, false, 'pieza', null, 65),
    ('dental', 'alargamiento_coronario', 'Alargamiento coronario', 180000, 'Periodoncia', 60, false, 'pieza', null, 66),
    -- Dental · Cirugía
    ('dental', 'resto_radicular', 'Extracción de resto radicular', 60000, 'Cirugía', 40, false, 'pieza', 'ausente', 73),
    ('dental', 'frenectomia', 'Frenectomía', 150000, 'Cirugía', 45, false, 'boca', null, 74),
    ('dental', 'regularizacion_reborde', 'Regularización de reborde', 120000, 'Cirugía', 60, false, 'boca', null, 75),
    ('dental', 'biopsia', 'Biopsia de tejido blando', 90000, 'Cirugía', 40, false, 'boca', null, 76),
    -- Dental · Implantología
    ('dental', 'pilar_protesico', 'Pilar protésico', 250000, 'Implantología', 45, false, 'pieza', 'implante', 82),
    ('dental', 'injerto_oseo', 'Injerto óseo', 450000, 'Implantología', 60, false, 'pieza', null, 83),
    ('dental', 'elevacion_seno', 'Elevación de seno maxilar', 900000, 'Implantología', 120, false, 'pieza', null, 84),
    ('dental', 'sobredentadura', 'Sobredentadura sobre implantes', 3500000, 'Implantología', 120, false, 'boca', null, 85),
    ('dental', 'all_on_4', 'Rehabilitación All-on-4 (por arcada)', 7500000, 'Implantología', 240, false, 'boca', null, 86),
    -- Dental · Prótesis fija y removible
    ('dental', 'corona_zirconio', 'Corona de zirconio', 420000, 'Prótesis', 60, false, 'pieza', 'corona', 93),
    ('dental', 'corona_provisoria', 'Corona provisoria', 45000, 'Prótesis', 30, false, 'pieza', 'corona', 94),
    ('dental', 'puente', 'Puente fijo (por pieza)', 350000, 'Prótesis', 60, false, 'pieza', 'corona', 95),
    ('dental', 'carilla_ceramica', 'Carilla cerámica', 450000, 'Prótesis', 60, false, 'pieza', 'corona', 96),
    ('dental', 'protesis_metalica', 'Prótesis removible metálica', 850000, 'Prótesis', 60, false, 'boca', null, 97),
    ('dental', 'protesis_total', 'Prótesis total (por arcada)', 700000, 'Prótesis', 60, false, 'boca', null, 98),
    ('dental', 'rebasado', 'Rebasado de prótesis', 90000, 'Prótesis', 45, false, 'boca', null, 99),
    ('dental', 'reparacion_protesis', 'Reparación de prótesis', 50000, 'Prótesis', 30, false, 'boca', null, 100),
    ('dental', 'plano_relajacion', 'Plano de relajación (bruxismo)', 180000, 'Prótesis', 45, false, 'boca', null, 101),
    -- Dental · Ortodoncia
    ('dental', 'ortodoncia_metalica', 'Ortodoncia brackets metálicos', 1400000, 'Ortodoncia', 60, false, 'boca', null, 102),
    ('dental', 'ortodoncia_autoligado', 'Ortodoncia autoligado', 2200000, 'Ortodoncia', 60, false, 'boca', null, 103),
    ('dental', 'ortodoncia_alineadores', 'Ortodoncia con alineadores', 2800000, 'Ortodoncia', 45, false, 'boca', null, 104),
    ('dental', 'ortopedia', 'Ortopedia maxilar', 900000, 'Ortodoncia', 45, false, 'boca', null, 105),
    ('dental', 'contencion', 'Contención (retenedor)', 120000, 'Ortodoncia', 30, false, 'boca', null, 106),
    ('dental', 'retiro_brackets', 'Retiro de brackets', 80000, 'Ortodoncia', 45, false, 'boca', null, 107),
    -- Dental · Odontopediatría
    ('dental', 'consulta_nino', 'Consulta odontopediátrica', 25000, 'Odontopediatría', 30, false, 'boca', null, 108),
    ('dental', 'pulpotomia', 'Pulpotomía', 70000, 'Odontopediatría', 40, false, 'pieza', 'endodoncia', 109),
    ('dental', 'corona_acero', 'Corona de acero', 70000, 'Odontopediatría', 40, false, 'pieza', 'corona', 110),
    ('dental', 'mantenedor_espacio', 'Mantenedor de espacio', 120000, 'Odontopediatría', 40, false, 'boca', null, 111),
    -- Dental · Estética y ATM
    ('dental', 'blanqueamiento_casero', 'Blanqueamiento ambulatorio', 150000, 'Estética', 30, false, 'boca', null, 112),
    ('dental', 'carilla_resina', 'Carilla de resina', 90000, 'Estética', 60, false, 'pieza', 'obturacion', 113),
    ('dental', 'microabrasion', 'Microabrasión', 60000, 'Estética', 30, false, 'pieza', null, 114),
    ('dental', 'diseno_sonrisa', 'Diseño de sonrisa digital', 90000, 'Estética', 45, false, 'boca', null, 115),
    ('dental', 'tratamiento_atm', 'Tratamiento de ATM (sesión)', 60000, 'ATM', 45, false, 'boca', null, 120),

    -- Vet · Consultas
    ('vet', 'consulta_domicilio', 'Consulta a domicilio', 40000, 'Consultas', 45, false, 'mascota', null, 13),
    ('vet', 'consulta_exoticos', 'Consulta de exóticos', 30000, 'Consultas', 30, false, 'mascota', null, 14),
    ('vet', 'teleconsulta', 'Teleconsulta', 15000, 'Consultas', 20, false, 'mascota', null, 15),
    ('vet', 'consulta_comportamiento', 'Consulta de comportamiento', 45000, 'Consultas', 60, false, 'mascota', null, 16),
    ('vet', 'certificado_viaje', 'Certificado de salud para viaje', 25000, 'Consultas', 20, false, 'mascota', null, 17),
    -- Vet · Urgencias y hospitalización
    ('vet', 'fluidoterapia', 'Fluidoterapia', 25000, 'Urgencias', 60, true, 'mascota', null, 23),
    ('vet', 'oxigenoterapia', 'Oxigenoterapia', 30000, 'Urgencias', 60, true, 'mascota', null, 24),
    ('vet', 'hospitalizacion_uci', 'Hospitalización UCI (por día)', 120000, 'Urgencias', 1440, true, 'mascota', null, 25),
    ('vet', 'transfusion', 'Transfusión sanguínea', 150000, 'Urgencias', 120, true, 'mascota', null, 26),
    ('vet', 'lavado_gastrico', 'Lavado gástrico', 60000, 'Urgencias', 45, true, 'region', null, 27),
    ('vet', 'eutanasia', 'Eutanasia', 60000, 'Urgencias', 30, false, 'mascota', null, 28),
    -- Vet · Vacunas y antiparasitarios
    ('vet', 'vacuna_leucemia', 'Vacuna leucemia felina', 22000, 'Vacunas', 15, false, 'mascota', null, 35),
    ('vet', 'vacuna_kc', 'Vacuna tos de las perreras', 20000, 'Vacunas', 15, false, 'mascota', null, 36),
    ('vet', 'vacuna_leptospira', 'Vacuna leptospira', 18000, 'Vacunas', 15, false, 'mascota', null, 37),
    ('vet', 'antiparasitario_oral', 'Antiparasitario oral (3 meses)', 35000, 'Vacunas', 10, false, 'mascota', null, 38),
    -- Vet · Laboratorio
    ('vet', 'hemograma', 'Hemograma', 20000, 'Laboratorio', 10, false, 'mascota', null, 42),
    ('vet', 'perfil_renal', 'Perfil renal', 30000, 'Laboratorio', 10, false, 'mascota', null, 43),
    ('vet', 'perfil_hepatico', 'Perfil hepático', 30000, 'Laboratorio', 10, false, 'mascota', null, 44),
    ('vet', 'perfil_tiroideo', 'Perfil tiroideo (T4)', 35000, 'Laboratorio', 10, false, 'mascota', null, 45),
    ('vet', 'test_parvovirus', 'Test rápido de parvovirus', 25000, 'Laboratorio', 15, false, 'mascota', null, 46),
    ('vet', 'test_distemper', 'Test rápido de distemper', 25000, 'Laboratorio', 15, false, 'mascota', null, 47),
    ('vet', 'test_vif_vilef', 'Test VIF / ViLeF', 30000, 'Laboratorio', 15, false, 'mascota', null, 48),
    ('vet', 'coproparasitario', 'Examen coproparasitario', 15000, 'Laboratorio', 10, false, 'mascota', null, 49),
    ('vet', 'citologia', 'Citología', 35000, 'Laboratorio', 15, false, 'region', null, 50),
    ('vet', 'cultivo', 'Cultivo y antibiograma', 40000, 'Laboratorio', 15, false, 'region', null, 51),
    ('vet', 'histopatologia', 'Histopatología (biopsia)', 60000, 'Laboratorio', 15, false, 'region', null, 52),
    -- Vet · Imagenología
    ('vet', 'radiografia_dos', 'Radiografía (2 proyecciones)', 45000, 'Imagenología', 25, false, 'region', null, 53),
    ('vet', 'ecocardiograma', 'Ecocardiograma', 70000, 'Imagenología', 40, false, 'region', null, 54),
    ('vet', 'electrocardiograma', 'Electrocardiograma', 35000, 'Imagenología', 20, false, 'mascota', null, 55),
    ('vet', 'ecografia_gestacional', 'Ecografía gestacional', 40000, 'Imagenología', 30, false, 'region', null, 56),
    ('vet', 'endoscopia', 'Endoscopia', 180000, 'Imagenología', 60, false, 'region', null, 57),
    ('vet', 'tomografia', 'Tomografía (TAC)', 350000, 'Imagenología', 60, false, 'region', null, 58),
    -- Vet · Anestesia
    ('vet', 'sedacion', 'Sedación', 30000, 'Anestesia', 30, false, 'mascota', null, 59),
    ('vet', 'anestesia_inhalatoria', 'Anestesia inhalatoria (por hora)', 60000, 'Anestesia', 60, false, 'mascota', null, 60),
    -- Vet · Cirugías
    ('vet', 'sutura_herida', 'Sutura de herida', 60000, 'Cirugías', 40, false, 'region', null, 65),
    ('vet', 'drenaje_absceso', 'Drenaje de absceso', 50000, 'Cirugías', 30, false, 'region', null, 66),
    ('vet', 'otohematoma', 'Cirugía de otohematoma', 180000, 'Cirugías', 60, false, 'region', null, 67),
    ('vet', 'entropion', 'Cirugía de párpado (entropión)', 280000, 'Cirugías', 60, false, 'region', null, 68),
    ('vet', 'enucleacion', 'Enucleación', 300000, 'Cirugías', 75, false, 'region', null, 69),
    ('vet', 'cesarea', 'Cesárea', 350000, 'Cirugías', 90, true, 'region', null, 70),
    ('vet', 'piometra', 'Cirugía de piómetra', 550000, 'Cirugías', 120, true, 'region', null, 71),
    ('vet', 'cuerpo_extrano', 'Cirugía de cuerpo extraño', 650000, 'Cirugías', 120, true, 'region', null, 72),
    ('vet', 'cistotomia', 'Cistotomía (cálculos)', 450000, 'Cirugías', 90, false, 'region', null, 73),
    ('vet', 'hernia', 'Herniorrafia', 300000, 'Cirugías', 75, false, 'region', null, 74),
    ('vet', 'mastectomia', 'Mastectomía', 450000, 'Cirugías', 120, false, 'region', null, 75),
    ('vet', 'luxacion_rotula', 'Corrección de luxación de rótula', 700000, 'Cirugías', 120, false, 'region', null, 76),
    ('vet', 'osteosintesis', 'Osteosíntesis de fractura', 850000, 'Cirugías', 150, false, 'region', null, 77),
    ('vet', 'amputacion', 'Amputación', 500000, 'Cirugías', 120, false, 'region', null, 78),
    -- Vet · Odontología
    ('vet', 'extraccion_dental', 'Extracción dental simple', 35000, 'Odontología', 20, false, 'region', null, 71),
    ('vet', 'extraccion_dental_quirurgica', 'Extracción dental quirúrgica', 80000, 'Odontología', 40, false, 'region', null, 72),
    -- Vet · Rehabilitación
    ('vet', 'fisioterapia', 'Fisioterapia (sesión)', 30000, 'Rehabilitación', 45, false, 'region', null, 85),
    ('vet', 'laserterapia', 'Laserterapia (sesión)', 25000, 'Rehabilitación', 20, false, 'region', null, 86),
    ('vet', 'hidroterapia', 'Hidroterapia (sesión)', 35000, 'Rehabilitación', 40, false, 'mascota', null, 87),
    -- Vet · Estética y cuidados
    ('vet', 'bano_medicado', 'Baño medicado', 18000, 'Estética', 45, false, 'mascota', null, 82),
    ('vet', 'corte_pelo', 'Corte de pelo', 20000, 'Estética', 60, false, 'mascota', null, 83),
    ('vet', 'limpieza_oidos', 'Limpieza de oídos', 12000, 'Estética', 15, false, 'region', null, 84),
    ('vet', 'glandulas_perianales', 'Vaciado de glándulas perianales', 10000, 'Estética', 10, false, 'region', null, 85),
    ('vet', 'cremacion', 'Cremación individual', 120000, 'Otros', 0, false, 'mascota', null, 95)
  ) as item(edicion, code, name, precio, categoria, duracion, urgencia, aplica, resultado, orden)
  where item.edicion = p_edicion
  on conflict (organization_id, code) do update
    set categoria = excluded.categoria,
        duracion_min = coalesce(public.sales_products.duracion_min, excluded.duracion_min),
        es_urgencia = excluded.es_urgencia,
        aplica_a = excluded.aplica_a,
        resultado_odontograma = excluded.resultado_odontograma,
        orden = excluded.orden,
        one_time_price = coalesce(public.sales_products.one_time_price, excluded.one_time_price);
end;
$$;

-- Insumos ------------------------------------------------------------------------

create table if not exists public.insumos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  codigo text not null,
  nombre text not null,
  categoria text,
  unidad text not null default 'unidad',
  costo numeric(14,2) not null default 0,
  precio_venta numeric(14,2),
  cobrable boolean not null default false,
  stock numeric(14,2),
  stock_minimo numeric(14,2),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insumos_nombre_not_blank check (btrim(nombre) <> ''),
  constraint insumos_costo_no_negativo check (costo >= 0),
  constraint insumos_cobrable_con_precio check (not cobrable or precio_venta is not null)
);
create unique index if not exists insumos_codigo_uidx on public.insumos (organization_id, codigo);

-- Receta: materiales de un procedimiento.
create table if not exists public.procedimiento_insumos (
  producto_id uuid not null references public.sales_products(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  cantidad numeric(10,2) not null default 1,
  primary key (producto_id, insumo_id),
  constraint procedimiento_insumos_cantidad_positiva check (cantidad > 0)
);

-- Lo usado en cada atención, con el costo y el precio de ese día.
create table if not exists public.atencion_insumos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  atencion_id uuid not null references public.atenciones(id) on delete cascade,
  insumo_id uuid references public.insumos(id) on delete set null,
  nombre text not null,
  unidad text not null,
  cantidad numeric(10,2) not null,
  costo_unitario numeric(14,2) not null default 0,
  precio_unitario numeric(14,2),
  cobrado boolean not null default false,
  created_at timestamptz not null default now(),
  constraint atencion_insumos_cantidad_positiva check (cantidad > 0)
);
create index if not exists atencion_insumos_atencion_idx on public.atencion_insumos (atencion_id);
create index if not exists atencion_insumos_insumo_idx on public.atencion_insumos (organization_id, insumo_id, created_at desc);

alter table public.atenciones
  add column if not exists costo_materiales numeric(14,2) not null default 0,
  add column if not exists precio_materiales numeric(14,2) not null default 0;

comment on column public.atenciones.costo_materiales is 'Costo de los materiales usados (interno, para el margen).';
comment on column public.atenciones.precio_materiales is 'Lo que se cobra por materiales aparte del procedimiento.';

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['insumos', 'procedimiento_insumos', 'atencion_insumos'] loop
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('drop policy if exists %I on public.%I', v_tabla || '_organization_isolation', v_tabla);
    execute format($p$create policy %I on public.%I as restrictive for all to authenticated
      using (organization_id = any (public.current_org_ids())) with check (organization_id = any (public.current_org_ids()))$p$,
      v_tabla || '_organization_isolation', v_tabla);
    execute format('drop policy if exists %I on public.%I', v_tabla || '_acceso', v_tabla);
    execute format($p$create policy %I on public.%I for all to authenticated
      using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
      with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())$p$,
      v_tabla || '_acceso', v_tabla);
  end loop;
end;
$$;

-- Insumos y recetas de partida por edición. Como el arancel: agrega lo que falta
-- y no pisa costos, precios ni recetas que la clínica ya ajustó.
create or replace function public.aplicar_insumos_de_edicion(p_organization_id uuid, p_edicion text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  insert into public.insumos (organization_id, codigo, nombre, categoria, unidad, costo, precio_venta, cobrable, stock, stock_minimo)
  select p_organization_id, item.codigo, item.nombre, item.categoria, item.unidad, item.costo, item.precio, item.precio is not null, item.stock, item.minimo
  from (values
    ('dental', 'anestesia', 'Anestesia local (carpule)', 'Anestesia', 'carpule', 900, null::numeric, 200, 50),
    ('dental', 'aguja_dental', 'Aguja dental', 'Anestesia', 'unidad', 120, null, 300, 50),
    ('dental', 'guantes', 'Guantes de nitrilo', 'Protección', 'par', 150, null, 500, 100),
    ('dental', 'kit_desechable', 'Kit desechable (babero, vaso, eyector)', 'Protección', 'kit', 450, null, 300, 60),
    ('dental', 'dique', 'Dique de goma', 'Aislamiento', 'unidad', 700, null, 100, 20),
    ('dental', 'acido_grabador', 'Ácido grabador', 'Operatoria', 'aplicación', 300, null, 200, 40),
    ('dental', 'adhesivo', 'Adhesivo dental', 'Operatoria', 'aplicación', 800, null, 200, 40),
    ('dental', 'resina', 'Resina compuesta', 'Operatoria', 'porción', 2500, null, 150, 30),
    ('dental', 'ionomero', 'Vidrio ionómero', 'Operatoria', 'porción', 1500, null, 100, 20),
    ('dental', 'perno_fibra', 'Perno de fibra de vidrio', 'Operatoria', 'unidad', 9000, null, 30, 5),
    ('dental', 'limas', 'Limas endodónticas (juego)', 'Endodoncia', 'juego', 6000, null, 40, 10),
    ('dental', 'gutapercha', 'Gutapercha', 'Endodoncia', 'juego', 1200, null, 60, 10),
    ('dental', 'cemento_sellador', 'Cemento sellador endodóntico', 'Endodoncia', 'aplicación', 1500, null, 60, 10),
    ('dental', 'hipoclorito', 'Hipoclorito de sodio', 'Endodoncia', 'ml', 20, null, 2000, 300),
    ('dental', 'radiografia_placa', 'Radiografía (sensor / placa)', 'Imagenología', 'toma', 500, null, 500, 50),
    ('dental', 'sutura', 'Sutura reabsorbible', 'Cirugía', 'unidad', 2500, null, 80, 15),
    ('dental', 'gasa', 'Gasa estéril', 'Cirugía', 'sobre', 100, null, 500, 100),
    ('dental', 'hemostatico', 'Esponja hemostática', 'Cirugía', 'unidad', 3500, null, 40, 10),
    ('dental', 'implante', 'Implante de titanio', 'Implantología', 'unidad', 180000, null, 12, 3),
    ('dental', 'tornillo_cicatrizacion', 'Tornillo de cicatrización', 'Implantología', 'unidad', 25000, null, 15, 3),
    ('dental', 'pilar', 'Pilar protésico', 'Implantología', 'unidad', 60000, null, 10, 2),
    ('dental', 'injerto_oseo', 'Injerto óseo (0,5 g)', 'Implantología', 'unidad', 90000, 150000, 10, 2),
    ('dental', 'membrana', 'Membrana de colágeno', 'Implantología', 'unidad', 70000, 120000, 8, 2),
    ('dental', 'corona_laboratorio', 'Corona (trabajo de laboratorio)', 'Laboratorio', 'unidad', 120000, null, null, null),
    ('dental', 'provisorio', 'Resina para provisorio', 'Prótesis', 'porción', 3000, null, 50, 10),
    ('dental', 'silicona', 'Silicona de impresión', 'Prótesis', 'impresión', 6000, null, 40, 10),
    ('dental', 'alginato', 'Alginato', 'Prótesis', 'impresión', 1500, null, 60, 10),
    ('dental', 'fluor', 'Flúor / barniz', 'Prevención', 'aplicación', 1200, null, 100, 20),
    ('dental', 'sellante', 'Sellante de fosas y fisuras', 'Prevención', 'aplicación', 900, null, 100, 20),
    ('dental', 'pasta_profilaxis', 'Pasta de profilaxis', 'Prevención', 'aplicación', 400, null, 200, 40),
    ('dental', 'kit_blanqueamiento', 'Kit de blanqueamiento', 'Estética', 'kit', 25000, null, 15, 3),
    ('dental', 'brackets', 'Kit de brackets', 'Ortodoncia', 'kit', 80000, null, 10, 2),
    ('dental', 'arco', 'Arco de ortodoncia', 'Ortodoncia', 'unidad', 3000, null, 60, 10),
    ('dental', 'alineadores', 'Set de alineadores (laboratorio)', 'Ortodoncia', 'set', 900000, null, null, null),

    ('vet', 'vacuna_octuple', 'Vacuna óctuple', 'Vacunas', 'dosis', 7000, null, 60, 15),
    ('vet', 'vacuna_triple_felina', 'Vacuna triple felina', 'Vacunas', 'dosis', 6500, null, 40, 10),
    ('vet', 'vacuna_antirrabica', 'Vacuna antirrábica', 'Vacunas', 'dosis', 4000, null, 60, 15),
    ('vet', 'vacuna_leucemia', 'Vacuna leucemia felina', 'Vacunas', 'dosis', 9000, null, 20, 5),
    ('vet', 'antiparasitario', 'Antiparasitario interno', 'Antiparasitarios', 'comprimido', 3000, null, 120, 20),
    ('vet', 'pipeta', 'Pipeta antipulgas', 'Antiparasitarios', 'unidad', 6000, null, 60, 10),
    ('vet', 'microchip', 'Microchip', 'Identificación', 'unidad', 5000, null, 30, 5),
    ('vet', 'jeringa', 'Jeringa desechable', 'Insumos', 'unidad', 150, null, 500, 100),
    ('vet', 'guantes', 'Guantes de examen', 'Insumos', 'par', 150, null, 500, 100),
    ('vet', 'guantes_esteriles', 'Guantes estériles', 'Cirugía', 'par', 800, null, 200, 40),
    ('vet', 'cateter', 'Catéter intravenoso', 'Fluidoterapia', 'unidad', 1200, null, 100, 20),
    ('vet', 'suero', 'Suero Ringer lactato (500 ml)', 'Fluidoterapia', 'bolsa', 2500, 6000, 80, 15),
    ('vet', 'venoclisis', 'Equipo de venoclisis', 'Fluidoterapia', 'unidad', 1500, null, 80, 15),
    ('vet', 'propofol', 'Propofol (dosis)', 'Anestesia', 'dosis', 8000, null, 40, 10),
    ('vet', 'isoflurano', 'Isoflurano', 'Anestesia', 'hora', 12000, null, 40, 10),
    ('vet', 'tubo_endotraqueal', 'Tubo endotraqueal', 'Anestesia', 'unidad', 2500, null, 40, 10),
    ('vet', 'sutura', 'Sutura quirúrgica', 'Cirugía', 'unidad', 2500, null, 120, 20),
    ('vet', 'campo_quirurgico', 'Campo quirúrgico estéril', 'Cirugía', 'unidad', 1500, null, 100, 20),
    ('vet', 'antibiotico', 'Antibiótico inyectable (dosis)', 'Medicamentos', 'dosis', 3500, 8000, 100, 20),
    ('vet', 'analgesico', 'Analgésico (meloxicam, dosis)', 'Medicamentos', 'dosis', 2000, 5000, 100, 20),
    ('vet', 'antiinflamatorio_oral', 'Antiinflamatorio oral (7 días)', 'Medicamentos', 'caja', 6000, 14000, 40, 10),
    ('vet', 'collar_isabelino', 'Collar isabelino', 'Postoperatorio', 'unidad', 3000, 6000, 40, 10),
    ('vet', 'vendaje', 'Vendaje', 'Postoperatorio', 'unidad', 2000, null, 60, 10),
    ('vet', 'placa_tplo', 'Placa TPLO con tornillos', 'Implantes', 'unidad', 280000, 380000, 4, 1),
    ('vet', 'placa_osteosintesis', 'Placa de osteosíntesis', 'Implantes', 'unidad', 150000, 220000, 4, 1),
    ('vet', 'reactivo_hemograma', 'Reactivo de hemograma', 'Laboratorio', 'prueba', 6000, null, 60, 10),
    ('vet', 'reactivo_bioquimica', 'Reactivo de bioquímica', 'Laboratorio', 'prueba', 8000, null, 60, 10),
    ('vet', 'test_rapido', 'Test rápido', 'Laboratorio', 'prueba', 9000, null, 40, 10),
    ('vet', 'gel_ecografia', 'Gel de ecografía', 'Imagenología', 'aplicación', 300, null, 200, 30),
    ('vet', 'placa_rx', 'Placa radiográfica / sensor', 'Imagenología', 'toma', 1500, null, 200, 30),
    ('vet', 'shampoo_medicado', 'Shampoo medicado', 'Estética', 'aplicación', 2500, null, 60, 10)
  ) as item(edicion, codigo, nombre, categoria, unidad, costo, precio, stock, minimo)
  where item.edicion = p_edicion
  on conflict (organization_id, codigo) do nothing;

  -- Recetas: procedimiento -> materiales habituales.
  insert into public.procedimiento_insumos (producto_id, insumo_id, organization_id, cantidad)
  select producto.id, insumo.id, p_organization_id, receta.cantidad
  from (values
    ('dental', 'evaluacion', 'guantes', 1), ('dental', 'evaluacion', 'kit_desechable', 1),
    ('dental', 'limpieza', 'guantes', 1), ('dental', 'limpieza', 'kit_desechable', 1), ('dental', 'limpieza', 'pasta_profilaxis', 1),
    ('dental', 'destartraje', 'guantes', 1), ('dental', 'destartraje', 'kit_desechable', 1), ('dental', 'destartraje', 'pasta_profilaxis', 1),
    ('dental', 'fluor', 'fluor', 1), ('dental', 'fluor_barniz', 'fluor', 1),
    ('dental', 'sellante', 'sellante', 1), ('dental', 'sellante', 'acido_grabador', 1),
    ('dental', 'restauracion', 'anestesia', 1), ('dental', 'restauracion', 'aguja_dental', 1), ('dental', 'restauracion', 'acido_grabador', 1), ('dental', 'restauracion', 'adhesivo', 1), ('dental', 'restauracion', 'resina', 1), ('dental', 'restauracion', 'guantes', 1), ('dental', 'restauracion', 'kit_desechable', 1),
    ('dental', 'restauracion_2', 'anestesia', 1), ('dental', 'restauracion_2', 'aguja_dental', 1), ('dental', 'restauracion_2', 'acido_grabador', 1), ('dental', 'restauracion_2', 'adhesivo', 1), ('dental', 'restauracion_2', 'resina', 2), ('dental', 'restauracion_2', 'guantes', 1), ('dental', 'restauracion_2', 'kit_desechable', 1),
    ('dental', 'restauracion_3', 'anestesia', 1), ('dental', 'restauracion_3', 'aguja_dental', 1), ('dental', 'restauracion_3', 'acido_grabador', 1), ('dental', 'restauracion_3', 'adhesivo', 1), ('dental', 'restauracion_3', 'resina', 3), ('dental', 'restauracion_3', 'dique', 1), ('dental', 'restauracion_3', 'guantes', 1), ('dental', 'restauracion_3', 'kit_desechable', 1),
    ('dental', 'restauracion_vidrio', 'ionomero', 1), ('dental', 'restauracion_vidrio', 'guantes', 1),
    ('dental', 'reconstruccion_perno', 'perno_fibra', 1), ('dental', 'reconstruccion_perno', 'resina', 2), ('dental', 'reconstruccion_perno', 'adhesivo', 1), ('dental', 'reconstruccion_perno', 'anestesia', 1),
    ('dental', 'endodoncia', 'anestesia', 2), ('dental', 'endodoncia', 'aguja_dental', 1), ('dental', 'endodoncia', 'dique', 1), ('dental', 'endodoncia', 'limas', 1), ('dental', 'endodoncia', 'gutapercha', 1), ('dental', 'endodoncia', 'cemento_sellador', 1), ('dental', 'endodoncia', 'hipoclorito', 20), ('dental', 'endodoncia', 'radiografia_placa', 3),
    ('dental', 'endodoncia_bi', 'anestesia', 2), ('dental', 'endodoncia_bi', 'aguja_dental', 1), ('dental', 'endodoncia_bi', 'dique', 1), ('dental', 'endodoncia_bi', 'limas', 1), ('dental', 'endodoncia_bi', 'gutapercha', 2), ('dental', 'endodoncia_bi', 'cemento_sellador', 1), ('dental', 'endodoncia_bi', 'hipoclorito', 30), ('dental', 'endodoncia_bi', 'radiografia_placa', 3),
    ('dental', 'endodoncia_molar', 'anestesia', 2), ('dental', 'endodoncia_molar', 'aguja_dental', 1), ('dental', 'endodoncia_molar', 'dique', 1), ('dental', 'endodoncia_molar', 'limas', 2), ('dental', 'endodoncia_molar', 'gutapercha', 3), ('dental', 'endodoncia_molar', 'cemento_sellador', 1), ('dental', 'endodoncia_molar', 'hipoclorito', 40), ('dental', 'endodoncia_molar', 'radiografia_placa', 4),
    ('dental', 'retratamiento', 'anestesia', 2), ('dental', 'retratamiento', 'limas', 2), ('dental', 'retratamiento', 'gutapercha', 3), ('dental', 'retratamiento', 'cemento_sellador', 1), ('dental', 'retratamiento', 'hipoclorito', 40), ('dental', 'retratamiento', 'radiografia_placa', 4),
    ('dental', 'pulpotomia', 'anestesia', 1), ('dental', 'pulpotomia', 'ionomero', 1),
    ('dental', 'extraccion', 'anestesia', 2), ('dental', 'extraccion', 'aguja_dental', 1), ('dental', 'extraccion', 'gasa', 2), ('dental', 'extraccion', 'guantes', 1),
    ('dental', 'extraccion_quirurgica', 'anestesia', 3), ('dental', 'extraccion_quirurgica', 'aguja_dental', 1), ('dental', 'extraccion_quirurgica', 'sutura', 1), ('dental', 'extraccion_quirurgica', 'gasa', 3), ('dental', 'extraccion_quirurgica', 'hemostatico', 1),
    ('dental', 'tercer_molar', 'anestesia', 3), ('dental', 'tercer_molar', 'sutura', 1), ('dental', 'tercer_molar', 'gasa', 3), ('dental', 'tercer_molar', 'hemostatico', 1), ('dental', 'tercer_molar', 'radiografia_placa', 1),
    ('dental', 'resto_radicular', 'anestesia', 2), ('dental', 'resto_radicular', 'gasa', 2),
    ('dental', 'implante', 'anestesia', 3), ('dental', 'implante', 'implante', 1), ('dental', 'implante', 'tornillo_cicatrizacion', 1), ('dental', 'implante', 'sutura', 1), ('dental', 'implante', 'gasa', 3), ('dental', 'implante', 'guantes', 2), ('dental', 'implante', 'radiografia_placa', 2),
    ('dental', 'pilar_protesico', 'pilar', 1),
    ('dental', 'corona_implante', 'corona_laboratorio', 1), ('dental', 'corona_implante', 'silicona', 1),
    ('dental', 'injerto_oseo', 'injerto_oseo', 1), ('dental', 'injerto_oseo', 'membrana', 1), ('dental', 'injerto_oseo', 'sutura', 1), ('dental', 'injerto_oseo', 'anestesia', 2),
    ('dental', 'elevacion_seno', 'injerto_oseo', 2), ('dental', 'elevacion_seno', 'membrana', 1), ('dental', 'elevacion_seno', 'sutura', 2), ('dental', 'elevacion_seno', 'anestesia', 3),
    ('dental', 'corona', 'corona_laboratorio', 1), ('dental', 'corona', 'silicona', 1), ('dental', 'corona', 'provisorio', 1), ('dental', 'corona', 'anestesia', 1),
    ('dental', 'corona_mp', 'corona_laboratorio', 1), ('dental', 'corona_mp', 'silicona', 1), ('dental', 'corona_mp', 'provisorio', 1),
    ('dental', 'corona_zirconio', 'corona_laboratorio', 1), ('dental', 'corona_zirconio', 'silicona', 1), ('dental', 'corona_zirconio', 'provisorio', 1),
    ('dental', 'corona_provisoria', 'provisorio', 1),
    ('dental', 'puente', 'corona_laboratorio', 1), ('dental', 'puente', 'silicona', 1),
    ('dental', 'protesis', 'alginato', 2), ('dental', 'protesis', 'silicona', 1),
    ('dental', 'protesis_total', 'alginato', 2), ('dental', 'protesis_total', 'silicona', 1),
    ('dental', 'blanqueamiento', 'kit_blanqueamiento', 1), ('dental', 'blanqueamiento_casero', 'kit_blanqueamiento', 1),
    ('dental', 'ortodoncia', 'brackets', 1), ('dental', 'ortodoncia', 'arco', 4), ('dental', 'ortodoncia_metalica', 'brackets', 1), ('dental', 'ortodoncia_metalica', 'arco', 4),
    ('dental', 'ortodoncia_alineadores', 'alineadores', 1), ('dental', 'control_ortodoncia', 'arco', 1),
    ('dental', 'urgencia', 'anestesia', 1), ('dental', 'urgencia', 'radiografia_placa', 1), ('dental', 'urgencia', 'guantes', 1),
    ('dental', 'trepanacion', 'anestesia', 2), ('dental', 'trepanacion', 'limas', 1), ('dental', 'trepanacion', 'hipoclorito', 10),
    ('dental', 'radiografia_retro', 'radiografia_placa', 1), ('dental', 'radiografia_bitewing', 'radiografia_placa', 2),

    ('vet', 'consulta', 'guantes', 1), ('vet', 'control', 'guantes', 1), ('vet', 'urgencia', 'guantes', 2), ('vet', 'urgencia', 'jeringa', 2),
    ('vet', 'vacuna', 'vacuna_octuple', 1), ('vet', 'vacuna', 'jeringa', 1),
    ('vet', 'vacuna_antirrabica', 'vacuna_antirrabica', 1), ('vet', 'vacuna_antirrabica', 'jeringa', 1),
    ('vet', 'vacuna_leucemia', 'vacuna_leucemia', 1), ('vet', 'vacuna_leucemia', 'jeringa', 1),
    ('vet', 'desparasitacion', 'antiparasitario', 1), ('vet', 'antipulgas', 'pipeta', 1), ('vet', 'microchip', 'microchip', 1),
    ('vet', 'examenes', 'reactivo_hemograma', 1), ('vet', 'examenes', 'reactivo_bioquimica', 1), ('vet', 'examenes', 'jeringa', 1),
    ('vet', 'hemograma', 'reactivo_hemograma', 1), ('vet', 'perfil_renal', 'reactivo_bioquimica', 1), ('vet', 'perfil_hepatico', 'reactivo_bioquimica', 1),
    ('vet', 'test_parvovirus', 'test_rapido', 1), ('vet', 'test_distemper', 'test_rapido', 1), ('vet', 'test_vif_vilef', 'test_rapido', 1),
    ('vet', 'radiografia', 'placa_rx', 1), ('vet', 'radiografia_dos', 'placa_rx', 2), ('vet', 'ecografia', 'gel_ecografia', 1), ('vet', 'ecocardiograma', 'gel_ecografia', 1), ('vet', 'ecografia_gestacional', 'gel_ecografia', 1),
    ('vet', 'fluidoterapia', 'cateter', 1), ('vet', 'fluidoterapia', 'suero', 2), ('vet', 'fluidoterapia', 'venoclisis', 1),
    ('vet', 'hospitalizacion', 'suero', 2), ('vet', 'hospitalizacion', 'venoclisis', 1), ('vet', 'hospitalizacion', 'antibiotico', 2), ('vet', 'hospitalizacion', 'analgesico', 2),
    ('vet', 'sedacion', 'propofol', 1), ('vet', 'sedacion', 'jeringa', 2),
    ('vet', 'anestesia_inhalatoria', 'isoflurano', 1), ('vet', 'anestesia_inhalatoria', 'tubo_endotraqueal', 1),
    ('vet', 'esterilizacion', 'propofol', 1), ('vet', 'esterilizacion', 'isoflurano', 1), ('vet', 'esterilizacion', 'tubo_endotraqueal', 1), ('vet', 'esterilizacion', 'cateter', 1), ('vet', 'esterilizacion', 'suero', 1), ('vet', 'esterilizacion', 'sutura', 2), ('vet', 'esterilizacion', 'campo_quirurgico', 1), ('vet', 'esterilizacion', 'guantes_esteriles', 2), ('vet', 'esterilizacion', 'antibiotico', 1), ('vet', 'esterilizacion', 'analgesico', 1), ('vet', 'esterilizacion', 'collar_isabelino', 1),
    ('vet', 'castracion', 'propofol', 1), ('vet', 'castracion', 'isoflurano', 1), ('vet', 'castracion', 'sutura', 1), ('vet', 'castracion', 'campo_quirurgico', 1), ('vet', 'castracion', 'guantes_esteriles', 2), ('vet', 'castracion', 'antibiotico', 1), ('vet', 'castracion', 'analgesico', 1), ('vet', 'castracion', 'collar_isabelino', 1),
    ('vet', 'cirugia', 'propofol', 1), ('vet', 'cirugia', 'isoflurano', 2), ('vet', 'cirugia', 'tubo_endotraqueal', 1), ('vet', 'cirugia', 'cateter', 1), ('vet', 'cirugia', 'suero', 2), ('vet', 'cirugia', 'sutura', 3), ('vet', 'cirugia', 'campo_quirurgico', 2), ('vet', 'cirugia', 'guantes_esteriles', 3), ('vet', 'cirugia', 'antibiotico', 2), ('vet', 'cirugia', 'analgesico', 2),
    ('vet', 'cirugia_lca', 'placa_tplo', 1), ('vet', 'cirugia_lca', 'propofol', 1), ('vet', 'cirugia_lca', 'isoflurano', 3), ('vet', 'cirugia_lca', 'tubo_endotraqueal', 1), ('vet', 'cirugia_lca', 'cateter', 1), ('vet', 'cirugia_lca', 'suero', 2), ('vet', 'cirugia_lca', 'sutura', 3), ('vet', 'cirugia_lca', 'campo_quirurgico', 2), ('vet', 'cirugia_lca', 'guantes_esteriles', 3), ('vet', 'cirugia_lca', 'antibiotico', 2), ('vet', 'cirugia_lca', 'analgesico', 3), ('vet', 'cirugia_lca', 'vendaje', 2), ('vet', 'cirugia_lca', 'collar_isabelino', 1), ('vet', 'cirugia_lca', 'placa_rx', 2),
    ('vet', 'osteosintesis', 'placa_osteosintesis', 1), ('vet', 'osteosintesis', 'isoflurano', 3), ('vet', 'osteosintesis', 'sutura', 3), ('vet', 'osteosintesis', 'antibiotico', 2), ('vet', 'osteosintesis', 'analgesico', 3), ('vet', 'osteosintesis', 'vendaje', 2),
    ('vet', 'extraccion_masa', 'propofol', 1), ('vet', 'extraccion_masa', 'isoflurano', 1), ('vet', 'extraccion_masa', 'sutura', 2), ('vet', 'extraccion_masa', 'campo_quirurgico', 1), ('vet', 'extraccion_masa', 'antibiotico', 1), ('vet', 'extraccion_masa', 'analgesico', 1),
    ('vet', 'limpieza_dental', 'propofol', 1), ('vet', 'limpieza_dental', 'isoflurano', 1), ('vet', 'limpieza_dental', 'tubo_endotraqueal', 1), ('vet', 'limpieza_dental', 'antibiotico', 1),
    ('vet', 'sutura_herida', 'sutura', 1), ('vet', 'sutura_herida', 'antibiotico', 1), ('vet', 'sutura_herida', 'vendaje', 1),
    ('vet', 'bano_medicado', 'shampoo_medicado', 1),
    ('vet', 'piometra', 'propofol', 1), ('vet', 'piometra', 'isoflurano', 2), ('vet', 'piometra', 'suero', 3), ('vet', 'piometra', 'sutura', 3), ('vet', 'piometra', 'antibiotico', 3), ('vet', 'piometra', 'analgesico', 2), ('vet', 'piometra', 'collar_isabelino', 1),
    ('vet', 'cesarea', 'propofol', 1), ('vet', 'cesarea', 'isoflurano', 2), ('vet', 'cesarea', 'suero', 2), ('vet', 'cesarea', 'sutura', 3), ('vet', 'cesarea', 'antibiotico', 2), ('vet', 'cesarea', 'analgesico', 2)
  ) as receta(edicion, producto, insumo, cantidad)
  join public.sales_products producto on producto.organization_id = p_organization_id and producto.code = receta.producto
  join public.insumos insumo on insumo.organization_id = p_organization_id and insumo.codigo = receta.insumo
  where receta.edicion = p_edicion
  on conflict (producto_id, insumo_id) do nothing;
end;
$$;

revoke all on function public.aplicar_arancel_ampliado(uuid, text) from public, anon, authenticated;
revoke all on function public.aplicar_insumos_de_edicion(uuid, text) from public, anon, authenticated;

create or replace function public.sembrar_modulos_de_empresa()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  perform public.aplicar_plantilla_de_edicion(new.id, new.edicion);
  if new.edicion in ('dental', 'vet') then
    perform public.aplicar_arancel_de_edicion(new.id, new.edicion);
    perform public.aplicar_arancel_ampliado(new.id, new.edicion);
    perform public.aplicar_insumos_de_edicion(new.id, new.edicion);
  end if;
  return new;
end;
$$;

select public.aplicar_arancel_ampliado(organization.id, organization.edicion), public.aplicar_insumos_de_edicion(organization.id, organization.edicion)
from public.organizations organization
where organization.edicion in ('dental', 'vet');

-- Registrar una atención con sus materiales ----------------------------------------
--
-- p_insumos: [{"insumo_id": "...", "cantidad": 2, "cobrar": true}, ...]. Si no
-- viene, se usa la receta del procedimiento. Cada material queda con el costo y
-- el precio de ese día; los cobrables se suman al cobro y el stock baja.

drop function if exists public.registrar_atencion(uuid, uuid, numeric, smallint, text[], uuid, text, text, text, date, boolean, boolean);

create or replace function public.registrar_atencion(
  p_cuenta uuid,
  p_producto uuid,
  p_precio numeric default null,
  p_pieza smallint default null,
  p_superficies text[] default '{}',
  p_mascota uuid default null,
  p_region text default null,
  p_profesional text default null,
  p_nota text default null,
  p_fecha date default null,
  p_actualizar_odontograma boolean default true,
  p_pagado boolean default false,
  p_insumos jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta public.sales_companies%rowtype;
  v_producto public.sales_products%rowtype;
  v_id uuid;
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Santiago')::date);
  v_donde text;
  v_costo numeric := 0;
  v_cobro numeric := 0;
  v_precio numeric;
  v_item record;
begin
  select * into v_cuenta from public.sales_companies where id = p_cuenta;
  if not found then
    raise exception 'No encontramos esa ficha' using errcode = 'P0002';
  end if;
  select * into v_producto from public.sales_products where id = p_producto and organization_id = v_cuenta.organization_id;
  if not found then
    raise exception 'Ese procedimiento no está en el arancel de la clínica' using errcode = 'P0002';
  end if;
  if v_producto.aplica_a in ('pieza', 'superficie') and p_pieza is null then
    raise exception 'Este procedimiento se hace en una pieza: elígela en el odontograma' using errcode = '22023';
  end if;
  if v_producto.aplica_a = 'superficie' and coalesce(array_length(p_superficies, 1), 0) = 0 then
    raise exception 'Marca las superficies tratadas' using errcode = '22023';
  end if;
  v_precio := coalesce(p_precio, v_producto.one_time_price, 0);

  insert into public.atenciones (organization_id, cuenta_id, mascota_id, producto_id, descripcion, pieza, superficies, region,
                                 precio, pagado, es_urgencia, profesional, nota, fecha, registrado_por)
  values (v_cuenta.organization_id, p_cuenta, p_mascota, p_producto, v_producto.name, p_pieza, coalesce(p_superficies, '{}'),
          nullif(btrim(coalesce(p_region, '')), ''), v_precio, coalesce(p_pagado, false),
          v_producto.es_urgencia, nullif(btrim(coalesce(p_profesional, '')), ''), nullif(btrim(coalesce(p_nota, '')), ''),
          v_fecha, auth.uid())
  returning id into v_id;

  -- Materiales: los que vienen, o la receta del procedimiento.
  for v_item in
    select insumo.*, usado.cantidad as usada, usado.cobrar
    from (
      select (elemento ->> 'insumo_id')::uuid as insumo_id,
             (elemento ->> 'cantidad')::numeric as cantidad,
             coalesce((elemento ->> 'cobrar')::boolean, true) as cobrar
      from jsonb_array_elements(coalesce(p_insumos, '[]'::jsonb)) as elemento
      where p_insumos is not null
      union all
      select receta.insumo_id, receta.cantidad, true
      from public.procedimiento_insumos receta
      where p_insumos is null and receta.producto_id = p_producto
    ) usado
    join public.insumos insumo on insumo.id = usado.insumo_id and insumo.organization_id = v_cuenta.organization_id
    where usado.cantidad > 0
  loop
    insert into public.atencion_insumos (organization_id, atencion_id, insumo_id, nombre, unidad, cantidad, costo_unitario, precio_unitario, cobrado)
    values (v_cuenta.organization_id, v_id, v_item.id, v_item.nombre, v_item.unidad, v_item.usada, v_item.costo,
            v_item.precio_venta, v_item.cobrable and v_item.cobrar);
    v_costo := v_costo + v_item.costo * v_item.usada;
    if v_item.cobrable and v_item.cobrar then
      v_cobro := v_cobro + coalesce(v_item.precio_venta, 0) * v_item.usada;
    end if;
    update public.insumos set stock = stock - v_item.usada, updated_at = now() where id = v_item.id and stock is not null;
  end loop;

  update public.atenciones set costo_materiales = v_costo, precio_materiales = v_cobro where id = v_id;

  if p_actualizar_odontograma and p_pieza is not null and v_producto.resultado_odontograma is not null then
    insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, tratamiento,
                                              profesional, nota, fecha, registrado_por)
    values (v_cuenta.organization_id, p_cuenta, p_pieza,
            case when v_producto.aplica_a = 'superficie' then coalesce(p_superficies, '{}') else '{}' end,
            v_producto.resultado_odontograma, 'terminado', v_producto.name,
            nullif(btrim(coalesce(p_profesional, '')), ''), nullif(btrim(coalesce(p_nota, '')), ''), v_fecha, auth.uid());
  end if;

  v_donde := case
    when p_pieza is not null then ' · pieza ' || p_pieza
    when nullif(btrim(coalesce(p_region, '')), '') is not null then ' · ' || lower(p_region)
    else '' end;
  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
  values (v_cuenta.organization_id, p_cuenta, 'reunion',
          'Atención: ' || v_producto.name || v_donde,
          to_char(v_precio + v_cobro, 'FM$999G999G999')
            || case when v_cobro > 0 then ' (incluye ' || to_char(v_cobro, 'FM$999G999G999') || ' en materiales)' else '' end
            || case when p_pagado then ' · pagado' else ' · por cobrar' end,
          now(), true, auth.uid());

  return v_id;
end;
$$;

revoke all on function public.registrar_atencion(uuid, uuid, numeric, smallint, text[], uuid, text, text, text, date, boolean, boolean, jsonb) from public, anon;
grant execute on function public.registrar_atencion(uuid, uuid, numeric, smallint, text[], uuid, text, text, text, date, boolean, boolean, jsonb) to authenticated;

-- Demo: las atenciones pasadas reciben los materiales de su receta, para que el
-- consumo y el margen tengan historia.
insert into public.atencion_insumos (organization_id, atencion_id, insumo_id, nombre, unidad, cantidad, costo_unitario, precio_unitario, cobrado, created_at)
select atencion.organization_id, atencion.id, insumo.id, insumo.nombre, insumo.unidad, receta.cantidad, insumo.costo, insumo.precio_venta,
       insumo.cobrable, atencion.fecha::timestamptz + interval '12 hours'
from public.atenciones atencion
join public.organizations empresa on empresa.id = atencion.organization_id and empresa.slug in ('demo-dental', 'demo-vet')
join public.procedimiento_insumos receta on receta.producto_id = atencion.producto_id
join public.insumos insumo on insumo.id = receta.insumo_id
where not exists (select 1 from public.atencion_insumos ya where ya.atencion_id = atencion.id);

update public.atenciones atencion
   set costo_materiales = totales.costo, precio_materiales = totales.cobro
  from (
    select atencion_id, sum(costo_unitario * cantidad) as costo,
           sum(case when cobrado then coalesce(precio_unitario, 0) * cantidad else 0 end) as cobro
    from public.atencion_insumos group by atencion_id
  ) totales
 where totales.atencion_id = atencion.id;
