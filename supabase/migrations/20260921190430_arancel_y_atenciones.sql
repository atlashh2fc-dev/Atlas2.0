-- Arancel de procedimientos y atenciones.
--
-- El arancel es el catálogo que ya existía (`sales_products`) con lo que una
-- clínica necesita saber de cada procedimiento: su categoría, si es urgencia,
-- cuánto dura, a qué se aplica (toda la boca, una pieza, una superficie, la
-- mascota o una zona de su cuerpo) y qué deja en el odontograma cuando se
-- realiza ("Endodoncia molar" deja la pieza con endodoncia terminada).
--
-- Una atención es un procedimiento realizado: a quién, en qué pieza o zona,
-- quién lo hizo, cuánto costó y si ya se pagó. Registrarla actualiza el
-- odontograma en el mismo paso, así la historia clínica, la atención y el cobro
-- salen de un solo hecho.

alter table public.sales_products
  add column if not exists categoria text,
  add column if not exists duracion_min integer,
  add column if not exists es_urgencia boolean not null default false,
  add column if not exists aplica_a text not null default 'boca',
  add column if not exists resultado_odontograma text,
  add column if not exists orden integer not null default 100;

alter table public.sales_products drop constraint if exists sales_products_aplica_a_check;
alter table public.sales_products add constraint sales_products_aplica_a_check
  check (aplica_a in ('boca', 'pieza', 'superficie', 'mascota', 'region'));
alter table public.sales_products drop constraint if exists sales_products_resultado_check;
alter table public.sales_products add constraint sales_products_resultado_check
  check (resultado_odontograma is null or resultado_odontograma in (
    'sano', 'caries', 'fractura', 'obturacion', 'sellante', 'endodoncia',
    'corona', 'implante', 'protesis', 'extraccion_indicada', 'ausente'));

comment on column public.sales_products.aplica_a is
  'A qué se aplica: boca, pieza, superficie (Dental), mascota o region del cuerpo (Vet).';
comment on column public.sales_products.resultado_odontograma is
  'Estado que deja en la pieza cuando se realiza. Nulo si no cambia el odontograma.';

create table if not exists public.atenciones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  mascota_id uuid references public.mascotas(id) on delete set null,
  producto_id uuid references public.sales_products(id) on delete set null,
  descripcion text not null,
  pieza smallint,
  superficies text[] not null default '{}',
  region text,
  precio numeric(14,2) not null default 0,
  pagado boolean not null default false,
  es_urgencia boolean not null default false,
  profesional text,
  nota text,
  fecha date not null default ((now() at time zone 'America/Santiago')::date),
  registrado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint atenciones_descripcion_not_blank check (btrim(descripcion) <> ''),
  constraint atenciones_precio_no_negativo check (precio >= 0),
  constraint atenciones_superficies_validas check (superficies <@ array['O', 'M', 'D', 'V', 'L']::text[])
);

create index if not exists atenciones_cuenta_idx on public.atenciones (cuenta_id, fecha desc);
create index if not exists atenciones_org_fecha_idx on public.atenciones (organization_id, fecha desc);

alter table public.atenciones enable row level security;

drop policy if exists atenciones_organization_isolation on public.atenciones;
create policy atenciones_organization_isolation on public.atenciones
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists atenciones_select on public.atenciones;
create policy atenciones_select on public.atenciones
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

