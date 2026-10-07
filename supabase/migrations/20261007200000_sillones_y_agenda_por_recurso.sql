-- Sillones, boxes y salas.
--
-- En una clínica dental dos profesionales pueden compartir un sillón, y en
-- una veterinaria el pabellón se reserva aparte. La columna `citas.box`
-- existía como texto suelto que nadie usaba. Desde acá cada empresa define
-- sus sillones o boxes, la cita puede ocupar uno, y la agenda impide que dos
-- citas usen el mismo a la misma hora.

create table if not exists public.recursos_agenda (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nombre text not null,
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  constraint recursos_nombre_not_blank check (btrim(nombre) <> ''),
  constraint recursos_unicos_por_empresa unique (organization_id, nombre)
);

alter table public.recursos_agenda enable row level security;

drop policy if exists recursos_agenda_organization_isolation on public.recursos_agenda;
create policy recursos_agenda_organization_isolation on public.recursos_agenda
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists recursos_agenda_select on public.recursos_agenda;
create policy recursos_agenda_select on public.recursos_agenda for select to authenticated using (true);

drop policy if exists recursos_agenda_write on public.recursos_agenda;
create policy recursos_agenda_write on public.recursos_agenda
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

alter table public.citas add column if not exists recurso_id uuid references public.recursos_agenda(id) on delete set null;
create index if not exists citas_recurso_inicio_idx on public.citas (recurso_id, inicio) where recurso_id is not null;

-- Agendar ahora recibe el sillón o box (opcional) y comprueba que esté libre.
drop function if exists public.agendar_cita(uuid, uuid, timestamptz, integer, text, uuid, text);

create or replace function public.agendar_cita(
  p_cuenta uuid,
  p_profesional uuid,
  p_inicio timestamptz,
  p_duracion_min integer default 30,
  p_motivo text default 'Consulta',
  p_mascota uuid default null,
  p_nota text default null,
  p_recurso uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta public.sales_companies%rowtype;
  v_profesional public.profesionales%rowtype;
  v_recurso public.recursos_agenda%rowtype;
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
  if p_recurso is not null then
    select * into v_recurso from public.recursos_agenda where id = p_recurso and organization_id = v_cuenta.organization_id and activo;
    if not found then
      raise exception 'Ese sillón o box no existe en esta clínica' using errcode = 'P0002';
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

  if p_recurso is not null then
    select to_char(cita.inicio at time zone 'America/Santiago', 'HH24:MI') into v_ocupada
      from public.citas cita
     where cita.recurso_id = p_recurso
       and cita.estado not in ('cancelada', 'no_vino')
       and tstzrange(cita.inicio, cita.fin, '[)') && tstzrange(p_inicio, v_fin, '[)')
     limit 1;
    if v_ocupada is not null then
      raise exception '% ya está ocupado a las %', v_recurso.nombre, v_ocupada using errcode = '23P01';
    end if;
  end if;

  insert into public.citas (organization_id, cuenta_id, mascota_id, profesional_id, inicio, fin, motivo, nota, creado_por, recurso_id, box)
  values (v_cuenta.organization_id, p_cuenta, p_mascota, p_profesional, p_inicio, v_fin,
          btrim(p_motivo), nullif(btrim(coalesce(p_nota, '')), ''), auth.uid(), p_recurso, v_recurso.nombre)
  returning id into v_id;

  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
  values (v_cuenta.organization_id, p_cuenta, 'reunion',
          'Cita: ' || btrim(p_motivo) || coalesce(' · ' || v_mascota, ''),
          to_char(p_inicio at time zone 'America/Santiago', 'DD/MM HH24:MI') || ' con ' || v_profesional.nombre || coalesce(' · ' || v_recurso.nombre, ''),
          now(), true, auth.uid());

  return v_id;
end;
$$;

revoke all on function public.agendar_cita(uuid, uuid, timestamptz, integer, text, uuid, text, uuid) from public, anon;
grant execute on function public.agendar_cita(uuid, uuid, timestamptz, integer, text, uuid, text, uuid) to authenticated;

-- Las demos dental y vet quedan con sus sillones y boxes.
insert into public.recursos_agenda (organization_id, nombre, orden)
select organizacion.id, nombre, orden
  from public.organizations organizacion
  cross join lateral (
    select * from (values ('Sillón 1', 1), ('Sillón 2', 2), ('Sillón 3', 3)) d(nombre, orden) where organizacion.edicion = 'dental'
    union all
    select * from (values ('Box 1', 1), ('Box 2', 2), ('Pabellón', 3)) v(nombre, orden) where organizacion.edicion = 'vet'
  ) recurso
 where organizacion.slug in ('demo-dental', 'demo-vet')
on conflict (organization_id, nombre) do nothing;
