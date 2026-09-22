-- Reportes de la clínica (Dental y Vet).
--
-- El tablero cruza filtros al instante en el navegador: se hace clic en un
-- profesional y todo el resto se recalcula sin volver a la base. Para eso
-- necesita los hechos del período, no totales ya sumados. Esta función los
-- entrega en una sola consulta y en forma compacta (arreglos por fila, no
-- objetos), desde el inicio del período de comparación hasta el fin del
-- período pedido.
--
-- Es security invoker a propósito: la seguridad por fila de cada tabla decide
-- la empresa y el rol, igual que en Caja o en la Agenda. Las fechas salen en
-- hora de Chile: el día de una cita es el de la clínica, no el de UTC.
--
-- Además de los hechos del período trae dos fotos del momento, que no dependen
-- del rango: lo que queda por cobrar (con su antigüedad) y, en Vet, el estado
-- de las vacunas de cada mascota.

create or replace function public.reporte_clinica(p_desde date, p_hasta date)
returns jsonb
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public'
as $$
  with
  atencion as (
    select a.id, a.fecha, a.cuenta_id,
           coalesce(nullif(btrim(a.profesional), ''), 'Sin profesional') as profesional,
           coalesce(nullif(btrim(p.categoria), ''), case when a.es_urgencia then 'Urgencias' else 'Sin categoría' end) as categoria,
           coalesce(p.name, a.descripcion) as procedimiento,
           (a.precio + coalesce(a.precio_materiales, 0))::numeric as monto,
           coalesce(a.costo_materiales, 0)::numeric as costo,
           a.pagado, a.es_urgencia, m.especie, m.nombre as mascota
    from public.atenciones a
    left join public.sales_products p on p.id = a.producto_id
    left join public.mascotas m on m.id = a.mascota_id
    where a.fecha between p_desde and p_hasta
  ),
  cita as (
    select c.id, c.inicio at time zone 'America/Santiago' as inicio_local,
           round(extract(epoch from (c.fin - c.inicio)) / 60)::int as minutos,
           c.cuenta_id, pr.nombre as profesional, c.estado, c.motivo, m.especie
    from public.citas c
    join public.profesionales pr on pr.id = c.profesional_id
    left join public.mascotas m on m.id = c.mascota_id
    where c.inicio >= (p_desde::timestamp at time zone 'America/Santiago')
      and c.inicio < ((p_hasta + 1)::timestamp at time zone 'America/Santiago')
  ),
  plan as (
    select o.id, (o.created_at at time zone 'America/Santiago')::date as creado, o.company_id as cuenta_id,
           o.name, o.status, o.one_time_amount::numeric as monto,
           (o.closed_at at time zone 'America/Santiago')::date as cerrado,
           o.lost_reason, s.name as etapa, s.position as etapa_orden,
           coalesce(nullif(o.source, ''), nullif(sc.source, '')) as origen
    from public.sales_opportunities o
    join public.sales_companies sc on sc.id = o.company_id
    left join public.sales_stages s on s.id = o.stage_id
    where (o.created_at at time zone 'America/Santiago')::date between p_desde and p_hasta
  ),
  pago as (
    select p.id, (coalesce(p.pagado_at, p.created_at) at time zone 'America/Santiago')::date as fecha,
           p.cuenta_id, p.monto::numeric as monto, p.medio, p.estado
    from public.pagos p
    where (coalesce(p.pagado_at, p.created_at) at time zone 'America/Santiago')::date between p_desde and p_hasta
  ),
  saldo as (
    select a.fecha, a.cuenta_id, (a.precio + coalesce(a.precio_materiales, 0))::numeric as monto,
           coalesce(nullif(btrim(a.profesional), ''), 'Sin profesional') as profesional
    from public.atenciones a
    where not a.pagado
  ),
  cuentas_usadas as (
    select cuenta_id as id from atencion
    union select cuenta_id from cita
    union select cuenta_id from plan
    union select cuenta_id from pago
    union select cuenta_id from saldo
    union select sc.id from public.sales_companies sc
      where (sc.created_at at time zone 'America/Santiago')::date between p_desde and p_hasta
  ),
  cuenta as (
    select sc.id, sc.name, (sc.created_at at time zone 'America/Santiago')::date as creada,
           nullif(sc.source, '') as origen, nullif(btrim(sc.commune), '') as comuna,
           (select min(a.fecha) from public.atenciones a where a.cuenta_id = sc.id) as primera_atencion
    from public.sales_companies sc
    join cuentas_usadas u on u.id = sc.id
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'atenciones', coalesce((select jsonb_agg(jsonb_build_array(id, fecha, cuenta_id, profesional, categoria, procedimiento,
                    monto, costo, pagado, es_urgencia, especie, mascota) order by fecha) from atencion), '[]'::jsonb),
    'citas', coalesce((select jsonb_agg(jsonb_build_array(id, to_char(inicio_local, 'YYYY-MM-DD"T"HH24:MI'), minutos,
                    cuenta_id, profesional, estado, motivo, especie) order by inicio_local) from cita), '[]'::jsonb),
    'planes', coalesce((select jsonb_agg(jsonb_build_array(id, creado, cuenta_id, name, status, monto, cerrado,
                    lost_reason, etapa, etapa_orden, origen) order by creado) from plan), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_array(id, fecha, cuenta_id, monto, medio, estado) order by fecha) from pago), '[]'::jsonb),
    'saldos', coalesce((select jsonb_agg(jsonb_build_array(fecha, cuenta_id, monto, profesional)) from saldo), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_array(id, name, creada, origen, comuna, primera_atencion)) from cuenta), '[]'::jsonb),
    'vacunas', coalesce((select jsonb_agg(jsonb_build_array(m.especie, m.proxima_vacuna, m.cuenta_id)) from public.mascotas m), '[]'::jsonb)
  );
$$;

comment on function public.reporte_clinica(date, date) is
  'Hechos de la clínica entre dos fechas (hora de Chile) para el tablero de reportes; respeta la seguridad por fila.';

revoke all on function public.reporte_clinica(date, date) from public;
revoke execute on function public.reporte_clinica(date, date) from anon;
grant execute on function public.reporte_clinica(date, date) to authenticated;
