-- Deja consultar qué migraciones figuran como aplicadas.
--
-- El esquema `supabase_migrations` no está expuesto por la API, así que no
-- había forma de comprobar desde una prueba que el repositorio y la base
-- estuvieran alineados. Ese desalineamiento fue un problema real y silencioso:
-- migraciones que vivían en el repositorio sin registrar porque alguien corrió
-- el SQL a mano. Las funciones existían, nada se veía roto, y el historial
-- mentía.
--
-- Devuelve versión y nombre, ningún SQL, y sólo para la clave de servicio: no
-- la puede ejecutar ni anon ni un usuario autenticado.
--
-- Se devuelven los dos campos porque el historial y el repositorio no siempre
-- coinciden en ambos a la vez: hay migraciones aplicadas desde el panel de
-- Supabase que quedaron con una marca de tiempo distinta a la del archivo, y un
-- placeholder registrado con otro nombre. La prueba considera aplicada una
-- migración que coincida por cualquiera de los dos.

drop function if exists public.applied_migration_names();

create function public.applied_migration_names()
returns table(version text, name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.version, m.name
  from supabase_migrations.schema_migrations m
  order by m.version;
$function$;

revoke execute on function public.applied_migration_names() from public, anon, authenticated;
grant execute on function public.applied_migration_names() to service_role;

comment on function public.applied_migration_names() is
  'Version y nombre de las migraciones aplicadas. Existe para que una prueba verifique que el repositorio y la base no se separaron. Solo service_role.';
