-- Preguntar "¿puedo ver esto?" nunca debe tumbar la pantalla.
--
-- Al cerrar la frontera de empresa envolví estas funciones con
-- `assert_org_access`, que levanta una excepción. En una acción está bien: si
-- alguien intenta mover un dato de otra empresa, tiene que fallar. Pero estas
-- cinco son predicados: se usan para FILTRAR filas dentro de un informe. Al
-- recorrer una campaña de otra empresa, en vez de descartar la fila, reventaban
-- la consulta entera y la página de Correo respondía error 500.
--
-- Un filtro responde "no" y sigue. Solo eso cambia acá.

do $$
declare
  v_nombre text;
  v_def text;
  v_nuevo text;
begin
  foreach v_nombre in array array[
    'can_manage_campaign(uuid)',
    'can_supervise_campaign(uuid)',
    'can_supervise_mail_lead(uuid, uuid)',
    'has_active_dial_attempt(uuid)',
    'management_requires_equifax_data(uuid, uuid)'
  ] loop
    v_def := pg_get_functiondef(('public.' || v_nombre)::regprocedure);

    v_nuevo := regexp_replace(
      v_def,
      'perform public\.assert_org_access\((.*)\);',
      'if not public.can_access_org(\1) then return false; end if;',
      'n'
    );

    if v_nuevo = v_def then
      raise exception 'No pude reescribir la guardia de %', v_nombre;
    end if;

    execute v_nuevo;
  end loop;
end;
$$;

do $$
declare
  v_nombre text;
begin
  foreach v_nombre in array array[
    'can_manage_campaign(uuid)',
    'can_supervise_campaign(uuid)',
    'can_supervise_mail_lead(uuid, uuid)',
    'has_active_dial_attempt(uuid)',
    'management_requires_equifax_data(uuid, uuid)'
  ] loop
    if pg_get_functiondef(('public.' || v_nombre)::regprocedure) like '%assert_org_access%' then
      raise exception 'La guardia de % todavía revienta en vez de filtrar', v_nombre;
    end if;
    if pg_get_functiondef(('public.' || v_nombre)::regprocedure) not like '%can_access_org%' then
      raise exception 'La guardia de % se perdió: ya no comprueba la empresa', v_nombre;
    end if;
  end loop;

  -- Tomar una conversación de WhatsApp SÍ es una acción: ahí el error se queda.
  if pg_get_functiondef('public.take_over_whatsapp_conversation(uuid)'::regprocedure) not like '%assert_org_access%' then
    raise exception 'Una acción perdió su guardia dura';
  end if;
end;
$$;
