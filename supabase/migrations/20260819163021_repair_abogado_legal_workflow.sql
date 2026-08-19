-- El flujo productivo de Abogado Legal estaba publicado, pero su nodo inicial
-- "Llamada" no tenía opciones. Atlas construye el catálogo de tipificaciones
-- desde ese nodo, por lo que el catálogo resultaba vacío.
--
-- Reparamos la cascada para que los estados Conecta / No Conecta lleven a sus
-- resultados. La agenda ya se captura en el formulario operativo; el antiguo
-- nodo que modelaba Día/Horario/Correo no debe convertir esos campos en
-- categorías de tipificación.
do $$
declare
  v_workflow_id uuid;
  v_start_id uuid;
  v_connected_id uuid;
  v_not_connected_id uuid;
  v_legacy_agenda_id uuid;
begin
  select c.workflow_id
    into v_workflow_id
  from public.campaigns c
  where lower(btrim(c.name)) = 'abogado legal'
  limit 1;

  -- La campaña es dato operativo y puede no existir en ambientes nuevos.
  if v_workflow_id is null then
    return;
  end if;

  select ws.id into v_start_id
  from public.workflow_steps ws
  where ws.workflow_id = v_workflow_id
    and ws.is_start
  order by ws.step_order
  limit 1;

  select ws.id into v_connected_id
  from public.workflow_steps ws
  where ws.workflow_id = v_workflow_id
    and lower(btrim(ws.name)) = 'conecta'
  limit 1;

  select ws.id into v_not_connected_id
  from public.workflow_steps ws
  where ws.workflow_id = v_workflow_id
    and lower(btrim(ws.name)) = 'no conecta'
  limit 1;

  select ws.id into v_legacy_agenda_id
  from public.workflow_steps ws
  where ws.workflow_id = v_workflow_id
    and lower(btrim(ws.name)) = 'agenda reunión'
  limit 1;

  if v_start_id is null or v_connected_id is null or v_not_connected_id is null then
    raise exception 'No se puede reparar Abogado Legal: faltan los pasos Llamada, Conecta o No Conecta';
  end if;

  update public.workflow_steps
  set
    field_type = 'single_choice',
    options = '["Conecta", "No Conecta"]'::jsonb,
    allowed_results = array['Conecta', 'No Conecta']::text[]
  where id = v_start_id;

  -- Elimina las salidas antiguas del inicio, incluidas las tres ramas
  -- duplicadas con from_option NULL.
  delete from public.workflow_step_branches
  where workflow_id = v_workflow_id
    and from_step_id = v_start_id;

  insert into public.workflow_step_branches (
    workflow_id,
    from_step_id,
    from_option,
    to_step_id
  ) values
    (v_workflow_id, v_start_id, 'Conecta', v_connected_id),
    (v_workflow_id, v_start_id, 'No Conecta', v_not_connected_id);

  -- Conserva el nodo y su posible historial, pero lo vuelve terminal para que
  -- Atlas ofrezca "Agenda Reunión" como razón y capture fecha/hora en el bloque
  -- de agenda, en vez de ofrecer Día/Horario/Correo como tipificaciones.
  if v_legacy_agenda_id is not null then
    update public.workflow_steps
    set
      field_type = 'text',
      options = '[]'::jsonb,
      allowed_results = array[]::text[]
    where id = v_legacy_agenda_id;
  end if;

  update public.workflows
  set updated_at = now()
  where id = v_workflow_id;
end
$$;
