-- Pacientes (Dental) y tutores con sus mascotas (Vet).
--
-- El paciente o el tutor es la cuenta persona de ventas (`sales_companies`):
-- ahí ya viven su nombre, teléfono, correo, comuna y los datos de la clínica en
-- `metadata` (previsión, profesional). Lo que faltaba es la mascota: un tutor
-- tiene varias, y cada una lleva sus vacunas y desparasitaciones con la fecha
-- de la próxima dosis, que es de lo que vive el recordatorio de una veterinaria.
--
-- Atlas es la capa de relación con el paciente, no la ficha clínica: el
-- odontograma, las evoluciones y las recetas se quedan en el software clínico.

create table if not exists public.mascotas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  nombre text not null,
  especie text not null default 'Perro',
  raza text,
  sexo text,
  nacimiento date,
  peso_kg numeric(5,2),
  microchip text,
  esterilizado boolean not null default false,
  ultima_vacuna date,
  proxima_vacuna date,
  ultima_desparasitacion date,
  proxima_desparasitacion date,
  alertas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mascotas_nombre_not_blank check (btrim(nombre) <> ''),
  constraint mascotas_especie_check check (especie in ('Perro', 'Gato', 'Otro')),
  constraint mascotas_sexo_check check (sexo is null or sexo in ('Macho', 'Hembra'))
);

create index if not exists mascotas_cuenta_idx on public.mascotas (cuenta_id);
create index if not exists mascotas_vacuna_idx on public.mascotas (organization_id, proxima_vacuna);

alter table public.mascotas enable row level security;

drop policy if exists mascotas_organization_isolation on public.mascotas;
create policy mascotas_organization_isolation on public.mascotas
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists mascotas_select on public.mascotas;
create policy mascotas_select on public.mascotas
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

