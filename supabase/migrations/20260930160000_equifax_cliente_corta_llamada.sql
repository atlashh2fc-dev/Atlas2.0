-- Equifax suma el motivo «CLIENTE CORTA LLAMADA» (pedido del 30-09-2026).
--
-- Va en CONTACTO > NO INTERESADO: el cliente contestó y colgó. Es el mismo
-- resultado que el tablero ya le da a «CORTA LLAMADA» (tipification-breakdown.ts),
-- y el cierre lo graba como connected/not_interested, sin agenda.
-- Queda al final de la lista para no mover los motivos de un clic.
-- Idempotente y solo toca el paso «Motivo no interesado» del workflow Equifax.

do $migration$
declare
  v_workflow_id constant uuid := 'c62a0bf7-7669-4646-b5ce-7765d08fd546';
  v_no_interesado constant uuid := '019e14eb-c1cc-4f43-a715-bbb0ec2f38d9';
  v_motivo constant text := 'CLIENTE CORTA LLAMADA';
begin
  if not exists (
    select 1 from public.workflow_steps
    where id = v_no_interesado and workflow_id = v_workflow_id
  ) then
    raise notice 'Paso Equifax % no existe en este ambiente; nada que hacer.', v_no_interesado;
    return;
  end if;

  update public.workflow_steps
  set options = options || to_jsonb(v_motivo),
      allowed_results = coalesce(allowed_results, array[]::text[]) || v_motivo
  where id = v_no_interesado
    and not (options ? v_motivo);

  update public.workflows set updated_at = now() where id = v_workflow_id;
end
$migration$;
