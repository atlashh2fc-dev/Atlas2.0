-- Agenda en horario hábil y nota obligatoria, como en Atlas 1.
--
-- Atlas 1 solo dejaba agendar en bloques de lunes a viernes entre 09:00 y
-- 19:00 y, si SE ENVIA INFORMACION quedaba sin agenda, exigía una nota. Atlas
-- 2.0 aceptaba cualquier datetime: domingos, madrugadas y fechas pasadas, que
-- quedan en la cola del ejecutivo sin que el discador pueda cumplirlas, y un
-- envío de información sin agenda ni nota es un cliente al que nadie vuelve.
--
-- 1. La franja es de cada campaña (campaigns.agenda_*). Nula por defecto: las
--    demás campañas siguen sin restricción. Equifax la declara aquí.
-- 2. private.agenda_fuera_de_franja evalúa en hora Chile; espejo de
--    agendaSlotError en src/lib/call-typification.ts, mismos mensajes.
-- 3. private.assert_management_closure_rules junta ambas reglas y la llaman
--    save_call_management y private.revise_call_management, parchadas sobre su
--    definición viva como en 20260910190000.
-- La nota solo se exige bajo el contrato Equifax (management_requires_equifax_data),
-- igual que los datos comerciales, para no cambiar campañas con la misma etiqueta.

alter table public.campaigns
  add column if not exists agenda_dias_habiles smallint[],
  add column if not exists agenda_hora_desde time,
  add column if not exists agenda_hora_hasta time;

alter table public.campaigns
  drop constraint if exists campaigns_agenda_franja_check;

alter table public.campaigns
  add constraint campaigns_agenda_franja_check check (
    (
      agenda_dias_habiles is null
      or (
        cardinality(agenda_dias_habiles) > 0
        and agenda_dias_habiles <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      )
    )
    and (
      agenda_hora_desde is null
      or agenda_hora_hasta is null
      or agenda_hora_desde < agenda_hora_hasta
    )
  );

comment on column public.campaigns.agenda_dias_habiles is
  'Días ISO (1 = lunes … 7 = domingo) en que se aceptan agendas, en hora Chile. Nulo: todos.';
comment on column public.campaigns.agenda_hora_desde is
  'Primera hora aceptada para una agenda, inclusive, en hora Chile. Nula: sin límite.';
comment on column public.campaigns.agenda_hora_hasta is
  'Fin de la franja de agendas, exclusivo (19:00 no se acepta), en hora Chile. Nula: sin límite.';

-- Equifax: la franja de Atlas 1. Solo si nadie la configuró antes, para que
-- re-aplicar la migración no pise un ajuste posterior.
update public.campaigns
set agenda_dias_habiles = array[1, 2, 3, 4, 5]::smallint[],
    agenda_hora_desde = time '09:00',
    agenda_hora_hasta = time '19:00'
where id = '318cf37a-da42-4cbd-934d-bdc47753d7bd'
  and agenda_dias_habiles is null
  and agenda_hora_desde is null
  and agenda_hora_hasta is null;

create or replace function private.agenda_fuera_de_franja(
  p_next_action_at timestamptz,
  p_dias smallint[],
  p_desde time,
  p_hasta time,
  p_now timestamptz default now()
)
returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $function$
declare
  v_local timestamp;
  v_nombres text[];
begin
  if p_next_action_at is null or (p_dias is null and p_desde is null and p_hasta is null) then
    return null;
  end if;

  if p_next_action_at <= p_now then
    return 'La agenda debe quedar en una fecha y hora futura.';
  end if;

  -- La franja es de la operación en Chile, no del servidor ni del navegador.
  v_local := p_next_action_at at time zone 'America/Santiago';

  if p_dias is not null and not (extract(isodow from v_local)::smallint = any (p_dias)) then
    select array_agg(
      (array['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'])[dia]
      order by dia
    )
    into v_nombres
    from unnest(p_dias) as dia;

    return format(
      'La agenda debe caer en un día hábil de la campaña (%s).',
      case
        when cardinality(v_nombres) = 1 then v_nombres[1]
        else array_to_string(v_nombres[1:cardinality(v_nombres) - 1], ', ')
          || ' y ' || v_nombres[cardinality(v_nombres)]
      end
    );
  end if;

  if (p_desde is not null and v_local::time < p_desde)
    or (p_hasta is not null and v_local::time >= p_hasta) then
    return format(
      'La agenda debe quedar %s, hora Chile.',
      concat_ws(
        ' y ',
        'desde las ' || to_char(p_desde, 'HH24:MI'),
        'antes de las ' || to_char(p_hasta, 'HH24:MI')
      )
    );
  end if;

  return null;
end;
$function$;

revoke all on function private.agenda_fuera_de_franja(timestamptz, smallint[], time, time, timestamptz) from public, anon;
grant execute on function private.agenda_fuera_de_franja(timestamptz, smallint[], time, time, timestamptz) to authenticated, service_role;

