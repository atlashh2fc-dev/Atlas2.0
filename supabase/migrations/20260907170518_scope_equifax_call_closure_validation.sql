-- COTIZACION ENVIADA existe tanto en Equifax como en Secretaria Virtual.
-- Los campos producto/UF/email pertenecen al contrato comercial de Equifax,
-- no a la etiqueta compartida. Acotamos esa validacion en las dos rutas de
-- persistencia (cierre y correccion) sin cambiar sus firmas ni privilegios.
--
-- El reemplazo se hace sobre las funciones ya migradas para conservar toda la
-- logica transaccional y, en revise_call_management, el wrapper publico y la
-- implementacion SECURITY DEFINER del schema privado. Cada reemplazo valida el
-- texto esperado y aborta la migracion ante drift en vez de aplicar a medias.

do $migration$
declare
  v_save_signature regprocedure := to_regprocedure(
    'public.save_call_management(uuid,uuid,text,text,text,text,timestamp with time zone,text,text[],numeric,text)'
  );
  v_revision_signature regprocedure := to_regprocedure(
    'private.revise_call_management(uuid,uuid,text,text,text,text,timestamp with time zone,text[],numeric,text)'
  );
  v_definition text;
  v_original text;
begin
  if v_save_signature is null then
    raise exception 'No existe public.save_call_management con la firma esperada.';
  end if;
  if v_revision_signature is null then
    raise exception 'No existe private.revise_call_management con la firma esperada.';
  end if;

  select pg_get_functiondef(v_save_signature) into v_definition;
  v_original := v_definition;

  v_definition := replace(
    v_definition,
    $old$  v_workflow_step_id uuid;$old$,
    $new$  v_workflow_step_id uuid;
  v_requires_equifax_data boolean := false;$new$
  );
  v_definition := replace(
    v_definition,
    $old$  v_workflow_id := coalesce(v_workflow_id, v_lead.workflow_id);$old$,
    $new$  v_workflow_id := coalesce(v_workflow_id, v_lead.workflow_id);

  v_requires_equifax_data :=
    exists (
      select 1
      from public.workflow_steps equifax_step
      where equifax_step.workflow_id = v_workflow_id
        and public.normalize_management_text(
          concat_ws(' ', equifax_step.name, equifax_step.description)
        ) like '%EQUIFAX%'
    )
    or exists (
      select 1
      from public.campaigns equifax_campaign
      where equifax_campaign.id = v_lead.campaign_id
        and public.normalize_management_text(equifax_campaign.name) like '%EQUIFAX%'
    );$new$
  );
  v_definition := replace(
    v_definition,
    $old$  if v_reason_norm in ('VOLVER A LLAMAR', 'REUNION AGENDADA', 'COTIZACION ENVIADA', 'NO ES EL MOMENTO')
    and p_next_action_at is null then$old$,
    $new$  if (
      v_reason_norm in ('VOLVER A LLAMAR', 'REUNION AGENDADA', 'NO ES EL MOMENTO')
      or (v_requires_equifax_data and v_reason_norm = 'COTIZACION ENVIADA')
    ) and p_next_action_at is null then$new$
  );
  v_definition := replace(
    v_definition,
    $old$  if (p_outcome = 'sale' or v_reason_norm = 'COTIZACION ENVIADA')$old$,
    $new$  if v_requires_equifax_data
    and (p_outcome = 'sale' or v_reason_norm = 'COTIZACION ENVIADA')$new$
  );
  v_definition := replace(
    v_definition,
    $old$  if v_reason_norm = 'COTIZACION ENVIADA'
    and nullif(btrim(coalesce(p_equifax_recipient_email, v_lead.email, '')), '') is null then$old$,
    $new$  if v_requires_equifax_data
    and v_reason_norm = 'COTIZACION ENVIADA'
    and nullif(btrim(coalesce(p_equifax_recipient_email, v_lead.email, '')), '') is null then$new$
  );

  if v_definition = v_original
    or position('v_requires_equifax_data boolean := false' in v_definition) = 0
    or position('if v_requires_equifax_data' in v_definition) = 0 then
    raise exception 'La definicion de save_call_management no coincide con la version esperada.';
  end if;

  execute v_definition;

  select pg_get_functiondef(v_revision_signature) into v_definition;
  v_original := v_definition;

  v_definition := replace(
    v_definition,
    $old$  v_workflow_step_id uuid;$old$,
    $new$  v_workflow_step_id uuid;
  v_requires_equifax_data boolean := false;$new$
  );
  v_definition := replace(
    v_definition,
    $old$  v_workflow_id := coalesce(v_workflow_id, v_lead.workflow_id);$old$,
    $new$  v_workflow_id := coalesce(v_workflow_id, v_lead.workflow_id);

  v_requires_equifax_data :=
    exists (
      select 1
      from public.workflow_steps equifax_step
      where equifax_step.workflow_id = v_workflow_id
        and public.normalize_management_text(
          concat_ws(' ', equifax_step.name, equifax_step.description)
        ) like '%EQUIFAX%'
    )
    or exists (
      select 1
      from public.campaigns equifax_campaign
      where equifax_campaign.id = v_lead.campaign_id
        and public.normalize_management_text(equifax_campaign.name) like '%EQUIFAX%'
    );$new$
  );
  v_definition := replace(
    v_definition,
    $old$  if v_reason_norm in ('VOLVER A LLAMAR', 'REUNION AGENDADA', 'COTIZACION ENVIADA', 'NO ES EL MOMENTO')
    and p_next_action_at is null then$old$,
    $new$  if (
      v_reason_norm in ('VOLVER A LLAMAR', 'REUNION AGENDADA', 'NO ES EL MOMENTO')
      or (v_requires_equifax_data and v_reason_norm = 'COTIZACION ENVIADA')
    ) and p_next_action_at is null then$new$
  );
  v_definition := replace(
    v_definition,
    $old$  if (p_outcome = 'sale' or v_reason_norm = 'COTIZACION ENVIADA')$old$,
    $new$  if v_requires_equifax_data
    and (p_outcome = 'sale' or v_reason_norm = 'COTIZACION ENVIADA')$new$
  );
  v_definition := replace(
    v_definition,
    $old$  if v_reason_norm = 'COTIZACION ENVIADA'
    and nullif(btrim(coalesce(p_equifax_recipient_email, v_lead.email, '')), '') is null then$old$,
    $new$  if v_requires_equifax_data
    and v_reason_norm = 'COTIZACION ENVIADA'
    and nullif(btrim(coalesce(p_equifax_recipient_email, v_lead.email, '')), '') is null then$new$
  );

  if v_definition = v_original
    or position('v_requires_equifax_data boolean := false' in v_definition) = 0
    or position('if v_requires_equifax_data' in v_definition) = 0 then
    raise exception 'La definicion de private.revise_call_management no coincide con la version esperada.';
  end if;

  execute v_definition;
