-- Reserva en línea.
--
-- La persona entra a un enlace de la clínica (desde Instagram, Google o la
-- web), elige el servicio, con quién y la hora libre, deja su nombre y
-- celular, y la cita queda en la agenda sin que nadie la escriba. Recibe un
-- enlace para cancelarla. Para saber qué horas están libres, la agenda
-- necesita horarios de atención (de la empresa y, si difieren, de cada
-- profesional) y bloqueos (vacaciones, feriados, colación larga).
--
-- Todo lo público pasa por funciones `security definer` que exponen solo lo
-- necesario: nombre de la empresa, servicios con precio y duración,
-- profesionales y horas libres. Nunca la agenda ni datos de otras personas.

-- ---------------------------------------------------------------------------
-- Horarios de atención. profesional_id nulo = horario de la empresa. Si un
-- profesional tiene filas propias, valen las suyas (un día sin fila = no
-- atiende ese día). Sin ninguna fila vale lunes a viernes 9-19 y sábado 10-14.
-- ---------------------------------------------------------------------------
create table if not exists public.horarios_atencion (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profesional_id uuid references public.profesionales(id) on delete cascade,
  dia_semana smallint not null,
  desde time not null,
  hasta time not null,
  created_at timestamptz not null default now(),
  constraint horarios_dia_check check (dia_semana between 1 and 7),
  constraint horarios_rango_check check (hasta > desde)
);

create index if not exists horarios_atencion_org_idx on public.horarios_atencion (organization_id, profesional_id, dia_semana);

alter table public.horarios_atencion enable row level security;

drop policy if exists horarios_atencion_organization_isolation on public.horarios_atencion;
create policy horarios_atencion_organization_isolation on public.horarios_atencion
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists horarios_atencion_select on public.horarios_atencion;
create policy horarios_atencion_select on public.horarios_atencion for select to authenticated using (true);

drop policy if exists horarios_atencion_write on public.horarios_atencion;
create policy horarios_atencion_write on public.horarios_atencion
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- Bloqueos: el profesional no atiende (vacaciones, curso) o, sin
-- profesional, la clínica completa cierra (feriado).
create table if not exists public.bloqueos_agenda (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profesional_id uuid references public.profesionales(id) on delete cascade,
  desde timestamptz not null,
  hasta timestamptz not null,
  motivo text,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bloqueos_rango_check check (hasta > desde)
);

create index if not exists bloqueos_agenda_org_idx on public.bloqueos_agenda (organization_id, desde);

alter table public.bloqueos_agenda enable row level security;

drop policy if exists bloqueos_agenda_organization_isolation on public.bloqueos_agenda;
create policy bloqueos_agenda_organization_isolation on public.bloqueos_agenda
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists bloqueos_agenda_select on public.bloqueos_agenda;
create policy bloqueos_agenda_select on public.bloqueos_agenda for select to authenticated using (true);

