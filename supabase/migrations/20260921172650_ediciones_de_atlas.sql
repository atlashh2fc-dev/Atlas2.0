-- Atlas se vende en ediciones: Center, Dental y Vet.
--
-- Es el mismo CRM. Lo que cambia por industria es con qué nace la empresa
-- (aplicaciones, etapas del embudo, catálogo), cómo se ve (color de acento y
-- sufijo del logo) y cómo habla. Lo primero vive acá; lo visual lo resuelve la
-- aplicación leyendo `organizations.edicion`.
--
-- La plantilla se COPIA al crear la empresa, no se referencia: desde ese momento
-- las etapas y los tratamientos son de la clínica y los edita ella. Cambiar la
-- plantilla mañana no toca a nadie que ya exista; `plantilla_version` deja
-- constancia de con cuál nació cada una.
--
-- Arregla de paso un error real: las etapas de venta se sembraron solo a las
-- empresas que existían el 17-09, así que una empresa nueva chocaba con "Tu
-- empresa no tiene etapas configuradas" al primer negocio.

alter table public.organizations
  add column if not exists edicion text not null default 'center',
  add column if not exists plantilla_version integer not null default 1;

alter table public.organizations
  drop constraint if exists organizations_edicion_check;

alter table public.organizations
  add constraint organizations_edicion_check check (edicion in ('center', 'dental', 'vet'));

comment on column public.organizations.edicion is
  'Edición de Atlas: center | dental | vet. Decide la plantilla con que nace la empresa, su color y su vocabulario.';
comment on column public.organizations.plantilla_version is
  'Versión de la plantilla de su edición con la que se creó la empresa.';

-- La plantilla. Solo agrega lo que falta: se puede volver a correr sin borrar
-- nada de lo que la empresa ya ajustó.
create or replace function public.aplicar_plantilla_de_edicion(p_organization_id uuid, p_edicion text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if p_edicion not in ('center', 'dental', 'vet') then
    raise exception 'Edición desconocida: %', p_edicion using errcode = '22023';
  end if;

  -- Aplicaciones. Center es la operación de contact center que ya corre en
  -- Geimser; Dental y Vet venden a personas y conversan por WhatsApp.
  insert into public.organization_modules (organization_id, module)
  select p_organization_id, modulo
  from unnest(case p_edicion
    when 'center' then array['leads', 'contact_center', 'correo', 'whatsapp']
    else array['leads', 'ventas_b2c', 'whatsapp', 'correo']
  end) as modulo
  on conflict do nothing;

  -- Etapas del embudo.
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
      ('vet', 'no_aceptado', 'No aceptado', 5, 0, false, true)
    ) as fila(edicion, key, name, position, probability, is_won, is_lost)
    where fila.edicion = p_edicion
  ) as etapa
  on conflict (organization_id, key) do nothing;

  -- Catálogo de partida. Sin precios: cada clínica pone los suyos, y un precio
  -- de referencia inventado terminaría en un presupuesto real.
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
$$;

-- Toda empresa nueva nace con la plantilla de su edición. El disparador ya
-- existía y sembraba solo `leads` y `ventas_b2b`; ahora siembra la edición.
create or replace function public.sembrar_modulos_de_empresa()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  perform public.aplicar_plantilla_de_edicion(new.id, new.edicion);
  return new;
end;
$$;

-- Crear una empresa ahora exige decir qué es. La firma anterior se retira para
-- que no queden dos versiones compitiendo en la llamada.
drop function if exists public.crear_organizacion(text, text);

create or replace function public.crear_organizacion(p_slug text, p_name text, p_edicion text default 'center')
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'Solo el dueño de la plataforma crea empresas' using errcode = '42501';
  end if;

  if coalesce(p_edicion, '') not in ('center', 'dental', 'vet') then
    raise exception 'Elige una edición: Center, Dental o Vet' using errcode = '22023';
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
$$;

-- Todo lo que el panel necesita saber de la empresa, en un solo viaje: edición,
-- aplicaciones y a qué empresas llega la persona. Antes eran consultas separadas
-- que el layout esperaba una detrás de otra en cada navegación.
create or replace function public.contexto_de_mi_empresa()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with actual as (select public.current_org_id() as id)
  select jsonb_build_object(
    'edicion', coalesce(
      (select organization.edicion from public.organizations organization where organization.id = (select id from actual)),
      'center'
    ),
    'modulos', coalesce(
      (select jsonb_agg(modulo.module order by modulo.module)
       from public.organization_modules modulo
       where modulo.organization_id = (select id from actual) and modulo.enabled),
      '[]'::jsonb
    ),
    'empresas', coalesce(
      (select jsonb_agg(jsonb_build_object('id', organization.id, 'name', organization.name) order by organization.name)
       from public.organizations organization
       where organization.active
         and (public.is_platform_owner() or organization.id = any (public.current_org_ids()))),
      '[]'::jsonb
    )
  );
$$;

-- Lo que el dueño de la plataforma ve de cada empresa en la administración.
drop function if exists public.aplicaciones_de_las_empresas();
create function public.aplicaciones_de_las_empresas()
returns table(organization_id uuid, slug text, name text, edicion text, module text, enabled boolean)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select organization.id, organization.slug, organization.name, organization.edicion, modulo.module, coalesce(modulo.enabled, false)
  from public.organizations organization
  left join public.organization_modules modulo on modulo.organization_id = organization.id
  where public.is_platform_owner()
  order by organization.name, modulo.module;
$$;

revoke all on function public.aplicar_plantilla_de_edicion(uuid, text) from public;
revoke all on function public.crear_organizacion(text, text, text) from public;
revoke all on function public.contexto_de_mi_empresa() from public;
revoke all on function public.aplicaciones_de_las_empresas() from public;
revoke execute on function public.aplicar_plantilla_de_edicion(uuid, text) from anon, authenticated;
revoke execute on function public.crear_organizacion(text, text, text) from anon;
revoke execute on function public.contexto_de_mi_empresa() from anon;
revoke execute on function public.aplicaciones_de_las_empresas() from anon;
grant execute on function public.aplicar_plantilla_de_edicion(uuid, text) to service_role;
grant execute on function public.crear_organizacion(text, text, text) to authenticated, service_role;
grant execute on function public.contexto_de_mi_empresa() to authenticated, service_role;
grant execute on function public.aplicaciones_de_las_empresas() to authenticated, service_role;

do $$
begin
  if exists (select 1 from public.organizations where edicion <> 'center') then
    raise exception 'Las empresas existentes debían quedar como Center';
  end if;
  if has_function_privilege('anon', 'public.contexto_de_mi_empresa()', 'execute') then
    raise exception 'Un visitante sin sesión puede leer el contexto de una empresa';
  end if;
  if has_function_privilege('authenticated', 'public.aplicar_plantilla_de_edicion(uuid, text)', 'execute') then
    raise exception 'Cualquier sesión podría reaplicar una plantilla';
  end if;
end;
$$;
