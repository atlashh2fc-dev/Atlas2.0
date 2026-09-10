-- La regla "qué tipificación exige agenda" vivía duplicada en tres capas: el
-- catálogo TypeScript, las dos RPC de persistencia y el trigger de
-- consistencia de public.calls. El 2026-09-07 se acotó COTIZACION ENVIADA al
-- contrato Equifax solo en las RPC; el trigger siguió exigiendo agenda para esa
-- etiqueta en cualquier campaña. Resultado en Secretaria Virtual: la UI no
-- ofrece fecha (la tipificación no la requiere) y la base la exige, así que la
-- gestión no se puede cerrar ni corregir y la agente queda atrapada en la ficha.
--
-- Esta migración crea una única fuente de verdad en SQL y la consume desde el
-- trigger y desde ambas RPC, para que la regla no pueda volver a divergir.
-- Contrato resultante, espejo de src/lib/call-typification.ts:
--   required -> callback, VOLVER A LLAMAR, REUNION, NO ES EL MOMENTO,
--               COMPROMISO DE PAGO, NEGOCIACION EN CURSO y COTIZACION cuando
--               la campaña declara el contrato comercial Equifax.
--   optional -> COTIZACION fuera de Equifax: admite seguimiento, no lo exige.
--   none     -> el resto: cierre final, ninguna agenda puede sobrevivir.

