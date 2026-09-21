-- La sesión en un viaje.
--
-- Cada pantalla del panel preguntaba tres veces a la base antes de leer un
-- solo dato: si la sesión seguía válida, quién es el perfil y en qué empresa
-- está. Eran tres viajes en fila, y el proxy repetía los dos primeros por cada
-- petición, incluidas las precargas de los enlaces del menú. Esta función
-- contesta las tres preguntas de una vez: el perfil (solo si la sesión sigue
-- viva y la persona activa) y el contexto de su empresa.
--
-- Devuelve null cuando la sesión fue cerrada a distancia o el perfil está
-- inactivo; el servidor entonces manda a la pantalla de acceso. La validez de
-- la sesión sigue siendo la misma regla de siempre, `is_current_app_session_valid`,
-- que también aplican las políticas por fila.

create or replace function public.sesion_actual()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when public.is_current_app_session_valid() then jsonb_build_object(
      'perfil', (
        select to_jsonb(profile)
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.active
      ),
      'contexto', public.contexto_de_mi_empresa()
    )
    else null
  end;
$$;

revoke execute on function public.sesion_actual() from public;
revoke execute on function public.sesion_actual() from anon;
grant execute on function public.sesion_actual() to authenticated;
grant execute on function public.sesion_actual() to service_role;
