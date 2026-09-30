-- Las cuatro vistas de una propuesta se generan en paralelo: cada una se
-- suma al JSON sin pisar a las otras. Corre con la sesión de quien llama, así
-- que la seguridad por fila de look_propuestas decide.
create or replace function public.guardar_vista_de_propuesta(p_propuesta uuid, p_vista text, p_path text)
returns jsonb
language sql
security invoker
set search_path to 'pg_catalog', 'public'
as $function$
  update public.look_propuestas
     set vistas = coalesce(vistas, '{}'::jsonb) || jsonb_build_object(p_vista, p_path)
   where id = p_propuesta
     and p_vista in ('frontal', 'tres_cuartos', 'perfil', 'nuca')
     and split_part(p_path, '/', 1) = organization_id::text
  returning vistas;
$function$;

revoke all on function public.guardar_vista_de_propuesta(uuid, text, text) from public, anon;
grant execute on function public.guardar_vista_de_propuesta(uuid, text, text) to authenticated;

-- Las propuestas de un análisis anterior se reemplazan al volver a analizar.
drop policy if exists look_propuestas_delete on public.look_propuestas;
create policy look_propuestas_delete on public.look_propuestas
  for delete to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());
