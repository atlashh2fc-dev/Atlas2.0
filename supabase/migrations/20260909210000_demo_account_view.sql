-- Cuentas de demostración con cambio de vista.
--
-- Mostrar el CRM exige recorrer el mismo dato desde el puesto del ejecutivo y
-- desde el tablero del supervisor. Abrir dos sesiones en medio de una reunión
-- rompe el hilo, y fingir la vista mentiría: en Atlas el rol es lo que la RLS
-- usa para decidir qué datos entrega.
--
-- La marca habilita el cambio de rol acotado (agente <-> supervisor) para esas
-- cuentas y solo para ellas. Admin queda fuera del conmutador a propósito: un
-- admin ve toda la base del CRM, no solo la campaña de la demostración.
alter table public.profiles
  add column if not exists is_demo boolean not null default false;

comment on column public.profiles.is_demo is
  'Cuenta de demostración: habilita el cambio de vista agente/supervisor sobre su propio perfil. No otorga permisos adicionales.';

update public.profiles
set is_demo = true
where email like '%@demo.geimser.cl';
