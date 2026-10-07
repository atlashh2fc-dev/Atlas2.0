-- Comisiones, propinas, venta de productos y el día del profesional.
--
-- En una barbería el barbero cobra por comisión, recibe propinas y vende
-- ceras y aceites; en una clínica el profesional quiere ver su agenda sin
-- ver la de todos. Esta migración:
--   · liga cada profesional a su usuario de Atlas y le pone sus porcentajes
--     de comisión (servicios y productos);
--   · registra ventas de productos en el mesón (descuentan stock) y
--     propinas por profesional;
--   · calcula la liquidación de un período: servicios atendidos, productos
--     vendidos, propinas y el total a pagar a cada uno;
--   · deja al profesional con rol «agente» ver y mover solo sus citas, y su
--     propia liquidación, por funciones acotadas (sin abrirle las tablas).

alter table public.profesionales add column if not exists perfil_id uuid references public.profiles(id) on delete set null;
alter table public.profesionales add column if not exists comision_servicios numeric(5,2) not null default 0;
alter table public.profesionales add column if not exists comision_productos numeric(5,2) not null default 0;
alter table public.profesionales drop constraint if exists profesionales_comisiones_check;
alter table public.profesionales add constraint profesionales_comisiones_check
  check (comision_servicios between 0 and 100 and comision_productos between 0 and 100);
create unique index if not exists profesionales_perfil_uidx on public.profesionales (organization_id, perfil_id) where perfil_id is not null;

-- ---------------------------------------------------------------------------
-- Ventas de productos en el mesón.
-- ---------------------------------------------------------------------------
create table if not exists public.ventas_productos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid references public.sales_companies(id) on delete set null,
  profesional_id uuid references public.profesionales(id) on delete set null,
  insumo_id uuid references public.insumos(id) on delete set null,
  nombre text not null,
  cantidad numeric not null,
  precio_unitario numeric not null,
  total numeric not null,
  medio text not null,
  creado_por uuid references public.profiles(id) on delete set null,
  vendido_at timestamptz not null default now(),
  constraint ventas_productos_cantidad_check check (cantidad > 0),
  constraint ventas_productos_precio_check check (precio_unitario >= 0),
  constraint ventas_productos_medio_check check (medio in ('efectivo', 'debito', 'credito', 'transferencia', 'otro'))
);
create index if not exists ventas_productos_org_idx on public.ventas_productos (organization_id, vendido_at desc);

alter table public.ventas_productos enable row level security;
drop policy if exists ventas_productos_organization_isolation on public.ventas_productos;
create policy ventas_productos_organization_isolation on public.ventas_productos
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));
drop policy if exists ventas_productos_rw on public.ventas_productos;
create policy ventas_productos_rw on public.ventas_productos
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- Propinas por profesional.
-- ---------------------------------------------------------------------------
create table if not exists public.propinas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  profesional_id uuid not null references public.profesionales(id) on delete cascade,
  cuenta_id uuid references public.sales_companies(id) on delete set null,
  monto numeric not null,
  medio text not null,
  nota text,
  creado_por uuid references public.profiles(id) on delete set null,
  recibida_at timestamptz not null default now(),
  constraint propinas_monto_check check (monto > 0),
  constraint propinas_medio_check check (medio in ('efectivo', 'debito', 'credito', 'transferencia', 'otro'))
);
create index if not exists propinas_org_idx on public.propinas (organization_id, recibida_at desc);