-- 1. Contrato comercial de la campaña (extraído de la RPC, donde estaba inline).
create or replace function public.management_requires_equifax_data(
  p_workflow_id uuid,
  p_campaign_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    exists (
      select 1
      from public.workflow_steps equifax_step
      where equifax_step.workflow_id = p_workflow_id
        and public.normalize_management_text(
          concat_ws(' ', equifax_step.name, equifax_step.description)
        ) like '%EQUIFAX%'
    )
    or exists (
      select 1
      from public.campaigns equifax_campaign
      where equifax_campaign.id = p_campaign_id
        and public.normalize_management_text(equifax_campaign.name) like '%EQUIFAX%'
    );
$function$;

revoke all on function public.management_requires_equifax_data(uuid, uuid) from public, anon;
grant execute on function public.management_requires_equifax_data(uuid, uuid) to authenticated, service_role;

comment on function public.management_requires_equifax_data(uuid, uuid)
is 'Indica si el workflow o la campaña declaran el contrato comercial Equifax (productos, UF, email).';

-- 2. Requerimiento de agenda por tipificación. Única fuente de verdad en SQL.
create or replace function public.management_agenda_requirement(
  p_reason text,
  p_outcome text,
  p_requires_equifax_data boolean
)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $function$
  select case
    when coalesce(p_outcome, '') = 'callback' then 'required'
    when public.normalize_management_text(p_reason) like '%VOLVER A LLAMAR%' then 'required'
    when public.normalize_management_text(p_reason) like '%REUNION%' then 'required'
    when public.normalize_management_text(p_reason) like '%NO ES EL MOMENTO%' then 'required'
    when public.normalize_management_text(p_reason) like '%COMPROMISO DE PAGO%' then 'required'
    when public.normalize_management_text(p_reason) like '%NEGOCIACION EN CURSO%' then 'required'
    when public.normalize_management_text(p_reason) like '%COTIZACION%' then
      case when coalesce(p_requires_equifax_data, false) then 'required' else 'optional' end
    else 'none'
  end;
$function$;

revoke all on function public.management_agenda_requirement(text, text, boolean) from public, anon;
grant execute on function public.management_agenda_requirement(text, text, boolean) to authenticated, service_role;

comment on function public.management_agenda_requirement(text, text, boolean)
is 'required | optional | none para una tipificación, según su contrato de campaña. Espejo de inferAgenda en src/lib/call-typification.ts.';

-- 3. Resolución por lead, para los clientes que solo tienen la fila de calls.
create or replace function public.lead_agenda_requirement(
  p_lead_id uuid,
  p_reason text,
  p_outcome text
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select public.management_agenda_requirement(
    p_reason,
    p_outcome,
    public.management_requires_equifax_data(agenda_lead.workflow_id, agenda_lead.campaign_id)
  )
  from public.leads agenda_lead
  where agenda_lead.id = p_lead_id;
$function$;

revoke all on function public.lead_agenda_requirement(uuid, text, text) from public, anon;
grant execute on function public.lead_agenda_requirement(uuid, text, text) to authenticated, service_role;

comment on function public.lead_agenda_requirement(uuid, text, text)
is 'Requerimiento de agenda de una tipificación resolviendo el contrato de la campaña del lead.';

-- 4. El trigger deja de hardcodear etiquetas y consulta el contrato.
create or replace function public.enforce_closed_call_agenda_consistency()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_requirement text;
begin
  if new.ended_at is null or new.discarded_reason is not null then
    return new;
  end if;

  -- Un lead ausente no debe bloquear el cierre: se cae al contrato genérico,
  -- que sigue protegiendo la invariante de las tipificaciones finales.
  v_requirement := coalesce(
    public.lead_agenda_requirement(new.lead_id, new.reason, new.outcome),
    public.management_agenda_requirement(new.reason, new.outcome, false)
  );

  if v_requirement = 'required' and new.next_action_at is null then
    raise exception 'Esta tipificación requiere fecha y hora de agenda.';
  end if;

  if v_requirement = 'none' and new.next_action_at is not null then
    raise exception 'Esta tipificación no admite una agenda.';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_closed_call_agenda_consistency() from public, anon, authenticated;

comment on function public.enforce_closed_call_agenda_consistency()
is 'Impide agendas residuales o ausentes en gestiones cerradas según el contrato de agenda de su campaña.';

-- 5. Las RPC de cierre y corrección pasan a consumir la misma función.
--    Se reemplaza sobre la definición viva para conservar toda la lógica
--    transaccional, el wrapper público y los privilegios ya otorgados.
do $migration$
declare
  v_targets regprocedure[] := array[
    to_regprocedure('public.save_call_management(uuid,uuid,text,text,text,text,timestamp with time zone,text,text[],numeric,text)'),
    to_regprocedure('private.revise_call_management(uuid,uuid,text,text,text,text,timestamp with time zone,text[],numeric,text)')
  ];
  v_target regprocedure;
  v_definition text;
  v_original text;
begin
  foreach v_target in array v_targets loop
    if v_target is null then
      raise exception 'No existe la función de persistencia de gestiones con la firma esperada.';
    end if;

    select pg_get_functiondef(v_target) into v_definition;
    v_original := v_definition;

    -- Re-ejecutar la migración no debe reescribir una definición ya convergida.
    if position('management_agenda_requirement' in v_definition) > 0 then
      continue;
    end if;

    v_definition := replace(
      v_definition,
      $old$  if (
      v_reason_norm in ('VOLVER A LLAMAR', 'REUNION AGENDADA', 'NO ES EL MOMENTO')
      or (v_requires_equifax_data and v_reason_norm = 'COTIZACION ENVIADA')
    ) and p_next_action_at is null then$old$,
      $new$  if public.management_agenda_requirement(
      v_reason_norm,
      p_outcome,
      v_requires_equifax_data
    ) = 'required' and p_next_action_at is null then$new$
    );

    if v_definition = v_original then
      raise exception
        'La definición de % no coincide con la versión esperada; falta aplicar 20260907170518_scope_equifax_call_closure_validation.',
        v_target::text;
    end if;

    -- El cálculo del contrato Equifax también vuelve a la función compartida.
    v_definition := replace(
      v_definition,
      $old$  v_requires_equifax_data :=
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
    );$old$,
      $new$  v_requires_equifax_data := public.management_requires_equifax_data(
    v_workflow_id,
    v_lead.campaign_id
  );$new$
    );

    execute v_definition;
  end loop;
end
$migration$;
