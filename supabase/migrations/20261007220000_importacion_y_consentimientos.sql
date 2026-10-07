-- Importar fichas desde una planilla y consentimiento informado.
--
-- 1. Una clínica que llega a Atlas trae cientos de pacientes en un Excel. La
--    importación los carga de una vez: busca cada persona por celular, RUT o
--    correo (no duplica), completa lo que falta y, en Vet, crea su mascota.
--    Corre con la sesión de quien importa: la seguridad por fila decide la
--    empresa.
-- 2. El consentimiento informado: plantillas por empresa (cirugía, anestesia,
--    blanqueamiento, extracción…) que se convierten en un documento de la
--    ficha y se firman en pantalla (tablet en el mesón) o por un enlace que
--    se manda por WhatsApp. Queda el texto exacto que se firmó, el nombre, el
--    RUT, la firma y la hora.

-- ---------------------------------------------------------------------------
-- Importación.
-- ---------------------------------------------------------------------------
create or replace function public.importar_fichas(p_filas jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid := public.current_org_id();
  v_edicion text;
  v_fila jsonb;
  v_indice integer := 0;
  v_nombre text;
  v_telefono text;
  v_digitos text;
  v_correo text;
  v_rut text;
  v_rut_limpio text;
  v_cuenta uuid;
  v_mascota text;
  v_creadas integer := 0;
  v_actualizadas integer := 0;
  v_mascotas integer := 0;
  v_errores jsonb := '[]'::jsonb;
  v_nacimiento date;
begin
  if v_org is null then raise exception 'Elige una empresa antes de importar' using errcode = '22023'; end if;
  if (select public.current_role_name()) not in ('admin', 'supervisor') and not public.is_platform_owner() then
    raise exception 'Solo administración o supervisión importa fichas' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'La planilla no trae filas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 5000 then
    raise exception 'Máximo 5.000 filas por vez: divide la planilla' using errcode = '22023';
  end if;
  select edicion into v_edicion from public.organizations where id = v_org;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    v_indice := v_indice + 1;
    begin
      v_nombre := nullif(btrim(regexp_replace(coalesce(v_fila->>'nombre', ''), '\s+', ' ', 'g')), '');
      v_digitos := regexp_replace(coalesce(v_fila->>'telefono', ''), '\D', '', 'g');
      if length(v_digitos) = 9 and left(v_digitos, 1) = '9' then v_digitos := '56' || v_digitos; end if;
      v_telefono := case when length(v_digitos) >= 8 then '+' || v_digitos end;
      v_correo := nullif(lower(btrim(coalesce(v_fila->>'correo', ''))), '');
      if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_correo := null; end if;
      v_rut := nullif(btrim(coalesce(v_fila->>'rut', '')), '');
      v_rut_limpio := upper(regexp_replace(coalesce(v_rut, ''), '[^0-9kK]', '', 'g'));

      if v_nombre is null or length(v_nombre) < 2 then
        v_errores := v_errores || jsonb_build_object('fila', v_indice, 'motivo', 'Sin nombre');
        continue;
      end if;
      if v_telefono is null and v_correo is null and v_rut_limpio = '' then
        v_errores := v_errores || jsonb_build_object('fila', v_indice, 'motivo', 'Sin celular, correo ni RUT');
        continue;
      end if;

      v_cuenta := null;
      if v_telefono is not null then
        select id into v_cuenta from public.sales_companies
         where organization_id = v_org and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) = right(v_digitos, 8)
         order by updated_at desc limit 1;
      end if;
      if v_cuenta is null and length(v_rut_limpio) >= 7 then
        select id into v_cuenta from public.sales_companies
         where organization_id = v_org and upper(regexp_replace(coalesce(rut, ''), '[^0-9kK]', '', 'g')) = v_rut_limpio
         order by updated_at desc limit 1;
      end if;
      if v_cuenta is null and v_correo is not null then
        select id into v_cuenta from public.sales_companies
         where organization_id = v_org and lower(btrim(coalesce(email, ''))) = v_correo
         order by updated_at desc limit 1;
      end if;

      if v_cuenta is null then
        insert into public.sales_companies (organization_id, name, rut, phone, email, commune, source, metadata)
        values (v_org, v_nombre, v_rut, v_telefono, v_correo, nullif(btrim(coalesce(v_fila->>'comuna', '')), ''), 'importacion',
                jsonb_build_object('origen', 'importacion') || case when nullif(btrim(coalesce(v_fila->>'nota', '')), '') is not null
                                                                    then jsonb_build_object('nota_importada', left(v_fila->>'nota', 500)) else '{}'::jsonb end)
        returning id into v_cuenta;
        v_creadas := v_creadas + 1;
      else
        update public.sales_companies
           set rut = coalesce(nullif(btrim(rut), ''), v_rut),
               phone = coalesce(nullif(btrim(phone), ''), v_telefono),
               email = coalesce(nullif(btrim(email), ''), v_correo),
               commune = coalesce(nullif(btrim(commune), ''), nullif(btrim(coalesce(v_fila->>'comuna', '')), '')),
               updated_at = now()
         where id = v_cuenta;
        v_actualizadas := v_actualizadas + 1;
      end if;

      v_mascota := nullif(btrim(coalesce(v_fila->>'mascota', '')), '');
      if v_edicion = 'vet' and v_mascota is not null
         and not exists (select 1 from public.mascotas where cuenta_id = v_cuenta and lower(nombre) = lower(v_mascota)) then
        v_nacimiento := null;
        begin
          v_nacimiento := nullif(btrim(coalesce(v_fila->>'nacimiento', '')), '')::date;
        exception when others then v_nacimiento := null;
        end;
        insert into public.mascotas (organization_id, cuenta_id, nombre, especie, raza, sexo, nacimiento)
        values (v_org, v_cuenta, initcap(v_mascota), coalesce(nullif(initcap(btrim(coalesce(v_fila->>'especie', ''))), ''), 'Perro'),
                nullif(btrim(coalesce(v_fila->>'raza', '')), ''), nullif(btrim(coalesce(v_fila->>'sexo', '')), ''), v_nacimiento);
        v_mascotas := v_mascotas + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object('fila', v_indice, 'motivo', left(sqlerrm, 160));
    end;
  end loop;

  return jsonb_build_object('creadas', v_creadas, 'actualizadas', v_actualizadas, 'mascotas', v_mascotas,
                            'omitidas', jsonb_array_length(v_errores), 'errores', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(v_errores) e limit 50) x));
