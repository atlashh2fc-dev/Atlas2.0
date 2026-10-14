-- Quien abre una gestión siempre puede cerrarla, aunque el cliente sea de otro.
--
-- 14-10-2026, Karina Halaby (Equifax): la respuesta de un cliente de Ximena
-- Cofre llevaba seis días sin atender y la cola de correo se la pasó a Karina
-- (dueña sin el canal de correo disponible y plazo vencido). Karina abrió la
-- gestión por correo, como permite 20260929231000, y quedó atrapada: la ficha
-- decía «Tienes una gestión pendiente con LABORATORIO…» estando en la ficha de
-- ese mismo registro, y el CTI la recargaba cada 5 s sin formulario.
--
-- Tres capas la bloqueaban:
-- 1. calls_select solo le muestra al ejecutivo las gestiones de registros a su
--    nombre. getOpenCall (ficha y bandeja) no encontraba la suya, mientras
--    getMyOpenManagement, con clave de servicio, sí. Ahora el ejecutivo siempre
--    ve su propia gestión abierta (hay a lo más una: calls_one_open_per_agent_idx).
-- 2. save_call_management corría con los permisos del ejecutivo: no veía la
--    llamada, no podía bloquear el registro ajeno (FOR UPDATE exige la política
--    de UPDATE) ni insertar la interacción. Pasa a SECURITY DEFINER con las
--    mismas comprobaciones explícitas: la llamada es suya (o es admin), está
--    abierta y el registro es de su empresa. El cruce de agendas duplicadas
--    mantiene el alcance que tenía bajo RLS para no sumar rechazos nuevos.
-- 3. Al cerrar, el registro tomaba managed_by = quien tipifica. Sobre un
--    cliente ajeno eso le quitaría el cliente y su agenda al dueño. Ahora la
--    tipificación actualiza el estado del registro, pero dueño y agenda siguen
--    con quien lo tenía (callback_owner_user_id también). Solo supervisión
--    reasigna clientes (Reasignar desde la ficha).
--
-- Además, leads_de_mis_correos incluye el registro de la gestión por correo que
-- el ejecutivo tiene abierta: si el correo cumple sus 7 días con la gestión
-- abierta, el ejecutivo no pierde la ficha que tiene que cerrar.

do $migration$
declare
  v_target constant regprocedure := to_regprocedure(
    'public.save_call_management(uuid,uuid,text,text,text,text,timestamp with time zone,text,text[],numeric,text,numeric)'
  );
  v_definition text;
  v_original text;
  v_step text;
  v_before text;
  v_patches constant text[][] := array[
    [
      $old$  v_interaction_id uuid;
begin$old$,
      $new$  v_interaction_id uuid;
  -- Cliente ajeno: tipifica, pero el registro y su agenda siguen con su dueño
  -- (20261014200000).
  v_mantiene_dueno boolean := false;
begin$new$
    ],
    [
      $old$  if not found then
    raise exception 'El lead no existe o no está disponible para tu usuario.';
  end if;
$old$,
      $new$  if not found then
    raise exception 'El lead no existe o no está disponible para tu usuario.';
  end if;

  -- Con privilegios de definidor la empresa se comprueba aquí; antes la ponía
  -- la RLS (20261014200000).
  perform public.assert_org_access(v_lead.organization_id);

  -- Respuesta de correo derivada por la cola, o registro reasignado con la
  -- gestión abierta: quien cierra no se queda con un cliente que tiene dueño.
  v_mantiene_dueno := v_role <> 'admin'
    and coalesce(v_lead.managed_by, v_lead.assigned_to) is not null
    and v_user_id is distinct from v_lead.managed_by
    and v_user_id is distinct from v_lead.assigned_to
    and not (p_lead_id = any (public.active_dial_attempt_lead_ids()));
$new$
    ],
    [
      $old$            or related.id = p_lead_id
          )
      )
  ) then$old$,
      $new$            or related.id = p_lead_id
          )
          -- El mismo alcance que tenía bajo RLS (20261014200000).
          and (
            v_role = 'admin'
            or related.id = p_lead_id
            or related.assigned_to = v_user_id
            or related.managed_by = v_user_id
            or related.team_id = any (public.supervised_team_ids())
          )
      )
  ) then$new$
    ],
    [
      $old$    callback_owner_user_id = case when p_next_action_at is not null then v_user_id else null end,$old$,
      $new$    callback_owner_user_id = case
      when p_next_action_at is null then null
      when v_mantiene_dueno then coalesce(v_lead.managed_by, v_lead.assigned_to)
      else v_user_id
    end,$new$
    ],
    [
      $old$    managed_by = v_user_id,
    updated_at = v_now
  where id = p_lead_id;$old$,
      $new$    managed_by = case when v_mantiene_dueno then managed_by else v_user_id end,
    updated_at = v_now
  where id = p_lead_id;$new$
    ]
  ];
  i integer;
begin
  if v_target is null then
    raise exception 'No existe save_call_management con la firma esperada.';
  end if;

  select pg_get_functiondef(v_target) into v_definition;
  v_original := v_definition;

  -- Re-ejecutar la migración no debe reescribir una definición ya convergida.
  if position('v_mantiene_dueno' in v_definition) = 0 then
    for i in 1 .. array_length(v_patches, 1) loop
      v_before := v_definition;
      v_step := v_patches[i][1];
      v_definition := replace(v_definition, v_step, v_patches[i][2]);
      if v_definition = v_before then
        raise exception
          'La definición de save_call_management no coincide con la versión esperada (parche %); revisa 20261014200000.',
          i;
      end if;
    end loop;

    execute v_definition;
  end if;

  execute format('alter function %s security definer set search_path = pg_catalog, public', v_target);
  execute format('revoke all on function %s from public, anon', v_target);
  execute format('grant execute on function %s to authenticated, service_role', v_target);
end
$migration$;

-- 1. El ejecutivo siempre ve su propia gestión abierta.
drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
  for select to authenticated
  using (
    ((select public.current_role_name()) = 'admin'::public.app_role)
    or (
      (select public.current_role_name()) = 'agente'::public.app_role
      and (
        lead_id in (
          select l.id
          from public.leads l
          where l.assigned_to = (select auth.uid()) or l.managed_by = (select auth.uid())
        )
        or (agent_id = (select auth.uid()) and ended_at is null)
      )
    )
    or (
      (select public.current_role_name()) = 'supervisor'::public.app_role
      and lead_id in (
        select l.id
        from public.leads l
        where l.team_id in (select unnest(public.supervised_team_ids()))
      )
    )
  );

-- 2. La ficha de la gestión por correo abierta no se pierde a los 7 días.
create or replace function public.leads_de_mis_correos()
returns uuid[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(array_agg(distinct registro.lead_id), '{}'::uuid[])
  from (
    select correo.lead_id
    from public.inbound_emails correo
    where correo.assigned_to = (select auth.uid())
      and correo.lead_id is not null
      and (correo.status = 'new' or correo.received_at >= now() - interval '7 days')
    union all
    select gestion.lead_id
    from public.calls gestion
    where gestion.agent_id = (select auth.uid())
      and gestion.ended_at is null
      and gestion.management_channel = 'correo'
      and gestion.lead_id is not null
  ) registro;
$$;

revoke all on function public.leads_de_mis_correos() from public, anon;
grant execute on function public.leads_de_mis_correos() to authenticated, service_role;
