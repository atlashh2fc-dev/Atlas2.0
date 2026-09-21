-- Pagos.
--
-- Hasta acá una atención se pagaba con un sí o un no. Una caja necesita el
-- pago como hecho propio: cuánto, por qué medio, con qué comprobante y a qué
-- atenciones se aplicó. Sobre eso se cuelga cualquier pasarela: un pago en
-- línea es un pago que nace pendiente con un token y termina pagado cuando la
-- pasarela lo confirma.

create table if not exists public.pagos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  monto numeric(14,2) not null,
  -- efectivo, débito o crédito en el POS de la clínica, transferencia, o en
  -- línea por la pasarela (webpay).
  medio text not null,
  estado text not null default 'pagado',
  -- Número de voucher, comprobante de transferencia o código de autorización.
  referencia text,
  pasarela text,
  token text,
  detalle jsonb not null default '{}'::jsonb,
  nota text,
  creado_por uuid references public.profiles(id) on delete set null,
  pagado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pagos_monto_positivo check (monto > 0),
  constraint pagos_medio_check check (medio in ('efectivo', 'debito', 'credito', 'transferencia', 'webpay', 'otro')),
  constraint pagos_estado_check check (estado in ('pendiente', 'pagado', 'fallido', 'anulado')),
  constraint pagos_token_unico unique (token)
);

create index if not exists pagos_org_created_idx on public.pagos (organization_id, created_at desc);
create index if not exists pagos_cuenta_idx on public.pagos (cuenta_id, created_at desc);

alter table public.atenciones add column if not exists pago_id uuid references public.pagos(id) on delete set null;
create index if not exists atenciones_pago_idx on public.atenciones (pago_id);

alter table public.pagos enable row level security;

drop policy if exists pagos_organization_isolation on public.pagos;
create policy pagos_organization_isolation on public.pagos
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists pagos_select on public.pagos;
create policy pagos_select on public.pagos
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

