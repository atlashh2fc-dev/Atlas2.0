-- Mascotas realistas: un modelo 3D por raza, hecho con IA desde una foto de
-- estudio (fal). La consola de plataforma genera las pruebas con varios
-- motores, se comparan en el visor y se elige uno por raza; la ficha de Vet usa
-- el elegido y, si la raza no tiene, sigue con el modelo procedural.
--
-- Los modelos son de la raza, no de un paciente: no llevan datos de nadie y se
-- sirven desde un bucket público.

create table if not exists public.mascota_modelos (
  id uuid primary key default gen_random_uuid(),
  especie text not null check (especie in ('Perro', 'Gato')),
  raza text not null,
  motor text not null,
  estado text not null default 'generando' check (estado in ('generando', 'guardando', 'listo', 'fallido')),
  foto_path text,
  modelo_path text,
  solicitud jsonb,
  error text,
  segundos integer,
  elegido boolean not null default false,
  -- Corrección manual de hacia dónde mira, si el ajuste automático se equivoca.
  giro smallint not null default 0 check (giro in (0, 90, 180, 270)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mascota_modelos_raza_idx on public.mascota_modelos (especie, raza, created_at desc);
create unique index if not exists mascota_modelos_un_elegido_por_raza on public.mascota_modelos (especie, raza) where elegido;

alter table public.mascota_modelos enable row level security;

-- Cualquier sesión ve el modelo elegido de cada raza (lo usa la ficha); las
-- pruebas y la escritura pasan por el servidor, después de comprobar que es el
-- dueño de la plataforma.
drop policy if exists mascota_modelos_elegidos on public.mascota_modelos;
create policy mascota_modelos_elegidos on public.mascota_modelos
  for select to authenticated
  using (elegido);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mascota-modelos', 'mascota-modelos', true, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary', 'application/octet-stream'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
