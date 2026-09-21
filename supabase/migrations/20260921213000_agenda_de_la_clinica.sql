-- La agenda de la clínica.
--
-- Una clínica no funciona con un embudo: funciona con una agenda. Desde una
-- cita se abre la consulta, y de la consulta salen el cobro y la próxima
-- cita. Esta migración pone esa columna vertebral: profesionales de la
-- clínica, citas por profesional con su estado, y las dos operaciones que la
-- recepción hace todo el día (agendar y cambiar el estado). Las dos empresas
-- de demostración quedan con dos semanas de citas para que la demo cuente la
-- historia completa.

-- ---------------------------------------------------------------------------
-- Profesionales: quienes atienden. Hasta ahora eran un texto suelto en cada
-- atención; la agenda necesita que existan como columnas propias.
-- ---------------------------------------------------------------------------
create table if not exists public.profesionales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  nombre text not null,
  especialidad text,
  color text not null default '#2563eb',
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  constraint profesionales_nombre_not_blank check (btrim(nombre) <> ''),
  constraint profesionales_unicos_por_empresa unique (organization_id, nombre)
);

alter table public.profesionales enable row level security;

drop policy if exists profesionales_organization_isolation on public.profesionales;
create policy profesionales_organization_isolation on public.profesionales
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists profesionales_select on public.profesionales;
create policy profesionales_select on public.profesionales
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

drop policy if exists profesionales_write on public.profesionales;
create policy profesionales_write on public.profesionales
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- Citas: la unidad de trabajo de la recepción.
-- ---------------------------------------------------------------------------
create table if not exists public.citas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  mascota_id uuid references public.mascotas(id) on delete set null,
  profesional_id uuid not null references public.profesionales(id),
  inicio timestamptz not null,
  fin timestamptz not null,
  motivo text not null,
  -- reservada → confirmada → en_sala → atendida; o no_vino / cancelada.
  estado text not null default 'reservada',
  box text,
  nota text,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint citas_rango_valido check (fin > inicio),
  constraint citas_motivo_not_blank check (btrim(motivo) <> ''),
  constraint citas_estado_check check (estado in ('reservada', 'confirmada', 'en_sala', 'atendida', 'no_vino', 'cancelada'))
);

create index if not exists citas_org_inicio_idx on public.citas (organization_id, inicio);
create index if not exists citas_profesional_inicio_idx on public.citas (profesional_id, inicio);
create index if not exists citas_cuenta_idx on public.citas (cuenta_id, inicio desc);

alter table public.citas enable row level security;

drop policy if exists citas_organization_isolation on public.citas;
create policy citas_organization_isolation on public.citas
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

