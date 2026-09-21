-- Mapa clínico de la mascota: lo que se encontró o se trató en cada zona del
-- cuerpo, sobre el modelo 3D de su especie y raza.
--
-- Igual que el odontograma, es historia: se agrega y no se sobreescribe. Cada
-- registro lleva la zona (cabeza, tórax, pata trasera derecha...) y, si se marcó
-- sobre el modelo, el punto exacto, para volver a dibujar el marcador ahí.

create table if not exists public.mascota_registros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  mascota_id uuid not null references public.mascotas(id) on delete cascade,
  region text not null,
  punto jsonb,
  tipo text not null,
  titulo text not null,
  detalle text,
  avance text not null default 'diagnostico',
  profesional text,
  fecha date not null default ((now() at time zone 'America/Santiago')::date),
  registrado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mascota_registros_titulo_not_blank check (btrim(titulo) <> ''),
  constraint mascota_registros_region_check check (region in (
    'cabeza', 'ojos', 'oidos', 'boca', 'cuello', 'torax', 'abdomen', 'lomo', 'cadera',
    'pata_delantera_izquierda', 'pata_delantera_derecha', 'pata_trasera_izquierda', 'pata_trasera_derecha',
    'cola', 'piel'
  )),
  constraint mascota_registros_tipo_check check (tipo in ('hallazgo', 'enfermedad', 'lesion', 'tratamiento', 'cirugia', 'control')),
  constraint mascota_registros_avance_check check (avance in ('diagnostico', 'planificado', 'en_curso', 'terminado'))
);

create index if not exists mascota_registros_mascota_idx on public.mascota_registros (mascota_id, fecha desc);

alter table public.mascota_registros enable row level security;

drop policy if exists mascota_registros_organization_isolation on public.mascota_registros;
create policy mascota_registros_organization_isolation on public.mascota_registros
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists mascota_registros_select on public.mascota_registros;
create policy mascota_registros_select on public.mascota_registros
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

drop policy if exists mascota_registros_insert on public.mascota_registros;
create policy mascota_registros_insert on public.mascota_registros
  for insert to authenticated
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- Demo: Veterinaria Patitas. Cada mascota con lo que dice su plan y algo de
-- historia, en la zona que corresponde.
do $$
declare
  v_org uuid := (select id from public.organizations where slug = 'demo-vet');
  v_mascota record;
  v_plan text;
  v_estado text;
  v_prof text;