end
$migration$;

-- Mantener versionado el arbol operacional entregado para Secretaria Virtual.
-- Estos UPDATE son idempotentes y no tocan IDs, llamadas ni historiales.
update public.workflow_steps
set
  field_type = 'single_choice',
  options = '["Conecta", "No Conecta"]'::jsonb,
  allowed_results = array['Conecta', 'No Conecta']::text[]
where id = 'cb69f0b3-3095-4b83-a3a3-f05be616c978'
  and workflow_id = '67aed07a-8986-4407-93a1-49e621fdbccd';

update public.workflow_steps
set
  field_type = 'combobox',
  options = '["Enviar Información", "Volver a Llamar", "Cotización Enviada", "Contrata Servicio", "Número Erróneo", "No Interesa", "Corta Llamada"]'::jsonb,
  allowed_results = array[
    'Enviar Información',
    'Volver a Llamar',
    'Cotización Enviada',
    'Contrata Servicio',
    'Número Erróneo',
    'No Interesa',
    'Corta Llamada'
  ]::text[]
where id = 'e8cbd49e-265a-4a9b-ae1e-c94b6bc32db3'
  and workflow_id = '67aed07a-8986-4407-93a1-49e621fdbccd';

update public.workflow_steps
set
  field_type = 'combobox',
  options = '["No Contesta", "Buzón de Voz", "Teléfono Fuera de Servicio"]'::jsonb,
  allowed_results = array[
    'No Contesta',
    'Buzón de Voz',
    'Teléfono Fuera de Servicio'
  ]::text[]
where id = '6ed91142-f9d1-4cbc-928d-3ea1f01725ed'
  and workflow_id = '67aed07a-8986-4407-93a1-49e621fdbccd';