comment on function private.agenda_fuera_de_franja(timestamptz, smallint[], time, time, timestamptz) is
  'Motivo por el que una agenda no cabe en la franja de la campaña (futura, día y hora en America/Santiago), o null. Espejo de agendaSlotError.';

-- SECURITY DEFINER para leer la franja aunque la política de campaigns no deje
-- ver la fila: la regla no puede depender de lo que el ejecutivo alcance a leer.
-- Vive en private (fuera de la API) y solo responde sobre la campaña que la RPC
-- ya resolvió desde el lead que el ejecutivo está cerrando.
create or replace function private.assert_management_closure_rules(
  p_campaign_id uuid,
  p_requires_equifax_data boolean,
  p_reason text,
  p_notes text,
  p_next_action_at timestamptz,
  p_previous_next_action_at timestamptz default null
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_reason text := public.normalize_management_text(p_reason);
  v_dias smallint[];
  v_desde time;
  v_hasta time;
  v_error text;
begin
  if coalesce(p_requires_equifax_data, false)
    and (v_reason like '%ENVIA INFORMACION%' or v_reason like '%ENVIAR INFORMACION%')
    and p_next_action_at is null
    and nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'Sin agenda, % exige una nota con lo enviado.', v_reason;
  end if;

  -- Una corrección que conserva la agenda original no la vuelve a juzgar: la
  -- fecha pudo quedar atrás sin que eso sea un error de quien corrige.
  if p_next_action_at is not null
    and p_next_action_at is distinct from p_previous_next_action_at
    and p_campaign_id is not null then
    select campaign.agenda_dias_habiles, campaign.agenda_hora_desde, campaign.agenda_hora_hasta
    into v_dias, v_desde, v_hasta
    from public.campaigns campaign
    where campaign.id = p_campaign_id;

    v_error := private.agenda_fuera_de_franja(p_next_action_at, v_dias, v_desde, v_hasta);
    if v_error is not null then
      raise exception '%', v_error;
    end if;
  end if;
end;
$function$;

revoke all on function private.assert_management_closure_rules(uuid, boolean, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function private.assert_management_closure_rules(uuid, boolean, text, text, timestamptz, timestamptz) to authenticated, service_role;

comment on function private.assert_management_closure_rules(uuid, boolean, text, text, timestamptz, timestamptz) is
  'Reglas de cierre heredadas de Atlas 1: franja de agenda de la campaña y nota obligatoria en SE ENVIA INFORMACION sin agenda (contrato Equifax).';

-- Las RPC de cierre y corrección llaman a las reglas justo después de validar
-- la venta, antes de escribir nada. Se reemplaza sobre la definición viva para
-- conservar la lógica transaccional, el wrapper público y los privilegios.
do $migration$
declare
  v_targets regprocedure[] := array[
    to_regprocedure('public.save_call_management(uuid,uuid,text,text,text,text,timestamp with time zone,text,text[],numeric,text)'),
    to_regprocedure('private.revise_call_management(uuid,uuid,text,text,text,text,timestamp with time zone,text[],numeric,text)')
  ];
  v_target regprocedure;
  v_definition text;
  v_original text;
  v_anchor constant text := $old$  if p_outcome = 'sale' and v_reason_norm <> 'VENTA EN VALIDACION' then
    raise exception 'Para registrar venta usa la tipificación VENTA EN VALIDACION.';
  end if;
$old$;
  v_previous text;
begin
  foreach v_target in array v_targets loop
    if v_target is null then
      raise exception 'No existe la función de persistencia de gestiones con la firma esperada.';
    end if;

    select pg_get_functiondef(v_target) into v_definition;
    v_original := v_definition;

    -- Re-ejecutar la migración no debe reescribir una definición ya convergida.
    if position('assert_management_closure_rules' in v_definition) > 0 then
      continue;
    end if;

    -- En la corrección, la agenda previa es la de la llamada que se corrige.
    v_previous := case
      when v_target::text like 'private.revise_call_management%' then 'v_call.next_action_at'
      else 'null'
    end;

    v_definition := replace(
      v_definition,
      v_anchor,
      v_anchor || format(
        $new$
  -- Reglas de Atlas 1: franja de agenda de la campaña y nota en SE ENVIA
  -- INFORMACION sin agenda (20260924180100).
  perform private.assert_management_closure_rules(
    v_lead.campaign_id,
    v_requires_equifax_data,
    v_reason,
    p_notes,
    p_next_action_at,
    %s
  );
$new$,
        v_previous
      )
    );

    if v_definition = v_original then
      raise exception
        'La definición de % no coincide con la versión esperada; revisa 20260910190000_unify_agenda_requirement_source_of_truth.',
        v_target::text;
    end if;

    execute v_definition;
  end loop;
end
$migration$;
