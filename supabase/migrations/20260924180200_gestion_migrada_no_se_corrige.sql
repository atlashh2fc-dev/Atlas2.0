-- Una gestión traída de Atlas 1 no se corrige desde Atlas 2.0.
--
-- La carga del 24-09-2026 trajo ~98 mil llamadas de Registro Intel con su
-- tipificación original (calls.legacy_call_id). «Corregir tipificación» toma la
-- última llamada conectada del ejecutivo y la reescribe; sobre una migrada
-- borraría la versión de Atlas 1, que es la que se concilia contra Vocalcom y el
-- reporte histórico, y la validaría contra reglas que no existían cuando se
-- gestionó. Lo que cambió después se registra con una gestión nueva.
--
-- La ficha ya no ofrece el botón (getRevisableCall) y la acción del servidor lo
-- rechaza; aquí se cierra también la RPC, que es lo que manda.

do $migration$
declare
  v_target regprocedure := to_regprocedure(
    'private.revise_call_management(uuid,uuid,text,text,text,text,timestamp with time zone,text[],numeric,text)'
  );
  v_definition text;
  v_original text;
  v_anchor constant text := $old$  if not found then
    raise exception 'La gestión no existe, sigue abierta o no pertenece a tu usuario.';
  end if;
$old$;
begin
  if v_target is null then
    raise exception 'No existe private.revise_call_management con la firma esperada.';
  end if;

  select pg_get_functiondef(v_target) into v_definition;

  -- Re-ejecutar la migración no debe duplicar la guarda.
  if position('legacy_call_id' in v_definition) > 0 then
    return;
  end if;

  v_original := v_definition;
  v_definition := replace(
    v_definition,
    v_anchor,
    v_anchor || $new$
  if v_call.legacy_call_id is not null then
    raise exception 'Esta gestión viene de Atlas 1 y no se puede corregir. Registra una gestión nueva.';
  end if;
$new$
  );

  if v_definition = v_original then
    raise exception 'La definición de private.revise_call_management no coincide con la versión esperada.';
  end if;

  execute v_definition;
end
$migration$;
