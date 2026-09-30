-- Estudio de Look (Atlas Barber).
--
-- En el sillón: el barbero saca una foto al cliente, la IA lee sus facciones y
-- su pelo, propone cortes, simula cómo le quedarían y deja un mapa de corte por
-- zona que el barbero sigue y corrige. Todo queda en la ficha del cliente.
--
-- La foto de una cara es un dato sensible: nada se guarda sin el
-- consentimiento del cliente registrado antes, las fotos originales se borran
-- a los 90 días y revocar el consentimiento las borra en el momento.

-- ---------------------------------------------------------------------------
-- Consentimiento del cliente para fotografiarlo y procesar su imagen.
-- ---------------------------------------------------------------------------
create table if not exists public.consentimientos_de_imagen (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  texto_version text not null default 'look-v1',
  otorgado_at timestamptz not null default now(),
  registrado_por uuid references public.profiles(id) on delete set null,
  revocado_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists consentimientos_de_imagen_vigente_uidx
  on public.consentimientos_de_imagen (cuenta_id) where revocado_at is null;

-- ---------------------------------------------------------------------------
-- Un look: una sesión del Estudio con un cliente.
-- ---------------------------------------------------------------------------
create table if not exists public.looks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  -- capturado → analizado → aprobado → realizado; o descartado.
  estado text not null default 'capturado',
  foto_path text,
  foto_perfil_path text,
  foto_despues_path text,
  pedido text,
  analisis jsonb,
  propuesta_aprobada uuid,
  barbero text,
  compartir_token text,
  fotos_borradas_at timestamptz,
  creado_por uuid references public.profiles(id) on delete set null,
  aprobado_at timestamptz,
  realizado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint looks_estado_check check (estado in ('capturado', 'analizado', 'aprobado', 'realizado', 'descartado')),
  constraint looks_fotos_de_la_empresa check (
    (foto_path is null or split_part(foto_path, '/', 1) = organization_id::text)
    and (foto_perfil_path is null or split_part(foto_perfil_path, '/', 1) = organization_id::text)
    and (foto_despues_path is null or split_part(foto_despues_path, '/', 1) = organization_id::text)
  ),
  constraint looks_token_largo check (compartir_token is null or length(compartir_token) >= 32)
);

create index if not exists looks_cuenta_idx on public.looks (cuenta_id, created_at desc);
create unique index if not exists looks_token_uidx on public.looks (compartir_token) where compartir_token is not null;

create table if not exists public.look_propuestas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  look_id uuid not null references public.looks(id) on delete cascade,
  orden integer not null default 0,
  nombre text not null,
  corte_base text,
  por_que text not null default '',
  que_decirle text,
  mantencion_semanas integer not null default 4,
  dificultad text not null default 'media',
  barba text,
  descripcion_visual text not null default '',
  mapa jsonb not null,
  -- ia: la propuso el análisis; reglas: el catálogo por facciones; barbero: la eligió él.
  origen text not null default 'ia',
  -- vista → ruta del archivo en el bucket.
  vistas jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint look_propuestas_nombre_not_blank check (btrim(nombre) <> ''),
  constraint look_propuestas_dificultad_check check (dificultad in ('baja', 'media', 'alta')),
  constraint look_propuestas_origen_check check (origen in ('ia', 'reglas', 'barbero'))
);

create index if not exists look_propuestas_look_idx on public.look_propuestas (look_id, orden);

