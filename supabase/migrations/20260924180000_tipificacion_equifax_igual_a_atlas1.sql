-- La ficha de Equifax vuelve a tipificar exactamente como Atlas 1.
--
-- El workflow c62a0bf7 mostraba 9 opciones de 24. La auditoría del 24-09-2026
-- encontró por qué: «No Interesa» del paso inicial llevaba a un paso sin
-- opciones y la ficha tomaba el motivo de su descripción («VOLVER A LLAMAR»),
-- los nueve motivos de no interés colgaban de un paso al que no llegaba ninguna
-- rama, «NO ES EL MOMENTO» y «CORTA LLAMADA» se perdían porque la descripción
-- de su paso nombraba otro motivo, y el inicio estaba marcado en un paso
-- intermedio. El dueño decidió replicar los 24 motivos de Atlas 1 con sus
-- nombres exactos, que son además los que traen las ~98 mil llamadas migradas.
--
-- Árbol resultante (tres niveles, como Atlas 1):
--   Estado de la llamada
--     CONTACTO    -> Resultado de la gestión
--                      INTERESADO    -> 6 motivos
--                      NO INTERESADO -> 14 motivos
--     NO CONTACTO -> 4 motivos
-- Las ramas terminan en «Cierre de gestión»; cotización y venta pasan antes por
-- «Datos comerciales Equifax», que además mantiene el contrato comercial que
-- lee public.management_requires_equifax_data.
--
-- Reglas que respeta (ver buildCallReasonCatalogFromWorkflow):
--   * Los motivos son opciones, nunca nombres ni descripciones de pasos, y
--     ninguna descripción nombra un motivo: la ficha deduce el motivo del texto
--     del paso hoja y así se colaban y deduplicaban motivos ajenos.
--   * Los tres pasos que ya tienen interacciones (inicio, resultado y motivo de
--     gestión a futuro) conservan su id; el resto no tiene referencias y se
--     elimina. Si en otro ambiente alguno sí las tuviera, se re-enlaza antes al
--     paso que hoy ofrece ese motivo.
--   * result_kind queda nulo a propósito. El tablero ya clasifica los 24 motivos
--     desde el catálogo comercial, y declarar «no_interesado» en el nodo movería
--     NUMERO ERRONEO / NO CORRESPONDE de NO CONTACTO (decisión del negocio en
--     tipification-breakdown.ts) a NO INTERESADO, porque la declaración manda.
-- Solo toca este workflow; en un ambiente sin él no hace nada.

do $migration$
declare
  v_workflow_id constant uuid := 'c62a0bf7-7669-4646-b5ce-7765d08fd546';
  v_estado constant uuid := 'ec99311b-b55b-46db-93c8-58058022a860';
  v_no_contacto constant uuid := '1d1c3fc9-6e21-4468-92e8-18229c3e31bc';
  v_resultado constant uuid := '47dc1b71-08b4-48d2-94c0-243c3665b169';
  v_interesado constant uuid := '22146982-235c-4b0f-a13c-8ccd4a2dbe12';
  v_no_interesado constant uuid := '019e14eb-c1cc-4f43-a715-bbb0ec2f38d9';
  v_equifax constant uuid := '1718665f-45a1-4c80-b2d1-62e869a6c801';
  v_cierre constant uuid := 'c457f866-7f48-4b80-a29a-834d34dbf751';
  v_kept uuid[] := array[
    'ec99311b-b55b-46db-93c8-58058022a860',
    '1d1c3fc9-6e21-4468-92e8-18229c3e31bc',
    '47dc1b71-08b4-48d2-94c0-243c3665b169',
    '22146982-235c-4b0f-a13c-8ccd4a2dbe12',
    '019e14eb-c1cc-4f43-a715-bbb0ec2f38d9',
    '1718665f-45a1-4c80-b2d1-62e869a6c801',
    'c457f866-7f48-4b80-a29a-834d34dbf751'
  ]::uuid[];
  -- Orden de Atlas 1 por frecuencia (60 días, 29.094 llamadas cerradas): lo
  -- más usado queda arriba y a un clic.
  v_opciones_no_contacto text[] := array[
    'NO CONECTA', 'NO CONTESTA', 'BUZON DE VOZ', 'TELEFONO FUERA DE SERVICIO'
  ];
  v_opciones_interesado text[] := array[
    'VOLVER A LLAMAR', 'SE ENVIA INFORMACION', 'COTIZACION ENVIADA',
    'REUNION AGENDADA', 'CONTACTO CON TERCERO', 'VENTA EN VALIDACION'
  ];
  v_opciones_no_interesado text[] := array[
    'NUMERO ERRONEO / NO CORRESPONDE', 'NO ENTREGA CREDITO / PAGO CONTADO',
    'NO DA MOTIVO', 'TERCERO NO ENTREGA INFORMACION', 'NO CALIFICA',
    'CLIENTE MOLESTO', 'CLIENTE CARTERIZADO',
    'SE DECLARA EN QUIEBRA O PROCESO DE CIERRE',
    'TIENE CONTRATO CON LA COMPETENCIA', 'CLIENTE NO SUJETO A VENTA',
    'PRECIO MUY ALTO', 'SIN PRESUPUESTO', 'NO ES EL MOMENTO', 'DURACION CONTRATO'
  ];
