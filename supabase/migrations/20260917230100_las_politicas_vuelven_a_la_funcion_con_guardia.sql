-- Diez políticas quedaron llamando a una función que nadie puede ejecutar.
--
-- Al poner la frontera de empresa, renombré cada función original a
-- `*_sin_empresa` y creé un envoltorio con el mismo nombre. Renombrar sigue al
-- objeto, no al nombre: las políticas que la usaban quedaron apuntando a la
-- versión sin guardia, y a esa le había quitado el permiso de ejecución.
--
-- Resultado: cualquier consulta de un usuario con sesión contra esas tablas
-- respondía "permission denied", y la pantalla de Correo caía con error 500.
--
-- Vuelven al envoltorio, que sí tiene permiso y además comprueba la empresa.

do $$
declare
  v_politica record;
  v_qual text;
  v_check text;
  v_sql text;
  v_cambiadas int := 0;
begin
  for v_politica in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual like '%\_sin\_empresa%' or with_check like '%\_sin\_empresa%')
  loop
    v_qual := replace(coalesce(v_politica.qual, ''), '_sin_empresa', '');
    v_check := replace(coalesce(v_politica.with_check, ''), '_sin_empresa', '');

    v_sql := format('alter policy %I on public.%I', v_politica.policyname, v_politica.tablename);
    if v_politica.qual is not null then
      v_sql := v_sql || format(' using (%s)', v_qual);
    end if;
    if v_politica.with_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;

    execute v_sql;
    v_cambiadas := v_cambiadas + 1;
  end loop;

  raise notice 'Políticas devueltas al envoltorio: %', v_cambiadas;
end;
$$;

do $$
declare
  v_quedan int;
begin
  select count(*) into v_quedan
  from pg_policies
  where schemaname = 'public'
    and (qual like '%\_sin\_empresa%' or with_check like '%\_sin\_empresa%');

  if v_quedan > 0 then
    raise exception 'Quedaron % políticas llamando a una función sin permiso', v_quedan;
  end if;
end;
$$;