end;
$$;

revoke all on function public.importar_fichas(jsonb) from public, anon;
grant execute on function public.importar_fichas(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Consentimiento informado.
-- ---------------------------------------------------------------------------
create table if not exists public.plantillas_consentimiento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo text not null,
  texto text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plantillas_consentimiento_titulo check (btrim(titulo) <> '' and length(titulo) <= 120),
  constraint plantillas_consentimiento_texto check (length(texto) between 20 and 20000)
);

alter table public.plantillas_consentimiento enable row level security;
drop policy if exists plantillas_consentimiento_organization_isolation on public.plantillas_consentimiento;
create policy plantillas_consentimiento_organization_isolation on public.plantillas_consentimiento
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));
drop policy if exists plantillas_consentimiento_rw on public.plantillas_consentimiento;
create policy plantillas_consentimiento_rw on public.plantillas_consentimiento
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

create table if not exists public.consentimientos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  mascota_id uuid references public.mascotas(id) on delete set null,
  plantilla_id uuid references public.plantillas_consentimiento(id) on delete set null,
  titulo text not null,
  texto text not null,
  estado text not null default 'pendiente',
  firmante_nombre text,
  firmante_rut text,
  firma_svg text,
  firmado_at timestamptz,
  firmado_desde text,
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint consentimientos_estado_check check (estado in ('pendiente', 'firmado', 'anulado')),
  constraint consentimientos_desde_check check (firmado_desde is null or firmado_desde in ('presencial', 'enlace')),
  constraint consentimientos_firma_largo check (firma_svg is null or length(firma_svg) <= 200000)
);
create unique index if not exists consentimientos_token_uidx on public.consentimientos (token);
create index if not exists consentimientos_cuenta_idx on public.consentimientos (cuenta_id, created_at desc);

alter table public.consentimientos enable row level security;
drop policy if exists consentimientos_organization_isolation on public.consentimientos;
create policy consentimientos_organization_isolation on public.consentimientos
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));
drop policy if exists consentimientos_rw on public.consentimientos;
create policy consentimientos_rw on public.consentimientos
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- Un documento firmado no se reescribe: solo se puede anular.
create or replace function public.consentimiento_inmutable()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if old.estado = 'firmado' and (new.texto is distinct from old.texto or new.titulo is distinct from old.titulo
       or new.firma_svg is distinct from old.firma_svg or new.firmante_nombre is distinct from old.firmante_nombre
       or new.firmante_rut is distinct from old.firmante_rut or new.firmado_at is distinct from old.firmado_at
       or new.estado not in ('firmado', 'anulado')) then
    raise exception 'Un consentimiento firmado no se modifica; anúlalo y crea otro' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists consentimientos_inmutables on public.consentimientos;
create trigger consentimientos_inmutables before update on public.consentimientos
  for each row execute function public.consentimiento_inmutable();

-- Crear el documento desde una plantilla, con los datos de la ficha.
create or replace function public.crear_consentimiento(p_cuenta uuid, p_plantilla uuid, p_mascota uuid default null)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta public.sales_companies%rowtype;
  v_plantilla public.plantillas_consentimiento%rowtype;
  v_org public.organizations%rowtype;
  v_mascota text;
  v_id uuid;