drop policy if exists bloqueos_agenda_write on public.bloqueos_agenda;
create policy bloqueos_agenda_write on public.bloqueos_agenda
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- Qué se ofrece en línea y de dónde vino cada cita.
-- ---------------------------------------------------------------------------
alter table public.configuracion_agenda add column if not exists reserva_activa boolean not null default false;
alter table public.configuracion_agenda add column if not exists reserva_slug text;
alter table public.configuracion_agenda add column if not exists reserva_anticipacion_horas integer not null default 2;
alter table public.configuracion_agenda add column if not exists reserva_dias integer not null default 30;
alter table public.configuracion_agenda add column if not exists reserva_intervalo_min integer not null default 15;
alter table public.configuracion_agenda add column if not exists reserva_mensaje text;
alter table public.configuracion_agenda drop constraint if exists configuracion_agenda_reserva_check;
alter table public.configuracion_agenda add constraint configuracion_agenda_reserva_check check (
  (reserva_slug is null or (reserva_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' and reserva_slug not in ('cita', 'admin', 'api')))
  and reserva_anticipacion_horas between 0 and 72
  and reserva_dias between 1 and 120
  and reserva_intervalo_min in (5, 10, 15, 20, 30, 60)
  and (reserva_mensaje is null or length(reserva_mensaje) <= 400)
);
create unique index if not exists configuracion_agenda_reserva_slug_uidx on public.configuracion_agenda (reserva_slug) where reserva_slug is not null;

alter table public.profesionales add column if not exists en_reserva_online boolean not null default true;
alter table public.sales_products add column if not exists en_reserva_online boolean not null default true;

alter table public.citas add column if not exists origen text not null default 'recepcion';
alter table public.citas drop constraint if exists citas_origen_check;
alter table public.citas add constraint citas_origen_check check (origen in ('recepcion', 'reserva_online', 'whatsapp', 'importacion'));
alter table public.citas add column if not exists token_publico text;
create unique index if not exists citas_token_publico_uidx on public.citas (token_publico) where token_publico is not null;

-- ---------------------------------------------------------------------------
-- Horas libres de un profesional un día, para una duración. Interna.
-- ---------------------------------------------------------------------------
create or replace function public.horas_libres_profesional(
  p_org uuid,
  p_profesional uuid,
  p_fecha date,
  p_duracion integer,
  p_intervalo integer default 15,
  p_minimo timestamptz default now()
)
returns setof timestamptz
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_dow smallint := extract(isodow from p_fecha)::smallint;
  v_propios boolean;
  v_empresa boolean;
begin
  select exists (select 1 from public.horarios_atencion where organization_id = p_org and profesional_id = p_profesional) into v_propios;
  select exists (select 1 from public.horarios_atencion where organization_id = p_org and profesional_id is null) into v_empresa;

  return query
  with rangos as (
    select h.desde, h.hasta from public.horarios_atencion h
     where v_propios and h.organization_id = p_org and h.profesional_id = p_profesional and h.dia_semana = v_dow
    union all
    select h.desde, h.hasta from public.horarios_atencion h
     where not v_propios and v_empresa and h.organization_id = p_org and h.profesional_id is null and h.dia_semana = v_dow
    union all
    select d.desde, d.hasta from (values (1, time '09:00', time '19:00'), (2, time '09:00', time '19:00'), (3, time '09:00', time '19:00'),
                                         (4, time '09:00', time '19:00'), (5, time '09:00', time '19:00'), (6, time '10:00', time '14:00')) d(dia, desde, hasta)
     where not v_propios and not v_empresa and d.dia = v_dow
  ), candidatos as (
    select distinct (pared at time zone 'America/Santiago') as inicio
      from rangos,
           generate_series(p_fecha + rangos.desde, p_fecha + rangos.hasta - make_interval(mins => p_duracion), make_interval(mins => greatest(5, p_intervalo))) pared
  )
  select c.inicio from candidatos c
   where c.inicio >= p_minimo
     and not exists (
       select 1 from public.citas cita
        where cita.profesional_id = p_profesional
          and cita.estado not in ('cancelada', 'no_vino')
          and tstzrange(cita.inicio, cita.fin, '[)') && tstzrange(c.inicio, c.inicio + make_interval(mins => p_duracion), '[)'))
     and not exists (
       select 1 from public.bloqueos_agenda b
        where b.organization_id = p_org
          and (b.profesional_id is null or b.profesional_id = p_profesional)
          and tstzrange(b.desde, b.hasta, '[)') && tstzrange(c.inicio, c.inicio + make_interval(mins => p_duracion), '[)'))
   order by c.inicio;
end;
$$;

revoke all on function public.horas_libres_profesional(uuid, uuid, date, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.horas_libres_profesional(uuid, uuid, date, integer, integer, timestamptz) to authenticated, service_role;

-- La configuración de reserva activa de un enlace, o nada.
create or replace function public.reserva_config_por_slug(p_slug text)
returns public.configuracion_agenda
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select cfg.* from public.configuracion_agenda cfg
    join public.organizations organizacion on organizacion.id = cfg.organization_id and organizacion.active
   where cfg.reserva_activa and cfg.reserva_slug = lower(btrim(p_slug))
   limit 1;
$$;

revoke all on function public.reserva_config_por_slug(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Público: lo que la página de reserva muestra.
-- ---------------------------------------------------------------------------
create or replace function public.reserva_publica(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cfg public.configuracion_agenda%rowtype;
  v_org public.organizations%rowtype;
begin
  v_cfg := public.reserva_config_por_slug(p_slug);
  if v_cfg.organization_id is null then return null; end if;
  select * into v_org from public.organizations where id = v_cfg.organization_id;
  return jsonb_build_object(
    'empresa', v_org.name,
    'edicion', v_org.edicion,
    'mensaje', v_cfg.reserva_mensaje,
    'dias', v_cfg.reserva_dias,
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.name, 'categoria', p.categoria, 'duracion', coalesce(p.duracion_min, 30), 'precio', p.one_time_price, 'descripcion', p.description)
                       order by p.orden, p.name)
        from public.sales_products p
       where p.organization_id = v_org.id and p.active and p.en_reserva_online and not p.es_urgencia
    ), '[]'::jsonb),
    'profesionales', coalesce((
      select jsonb_agg(jsonb_build_object('id', pr.id, 'nombre', pr.nombre, 'especialidad', pr.especialidad, 'color', pr.color) order by pr.orden, pr.nombre)
        from public.profesionales pr
       where pr.organization_id = v_org.id and pr.activo and pr.en_reserva_online
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.reserva_publica(text) from public;
grant execute on function public.reserva_publica(text) to anon, authenticated;

-- Horas libres de un día para un servicio, con un profesional o con
-- cualquiera (la primera persona libre a cada hora).
create or replace function public.reserva_horas(p_slug text, p_servicio uuid, p_profesional uuid, p_fecha date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cfg public.configuracion_agenda%rowtype;
  v_duracion integer;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
begin
  v_cfg := public.reserva_config_por_slug(p_slug);
  if v_cfg.organization_id is null or p_fecha is null or p_fecha < v_hoy or p_fecha > v_hoy + v_cfg.reserva_dias then
    return '[]'::jsonb;
  end if;
  select coalesce(duracion_min, 30) into v_duracion from public.sales_products
   where id = p_servicio and organization_id = v_cfg.organization_id and active and en_reserva_online and not es_urgencia;
  if v_duracion is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('inicio', inicio, 'hora', to_char(inicio at time zone 'America/Santiago', 'HH24:MI'), 'profesional_id', profesional_id) order by inicio)
      from (
        select distinct on (libre.inicio) libre.inicio, pr.id as profesional_id
          from public.profesionales pr
          cross join lateral public.horas_libres_profesional(v_cfg.organization_id, pr.id, p_fecha, v_duracion, v_cfg.reserva_intervalo_min,
                                                             now() + make_interval(hours => v_cfg.reserva_anticipacion_horas)) as libre(inicio)
         where pr.organization_id = v_cfg.organization_id and pr.activo and pr.en_reserva_online
           and (p_profesional is null or pr.id = p_profesional)
         order by libre.inicio, pr.orden, pr.nombre
      ) horas
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.reserva_horas(text, uuid, uuid, date) from public;
grant execute on function public.reserva_horas(text, uuid, uuid, date) to anon, authenticated;

-- Qué días de los próximos 14 tienen al menos una hora libre.
create or replace function public.reserva_dias_con_horas(p_slug text, p_servicio uuid, p_profesional uuid, p_desde date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_dia date;
  v_dias jsonb := '[]'::jsonb;
  v_desde date := greatest(coalesce(p_desde, (now() at time zone 'America/Santiago')::date), (now() at time zone 'America/Santiago')::date);
begin
  for v_dia in select d::date from generate_series(v_desde, v_desde + 13, interval '1 day') d loop
    if jsonb_array_length(public.reserva_horas(p_slug, p_servicio, p_profesional, v_dia)) > 0 then
      v_dias := v_dias || to_jsonb(v_dia::text);
    end if;
  end loop;
  return v_dias;
end;
$$;

revoke all on function public.reserva_dias_con_horas(text, uuid, uuid, date) from public;
grant execute on function public.reserva_dias_con_horas(text, uuid, uuid, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Público: reservar. Vuelve a comprobar que la hora esté libre (con un
-- candado por profesional para que dos personas no tomen la misma), busca o
-- crea la ficha por celular o correo, deja la cita reservada y programa el
-- mensaje con el enlace para cancelar.
-- ---------------------------------------------------------------------------
create or replace function public.reservar_en_linea(
  p_slug text,
  p_servicio uuid,
  p_profesional uuid,
  p_inicio timestamptz,
  p_nombre text,
  p_telefono text,
  p_correo text default null,
  p_mascota text default null,
  p_especie text default null,
  p_nota text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cfg public.configuracion_agenda%rowtype;
  v_org public.organizations%rowtype;
  v_servicio public.sales_products%rowtype;
  v_profesional public.profesionales%rowtype;
  v_digitos text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_telefono text;
  v_correo text := nullif(lower(btrim(coalesce(p_correo, ''))), '');
  v_nombre text := nullif(btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')), '');
  v_cuenta uuid;
  v_mascota uuid;
  v_fecha date;
  v_token text;
  v_cita uuid;
  v_fin timestamptz;
begin
  v_cfg := public.reserva_config_por_slug(p_slug);
  if v_cfg.organization_id is null then
    raise exception 'Este enlace de reserva no está activo' using errcode = 'P0002';
  end if;
  select * into v_org from public.organizations where id = v_cfg.organization_id;

  if v_nombre is null or length(v_nombre) < 3 or length(v_nombre) > 80 then
    raise exception 'Escribe tu nombre y apellido' using errcode = '22023';
  end if;
  if length(v_digitos) = 9 and left(v_digitos, 1) = '9' then v_digitos := '56' || v_digitos; end if;
  if not (length(v_digitos) = 11 and left(v_digitos, 3) = '569') then
    raise exception 'Revisa tu celular: son 9 dígitos y empieza con 9' using errcode = '22023';
  end if;
  v_telefono := '+' || v_digitos;
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Revisa tu correo' using errcode = '22023';
  end if;
  if v_org.edicion = 'vet' and nullif(btrim(coalesce(p_mascota, '')), '') is null then
    raise exception 'Escribe el nombre de tu mascota' using errcode = '22023';
  end if;

  select * into v_servicio from public.sales_products
   where id = p_servicio and organization_id = v_org.id and active and en_reserva_online and not es_urgencia;
  if not found then raise exception 'Ese servicio ya no se puede reservar en línea' using errcode = 'P0002'; end if;
  select * into v_profesional from public.profesionales
   where id = p_profesional and organization_id = v_org.id and activo and en_reserva_online;
  if not found then raise exception 'Esa persona ya no recibe reservas en línea' using errcode = 'P0002'; end if;

  v_fecha := (p_inicio at time zone 'America/Santiago')::date;
  if v_fecha > (now() at time zone 'America/Santiago')::date + v_cfg.reserva_dias then
    raise exception 'Esa fecha todavía no está abierta' using errcode = '22023';
  end if;

  -- Que nadie tome la misma hora en paralelo, y que siga libre.
  perform pg_advisory_xact_lock(hashtextextended('reserva:' || p_profesional::text, 0));
  if not exists (
    select 1 from public.horas_libres_profesional(v_org.id, p_profesional, v_fecha, coalesce(v_servicio.duracion_min, 30), v_cfg.reserva_intervalo_min,
                                                   now() + make_interval(hours => v_cfg.reserva_anticipacion_horas)) as libre(inicio)
     where libre.inicio = p_inicio
  ) then
    raise exception 'Esa hora se acaba de ocupar. Elige otra' using errcode = '23P01';
  end if;

  -- Freno al abuso: tope diario por empresa.
  if (select count(*) from public.citas where organization_id = v_org.id and origen = 'reserva_online' and created_at >= now() - interval '1 day') >= 150 then
    raise exception 'Hoy no podemos recibir más reservas en línea. Escríbenos por WhatsApp' using errcode = '54000';
  end if;

  -- La ficha: por celular (últimos 8 dígitos) o por correo; si no existe, nace.
  select cuenta.id into v_cuenta from public.sales_companies cuenta
   where cuenta.organization_id = v_org.id and right(regexp_replace(coalesce(cuenta.phone, ''), '\D', '', 'g'), 8) = right(v_digitos, 8)
   order by cuenta.updated_at desc limit 1;
  if v_cuenta is null and v_correo is not null then
    select cuenta.id into v_cuenta from public.sales_companies cuenta
     where cuenta.organization_id = v_org.id and lower(btrim(coalesce(cuenta.email, ''))) = v_correo
     order by cuenta.updated_at desc limit 1;
  end if;
  if v_cuenta is null then
    insert into public.sales_companies (organization_id, name, phone, email, source, metadata)
    values (v_org.id, v_nombre, v_telefono, v_correo, 'reserva_online', jsonb_build_object('origen', 'reserva_online'))
    returning id into v_cuenta;
  else
    update public.sales_companies
       set phone = coalesce(nullif(btrim(phone), ''), v_telefono),
           email = coalesce(nullif(btrim(email), ''), v_correo),
           updated_at = now()
     where id = v_cuenta;
  end if;

  if (select count(*) from public.citas where cuenta_id = v_cuenta and origen = 'reserva_online' and inicio > now() and estado in ('reservada', 'confirmada')) >= 3 then
    raise exception 'Ya tienes 3 horas reservadas. Para otra, escríbenos' using errcode = '54000';
  end if;

  if v_org.edicion = 'vet' then
    select id into v_mascota from public.mascotas where cuenta_id = v_cuenta and lower(nombre) = lower(btrim(p_mascota)) limit 1;
    if v_mascota is null then
      insert into public.mascotas (organization_id, cuenta_id, nombre, especie)
      values (v_org.id, v_cuenta, initcap(btrim(p_mascota)), coalesce(nullif(btrim(coalesce(p_especie, '')), ''), 'Perro'))
      returning id into v_mascota;
    end if;
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_fin := p_inicio + make_interval(mins => coalesce(v_servicio.duracion_min, 30));
  insert into public.citas (organization_id, cuenta_id, mascota_id, profesional_id, inicio, fin, motivo, nota, estado, origen, token_publico)
  values (v_org.id, v_cuenta, v_mascota, p_profesional, p_inicio, v_fin, v_servicio.name,
          nullif(left(btrim(coalesce(p_nota, '')), 300), ''), 'reservada', 'reserva_online', v_token)
  returning id into v_cita;

  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done)
  values (v_org.id, v_cuenta, 'reunion', 'Reservó en línea: ' || v_servicio.name || coalesce(' · ' || initcap(btrim(p_mascota)), ''),
          to_char(p_inicio at time zone 'America/Santiago', 'DD/MM HH24:MI') || ' con ' || v_profesional.nombre, now(), true);

  insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
  values (v_org.id, 'whatsapp', v_cuenta, v_telefono, v_nombre, 'reserva_online', v_cita, 'reserva_online:' || v_cita, 'reserva_recibida',
          jsonb_build_object('nombre', split_part(v_nombre, ' ', 1), 'clinica', v_org.name, 'motivo', v_servicio.name, 'profesional', v_profesional.nombre,
                             'fecha', to_char(p_inicio at time zone 'America/Santiago', 'DD/MM') || ' a las ' || to_char(p_inicio at time zone 'America/Santiago', 'HH24:MI'),
                             'token', v_token))
  on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing;
  if v_correo is not null then
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select organization_id, 'correo', cuenta_id, v_correo, nombre_destinatario, regla, origen_ref, 'reserva_online_correo:' || v_cita, plantilla, variables
      from public.mensajes_salientes where clave_dedupe = 'reserva_online:' || v_cita and organization_id = v_org.id
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing;
  end if;

  return jsonb_build_object('token', v_token, 'inicio', p_inicio, 'profesional', v_profesional.nombre, 'servicio', v_servicio.name, 'empresa', v_org.name);
end;
$$;

revoke all on function public.reservar_en_linea(text, uuid, uuid, timestamptz, text, text, text, text, text, text) from public;
grant execute on function public.reservar_en_linea(text, uuid, uuid, timestamptz, text, text, text, text, text, text) to anon, authenticated;

-- Público: ver y cancelar la propia cita con el enlace que llegó.
create or replace function public.cita_publica(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select jsonb_build_object(
           'empresa', organizacion.name,
           'servicio', cita.motivo,
           'profesional', profesional.nombre,
           'inicio', cita.inicio,
           'estado', cita.estado,
           'mascota', mascota.nombre,
           'cancelable', cita.estado in ('reservada', 'confirmada') and cita.inicio > now() + interval '2 hours',
           'reserva_slug', cfg.reserva_slug)
    from public.citas cita
    join public.organizations organizacion on organizacion.id = cita.organization_id
    join public.profesionales profesional on profesional.id = cita.profesional_id
    left join public.mascotas mascota on mascota.id = cita.mascota_id
    left join public.configuracion_agenda cfg on cfg.organization_id = cita.organization_id and cfg.reserva_activa
   where length(coalesce(p_token, '')) >= 32 and cita.token_publico = p_token;
$$;

revoke all on function public.cita_publica(text) from public;
grant execute on function public.cita_publica(text) to anon, authenticated;

create or replace function public.cancelar_cita_publica(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cita public.citas%rowtype;
begin
  if length(coalesce(p_token, '')) < 32 then return false; end if;
  update public.citas set estado = 'cancelada', updated_at = now()
   where token_publico = p_token and estado in ('reservada', 'confirmada') and inicio > now() + interval '2 hours'
  returning * into v_cita;
  if v_cita.id is null then return false; end if;
  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done)
  values (v_cita.organization_id, v_cita.cuenta_id, 'nota', 'Canceló su cita desde el enlace',
          v_cita.motivo || ' · ' || to_char(v_cita.inicio at time zone 'America/Santiago', 'DD/MM HH24:MI') || '. El horario quedó libre.', now(), true);
  return true;
end;
$$;

revoke all on function public.cancelar_cita_publica(text) from public;
grant execute on function public.cancelar_cita_publica(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Las demos quedan con su enlace de reserva activo y horario de empresa.
-- ---------------------------------------------------------------------------
insert into public.configuracion_agenda (organization_id, reserva_activa, reserva_slug, reserva_mensaje)
select organizacion.id, true, organizacion.slug,
       case organizacion.edicion
         when 'vet' then 'Elige el servicio y la hora para tu mascota. Te confirmamos por WhatsApp.'
         when 'barber' then 'Elige tu corte, tu barbero y la hora. Te confirmamos por WhatsApp.'
         else 'Elige el tratamiento y la hora. Te confirmamos por WhatsApp.' end
  from public.organizations organizacion
 where organizacion.slug in ('demo-dental', 'demo-vet', 'demo-barber')
on conflict (organization_id) do update set reserva_activa = true, reserva_slug = excluded.reserva_slug, reserva_mensaje = coalesce(public.configuracion_agenda.reserva_mensaje, excluded.reserva_mensaje);

insert into public.horarios_atencion (organization_id, dia_semana, desde, hasta)
select organizacion.id, dia, desde, hasta
  from public.organizations organizacion
  cross join (values (1, time '09:00', time '13:30'), (1, time '14:30', time '19:00'),
                     (2, time '09:00', time '13:30'), (2, time '14:30', time '19:00'),
                     (3, time '09:00', time '13:30'), (3, time '14:30', time '19:00'),
                     (4, time '09:00', time '13:30'), (4, time '14:30', time '19:00'),
                     (5, time '09:00', time '13:30'), (5, time '14:30', time '19:00'),
                     (6, time '10:00', time '14:00')) h(dia, desde, hasta)
 where organizacion.slug in ('demo-dental', 'demo-vet', 'demo-barber')
   and not exists (select 1 from public.horarios_atencion existente where existente.organization_id = organizacion.id);