drop policy if exists atenciones_insert on public.atenciones;
create policy atenciones_insert on public.atenciones
  for insert to authenticated
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- Lo único que cambia después es si se pagó.
drop policy if exists atenciones_update on public.atenciones;
create policy atenciones_update on public.atenciones
  for update to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- Registrar una atención: la atención, el odontograma (si el procedimiento lo
-- cambia) y la línea en la historia de la ficha, en una transacción.
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
  p_pagado boolean default false
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

  insert into public.atenciones (organization_id, cuenta_id, mascota_id, producto_id, descripcion, pieza, superficies, region,
                                 precio, pagado, es_urgencia, profesional, nota, fecha, registrado_por)
  values (v_cuenta.organization_id, p_cuenta, p_mascota, p_producto, v_producto.name, p_pieza, coalesce(p_superficies, '{}'),
          nullif(btrim(coalesce(p_region, '')), ''), coalesce(p_precio, v_producto.one_time_price, 0), coalesce(p_pagado, false),
          v_producto.es_urgencia, nullif(btrim(coalesce(p_profesional, '')), ''), nullif(btrim(coalesce(p_nota, '')), ''),
          v_fecha, auth.uid())
  returning id into v_id;

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
          to_char(coalesce(p_precio, v_producto.one_time_price, 0), 'FM$999G999G999') || case when p_pagado then ' · pagado' else ' · por cobrar' end,
          now(), true, auth.uid());

  return v_id;
end;
$$;

revoke all on function public.registrar_atencion(uuid, uuid, numeric, smallint, text[], uuid, text, text, text, date, boolean, boolean) from public, anon;
grant execute on function public.registrar_atencion(uuid, uuid, numeric, smallint, text[], uuid, text, text, text, date, boolean, boolean) to authenticated;