begin
  select * into v_cuenta from public.sales_companies where id = p_cuenta;
  if not found then raise exception 'No encontramos esa ficha' using errcode = 'P0002'; end if;
  select * into v_plantilla from public.plantillas_consentimiento where id = p_plantilla and organization_id = v_cuenta.organization_id and activo;
  if not found then raise exception 'Esa plantilla no existe' using errcode = 'P0002'; end if;
  select * into v_org from public.organizations where id = v_cuenta.organization_id;
  if p_mascota is not null then
    select nombre into v_mascota from public.mascotas where id = p_mascota and cuenta_id = p_cuenta;
  end if;
  insert into public.consentimientos (organization_id, cuenta_id, mascota_id, plantilla_id, titulo, texto, creado_por)
  values (v_cuenta.organization_id, p_cuenta, p_mascota, p_plantilla, v_plantilla.titulo,
          replace(replace(replace(replace(replace(v_plantilla.texto,
            '{{nombre}}', v_cuenta.name),
            '{{rut}}', coalesce(v_cuenta.rut, '__________')),
            '{{mascota}}', coalesce(v_mascota, '__________')),
            '{{clinica}}', v_org.name),
            '{{fecha}}', to_char(now() at time zone 'America/Santiago', 'DD/MM/YYYY')),
          auth.uid())
  returning id into v_id;
  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
  values (v_cuenta.organization_id, p_cuenta, 'nota', 'Consentimiento preparado: ' || v_plantilla.titulo, 'Pendiente de firma', now(), true, auth.uid());
  return v_id;
end;
$$;
revoke all on function public.crear_consentimiento(uuid, uuid, uuid) from public, anon;
grant execute on function public.crear_consentimiento(uuid, uuid, uuid) to authenticated;

-- Firmar: en el mesón (con sesión) o desde el enlace (sin sesión, por token).
create or replace function public.firmar_consentimiento_interno(p_id uuid, p_token text, p_nombre text, p_rut text, p_firma text, p_desde text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_doc public.consentimientos%rowtype;
begin
  if nullif(btrim(coalesce(p_nombre, '')), '') is null or length(btrim(p_nombre)) < 3 then
    raise exception 'Escribe el nombre de quien firma' using errcode = '22023';
  end if;
  if p_firma is null or length(p_firma) < 40 or length(p_firma) > 200000 or p_firma !~ '^<svg[\s\S]*</svg>$' or p_firma ~* '(<script|javascript:|href\s*=|xlink|\son[a-z]+\s*=|<foreignobject|<image|<use|<style)' then
    raise exception 'Falta la firma' using errcode = '22023';
  end if;
  update public.consentimientos
     set estado = 'firmado', firmante_nombre = left(btrim(p_nombre), 120), firmante_rut = nullif(left(btrim(coalesce(p_rut, '')), 20), ''),
         firma_svg = p_firma, firmado_at = now(), firmado_desde = p_desde
   where estado = 'pendiente'
     and ((p_id is not null and id = p_id) or (p_token is not null and length(p_token) >= 32 and token = p_token))
  returning * into v_doc;
  if v_doc.id is null then return false; end if;
  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done)
  values (v_doc.organization_id, v_doc.cuenta_id, 'nota', 'Consentimiento firmado: ' || v_doc.titulo,
          'Firmó ' || v_doc.firmante_nombre || coalesce(' (' || v_doc.firmante_rut || ')', '') || case when p_desde = 'enlace' then ' desde el enlace' else ' en la clínica' end, now(), true);
  return true;
end;
$$;
revoke all on function public.firmar_consentimiento_interno(uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.firmar_consentimiento(p_id uuid, p_nombre text, p_rut text, p_firma text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  -- Misma frontera que la tabla: empresa de la sesión y rol de clínica.
  if not exists (select 1 from public.consentimientos where id = p_id and organization_id = any (public.current_org_ids()))
     or not ((select public.current_role_name()) in ('admin', 'supervisor') or public.is_platform_owner()) then
    raise exception 'No encontramos ese consentimiento' using errcode = 'P0002';
  end if;
  return public.firmar_consentimiento_interno(p_id, null, p_nombre, p_rut, p_firma, 'presencial');
end;
$$;
revoke all on function public.firmar_consentimiento(uuid, text, text, text) from public, anon;
grant execute on function public.firmar_consentimiento(uuid, text, text, text) to authenticated;

create or replace function public.firmar_consentimiento_publico(p_token text, p_nombre text, p_rut text, p_firma text)
returns boolean
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.firmar_consentimiento_interno(null, p_token, p_nombre, p_rut, p_firma, 'enlace');
$$;
revoke all on function public.firmar_consentimiento_publico(text, text, text, text) from public;
grant execute on function public.firmar_consentimiento_publico(text, text, text, text) to anon, authenticated;

create or replace function public.consentimiento_publico(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select jsonb_build_object('titulo', doc.titulo, 'texto', doc.texto, 'estado', doc.estado, 'empresa', organizacion.name,
                            'firmante', doc.firmante_nombre, 'firmado_at', doc.firmado_at, 'persona', cuenta.name)
    from public.consentimientos doc
    join public.organizations organizacion on organizacion.id = doc.organization_id
    join public.sales_companies cuenta on cuenta.id = doc.cuenta_id
   where length(coalesce(p_token, '')) >= 32 and doc.token = p_token and doc.estado <> 'anulado';
$$;
revoke all on function public.consentimiento_publico(text) from public;
grant execute on function public.consentimiento_publico(text) to anon, authenticated;