begin
  if v_org is null or exists (select 1 from public.mascota_registros where organization_id = v_org) then
    return;
  end if;

  for v_mascota in
    select mascota.*, cuenta.metadata ->> 'profesional' as profesional
    from public.mascotas mascota
    join public.sales_companies cuenta on cuenta.id = mascota.cuenta_id
    where mascota.organization_id = v_org
  loop
    v_prof := coalesce(v_mascota.profesional, 'Dra. Fernanda Lagos');

    -- Lo que dice su plan de tratamiento (sin plan, las variables quedan vacías).
    v_plan := null;
    v_estado := null;
    select negocio.name, negocio.status into v_plan, v_estado
    from public.sales_opportunities negocio
    where negocio.company_id = v_mascota.cuenta_id and negocio.name ilike '%' || v_mascota.nombre
    order by negocio.created_at desc limit 1;

    if v_plan ilike 'Esterilización%' then
      insert into public.mascota_registros (organization_id, cuenta_id, mascota_id, region, tipo, titulo, detalle, avance, profesional, fecha)
      values (v_org, v_mascota.cuenta_id, v_mascota.id,
              case when v_mascota.sexo = 'Macho' then 'cadera' else 'abdomen' end, 'cirugia',
              case when v_mascota.sexo = 'Macho' then 'Orquiectomía (castración)' else 'Ovariohisterectomía' end,
              'Exámenes preoperatorios normales. Ayuno de 12 horas.', case v_estado when 'ganada' then 'en_curso' else 'planificado' end, v_prof, current_date - 5);
    elsif v_plan ilike 'Cirugía de ligamento%' then
      insert into public.mascota_registros (organization_id, cuenta_id, mascota_id, region, tipo, titulo, detalle, avance, profesional, fecha)
      values
        (v_org, v_mascota.cuenta_id, v_mascota.id, 'pata_trasera_derecha', 'lesion', 'Rotura de ligamento cruzado craneal',
         'Claudicación sin apoyo, signo del cajón positivo.', 'terminado', v_prof, current_date - 18),
        (v_org, v_mascota.cuenta_id, v_mascota.id, 'pata_trasera_derecha', 'cirugia', 'TPLO (osteotomía niveladora de meseta tibial)',
         'Reposo estricto 8 semanas después de la cirugía.', case v_estado when 'ganada' then 'en_curso' else 'planificado' end, v_prof, current_date - 6);
    elsif v_plan ilike 'Limpieza dental%' then
      insert into public.mascota_registros (organization_id, cuenta_id, mascota_id, region, tipo, titulo, detalle, avance, profesional, fecha)
      values
        (v_org, v_mascota.cuenta_id, v_mascota.id, 'boca', 'enfermedad', 'Enfermedad periodontal grado II',
         'Sarro abundante en premolares y halitosis.', 'terminado', v_prof, current_date - 12),
        (v_org, v_mascota.cuenta_id, v_mascota.id, 'boca', 'tratamiento', 'Destartraje y pulido bajo anestesia',
         null, case v_estado when 'ganada' then 'en_curso' else 'planificado' end, v_prof, current_date - 4);
    elsif v_plan ilike 'Extracción de masa%' then
      insert into public.mascota_registros (organization_id, cuenta_id, mascota_id, region, punto, tipo, titulo, detalle, avance, profesional, fecha)
      values
        (v_org, v_mascota.cuenta_id, v_mascota.id, 'torax', null, 'hallazgo', 'Masa subcutánea de 2 cm',
         'Móvil, no dolorosa. Citología compatible con lipoma.', 'terminado', v_prof, current_date - 15),
        (v_org, v_mascota.cuenta_id, v_mascota.id, 'torax', null, 'cirugia', 'Extracción de masa cutánea',
         'Enviar a biopsia.', case v_estado when 'ganada' then 'en_curso' else 'planificado' end, v_prof, current_date - 3);
    elsif v_plan ilike 'Chequeo senior%' then
      insert into public.mascota_registros (organization_id, cuenta_id, mascota_id, region, tipo, titulo, detalle, avance, profesional, fecha)
      values (v_org, v_mascota.cuenta_id, v_mascota.id, 'abdomen', 'control', 'Chequeo senior: perfil renal y hepático',
              'Control anual por edad.', case v_estado when 'ganada' then 'en_curso' else 'planificado' end, v_prof, current_date - 7);
    end if;

    -- Historia suelta, típica de consulta.
    if random() < 0.35 then
      insert into public.mascota_registros (organization_id, cuenta_id, mascota_id, region, tipo, titulo, detalle, avance, profesional, fecha)
      values (v_org, v_mascota.cuenta_id, v_mascota.id, 'oidos', 'enfermedad', 'Otitis externa',
              'Tratamiento con gotas óticas 10 días.', 'terminado', v_prof, current_date - (30 + floor(random() * 300))::int);
    end if;
    if random() < 0.25 then
      insert into public.mascota_registros (organization_id, cuenta_id, mascota_id, region, tipo, titulo, detalle, avance, profesional, fecha)
      values (v_org, v_mascota.cuenta_id, v_mascota.id, 'piel', 'enfermedad', 'Dermatitis alérgica',
              'Prurito en zona lumbar. Cambio de alimento.', (array['en_curso', 'terminado'])[1 + floor(random() * 2)::int], v_prof, current_date - (10 + floor(random() * 200))::int);
    end if;
    if random() < 0.2 then
      insert into public.mascota_registros (organization_id, cuenta_id, mascota_id, region, tipo, titulo, detalle, avance, profesional, fecha)
      values (v_org, v_mascota.cuenta_id, v_mascota.id, 'ojos', 'enfermedad', 'Conjuntivitis',
              'Colirio antibiótico 7 días.', 'terminado', v_prof, current_date - (20 + floor(random() * 250))::int);
    end if;
    if random() < 0.15 then
      insert into public.mascota_registros (organization_id, cuenta_id, mascota_id, region, tipo, titulo, detalle, avance, profesional, fecha)
      values (v_org, v_mascota.cuenta_id, v_mascota.id, 'pata_delantera_izquierda', 'lesion', 'Herida en almohadilla',
              'Limpieza y vendaje. Control en 5 días.', 'terminado', v_prof, current_date - (15 + floor(random() * 150))::int);
    end if;
  end loop;
end;
$$;

-- Atenciones de la demo de Vet: las consultas, vacunas y cirugías ya hechas.
insert into public.atenciones (organization_id, cuenta_id, mascota_id, producto_id, descripcion, region, precio, pagado, es_urgencia, profesional, fecha)
select registro.organization_id, registro.cuenta_id, registro.mascota_id, producto.id, producto.name, registro.region,
       producto.one_time_price, true, producto.es_urgencia, registro.profesional, registro.fecha
from public.mascota_registros registro
join public.organizations empresa on empresa.id = registro.organization_id and empresa.slug = 'demo-vet'
join public.sales_products producto on producto.organization_id = registro.organization_id
  and producto.code = case when registro.tipo in ('enfermedad', 'lesion') then 'consulta' when registro.tipo = 'control' then 'examenes' else 'control' end
where registro.avance = 'terminado'
  and not exists (select 1 from public.atenciones atencion where atencion.mascota_id = registro.mascota_id);

insert into public.atenciones (organization_id, cuenta_id, mascota_id, producto_id, descripcion, precio, pagado, profesional, fecha)
select mascota.organization_id, mascota.cuenta_id, mascota.id, producto.id, producto.name, producto.one_time_price,
       true, cuenta.metadata ->> 'profesional', mascota.ultima_vacuna
from public.mascotas mascota
join public.sales_companies cuenta on cuenta.id = mascota.cuenta_id
join public.organizations empresa on empresa.id = mascota.organization_id and empresa.slug = 'demo-vet'
join public.sales_products producto on producto.organization_id = mascota.organization_id and producto.code = 'vacuna'
where mascota.ultima_vacuna is not null and mascota.ultima_vacuna <= current_date;
