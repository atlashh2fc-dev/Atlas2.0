-- Cada empresa ve lo que tiene contratado, y nada más.
--
-- Atlas 2.0 es una plataforma de leads y ventas. El call center (voz, discador,
-- agentes, colas, grabaciones) es un producto aparte: Geimser lo tiene, Altius
-- no. Hasta ahora el menú era una lista fija, así que Altius veía "Campañas",
-- "Grabaciones" o "Estados de agente" sin tener un solo teléfono conectado.
--
-- El módulo contratado es un hecho de la empresa, no una preferencia de la
-- pantalla: por eso vive acá y el menú lo lee, en vez de adivinarlo.

create table if not exists public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, module),
  constraint organization_modules_module_check check (module in (
    'leads',           -- captación y gestión de registros: la base de todo
    'ventas_b2b',      -- embudo de empresas: monto mensual, etapa, próxima acción
    'ventas_b2c',      -- venta a consumidor final
    'contact_center',  -- voz, discador, agentes, colas, grabaciones y calidad
    'correo',          -- campañas de correo y sus respuestas
    'whatsapp'         -- canal WhatsApp con o sin IA
  ))
);

comment on table public.organization_modules is
  'Productos contratados por cada empresa. El menú y las rutas se arman con esto.';

alter table public.organization_modules enable row level security;

drop policy if exists organization_modules_select on public.organization_modules;
create policy organization_modules_select on public.organization_modules
  for select to authenticated
  using (organization_id = any (public.current_org_ids()));

-- Contratar o dar de baja un módulo es cosa del dueño de la plataforma.
drop policy if exists organization_modules_write on public.organization_modules;
create policy organization_modules_write on public.organization_modules
  for all to authenticated
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

-- Geimser: call center completo. Altius: leads y venta B2B, sin teléfonos.
insert into public.organization_modules (organization_id, module)
select public.organization_id_by_slug('geimser'), unnest(array['leads', 'contact_center', 'correo', 'whatsapp'])
on conflict do nothing;

insert into public.organization_modules (organization_id, module)
select public.organization_id_by_slug('altius'), unnest(array['leads', 'ventas_b2b', 'correo'])
on conflict do nothing;

-- Una empresa nueva nace vendiendo: leads y embudo B2B.
create or replace function public.sembrar_modulos_de_empresa()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  insert into public.organization_modules (organization_id, module)
  values (new.id, 'leads'), (new.id, 'ventas_b2b')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_sembrar_modulos on public.organizations;
create trigger organizations_sembrar_modulos
  after insert on public.organizations
  for each row execute function public.sembrar_modulos_de_empresa();

-- Lo que la aplicación pregunta: ¿qué tiene contratado la empresa que miro?
create or replace function public.modulos_de_mi_empresa()
returns text[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(
    (select array_agg(module order by module)
     from public.organization_modules
     where organization_id = public.current_org_id() and enabled),
    '{}'::text[]
  );
$$;

-- Y la versión de una sola pregunta, para cerrar rutas en el servidor.
create or replace function public.org_tiene_modulo(p_module text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1 from public.organization_modules
    where organization_id = public.current_org_id()
      and module = p_module
      and enabled
  );
$$;

revoke all on function public.sembrar_modulos_de_empresa() from public;
revoke all on function public.modulos_de_mi_empresa() from public;
revoke all on function public.org_tiene_modulo(text) from public;
revoke execute on function public.modulos_de_mi_empresa() from anon;
revoke execute on function public.org_tiene_modulo(text) from anon;
grant execute on function public.modulos_de_mi_empresa() to authenticated, service_role;
grant execute on function public.org_tiene_modulo(text) to authenticated, service_role;

do $$
begin
  if (select count(*) from public.organization_modules) < 7 then
    raise exception 'Los módulos de las dos empresas no quedaron sembrados';
  end if;
  if has_function_privilege('anon', 'public.modulos_de_mi_empresa()', 'execute') then
    raise exception 'Un visitante sin sesión puede preguntar por los módulos';
  end if;
end;
$$;
