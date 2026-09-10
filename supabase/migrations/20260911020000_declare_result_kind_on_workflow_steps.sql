-- Deja que el workflow declare qué significa cada nodo de resultado.
--
-- El tablero agrupa las tipificaciones en interesa / no interesa / no contacto.
-- Para lo heredado de Equifax lo resuelve el catálogo comercial, y para el
-- resto el estado y el desenlace que graba el cierre. Queda un hueco: las
-- gestiones efectivas cuyo desenlace es `other`, que son justamente las que el
-- workflow de la campaña clasifica pero el código no sabe leer.
--
-- El caso concreto es la cartera de cobranza de la demo. Su workflow es una
-- cascada de tres niveles y el segundo nivel ya declara el resultado:
--
--   Acuerdo de pago    -> Compromiso de pago, Convenio suscrito, Pago ya realizado
--   Seguimiento        -> Negociación en curso, Volver a llamar, Seguimiento de convenio
--   Sin acuerdo        -> Sin capacidad de pago, Rechaza la deuda, Derivado a cobranza prejudicial
--   Caso en revisión   -> Reclamo a la fundación, Alumno retirado del colegio
--
-- Esa estructura es la verdad y estaba ahí, pero sin decir si "Acuerdo de pago"
-- significa interés. Esta columna lo declara, y la declara el mismo
-- administrador que arma la cascada, no el código: una cartera nueva trae su
-- vocabulario y no debería obligar a un despliegue.
--
-- No se toca el nivel 1 ("Estado del contacto"): ahí conviven opciones de
-- contacto y de no contacto, y para esas el `status` del cierre ya decide bien.

alter table public.workflow_steps
  add column if not exists result_kind text;

alter table public.workflow_steps
  drop constraint if exists workflow_steps_result_kind_check;

alter table public.workflow_steps
  add constraint workflow_steps_result_kind_check
  check (result_kind is null or result_kind in ('interesado', 'no_interesado', 'no_contacto'));

comment on column public.workflow_steps.result_kind is
  'Que significa este nodo de resultado para el tablero: interesado, no_interesado o no_contacto. Nulo cuando el paso no declara resultado (por ejemplo el estado del contacto, donde lo decide el status del cierre).';

-- Declaración para el workflow de cobranza de la demo. Se identifica por
-- nombre de paso dentro de ese workflow, no por id, para que sea legible.
update public.workflow_steps s
set result_kind = m.kind
from (values
  ('Acuerdo de pago',  'interesado'),
  ('Seguimiento',      'interesado'),
  ('Sin acuerdo',      'no_interesado'),
  ('Caso en revisión', 'no_interesado')
) as m(paso, kind)
where s.name = m.paso
  and s.workflow_id in (select id from public.workflows where name ilike '%Créate%');
