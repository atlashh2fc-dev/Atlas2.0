-- La puerta de entrada desde la web limpia el nombre al guardarlo, en vez de
-- dejar que la pantalla cargue con lo que cada visitante teclee.
do $$
declare
  v_def text;
  v_nuevo text;
begin
  v_def := pg_get_functiondef('public.ingresar_negocio_desde_web(text, text, text, text, text, text, text, text, text, numeric, timestamptz, text, text)'::regprocedure);

  v_nuevo := replace(
    v_def,
    'v_nombre text := nullif(btrim(coalesce(p_company_name, '''')), '''');',
    'v_nombre text := public.nombre_presentable(p_company_name);'
  );

  v_nuevo := replace(
    v_nuevo,
    'v_nombre := coalesce(nullif(btrim(coalesce(p_contact_name, '''')), ''''), split_part(coalesce(v_email, ''sin nombre''), ''@'', 1));',
    'v_nombre := coalesce(public.nombre_presentable(p_contact_name), public.nombre_presentable(split_part(coalesce(v_email, ''sin nombre''), ''@'', 1)));'
  );

  v_nuevo := replace(
    v_nuevo,
    'coalesce(nullif(btrim(coalesce(p_contact_name, '''')), ''''), v_email, ''Contacto web''),',
    'coalesce(public.nombre_presentable(p_contact_name), v_email, ''Contacto web''),'
  );

  if v_nuevo = v_def then
    raise exception 'No pude injertar el arreglo de nombres en la entrada web';
  end if;

  execute v_nuevo;
end;
$$;

do $$
begin
  if pg_get_functiondef('public.ingresar_negocio_desde_web(text, text, text, text, text, text, text, text, text, numeric, timestamptz, text, text)'::regprocedure)
     not like '%nombre_presentable%' then
    raise exception 'La entrada web sigue guardando el nombre crudo';
  end if;
end;
$$;