drop policy if exists mascotas_write on public.mascotas;
create policy mascotas_write on public.mascotas
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- Alta de un paciente (o tutor) en un solo paso: la cuenta persona, su contacto
-- y su registro, para que aparezca en Pacientes, en Presupuestos y en Registros
-- y sus llamadas y conversaciones caigan en la misma ficha. En Vet puede venir
-- con su primera mascota. Corre con la sesión de quien llama: la seguridad por
-- fila decide si puede.
create or replace function public.crear_paciente(
  p_nombre text,
  p_telefono text default null,
  p_email text default null,
  p_rut text default null,
  p_datos jsonb default '{}'::jsonb,
  p_mascota jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid := public.current_org_id();
  v_cuenta uuid;
  v_lead uuid;
begin
  if v_org is null then
    raise exception 'Elige una empresa antes de crear pacientes' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'Escribe el nombre' using errcode = '22023';
  end if;
  if coalesce(btrim(p_telefono), '') = '' and coalesce(btrim(p_email), '') = '' then
    raise exception 'Deja al menos un teléfono o un correo para poder contactarlo' using errcode = '22023';
  end if;

  insert into public.leads (full_name, phone, email, rut, organization_id, status, extra, created_by)
  values (btrim(p_nombre), nullif(btrim(p_telefono), ''), nullif(btrim(p_email), ''), nullif(btrim(p_rut), ''),
          v_org, 'nuevo', coalesce(p_datos, '{}'::jsonb), auth.uid())
  returning id into v_lead;

  insert into public.sales_companies (organization_id, name, rut, phone, email, commune, source, owner_id, metadata, created_by)
  values (v_org, btrim(p_nombre), nullif(btrim(p_rut), ''), nullif(btrim(p_telefono), ''), nullif(btrim(p_email), ''),
          nullif(btrim(coalesce(p_datos ->> 'comuna', '')), ''), nullif(p_datos ->> 'origen', ''), auth.uid(),
          coalesce(p_datos, '{}'::jsonb) - 'comuna' - 'origen', auth.uid())
  returning id into v_cuenta;

  insert into public.sales_contacts (organization_id, company_id, full_name, email, phone, whatsapp, lead_id, is_decision_maker)
  values (v_org, v_cuenta, btrim(p_nombre), nullif(btrim(p_email), ''), nullif(btrim(p_telefono), ''),
          nullif(btrim(p_telefono), ''), v_lead, true);

  if p_mascota is not null and btrim(coalesce(p_mascota ->> 'nombre', '')) <> '' then
    insert into public.mascotas (organization_id, cuenta_id, nombre, especie, raza, sexo, nacimiento, esterilizado)
    values (v_org, v_cuenta, btrim(p_mascota ->> 'nombre'), coalesce(nullif(p_mascota ->> 'especie', ''), 'Perro'),
            nullif(p_mascota ->> 'raza', ''), nullif(p_mascota ->> 'sexo', ''),
            nullif(p_mascota ->> 'nacimiento', '')::date, coalesce((p_mascota ->> 'esterilizado')::boolean, false));
  end if;

  insert into public.sales_activities (organization_id, company_id, kind, subject, occurred_at, done, owner_id)
  values (v_org, v_cuenta, 'nota', 'Ficha creada', now(), true, auth.uid());

  return v_cuenta;
end;
$$;

-- Registrar una vacuna mueve la próxima dosis un año y deja la huella en la
-- historia del tutor. La desparasitación, a tres meses.
create or replace function public.registrar_cuidado_de_mascota(p_mascota uuid, p_tipo text)
returns date
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_mascota public.mascotas%rowtype;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_proxima date;
begin
  select * into v_mascota from public.mascotas where id = p_mascota;
  if not found then
    raise exception 'Mascota no encontrada' using errcode = 'P0002';
  end if;

  if p_tipo = 'vacuna' then
    v_proxima := v_hoy + interval '1 year';
    update public.mascotas set ultima_vacuna = v_hoy, proxima_vacuna = v_proxima, updated_at = now() where id = p_mascota;
  elsif p_tipo = 'desparasitacion' then
    v_proxima := v_hoy + interval '3 months';
    update public.mascotas set ultima_desparasitacion = v_hoy, proxima_desparasitacion = v_proxima, updated_at = now() where id = p_mascota;
  else
    raise exception 'Tipo de cuidado desconocido: %', p_tipo using errcode = '22023';
  end if;

  insert into public.sales_activities (organization_id, company_id, kind, subject, occurred_at, done, owner_id)
  values (v_mascota.organization_id, v_mascota.cuenta_id, 'nota',
          case p_tipo when 'vacuna' then 'Vacuna anual de ' else 'Desparasitación de ' end || v_mascota.nombre
            || '; próxima el ' || to_char(v_proxima, 'DD-MM-YYYY'),
          now(), true, auth.uid());

  return v_proxima;
end;
$$;

revoke all on function public.crear_paciente(text, text, text, text, jsonb, jsonb) from public, anon;
revoke all on function public.registrar_cuidado_de_mascota(uuid, text) from public, anon;
grant execute on function public.crear_paciente(text, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.registrar_cuidado_de_mascota(uuid, text) to authenticated;

-- Las mascotas de la demo de Vet salen de lo que ya se sembró en la ficha de
-- cada tutor; uno de cada tres tiene una segunda. Las vacunas quedan repartidas
-- entre vencidas, por vencer y al día para que el semáforo se vea.
insert into public.mascotas (organization_id, cuenta_id, nombre, especie, raza, sexo, nacimiento, peso_kg, esterilizado,
                             ultima_vacuna, proxima_vacuna, ultima_desparasitacion, proxima_desparasitacion)
select cuenta.organization_id, cuenta.id, cuenta.metadata ->> 'mascota', cuenta.metadata ->> 'especie', cuenta.metadata ->> 'raza',
       case when random() < 0.5 then 'Macho' else 'Hembra' end,
       current_date - (365 + floor(random() * 3650))::int,
       case when cuenta.metadata ->> 'especie' = 'Gato' then round((3 + random() * 3)::numeric, 1) else round((5 + random() * 28)::numeric, 1) end,
       random() < 0.6,
       vacuna - 365, vacuna, vacuna - 90 - 60, vacuna - 60
from public.sales_companies cuenta
join public.organizations empresa on empresa.id = cuenta.organization_id and empresa.slug = 'demo-vet'
cross join lateral (select current_date + (floor(random() * 120) - 40)::int as vacuna) fecha
where cuenta.metadata ? 'mascota'
  and not exists (select 1 from public.mascotas m where m.cuenta_id = cuenta.id);

insert into public.mascotas (organization_id, cuenta_id, nombre, especie, raza, sexo, nacimiento, peso_kg, esterilizado,
                             ultima_vacuna, proxima_vacuna)
select cuenta.organization_id, cuenta.id,
       (array['Canela','Thor','Frida','Oreo','Pelusa','Chester','Lola','Zeus','Maya','Bobby'])[1 + floor(random() * 10)::int],
       especie, case when especie = 'Gato' then 'Mestizo' else (array['Mestizo','Poodle','Beagle','Labrador'])[1 + floor(random() * 4)::int] end,
       case when random() < 0.5 then 'Macho' else 'Hembra' end,
       current_date - (200 + floor(random() * 2500))::int,
       case when especie = 'Gato' then round((3 + random() * 3)::numeric, 1) else round((4 + random() * 20)::numeric, 1) end,
       random() < 0.5, vacuna - 365, vacuna
from public.sales_companies cuenta
join public.organizations empresa on empresa.id = cuenta.organization_id and empresa.slug = 'demo-vet'
cross join lateral (select case when random() < 0.5 then 'Gato' else 'Perro' end as especie,
                           current_date + (floor(random() * 120) - 30)::int as vacuna) datos
where cuenta.metadata ? 'mascota'
  and random() < 0.33
  and (select count(*) from public.mascotas m where m.cuenta_id = cuenta.id) = 1;

-- Los pacientes de la demo de Dental reciben fecha de nacimiento, para la edad
-- en la ficha.
update public.sales_companies cuenta
   set metadata = cuenta.metadata || jsonb_build_object('nacimiento', to_char(current_date - (6570 + floor(random() * 18250))::int, 'YYYY-MM-DD'))
  from public.organizations empresa
 where empresa.id = cuenta.organization_id and empresa.slug = 'demo-dental'
   and not cuenta.metadata ? 'nacimiento';