-- El arancel de partida de cada edición. Agrega lo que falta y completa los
-- datos del procedimiento, pero no pisa el precio que la clínica ya puso.
create or replace function public.aplicar_arancel_de_edicion(p_organization_id uuid, p_edicion text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  insert into public.sales_products (organization_id, code, name, one_time_price, categoria, duracion_min, es_urgencia, aplica_a, resultado_odontograma, orden)
  select p_organization_id, item.code, item.name, item.precio, item.categoria, item.duracion, item.urgencia, item.aplica, item.resultado, item.orden
  from (values
    -- Dental
    ('dental', 'evaluacion', 'Evaluación y diagnóstico', 25000, 'Diagnóstico', 30, false, 'boca', null, 10),
    ('dental', 'radiografia_retro', 'Radiografía retroalveolar', 8000, 'Diagnóstico', 10, false, 'pieza', null, 11),
    ('dental', 'radiografia_panoramica', 'Radiografía panorámica', 25000, 'Diagnóstico', 15, false, 'boca', null, 12),
    ('dental', 'urgencia', 'Consulta de urgencia', 35000, 'Urgencias', 30, true, 'boca', null, 20),
    ('dental', 'urgencia_fuera_horario', 'Urgencia fuera de horario', 60000, 'Urgencias', 45, true, 'boca', null, 21),
    ('dental', 'trepanacion', 'Trepanación de urgencia', 45000, 'Urgencias', 40, true, 'pieza', null, 22),
    ('dental', 'limpieza', 'Limpieza y profilaxis', 45000, 'Prevención', 45, false, 'boca', null, 30),
    ('dental', 'destartraje', 'Destartraje y pulido', 40000, 'Prevención', 40, false, 'boca', null, 31),
    ('dental', 'fluor', 'Aplicación de flúor', 15000, 'Prevención', 15, false, 'boca', null, 32),
    ('dental', 'sellante', 'Sellante de fosas y fisuras', 18000, 'Prevención', 15, false, 'superficie', 'sellante', 33),
    ('dental', 'restauracion', 'Restauración de resina (1 cara)', 45000, 'Operatoria', 40, false, 'superficie', 'obturacion', 40),
    ('dental', 'restauracion_2', 'Restauración de resina (2 caras)', 55000, 'Operatoria', 50, false, 'superficie', 'obturacion', 41),
    ('dental', 'restauracion_3', 'Restauración de resina (3 o más caras)', 65000, 'Operatoria', 60, false, 'superficie', 'obturacion', 42),
    ('dental', 'incrustacion', 'Incrustación cerámica', 280000, 'Operatoria', 90, false, 'superficie', 'obturacion', 43),
    ('dental', 'endodoncia', 'Endodoncia unirradicular', 180000, 'Endodoncia', 90, false, 'pieza', 'endodoncia', 50),
    ('dental', 'endodoncia_bi', 'Endodoncia birradicular', 220000, 'Endodoncia', 100, false, 'pieza', 'endodoncia', 51),
    ('dental', 'endodoncia_molar', 'Endodoncia molar', 260000, 'Endodoncia', 120, false, 'pieza', 'endodoncia', 52),
    ('dental', 'pulido_radicular', 'Pulido radicular por cuadrante', 60000, 'Periodoncia', 60, false, 'boca', null, 60),
    ('dental', 'extraccion', 'Extracción simple', 45000, 'Cirugía', 30, false, 'pieza', 'ausente', 70),
    ('dental', 'extraccion_quirurgica', 'Extracción quirúrgica', 90000, 'Cirugía', 60, false, 'pieza', 'ausente', 71),
    ('dental', 'tercer_molar', 'Extracción de tercer molar incluido', 150000, 'Cirugía', 75, false, 'pieza', 'ausente', 72),
    ('dental', 'implante', 'Implante oseointegrado', 1350000, 'Implantología', 90, false, 'pieza', 'implante', 80),
    ('dental', 'corona_implante', 'Corona sobre implante', 450000, 'Implantología', 60, false, 'pieza', 'implante', 81),
    ('dental', 'corona', 'Corona de disilicato de litio', 380000, 'Prótesis', 60, false, 'pieza', 'corona', 90),
    ('dental', 'corona_mp', 'Corona metal-porcelana', 300000, 'Prótesis', 60, false, 'pieza', 'corona', 91),
    ('dental', 'protesis', 'Prótesis removible acrílica', 650000, 'Prótesis', 60, false, 'boca', null, 92),
    ('dental', 'ortodoncia', 'Ortodoncia brackets estéticos', 1900000, 'Ortodoncia', 60, false, 'boca', null, 100),
    ('dental', 'control_ortodoncia', 'Control de ortodoncia', 35000, 'Ortodoncia', 30, false, 'boca', null, 101),
    ('dental', 'blanqueamiento', 'Blanqueamiento en clínica', 180000, 'Estética', 90, false, 'boca', null, 110),
    -- Vet
    ('vet', 'consulta', 'Consulta general', 22000, 'Consultas', 30, false, 'mascota', null, 10),
    ('vet', 'consulta_especialista', 'Consulta de especialista', 35000, 'Consultas', 40, false, 'mascota', null, 11),
    ('vet', 'control', 'Control', 15000, 'Consultas', 20, false, 'mascota', null, 12),
    ('vet', 'urgencia', 'Consulta de urgencia', 45000, 'Urgencias', 40, true, 'mascota', null, 20),
    ('vet', 'urgencia_nocturna', 'Urgencia nocturna', 70000, 'Urgencias', 45, true, 'mascota', null, 21),
    ('vet', 'hospitalizacion', 'Hospitalización (por día)', 55000, 'Urgencias', 1440, true, 'mascota', null, 22),
    ('vet', 'vacuna', 'Vacuna óctuple / triple felina', 18000, 'Vacunas', 15, false, 'mascota', null, 30),
    ('vet', 'vacuna_antirrabica', 'Vacuna antirrábica', 15000, 'Vacunas', 15, false, 'mascota', null, 31),
    ('vet', 'desparasitacion', 'Desparasitación interna', 12000, 'Vacunas', 10, false, 'mascota', null, 32),
    ('vet', 'antipulgas', 'Pipeta antipulgas', 15000, 'Vacunas', 10, false, 'mascota', null, 33),
    ('vet', 'microchip', 'Implantación de microchip', 20000, 'Vacunas', 10, false, 'mascota', null, 34),
    ('vet', 'examenes', 'Hemograma y perfil bioquímico', 55000, 'Laboratorio', 15, false, 'mascota', null, 40),
    ('vet', 'examen_orina', 'Examen de orina', 18000, 'Laboratorio', 10, false, 'mascota', null, 41),
    ('vet', 'radiografia', 'Radiografía', 30000, 'Imagenología', 20, false, 'region', null, 50),
    ('vet', 'ecografia', 'Ecografía abdominal', 45000, 'Imagenología', 30, false, 'region', null, 51),
    ('vet', 'esterilizacion', 'Esterilización hembra', 160000, 'Cirugías', 90, false, 'region', null, 60),
    ('vet', 'castracion', 'Castración macho', 120000, 'Cirugías', 60, false, 'region', null, 61),
    ('vet', 'cirugia', 'Cirugía de tejidos blandos', 450000, 'Cirugías', 120, false, 'region', null, 62),
    ('vet', 'cirugia_lca', 'Cirugía de ligamento cruzado', 890000, 'Cirugías', 150, false, 'region', null, 63),
    ('vet', 'extraccion_masa', 'Extracción de masa cutánea', 380000, 'Cirugías', 90, false, 'region', null, 64),
    ('vet', 'limpieza_dental', 'Limpieza dental con anestesia', 120000, 'Odontología', 60, false, 'region', null, 70),
    ('vet', 'peluqueria', 'Peluquería completa', 25000, 'Estética', 60, false, 'mascota', null, 80),
    ('vet', 'corte_unas', 'Corte de uñas', 8000, 'Estética', 10, false, 'mascota', null, 81)
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

revoke all on function public.aplicar_arancel_de_edicion(uuid, text) from public, anon, authenticated;
grant execute on function public.aplicar_arancel_de_edicion(uuid, text) to service_role;

-- Toda clínica nueva nace con su arancel: la plantilla lo agrega.
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
  end if;
  return new;
end;
$$;

-- Las clínicas que ya existen (las demo) reciben su arancel.
select public.aplicar_arancel_de_edicion(organization.id, organization.edicion)
from public.organizations organization
where organization.edicion in ('dental', 'vet');

-- Demo: atenciones pasadas, coherentes con lo que el odontograma ya dice que
-- está terminado (una obturación terminada se atendió y se cobró).
insert into public.atenciones (organization_id, cuenta_id, producto_id, descripcion, pieza, superficies, precio, pagado,
                               es_urgencia, profesional, fecha, created_at)
select registro.organization_id, registro.cuenta_id, producto.id, producto.name, registro.pieza, registro.superficies,
       producto.one_time_price, registro.fecha < current_date - 20, producto.es_urgencia, registro.profesional, registro.fecha, registro.created_at
from public.odontograma_registros registro
join public.organizations empresa on empresa.id = registro.organization_id and empresa.slug = 'demo-dental'
join lateral (
  select * from public.sales_products candidato
  where candidato.organization_id = registro.organization_id
    and candidato.code = case registro.estado
      when 'obturacion' then case coalesce(array_length(registro.superficies, 1), 1) when 1 then 'restauracion' when 2 then 'restauracion_2' else 'restauracion_3' end
      when 'sellante' then 'sellante'
      when 'corona' then 'corona'
      when 'endodoncia' then 'endodoncia_molar'
      when 'ausente' then 'extraccion'
    end
) producto on true
where registro.avance = 'terminado'
  and registro.estado in ('obturacion', 'sellante', 'corona', 'ausente')
  and not exists (select 1 from public.atenciones atencion where atencion.cuenta_id = registro.cuenta_id);

-- Y alguna urgencia y limpieza sueltas, que no son de una pieza.
insert into public.atenciones (organization_id, cuenta_id, producto_id, descripcion, precio, pagado, es_urgencia, profesional, fecha)
select cuenta.organization_id, cuenta.id, producto.id, producto.name, producto.one_time_price, true, producto.es_urgencia,
       cuenta.metadata ->> 'profesional', current_date - (5 + floor(random() * 80))::int
from public.sales_companies cuenta
join public.organizations empresa on empresa.id = cuenta.organization_id and empresa.slug = 'demo-dental'
join public.sales_products producto on producto.organization_id = cuenta.organization_id
  and producto.code = (array['limpieza', 'evaluacion', 'urgencia', 'radiografia_panoramica'])[1 + floor(random() * 4)::int]
where random() < 0.45;
