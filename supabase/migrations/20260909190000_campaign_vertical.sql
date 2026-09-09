-- Vertical de negocio de la campaña.
--
-- Atlas nació con vocabulario de venta ("ventas", "cotizaciones", "UF en
-- pipeline"). Una operación de cobranza mide lo mismo con otros nombres y otras
-- etapas: cartera, compromiso de pago, convenio, recuperación. Antes de esto la
-- única salida era renombrar para todos o cablear una campaña en el código.
--
-- El vertical viaja en la campaña y las pantallas leen de él su vocabulario,
-- sus vistas y sus KPI. Es aditivo: todo lo existente queda en 'ventas' y se
-- comporta igual que antes.
alter table public.campaigns
  add column if not exists vertical text not null default 'ventas';

alter table public.campaigns
  drop constraint if exists campaigns_vertical_check;

alter table public.campaigns
  add constraint campaigns_vertical_check
  check (vertical in ('ventas', 'cobranza'));

comment on column public.campaigns.vertical is
  'Vertical de negocio de la campaña: ventas | cobranza. Decide el vocabulario, las vistas y los KPI que muestran las pantallas.';

update public.campaigns
set vertical = 'cobranza'
where name = 'Fundación Educacional Créate';