alter table public.propinas enable row level security;
drop policy if exists propinas_organization_isolation on public.propinas;
create policy propinas_organization_isolation on public.propinas
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));
drop policy if exists propinas_rw on public.propinas;
create policy propinas_rw on public.propinas
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- Vender un producto: deja la venta, descuenta stock y, si hay ficha, la
-- línea en su historia.
create or replace function public.vender_producto(
  p_insumo uuid,
  p_cantidad numeric,
  p_medio text,
  p_precio_unitario numeric default null,
  p_cuenta uuid default null,
  p_profesional uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_insumo public.insumos%rowtype;
  v_precio numeric;
  v_id uuid;
begin
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad > 999 then
    raise exception 'Revisa la cantidad' using errcode = '22023';
  end if;
  if p_medio not in ('efectivo', 'debito', 'credito', 'transferencia', 'otro') then
    raise exception 'Elige el medio de pago' using errcode = '22023';
  end if;
  select * into v_insumo from public.insumos where id = p_insumo and activo;
  if not found then raise exception 'Ese producto no existe o no está activo' using errcode = 'P0002'; end if;
  v_precio := coalesce(p_precio_unitario, v_insumo.precio_venta, 0);
  if v_precio <= 0 then raise exception 'El producto no tiene precio de venta: escríbelo' using errcode = '22023'; end if;
  if p_profesional is not null and not exists (select 1 from public.profesionales where id = p_profesional and organization_id = v_insumo.organization_id) then
    raise exception 'Ese profesional no es de esta empresa' using errcode = 'P0002';
  end if;
  if p_cuenta is not null and not exists (select 1 from public.sales_companies where id = p_cuenta and organization_id = v_insumo.organization_id) then
    raise exception 'Esa ficha no es de esta empresa' using errcode = 'P0002';
  end if;

  insert into public.ventas_productos (organization_id, cuenta_id, profesional_id, insumo_id, nombre, cantidad, precio_unitario, total, medio, creado_por)
  values (v_insumo.organization_id, p_cuenta, p_profesional, v_insumo.id, v_insumo.nombre, p_cantidad, v_precio, round(v_precio * p_cantidad), p_medio, auth.uid())
  returning id into v_id;

  update public.insumos set stock = greatest(0, coalesce(stock, 0) - p_cantidad), updated_at = now() where id = v_insumo.id;

  if p_cuenta is not null then
    insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
    values (v_insumo.organization_id, p_cuenta, 'nota', 'Compró ' || v_insumo.nombre,
            p_cantidad || ' × ' || to_char(v_precio, 'FM$999G999G999') || ' · ' || p_medio, now(), true, auth.uid());
  end if;
  return v_id;
end;
$$;
revoke all on function public.vender_producto(uuid, numeric, text, numeric, uuid, uuid) from public, anon;
grant execute on function public.vender_producto(uuid, numeric, text, numeric, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Liquidación de un período por profesional. Los servicios se cuentan desde
-- las atenciones registradas con su nombre (como quedan en la ficha).
-- ---------------------------------------------------------------------------
create or replace function public.liquidacion_de_profesionales(p_desde date, p_hasta date, p_profesional uuid default null)
returns table (
  profesional_id uuid,
  nombre text,
  color text,
  atenciones bigint,
  servicios numeric,
  comision_servicios numeric,
  productos numeric,
  comision_productos numeric,
  propinas numeric,
  total numeric
)
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public'
as $$
  with equipo as (
    select pr.* from public.profesionales pr
     where (p_profesional is null or pr.id = p_profesional)
  ), servicios as (
    select pr.id, count(a.id) as atenciones, coalesce(sum(coalesce(a.precio, 0)), 0) as monto
      from equipo pr
      left join public.atenciones a on a.organization_id = pr.organization_id
                                   and lower(btrim(a.profesional)) = lower(btrim(pr.nombre))
                                   and a.fecha between p_desde and p_hasta
     group by pr.id
  ), productos as (
    select v.profesional_id as id, sum(v.total) as monto from public.ventas_productos v
     where (v.vendido_at at time zone 'America/Santiago')::date between p_desde and p_hasta and v.profesional_id is not null
     group by v.profesional_id
  ), propinas as (
    select p.profesional_id as id, sum(p.monto) as monto from public.propinas p
     where (p.recibida_at at time zone 'America/Santiago')::date between p_desde and p_hasta
     group by p.profesional_id
  )
  select pr.id, pr.nombre, pr.color,
         s.atenciones, s.monto,
         round(s.monto * pr.comision_servicios / 100),
         coalesce(pd.monto, 0),
         round(coalesce(pd.monto, 0) * pr.comision_productos / 100),
         coalesce(pp.monto, 0),
         round(s.monto * pr.comision_servicios / 100) + round(coalesce(pd.monto, 0) * pr.comision_productos / 100) + coalesce(pp.monto, 0)
    from equipo pr
    join servicios s on s.id = pr.id
    left join productos pd on pd.id = pr.id
    left join propinas pp on pp.id = pr.id
   where pr.activo or s.atenciones > 0 or pd.monto is not null or pp.monto is not null
   order by pr.orden, pr.nombre;
$$;
revoke all on function public.liquidacion_de_profesionales(date, date, uuid) from public, anon;
grant execute on function public.liquidacion_de_profesionales(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- El día del profesional (rol agente): solo lo suyo.
-- ---------------------------------------------------------------------------
create or replace function public.mi_profesional()
returns public.profesionales
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select pr.* from public.profesionales pr
   where pr.perfil_id = auth.uid()
     and pr.organization_id = any (public.current_org_ids())
     and pr.activo
   order by pr.organization_id = public.current_org_id() desc
   limit 1;
$$;
revoke all on function public.mi_profesional() from public, anon;
grant execute on function public.mi_profesional() to authenticated;

create or replace function public.mi_agenda(p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_pro public.profesionales%rowtype;
begin
  v_pro := public.mi_profesional();
  if v_pro.id is null then return null; end if;
  if p_hasta - p_desde > interval '8 days' then
    raise exception 'Rango demasiado largo' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'profesional', jsonb_build_object('id', v_pro.id, 'nombre', v_pro.nombre, 'color', v_pro.color),
    'citas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', cita.id, 'inicio', cita.inicio, 'fin', cita.fin, 'motivo', cita.motivo, 'estado', cita.estado,
               'nota', cita.nota, 'box', cita.box, 'origen', cita.origen,
               'persona', cuenta.name, 'mascota', mascota.nombre, 'especie', mascota.especie) order by cita.inicio)
        from public.citas cita
        join public.sales_companies cuenta on cuenta.id = cita.cuenta_id
        left join public.mascotas mascota on mascota.id = cita.mascota_id
       where cita.profesional_id = v_pro.id and cita.inicio >= p_desde and cita.inicio < p_hasta
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.mi_agenda(timestamptz, timestamptz) from public, anon;
grant execute on function public.mi_agenda(timestamptz, timestamptz) to authenticated;

-- El profesional marca sus propias citas: en sala, atendida o no vino.
create or replace function public.marcar_mi_cita(p_cita uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_pro public.profesionales%rowtype;
  v_cita public.citas%rowtype;
begin
  v_pro := public.mi_profesional();
  if v_pro.id is null then raise exception 'Tu usuario no está ligado a la agenda' using errcode = '42501'; end if;
  if p_estado not in ('en_sala', 'atendida', 'no_vino') then raise exception 'Ese cambio lo hace la recepción' using errcode = '22023'; end if;
  update public.citas set estado = p_estado, updated_at = now()
   where id = p_cita and profesional_id = v_pro.id and estado in ('reservada', 'confirmada', 'en_sala')
  returning * into v_cita;
  if v_cita.id is null then raise exception 'No encontramos esa cita en tu agenda' using errcode = 'P0002'; end if;
  if p_estado = 'no_vino' then
    insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
    values (v_cita.organization_id, v_cita.cuenta_id, 'nota', 'No vino a la cita',
            v_cita.motivo || ' · ' || to_char(v_cita.inicio at time zone 'America/Santiago', 'DD/MM HH24:MI') || ' · marcado por ' || v_pro.nombre, now(), true, auth.uid());
  end if;
end;
$$;
revoke all on function public.marcar_mi_cita(uuid, text) from public, anon;
grant execute on function public.marcar_mi_cita(uuid, text) to authenticated;

-- Su propia liquidación del período.
create or replace function public.mi_liquidacion(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_pro public.profesionales%rowtype;
  v_fila record;
begin
  v_pro := public.mi_profesional();
  if v_pro.id is null then return null; end if;
  if p_hasta - p_desde > 62 then raise exception 'Rango demasiado largo' using errcode = '22023'; end if;
  select coalesce(count(a.id), 0) as atenciones, coalesce(sum(coalesce(a.precio, 0)), 0) as servicios into v_fila
    from public.atenciones a
   where a.organization_id = v_pro.organization_id and lower(btrim(a.profesional)) = lower(btrim(v_pro.nombre))
     and a.fecha between p_desde and p_hasta;
  return jsonb_build_object(
    'atenciones', v_fila.atenciones,
    'servicios', v_fila.servicios,
    'comision_servicios', round(v_fila.servicios * v_pro.comision_servicios / 100),
    'porcentaje_servicios', v_pro.comision_servicios,
    'productos', coalesce((select sum(total) from public.ventas_productos where profesional_id = v_pro.id and (vendido_at at time zone 'America/Santiago')::date between p_desde and p_hasta), 0),
    'porcentaje_productos', v_pro.comision_productos,
    'propinas', coalesce((select sum(monto) from public.propinas where profesional_id = v_pro.id and (recibida_at at time zone 'America/Santiago')::date between p_desde and p_hasta), 0));
end;
$$;
revoke all on function public.mi_liquidacion(date, date) from public, anon;
grant execute on function public.mi_liquidacion(date, date) to authenticated;

-- La demo de barbería con comisiones verosímiles.
update public.profesionales pr set comision_servicios = 45, comision_productos = 10
  from public.organizations o
 where o.id = pr.organization_id and o.slug = 'demo-barber' and pr.comision_servicios = 0;