drop policy if exists pagos_write on public.pagos;
create policy pagos_write on public.pagos
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- Aplica un pago a las atenciones pendientes de la ficha: las indicadas, o
-- las más antiguas hasta cubrir el monto. Es interna: la llaman las dos
-- funciones de abajo.
create or replace function public.aplicar_pago_a_atenciones(p_pago uuid, p_atenciones uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_pago public.pagos%rowtype;
  v_restante numeric;
  v_atencion record;
  v_aplicadas integer := 0;
begin
  select * into v_pago from public.pagos where id = p_pago;
  if not found then
    raise exception 'No encontramos ese pago' using errcode = 'P0002';
  end if;
  v_restante := v_pago.monto;
  for v_atencion in
    select id, precio from public.atenciones
     where cuenta_id = v_pago.cuenta_id and not pagado
       and (p_atenciones is null or id = any (p_atenciones))
     order by fecha, created_at
  loop
    exit when p_atenciones is null and v_restante < coalesce(v_atencion.precio, 0) and v_aplicadas > 0;
    update public.atenciones set pagado = true, pago_id = p_pago where id = v_atencion.id;
    v_restante := v_restante - coalesce(v_atencion.precio, 0);
    v_aplicadas := v_aplicadas + 1;
    exit when p_atenciones is null and v_restante <= 0;
  end loop;
  return v_aplicadas;
end;
$$;

revoke all on function public.aplicar_pago_a_atenciones(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.aplicar_pago_a_atenciones(uuid, uuid[]) to service_role;

-- Un pago en caja: efectivo, tarjeta en el POS o transferencia. Queda pagado
-- al tiro y se aplica a las atenciones. Corre con la sesión de quien cobra.
create or replace function public.registrar_pago(
  p_cuenta uuid,
  p_monto numeric,
  p_medio text,
  p_referencia text default null,
  p_atenciones uuid[] default null,
  p_nota text default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta public.sales_companies%rowtype;
  v_id uuid;
  v_aplicadas integer;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto tiene que ser mayor que cero' using errcode = '22023';
  end if;
  if p_medio not in ('efectivo', 'debito', 'credito', 'transferencia', 'otro') then
    raise exception 'Ese medio de pago se cobra en línea, no en caja' using errcode = '22023';
  end if;
  select * into v_cuenta from public.sales_companies where id = p_cuenta;
  if not found then
    raise exception 'No encontramos esa ficha' using errcode = 'P0002';
  end if;

  insert into public.pagos (organization_id, cuenta_id, monto, medio, estado, referencia, nota, creado_por, pagado_at)
  values (v_cuenta.organization_id, p_cuenta, p_monto, p_medio, 'pagado',
          nullif(btrim(coalesce(p_referencia, '')), ''), nullif(btrim(coalesce(p_nota, '')), ''), auth.uid(), now())
  returning id into v_id;

  v_aplicadas := public.aplicar_pago_a_atenciones(v_id, p_atenciones);

  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
  values (v_cuenta.organization_id, p_cuenta, 'nota',
          'Pago: ' || to_char(p_monto, 'FM$999G999G999') || ' · ' ||
          case p_medio when 'efectivo' then 'efectivo' when 'debito' then 'débito' when 'credito' then 'crédito'
                       when 'transferencia' then 'transferencia' else 'otro medio' end,
          v_aplicadas || case when v_aplicadas = 1 then ' atención al día' else ' atenciones al día' end ||
          coalesce(' · ' || nullif(btrim(coalesce(p_referencia, '')), ''), ''),
          now(), true, auth.uid());
  return v_id;
end;
$$;

revoke all on function public.registrar_pago(uuid, numeric, text, text, uuid[], text) from public, anon;
grant execute on function public.registrar_pago(uuid, numeric, text, text, uuid[], text) to authenticated;

-- Un cobro en línea nace pendiente. La pasarela le pone el token y, cuando la
-- persona paga, la confirmación (sin sesión: vuelve por la pasarela) lo cierra.
create or replace function public.iniciar_cobro_en_linea(
  p_cuenta uuid,
  p_monto numeric,
  p_pasarela text default 'transbank',
  p_atenciones uuid[] default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta public.sales_companies%rowtype;
  v_id uuid;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto tiene que ser mayor que cero' using errcode = '22023';
  end if;
  select * into v_cuenta from public.sales_companies where id = p_cuenta;
  if not found then
    raise exception 'No encontramos esa ficha' using errcode = 'P0002';
  end if;
  insert into public.pagos (organization_id, cuenta_id, monto, medio, estado, pasarela, detalle, creado_por)
  values (v_cuenta.organization_id, p_cuenta, round(p_monto), 'webpay', 'pendiente', p_pasarela,
          jsonb_build_object('atenciones', to_jsonb(coalesce(p_atenciones, '{}'::uuid[]))), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.iniciar_cobro_en_linea(uuid, numeric, text, uuid[]) from public, anon;
grant execute on function public.iniciar_cobro_en_linea(uuid, numeric, text, uuid[]) to authenticated;

-- La confirmación llega desde la pasarela, sin sesión de Atlas: solo la clave
-- de servicio puede cerrar un pago. Cerrar dos veces no hace nada.
create or replace function public.confirmar_pago_en_linea(
  p_pago uuid,
  p_estado text,
  p_referencia text default null,
  p_detalle jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_pago public.pagos%rowtype;
  v_atenciones uuid[];
  v_aplicadas integer := 0;
begin
  if p_estado not in ('pagado', 'fallido', 'anulado') then
    raise exception 'Estado de pago desconocido' using errcode = '22023';
  end if;
  select * into v_pago from public.pagos where id = p_pago for update;
  if not found then
    raise exception 'No encontramos ese pago' using errcode = 'P0002';
  end if;
  if v_pago.estado <> 'pendiente' then
    return jsonb_build_object('estado', v_pago.estado, 'repetido', true);
  end if;

  update public.pagos
     set estado = p_estado,
         referencia = coalesce(nullif(btrim(coalesce(p_referencia, '')), ''), referencia),
         detalle = detalle || coalesce(p_detalle, '{}'::jsonb),
         pagado_at = case when p_estado = 'pagado' then now() else null end,
         updated_at = now()
   where id = p_pago;

  if p_estado = 'pagado' then
    select array_agg(value::uuid) into v_atenciones
      from jsonb_array_elements_text(coalesce(v_pago.detalle -> 'atenciones', '[]'::jsonb));
    v_aplicadas := public.aplicar_pago_a_atenciones(p_pago, case when coalesce(array_length(v_atenciones, 1), 0) > 0 then v_atenciones else null end);
    insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
    values (v_pago.organization_id, v_pago.cuenta_id, 'nota',
            'Pago en línea: ' || to_char(v_pago.monto, 'FM$999G999G999'),
            v_aplicadas || case when v_aplicadas = 1 then ' atención al día' else ' atenciones al día' end ||
            coalesce(' · autorización ' || nullif(btrim(coalesce(p_referencia, '')), ''), ''),
            now(), true, v_pago.creado_por);
  end if;
  return jsonb_build_object('estado', p_estado, 'aplicadas', v_aplicadas, 'repetido', false);
end;
$$;

revoke all on function public.confirmar_pago_en_linea(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirmar_pago_en_linea(uuid, text, text, jsonb) to service_role;
