-- «Contesta IA» como motivo de no contacto.
--
-- Pedido de operación (01-10-2026): a los ejecutivos a veces les cae la
-- llamada y contesta una IA (el asistente de llamadas del teléfono o del
-- operador), no la persona. No había cómo contarlo y cada uno lo dejaba como
-- buzón u otra cosa. Se agrega la opción justo después del buzón en todo paso
-- de no contacto que ya ofrece «Buzón de voz», con la misma escritura que el
-- resto de sus opciones (MAYÚSCULAS en Equifax, «Contesta IA» en los demás).
--
-- La ficha la clasifica como buzón de voz (status voicemail, NO CONTACTO):
-- contestó una máquina, no hubo conversación. El motivo queda propio, así que
-- se cuenta aparte en reportes y tipificaciones.
--
-- Idempotente: no toca un paso que ya tenga la opción. Los pasos de no contacto
-- no tienen ramas por opción (salen con una sola rama o ninguna), así que la
-- opción nueva no deja una conexión suelta en el lienzo.

do $migration$
declare
  v_paso record;
  v_buzon text;
  v_nueva text;
  v_opciones text[];
  v_resultado text[];
  v_opcion text;
begin
  for v_paso in
    select step.id, step.options, step.allowed_results
    from public.workflow_steps step
    where jsonb_typeof(step.options) = 'array'
      and exists (
        select 1 from jsonb_array_elements_text(step.options) as option(value)
        where public.normalize_management_text(option.value) = 'BUZON DE VOZ'
      )
      and not exists (
        select 1 from jsonb_array_elements_text(step.options) as option(value)
        where public.normalize_management_text(option.value) = 'CONTESTA IA'
      )
  loop
    select option.value into v_buzon
    from jsonb_array_elements_text(v_paso.options) as option(value)
    where public.normalize_management_text(option.value) = 'BUZON DE VOZ'
    limit 1;

    v_nueva := case when v_buzon = upper(v_buzon) then 'CONTESTA IA' else 'Contesta IA' end;

    select array_agg(option.value order by option.ordinality)
    into v_opciones
    from jsonb_array_elements_text(v_paso.options) with ordinality as option(value, ordinality);

    v_resultado := array[]::text[];
    foreach v_opcion in array v_opciones loop
      v_resultado := v_resultado || v_opcion;
      if v_opcion = v_buzon then
        v_resultado := v_resultado || v_nueva;
      end if;
    end loop;

    update public.workflow_steps
    set options = to_jsonb(v_resultado),
        allowed_results = case
          when allowed_results is null then null
          when v_nueva = any (allowed_results) then allowed_results
          else (
            select array_agg(value order by ordinality)
            from (
              select value, ordinality::numeric as ordinality
              from unnest(allowed_results) with ordinality as result(value, ordinality)
              union all
              select v_nueva, coalesce((
                select ordinality::numeric + 0.5
                from unnest(allowed_results) with ordinality as result(value, ordinality)
                where value = v_buzon
                limit 1
              ), 1e9)
            ) ordered
          )
        end
    where id = v_paso.id;
  end loop;
end
$migration$;
