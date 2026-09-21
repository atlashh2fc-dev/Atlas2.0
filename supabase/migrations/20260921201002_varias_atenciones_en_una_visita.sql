-- Varias atenciones en una visita.
--
-- En una consulta se hacen varios procedimientos (una limpieza, dos
-- restauraciones y una radiografía; vacuna, antiparasitario y examen). Esta
-- función los registra juntos, cada uno con su pieza, superficies y materiales,
-- en una sola transacción: o queda la visita completa o no queda nada.
--
-- De paso, los montos de la historia de la ficha se escriben a la chilena
-- ($1.350.000 y no $1,350,000).

create or replace function public.registrar_atencion(
  p_cuenta uuid,
  p_producto uuid,
  p_precio numeric default null,
  p_pieza smallint default null,
  p_superficies text[] default '{}',
  p_mascota uuid default null,
  p_region text default null,
  p_profesional text default null,
  p_nota text default null,
  p_fecha date default null,
  p_actualizar_odontograma boolean default true,
  p_pagado boolean default false,
  p_insumos jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta public.sales_companies%rowtype;
  v_producto public.sales_products%rowtype;
  v_id uuid;
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Santiago')::date);
  v_donde text;
  v_costo numeric := 0;
  v_cobro numeric := 0;
  v_precio numeric;
  v_item record;
begin
  select * into v_cuenta from public.sales_companies where id = p_cuenta;
  if not found then
    raise exception 'No encontramos esa ficha' using errcode = 'P0002';
  end if;
  select * into v_producto from public.sales_products where id = p_producto and organization_id = v_cuenta.organization_id;
  if not found then
    raise exception 'Ese procedimiento no está en el arancel de la clínica' using errcode = 'P0002';
  end if;
  if v_producto.aplica_a in ('pieza', 'superficie') and p_pieza is null then
    raise exception 'Este procedimiento se hace en una pieza: elígela en el odontograma' using errcode = '22023';
  end if;
  if v_producto.aplica_a = 'superficie' and coalesce(array_length(p_superficies, 1), 0) = 0 then
    raise exception 'Marca las superficies tratadas' using errcode = '22023';
  end if;
  v_precio := coalesce(p_precio, v_producto.one_time_price, 0);

  insert into public.atenciones (organization_id, cuenta_id, mascota_id, producto_id, descripcion, pieza, superficies, region,
                                 precio, pagado, es_urgencia, profesional, nota, fecha, registrado_por)
  values (v_cuenta.organization_id, p_cuenta, p_mascota, p_producto, v_producto.name, p_pieza, coalesce(p_superficies, '{}'),
          nullif(btrim(coalesce(p_region, '')), ''), v_precio, coalesce(p_pagado, false),
          v_producto.es_urgencia, nullif(btrim(coalesce(p_profesional, '')), ''), nullif(btrim(coalesce(p_nota, '')), ''),
          v_fecha, auth.uid())
  returning id into v_id;

  -- Materiales: los que vienen, o la receta del procedimiento.
  for v_item in
    select insumo.*, usado.cantidad as usada, usado.cobrar
    from (
      select (elemento ->> 'insumo_id')::uuid as insumo_id,
             (elemento ->> 'cantidad')::numeric as cantidad,
             coalesce((elemento ->> 'cobrar')::boolean, true) as cobrar
      from jsonb_array_elements(coalesce(p_insumos, '[]'::jsonb)) as elemento
      where p_insumos is not null
      union all
      select receta.insumo_id, receta.cantidad, true
      from public.procedimiento_insumos receta
      where p_insumos is null and receta.producto_id = p_producto
    ) usado
    join public.insumos insumo on insumo.id = usado.insumo_id and insumo.organization_id = v_cuenta.organization_id
    where usado.cantidad > 0
  loop
    insert into public.atencion_insumos (organization_id, atencion_id, insumo_id, nombre, unidad, cantidad, costo_unitario, precio_unitario, cobrado)
    values (v_cuenta.organization_id, v_id, v_item.id, v_item.nombre, v_item.unidad, v_item.usada, v_item.costo,
            v_item.precio_venta, v_item.cobrable and v_item.cobrar);
    v_costo := v_costo + v_item.costo * v_item.usada;
    if v_item.cobrable and v_item.cobrar then
      v_cobro := v_cobro + coalesce(v_item.precio_venta, 0) * v_item.usada;
    end if;
    update public.insumos set stock = stock - v_item.usada, updated_at = now() where id = v_item.id and stock is not null;
  end loop;

  update public.atenciones set costo_materiales = v_costo, precio_materiales = v_cobro where id = v_id;

  if p_actualizar_odontograma and p_pieza is not null and v_producto.resultado_odontograma is not null then
    insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, tratamiento,
                                              profesional, nota, fecha, registrado_por)
    values (v_cuenta.organization_id, p_cuenta, p_pieza,
            case when v_producto.aplica_a = 'superficie' then coalesce(p_superficies, '{}') else '{}' end,
            v_producto.resultado_odontograma, 'terminado', v_producto.name,
            nullif(btrim(coalesce(p_profesional, '')), ''), nullif(btrim(coalesce(p_nota, '')), ''), v_fecha, auth.uid());
  end if;

  v_donde := case
    when p_pieza is not null then ' · pieza ' || p_pieza
    when nullif(btrim(coalesce(p_region, '')), '') is not null then ' · ' || lower(p_region)
    else '' end;
  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
  values (v_cuenta.organization_id, p_cuenta, 'reunion',
          'Atención: ' || v_producto.name || v_donde,
          replace(to_char(v_precio + v_cobro, 'FM$999,999,999'), ',', '.')
            || case when v_cobro > 0 then ' (incluye ' || replace(to_char(v_cobro, 'FM$999,999,999'), ',', '.') || ' en materiales)' else '' end
            || case when p_pagado then ' · pagado' else ' · por cobrar' end,
          now(), true, auth.uid());

  return v_id;
end;
$$;


create or replace function public.registrar_atenciones(
  p_cuenta uuid,
  p_items jsonb,
  p_mascota uuid default null,
  p_region text default null,
  p_profesional text default null,
  p_nota text default null,
  p_fecha date default null,
  p_actualizar_odontograma boolean default true,
  p_pagado boolean default false
)
returns uuid[]
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_item jsonb;
  v_ids uuid[] := '{}';
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un procedimiento' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'Demasiados procedimientos en una sola atención' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_ids := v_ids || public.registrar_atencion(
      p_cuenta,
      (v_item ->> 'producto_id')::uuid,
      (v_item ->> 'precio')::numeric,
      (v_item ->> 'pieza')::smallint,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item -> 'superficies', '[]'::jsonb))), '{}'),
      p_mascota,
      coalesce(nullif(v_item ->> 'region', ''), p_region),
      p_profesional,
      p_nota,
      p_fecha,
      p_actualizar_odontograma,
      p_pagado,
      case when jsonb_typeof(v_item -> 'insumos') = 'array' then v_item -> 'insumos' end
    );
  end loop;
  return v_ids;
end;
$$;

revoke all on function public.registrar_atenciones(uuid, jsonb, uuid, text, text, text, date, boolean, boolean) from public, anon;
grant execute on function public.registrar_atenciones(uuid, jsonb, uuid, text, text, text, date, boolean, boolean) to authenticated;