alter table public.looks drop constraint if exists looks_propuesta_aprobada_fkey;
alter table public.looks add constraint looks_propuesta_aprobada_fkey
  foreign key (propuesta_aprobada) references public.look_propuestas(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Mapa de corte: lo que el barbero hizo, por zona. Solo se agregan filas: el
-- vigente es el último, y la historia muestra cómo cambió el corte.
-- ---------------------------------------------------------------------------
create table if not exists public.mapas_de_corte (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  look_id uuid references public.looks(id) on delete set null,
  nombre text,
  mapa jsonb not null,
  nota text,
  profesional text,
  fecha date not null default ((now() at time zone 'America/Santiago')::date),
  registrado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists mapas_de_corte_cuenta_idx on public.mapas_de_corte (cuenta_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Uso de IA: cada análisis e imagen generada, para el tope diario y el costo.
-- ---------------------------------------------------------------------------
create table if not exists public.uso_ia_looks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  look_id uuid references public.looks(id) on delete set null,
  tipo text not null,
  proveedor text not null,
  modelo text,
  ok boolean not null default true,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint uso_ia_looks_tipo_check check (tipo in ('analisis', 'imagen'))
);

create index if not exists uso_ia_looks_dia_idx on public.uso_ia_looks (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Seguridad: el patrón de las tablas de clínica. Aislamiento por empresa y
-- lectura/escritura para admin, supervisor o el dueño de la plataforma.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['consentimientos_de_imagen', 'looks', 'look_propuestas', 'mapas_de_corte', 'uso_ia_looks'] loop
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('drop policy if exists %I on public.%I', v_tabla || '_organization_isolation', v_tabla);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (organization_id = any (public.current_org_ids())) with check (organization_id = any (public.current_org_ids()))',
      v_tabla || '_organization_isolation', v_tabla);
    execute format('drop policy if exists %I on public.%I', v_tabla || '_select', v_tabla);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_role_name()) = any (array[''admin''::public.app_role, ''supervisor''::public.app_role]) or public.is_platform_owner())',
      v_tabla || '_select', v_tabla);
  end loop;

  -- Escritura: todas menos el uso de IA, que solo registra el servidor.
  foreach v_tabla in array array['consentimientos_de_imagen', 'looks', 'look_propuestas', 'mapas_de_corte'] loop
    execute format('drop policy if exists %I on public.%I', v_tabla || '_insert', v_tabla);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.current_role_name()) = any (array[''admin''::public.app_role, ''supervisor''::public.app_role]) or public.is_platform_owner())',
      v_tabla || '_insert', v_tabla);
  end loop;
  foreach v_tabla in array array['consentimientos_de_imagen', 'looks', 'look_propuestas'] loop
    execute format('drop policy if exists %I on public.%I', v_tabla || '_update', v_tabla);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.current_role_name()) = any (array[''admin''::public.app_role, ''supervisor''::public.app_role]) or public.is_platform_owner()) with check ((select public.current_role_name()) = any (array[''admin''::public.app_role, ''supervisor''::public.app_role]) or public.is_platform_owner())',
      v_tabla || '_update', v_tabla);
  end loop;
end;
$$;

-- Un look solo nace si el cliente dio su consentimiento y no lo revocó.
create or replace function public.look_exige_consentimiento()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not exists (
    select 1 from public.consentimientos_de_imagen c
     where c.cuenta_id = new.cuenta_id and c.revocado_at is null
  ) then
    raise exception 'El cliente todavía no autoriza fotos' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists looks_exige_consentimiento on public.looks;
create trigger looks_exige_consentimiento
  before insert on public.looks
  for each row execute function public.look_exige_consentimiento();

create or replace function public.look_al_dia()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists looks_al_dia on public.looks;
create trigger looks_al_dia
  before update on public.looks
  for each row execute function public.look_al_dia();

-- ---------------------------------------------------------------------------
-- El bucket: privado, solo imágenes, carpeta de la empresa primero.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('looks', 'looks', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists looks_leer on storage.objects;
create policy looks_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'looks'
    and (storage.foldername(name))[1] = any (select unnest(public.current_org_ids())::text)
    and ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  );

drop policy if exists looks_subir on storage.objects;
create policy looks_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'looks'
    and (storage.foldername(name))[1] = any (select unnest(public.current_org_ids())::text)
    and ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  );

-- ---------------------------------------------------------------------------
-- El look compartido: lo que ve el cliente en su enlace, sin sesión. Solo el
-- servidor (clave de servicio) lo lee, por el token.
-- ---------------------------------------------------------------------------
create or replace function public.look_compartido(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'id', look.id,
    'organization_id', look.organization_id,
    'empresa', organizacion.name,
    'cliente', split_part(cuenta.name, ' ', 1),
    'barbero', look.barbero,
    'fecha', (look.aprobado_at at time zone 'America/Santiago')::date,
    'propuesta', jsonb_build_object(
      'nombre', propuesta.nombre,
      'por_que', propuesta.por_que,
      'mantencion_semanas', propuesta.mantencion_semanas,
      'barba', propuesta.barba,
      'mapa', propuesta.mapa,
      'vistas', propuesta.vistas
    )
  )
  from public.looks look
  join public.organizations organizacion on organizacion.id = look.organization_id
  join public.sales_companies cuenta on cuenta.id = look.cuenta_id
  join public.look_propuestas propuesta on propuesta.id = look.propuesta_aprobada
  where look.compartir_token = p_token
    and length(p_token) >= 32
    and look.estado in ('aprobado', 'realizado');
$function$;

revoke all on function public.look_compartido(text) from public, anon, authenticated;
grant execute on function public.look_compartido(text) to service_role;

-- Auto-verificación.
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'looks' and not public) then
    raise exception 'El bucket looks no quedó privado';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'looks') < 4 then
    raise exception 'looks quedó sin políticas';
  end if;
end;
$$;