begin
  if not exists (select 1 from public.workflows where id = v_workflow_id) then
    raise notice 'Workflow Equifax % no existe en este ambiente; nada que hacer.', v_workflow_id;
    return;
  end if;

  if exists (
    select 1 from public.workflow_steps
    where id = any (v_kept) and workflow_id <> v_workflow_id
  ) then
    raise exception 'Un paso reservado para Equifax pertenece a otro workflow; se aborta sin tocar nada.';
  end if;

  -- Libera los step_order (únicos por workflow) antes de reasignarlos.
  update public.workflow_steps
  set step_order = step_order + 1000
  where workflow_id = v_workflow_id;

  insert into public.workflow_steps as step (
    id, workflow_id, step_order, name, description, is_mandatory, field_type,
    options, allowed_results, pos_x, pos_y, is_start, result_kind
  ) values
    (v_estado, v_workflow_id, 1, 'Estado de la llamada',
      '¿Hubo conversación con alguien de la empresa?',
      true, 'single_choice', '["CONTACTO", "NO CONTACTO"]'::jsonb,
      array['CONTACTO', 'NO CONTACTO'], 0, 240, true, null),
    (v_no_contacto, v_workflow_id, 2, 'Motivo de no contacto',
      'La llamada no llegó a una conversación. En el progresivo el motor registra por su cuenta las que no se completan; esta lista sirve para las llamadas manuales y para las que alcanzaron al ejecutivo.',
      true, 'single_choice', to_jsonb(v_opciones_no_contacto),
      v_opciones_no_contacto, 360, 480, false, null),
    (v_resultado, v_workflow_id, 3, 'Resultado de la gestión',
      'Solo cuando hubo contacto: ¿la empresa quedó interesada?',
      true, 'single_choice', '["INTERESADO", "NO INTERESADO"]'::jsonb,
      array['INTERESADO', 'NO INTERESADO'], 360, 120, false, null),
    (v_interesado, v_workflow_id, 4, 'Motivo interesado',
      'Oportunidad viva: cotizar y cerrar piden datos comerciales; el seguimiento pide agenda.',
      true, 'combobox', to_jsonb(v_opciones_interesado),
      v_opciones_interesado, 720, -60, false, null),
    (v_no_interesado, v_workflow_id, 5, 'Motivo no interesado',
      'La empresa no avanza. Registra el motivo real: alimenta el reciclaje de la base y el reporte.',
      true, 'combobox', to_jsonb(v_opciones_no_interesado),
      v_opciones_no_interesado, 720, 300, false, null),
    (v_equifax, v_workflow_id, 6, 'Datos comerciales Equifax',
      'Productos, UF mensual y correo destinatario de la propuesta.',
      false, 'text', '[]'::jsonb, null, 1080, -120, false, null),
    (v_cierre, v_workflow_id, 7, 'Cierre de gestión',
      'Guarda la tipificación, la nota y la agenda en el registro.',
      false, 'text', '[]'::jsonb, null, 1440, 120, false, null)
  on conflict (id) do update set
    step_order = excluded.step_order,
    name = excluded.name,
    description = excluded.description,
    is_mandatory = excluded.is_mandatory,
    field_type = excluded.field_type,
    options = excluded.options,
    allowed_results = excluded.allowed_results,
    pos_x = excluded.pos_x,
    pos_y = excluded.pos_y,
    is_start = excluded.is_start,
    result_kind = excluded.result_kind;

  -- interactions.workflow_step_id no tiene ON DELETE: un paso referenciado no
  -- se puede borrar. Hoy ninguno de los que salen tiene referencias; si en otro
  -- ambiente las tuviera, se re-enlazan al paso que ofrece ese motivo (o al
  -- inicio) para no perder la trazabilidad de la gestión.
  update public.interactions interaction
  set workflow_step_id = coalesce(
    (
      select candidate.id
      from public.workflow_steps candidate
      cross join lateral jsonb_array_elements_text(candidate.options) as option(value)
      where candidate.id = any (v_kept)
        and public.normalize_management_text(option.value)
          = public.normalize_management_text(interaction.result)
      order by candidate.step_order
      limit 1
    ),
    v_estado
  )
  where interaction.workflow_step_id in (
    select id from public.workflow_steps
    where workflow_id = v_workflow_id and not (id = any (v_kept))
  );

  update public.legacy_tipificacion_map map
  set workflow_step_id = coalesce(
    (
      select candidate.id
      from public.workflow_steps candidate
      cross join lateral jsonb_array_elements_text(candidate.options) as option(value)
      where candidate.id = any (v_kept)
        and public.normalize_management_text(option.value)
          = public.normalize_management_text(map.mapped_result)
      order by candidate.step_order
      limit 1
    ),
    v_estado
  )
  where map.workflow_step_id in (
    select id from public.workflow_steps
    where workflow_id = v_workflow_id and not (id = any (v_kept))
  );

  -- Las ramas se rehacen completas; borrar los pasos sobrantes arrastra las
  -- suyas por ON DELETE CASCADE.
  delete from public.workflow_step_branches where workflow_id = v_workflow_id;
  delete from public.workflow_steps
  where workflow_id = v_workflow_id and not (id = any (v_kept));

  insert into public.workflow_step_branches (workflow_id, from_step_id, from_option, to_step_id) values
    (v_workflow_id, v_estado, 'CONTACTO', v_resultado),
    (v_workflow_id, v_estado, 'NO CONTACTO', v_no_contacto),
    (v_workflow_id, v_resultado, 'INTERESADO', v_interesado),
    (v_workflow_id, v_resultado, 'NO INTERESADO', v_no_interesado),
    (v_workflow_id, v_interesado, 'COTIZACION ENVIADA', v_equifax),
    (v_workflow_id, v_interesado, 'VENTA EN VALIDACION', v_equifax),
    (v_workflow_id, v_interesado, null, v_cierre),
    (v_workflow_id, v_no_interesado, null, v_cierre),
    (v_workflow_id, v_no_contacto, null, v_cierre),
    (v_workflow_id, v_equifax, null, v_cierre);

  update public.workflows set updated_at = now() where id = v_workflow_id;
end
$migration$;
