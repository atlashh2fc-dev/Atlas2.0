-- Funciones SECURITY DEFINER que cualquiera sin sesión podía ejecutar.
--
-- Tres son consultas que devuelven datos de una empresa sin comprobar quién
-- pregunta (revisiones_del_vendedor recibe el slug de cualquier empresa): solo
-- las llama el servidor con service_role, así que quedan solo para él.
-- Las otras diez son funciones de trigger: un trigger no necesita el permiso
-- EXECUTE de quien escribe, así que quitárselo a anon no cambia nada salvo
-- que dejan de poder invocarse por la API.

revoke execute on function public.revisiones_del_vendedor(text) from public, anon, authenticated;
revoke execute on function public.ultima_corrida_de_agente(text) from public, anon, authenticated;
revoke execute on function public.verificar_envios_de_correo(uuid) from public, anon, authenticated;
grant execute on function public.revisiones_del_vendedor(text) to service_role;
grant execute on function public.ultima_corrida_de_agente(text) to service_role;
grant execute on function public.verificar_envios_de_correo(uuid) to service_role;

do $$
declare
  v_funcion text;
begin
  foreach v_funcion in array array[
    'asignar_negocio_nuevo', 'cerrar_correos_con_la_gestion', 'enlazar_negocio_a_registro',
    'heredar_empresa_de_la_campana', 'marcar_primera_respuesta_de_correo',
    'reflejar_acuse_de_outbox_en_saliente', 'reflejar_estado_whatsapp_en_saliente',
    'sale_validation_from_call', 'sales_companies_normalize', 'sembrar_modulos_de_empresa'
  ] loop
    execute format('revoke execute on function public.%I() from public, anon, authenticated', v_funcion);
  end loop;
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.revisiones_del_vendedor(text)', 'execute')
     or has_function_privilege('authenticated', 'public.revisiones_del_vendedor(text)', 'execute') then
    raise exception 'revisiones_del_vendedor sigue expuesta';
  end if;
end;
$$;
