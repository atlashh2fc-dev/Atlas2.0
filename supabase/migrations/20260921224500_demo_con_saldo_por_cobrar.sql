-- Demostración: saldos por cobrar.
--
-- Las atenciones sembradas venían todas pagadas, así que la Caja de la demo
-- se veía vacía. Las atenciones de la última semana de cada empresa de
-- demostración quedan por cobrar, y así la caja muestra saldos, el enlace de
-- pago tiene a quién mandarse y el inicio muestra un monto real.

update public.atenciones a
   set pagado = false, pago_id = null
  from public.organizations o
 where o.id = a.organization_id
   and o.slug in ('demo-vet', 'demo-dental')
   and a.pagado
   and a.pago_id is null
   and a.fecha >= (now() at time zone 'America/Santiago')::date - 7;

-- Si una empresa de demostración no tuvo atenciones esta semana, quedan por
-- cobrar sus quince más recientes: la caja nunca se muestra vacía.
update public.atenciones a
   set pagado = false, pago_id = null
 where a.id in (
   select reciente.id
     from public.organizations o
     cross join lateral (
       select a2.id from public.atenciones a2
        where a2.organization_id = o.id and a2.pagado and a2.pago_id is null
        order by a2.fecha desc, a2.created_at desc
        limit 15
     ) reciente
    where o.slug in ('demo-vet', 'demo-dental')
      and not exists (select 1 from public.atenciones a3 where a3.organization_id = o.id and not a3.pagado)
 );
