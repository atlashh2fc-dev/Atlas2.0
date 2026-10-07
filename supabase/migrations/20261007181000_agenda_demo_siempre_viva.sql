-- La agenda de las demos siempre tiene citas por delante.
--
-- Las citas de demostración se generaron una sola vez (el 21-09), así que a
-- las dos semanas la agenda de Dental y Vet quedó vacía hacia adelante: justo
-- lo que se muestra en una venta. Esta función rellena, para cada empresa
-- de demostración, los días hábiles que faltan hasta 10 días por delante,
-- con el mismo patrón de la carga original. Corre con el despacho de
-- mensajes (cada 10 minutos) y no hace nada si los días ya tienen citas.

create or replace function public.refrescar_agenda_demo()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
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
  v_n integer := 0;
begin
  for v_org in select id, edicion from public.organizations where slug like 'demo-%' and edicion in ('vet', 'dental', 'barber') loop
    for v_dia in select d::date from generate_series(v_hoy, v_hoy + 10, interval '1 day') d loop
      if extract(isodow from v_dia) = 7 then continue; end if;
      if exists (select 1 from public.citas where organization_id = v_org.id
                  and inicio >= (v_dia::text || ' 00:00')::timestamp at time zone 'America/Santiago'
                  and inicio < ((v_dia + 1)::text || ' 00:00')::timestamp at time zone 'America/Santiago') then
        continue;
      end if;
      for v_prof in select id from public.profesionales where organization_id = v_org.id and activo loop
        v_libre_hasta := null;
        for v_slot in 0..17 loop
          v_inicio := ((v_dia::text || ' 09:00')::timestamp + (v_slot * interval '30 minutes')) at time zone 'America/Santiago';
          if v_libre_hasta is not null and v_inicio < v_libre_hasta then continue; end if;
          if random() > (case when extract(isodow from v_dia) = 6 then 0.35 else 0.55 end) then continue; end if;

          select id into v_cuenta from public.sales_companies where organization_id = v_org.id order by random() limit 1;
          if v_cuenta is null then exit; end if;
          v_mascota := null;
          if v_org.edicion = 'vet' then
            select id into v_mascota from public.mascotas where cuenta_id = v_cuenta order by random() limit 1;
          end if;
          select name, coalesce(duracion_min, 30) as duracion into v_producto
            from public.sales_products
           where organization_id = v_org.id and active and not coalesce(es_urgencia, false) and coalesce(one_time_price, 0) > 0
           order by random() limit 1;
          v_duracion := greatest(15, least(90, coalesce(v_producto.duracion, 30)));
          v_libre_hasta := v_inicio + make_interval(mins => v_duracion);

          insert into public.citas (organization_id, cuenta_id, mascota_id, profesional_id, inicio, fin, motivo, estado, confirmada_por, confirmada_at)
          select v_org.id, v_cuenta, v_mascota, v_prof.id, v_inicio, v_libre_hasta, coalesce(v_producto.name, 'Consulta'), estado,
                 case when estado = 'confirmada' then (array['whatsapp', 'whatsapp', 'recepcion'])[1 + floor(random() * 3)::int] end,
                 case when estado = 'confirmada' then now() end
            from (select case when v_dia <= v_hoy + 1 and random() < 0.5 then 'confirmada' else 'reservada' end as estado) e;
          v_n := v_n + 1;
        end loop;
      end loop;
    end loop;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.refrescar_agenda_demo() from public, anon, authenticated;
grant execute on function public.refrescar_agenda_demo() to service_role;
