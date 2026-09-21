-- Radiografías y estudios adjuntos a la ficha.
--
-- Un estudio es un archivo (radiografía, ecografía, examen, foto, documento)
-- de un paciente o de una mascota, asociado si corresponde a una pieza dental o
-- a una zona del cuerpo. El archivo vive en un bucket privado, en una carpeta
-- por empresa: `<empresa>/<ficha>/<archivo>`. Solo quien llega a esa empresa
-- (administración, supervisión o el dueño de la plataforma) lo sube o lo ve, y
-- se abre con enlaces firmados que expiran.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estudios-clinicos', 'estudios-clinicos', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/dicom'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.estudios_clinicos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  mascota_id uuid references public.mascotas(id) on delete set null,
  pieza smallint,
  region text,
  tipo text not null default 'radiografia',
  titulo text not null,
  nota text,
  storage_path text not null,
  mime text not null,
  tamano integer,
  fecha date not null default ((now() at time zone 'America/Santiago')::date),
  subido_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint estudios_tipo_check check (tipo in ('radiografia', 'ecografia', 'laboratorio', 'foto', 'documento')),
  constraint estudios_titulo_not_blank check (btrim(titulo) <> ''),
  -- El archivo tiene que estar en la carpeta de su propia empresa.
  constraint estudios_ruta_de_la_empresa check (split_part(storage_path, '/', 1) = organization_id::text)
);

create index if not exists estudios_cuenta_idx on public.estudios_clinicos (cuenta_id, fecha desc);

alter table public.estudios_clinicos enable row level security;

drop policy if exists estudios_organization_isolation on public.estudios_clinicos;
create policy estudios_organization_isolation on public.estudios_clinicos
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists estudios_select on public.estudios_clinicos;
create policy estudios_select on public.estudios_clinicos
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

drop policy if exists estudios_insert on public.estudios_clinicos;
create policy estudios_insert on public.estudios_clinicos
  for insert to authenticated
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- El bucket: la primera carpeta es la empresa, y tiene que ser una a la que
-- llega quien sube o mira.
drop policy if exists estudios_clinicos_leer on storage.objects;
create policy estudios_clinicos_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'estudios-clinicos'
    and (storage.foldername(name))[1] = any (select unnest(public.current_org_ids())::text)
    and ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  );

drop policy if exists estudios_clinicos_subir on storage.objects;
create policy estudios_clinicos_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'estudios-clinicos'
    and (storage.foldername(name))[1] = any (select unnest(public.current_org_ids())::text)
    and ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  );