drop policy if exists citas_write on public.citas;
create policy citas_write on public.citas
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- Agendar: comprueba que el horario esté libre y deja la línea en la historia
-- de la ficha. Corre con la sesión de quien agenda: la seguridad por fila
-- decide la empresa y el permiso.
-- ---------------------------------------------------------------------------
create or replace function public.agendar_cita(
  p_cuenta uuid,
  p_profesional uuid,
  p_inicio timestamptz,
  p_duracion_min integer default 30,
  p_motivo text default 'Consulta',
  p_mascota uuid default null,
  p_nota text default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta public.sales_companies%rowtype;
  v_profesional public.profesionales%rowtype;
  v_mascota text;
  v_fin timestamptz;
  v_ocupada text;
  v_id uuid;
begin
  if p_duracion_min is null or p_duracion_min < 5 or p_duracion_min > 480 then
    raise exception 'La duración tiene que estar entre 5 minutos y 8 horas' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Escribe el motivo de la cita' using errcode = '22023';
  end if;

  select * into v_cuenta from public.sales_companies where id = p_cuenta;
  if not found then
    raise exception 'No encontramos esa ficha' using errcode = 'P0002';
  end if;
  select * into v_profesional from public.profesionales
   where id = p_profesional and organization_id = v_cuenta.organization_id and activo;
  if not found then
    raise exception 'Ese profesional no atiende en esta clínica' using errcode = 'P0002';
  end if;
  if p_mascota is not null then
    select nombre into v_mascota from public.mascotas where id = p_mascota and cuenta_id = p_cuenta;
    if not found then
      raise exception 'Esa mascota no es de este tutor' using errcode = 'P0002';
    end if;
  end if;

  v_fin := p_inicio + make_interval(mins => p_duracion_min);

  select to_char(cita.inicio at time zone 'America/Santiago', 'HH24:MI') into v_ocupada
    from public.citas cita
   where cita.profesional_id = p_profesional
     and cita.estado not in ('cancelada', 'no_vino')
     and tstzrange(cita.inicio, cita.fin, '[)') && tstzrange(p_inicio, v_fin, '[)')
   limit 1;
  if v_ocupada is not null then
    raise exception '% ya tiene una cita a las %', v_profesional.nombre, v_ocupada using errcode = '23P01';
  end if;

  insert into public.citas (organization_id, cuenta_id, mascota_id, profesional_id, inicio, fin, motivo, nota, creado_por)
  values (v_cuenta.organization_id, p_cuenta, p_mascota, p_profesional, p_inicio, v_fin,
          btrim(p_motivo), nullif(btrim(coalesce(p_nota, '')), ''), auth.uid())
  returning id into v_id;

  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
  values (v_cuenta.organization_id, p_cuenta, 'reunion',
          'Cita: ' || btrim(p_motivo) || coalesce(' · ' || v_mascota, ''),
          to_char(p_inicio at time zone 'America/Santiago', 'DD/MM HH24:MI') || ' con ' || v_profesional.nombre,
          now(), true, auth.uid());

  return v_id;
end;
$$;

revoke all on function public.agendar_cita(uuid, uuid, timestamptz, integer, text, uuid, text) from public, anon;
grant execute on function public.agendar_cita(uuid, uuid, timestamptz, integer, text, uuid, text) to authenticated;

-- Cambiar el estado: confirmar, pasar a sala, dar por atendida, marcar que no
-- vino o cancelar. Lo que no se presenta queda también en la historia.
create or replace function public.cambiar_estado_cita(p_cita uuid, p_estado text)
returns void
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cita public.citas%rowtype;
begin
  if p_estado not in ('reservada', 'confirmada', 'en_sala', 'atendida', 'no_vino', 'cancelada') then
    raise exception 'Estado de cita desconocido' using errcode = '22023';
  end if;
  update public.citas set estado = p_estado, updated_at = now() where id = p_cita returning * into v_cita;
  if not found then
    raise exception 'No encontramos esa cita' using errcode = 'P0002';
  end if;
  if p_estado in ('no_vino', 'cancelada') then
    insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
    values (v_cita.organization_id, v_cita.cuenta_id, 'nota',
            case when p_estado = 'no_vino' then 'No vino a la cita' else 'Cita cancelada' end,
            v_cita.motivo || ' · ' || to_char(v_cita.inicio at time zone 'America/Santiago', 'DD/MM HH24:MI'),
            now(), true, auth.uid());
  end if;
end;
$$;

revoke all on function public.cambiar_estado_cita(uuid, text) from public, anon;
grant execute on function public.cambiar_estado_cita(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Demostración: profesionales a partir de las atenciones ya registradas y dos
-- semanas de citas alrededor de hoy, con estados verosímiles.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org record;
  v_prof record;
  v_dia date;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_slot integer;
  v_inicio timestamptz;
  v_libre_hasta timestamptz;
  v_cuenta uuid;
  v_mascota uuid;
  v_producto record;
  v_duracion integer;
  v_estado text;
  v_colores text[] := array['#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777'];
  v_n integer;
begin
  for v_org in select id, slug, edicion from public.organizations where slug in ('demo-vet', 'demo-dental') loop
    if exists (select 1 from public.citas where organization_id = v_org.id) then
      continue;
    end if;

    v_n := 0;
    insert into public.profesionales (organization_id, nombre, especialidad, color, orden)
    select v_org.id, nombre, case when v_org.edicion = 'vet' then 'Medicina general' else 'Odontología general' end,
           v_colores[1 + (row_number() over (order by nombre) - 1) % array_length(v_colores, 1)],
           row_number() over (order by nombre)
      from (select distinct profesional as nombre from public.atenciones where organization_id = v_org.id and profesional is not null) p
    on conflict (organization_id, nombre) do nothing;

    if not exists (select 1 from public.profesionales where organization_id = v_org.id) then
      insert into public.profesionales (organization_id, nombre, especialidad, color, orden)
      values (v_org.id, case when v_org.edicion = 'vet' then 'Dra. Fernanda Lagos' else 'Dra. Carolina Vidal' end, null, v_colores[1], 1),
             (v_org.id, case when v_org.edicion = 'vet' then 'Dr. Cristóbal Vega' else 'Dr. Matías Soto' end, null, v_colores[2], 2);
    end if;

    for v_prof in select id from public.profesionales where organization_id = v_org.id loop
      for v_dia in select d::date from generate_series(v_hoy - 6, v_hoy + 8, interval '1 day') d loop
        if extract(isodow from v_dia) = 7 then continue; end if;
        v_libre_hasta := null;
        for v_slot in 0..17 loop
          v_inicio := ((v_dia::text || ' 09:00')::timestamp + (v_slot * interval '30 minutes')) at time zone 'America/Santiago';
          if v_libre_hasta is not null and v_inicio < v_libre_hasta then continue; end if;
          if random() > (case when extract(isodow from v_dia) = 6 then 0.35 else 0.6 end) then continue; end if;

          select id into v_cuenta from public.sales_companies where organization_id = v_org.id order by random() limit 1;
          v_mascota := null;
          if v_org.edicion = 'vet' then
            select id into v_mascota from public.mascotas where cuenta_id = v_cuenta order by random() limit 1;
          end if;
          select name, coalesce(duracion_min, 30) as duracion into v_producto
            from public.sales_products
           where organization_id = v_org.id and active and not es_urgencia and coalesce(one_time_price, 0) > 0
           order by random() limit 1;
          v_duracion := greatest(15, least(90, coalesce(v_producto.duracion, 30)));
          v_libre_hasta := v_inicio + make_interval(mins => v_duracion);

          v_estado := case
            when v_dia < v_hoy then (case when random() < 0.86 then 'atendida' when random() < 0.7 then 'no_vino' else 'cancelada' end)
            when v_dia = v_hoy and v_inicio + make_interval(mins => v_duracion) < now() then 'atendida'
            when v_dia = v_hoy and v_inicio <= now() then 'en_sala'
            when v_dia = v_hoy then (case when random() < 0.7 then 'confirmada' else 'reservada' end)
            when v_dia = v_hoy + 1 then (case when random() < 0.5 then 'confirmada' else 'reservada' end)
            else 'reservada' end;

          insert into public.citas (organization_id, cuenta_id, mascota_id, profesional_id, inicio, fin, motivo, estado)
          values (v_org.id, v_cuenta, v_mascota, v_prof.id, v_inicio, v_libre_hasta, coalesce(v_producto.name, 'Consulta'), v_estado);
          v_n := v_n + 1;
        end loop;
      end loop;
    end loop;
    raise notice 'demo %: % citas', v_org.slug, v_n;
  end loop;
end;
$$;
