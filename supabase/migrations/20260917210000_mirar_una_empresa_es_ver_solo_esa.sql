-- Mirar una empresa significa ver solo esa empresa. También para el dueño.
--
-- Las políticas de aislamiento decían "es dueño de la plataforma O la fila es
-- de una empresa a la que alcanzo". Para hh2fc24@gmail.com la primera mitad
-- siempre era verdadera, así que el selector de empresa no filtraba nada: al
-- elegir Altius seguían apareciendo los datos de Geimser.
--
-- El permiso amplio ya está donde corresponde: `current_org_ids()` devuelve
-- todas las empresas activas cuando el dueño no ha elegido ninguna, y solo la
-- elegida cuando sí. Basta con quitar el atajo.
--
-- Dos excepciones, porque sin ellas el dueño se deja fuera a sí mismo: su
-- propio perfil y sus propias filas de sesión y preferencias tienen que
-- seguir visibles aunque esté mirando otra empresa.

do $$
declare
  v_politica record;
  v_nuevo text;
  v_cambiadas int := 0;
begin
  for v_politica in
    select tablename, policyname, qual
    from pg_policies
    where schemaname = 'public'
      and permissive = 'RESTRICTIVE'
      and (policyname like '%_organization_isolation' or policyname like '%_org_isolation')
      and qual like '%is_platform_owner%'
  loop
    v_nuevo := regexp_replace(v_politica.qual, '^\(is_platform_owner\(\) OR (.*)\)$', '\1');
    if v_nuevo = v_politica.qual then
      raise exception 'No pude reescribir la política % de %', v_politica.policyname, v_politica.tablename;
    end if;
    execute format(
      'alter policy %I on public.%I using (%s) with check (%s)',
      v_politica.policyname, v_politica.tablename, v_nuevo, v_nuevo
    );
    v_cambiadas := v_cambiadas + 1;
  end loop;
  raise notice 'Políticas reescritas: %', v_cambiadas;
end;
$$;

-- Tu propio perfil te sigue a donde mires: sin esto, elegir Altius te cerraría
-- la sesión, porque la aplicación no podría leer tu propia fila.
alter policy profiles_organization_isolation on public.profiles
  using (id = (select auth.uid()) or organization_id = any (public.current_org_ids()))
  with check (id = (select auth.uid()) or organization_id = any (public.current_org_ids()));

-- Lo mismo con lo que es tuyo y de nadie más: tu sesión y tus preferencias.
do $$
declare
  v_tabla text;
  v_regla text;
begin
  foreach v_tabla in array array['revoked_app_sessions', 'user_saved_views', 'user_view_preferences'] loop
    v_regla := 'profile_id = (select auth.uid()) or profile_id is null'
      || ' or public.org_of_profile(profile_id) = any (public.current_org_ids())';
    execute format(
      'alter policy %I on public.%I using (%s) with check (%s)',
      v_tabla || '_organization_isolation', v_tabla, v_regla, v_regla
    );
  end loop;
end;
$$;

-- Las funciones que comprueban la empresa tenían el mismo atajo.
create or replace function public.can_access_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select p_organization_id is null
    or p_organization_id = any (public.current_org_ids());
$$;

-- Que no quede ni un atajo suelto.
do $$
declare
  v_quedan int;
begin
  select count(*) into v_quedan
  from pg_policies
  where schemaname = 'public'
    and permissive = 'RESTRICTIVE'
    and (policyname like '%_organization_isolation' or policyname like '%_org_isolation')
    and qual like '%is_platform_owner%';

  if v_quedan > 0 then
    raise exception 'Quedaron % políticas de aislamiento con el atajo del dueño', v_quedan;
  end if;

  if pg_get_functiondef('public.can_access_org(uuid)'::regprocedure) like '%is_platform_owner%' then
    raise exception 'can_access_org todavía se salta la empresa elegida';
  end if;
end;
$$;
