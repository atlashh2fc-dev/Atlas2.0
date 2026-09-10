-- Cierra una escalada de privilegios: cualquier usuario podía hacerse admin.
--
-- La política `profiles_update` es `using (id = auth.uid() or rol = admin)` y
-- **no tiene WITH CHECK**. En Postgres, cuando WITH CHECK es nulo se reutiliza
-- el USING para validar la fila resultante. La fila que queda tras el UPDATE
-- sigue teniendo el mismo `id`, así que sigue cumpliendo `id = auth.uid()`
-- pase lo que pase con las demás columnas.
--
-- Y el GRANT sobre `profiles` era de tabla completa, así que `authenticated`
-- podía escribir la columna `role`. No hay política RESTRICTIVE ni trigger que
-- lo impida: el único trigger de la tabla es `profiles_set_updated_at`.
--
-- Resultado: un `PATCH /rest/v1/profiles?id=eq.<mi-uuid>` con {"role":"admin"}
-- desde cualquier cuenta con sesión daba acceso de administrador, y con él los
-- 74.151 leads con nombre, RUT y teléfono.
--
-- Un REVOKE por columna NO sirve mientras exista el GRANT de tabla completa:
-- el permiso de tabla manda sobre el de columna. Hay que revocar el UPDATE de
-- la tabla y volver a conceder sólo las columnas que la aplicación escribe con
-- el cliente del usuario. Inventario completo de escrituras a `profiles`:
--
--   active                 -> src/app/actions/admin.ts:145 y :162, cliente del
--                             usuario, ya protegidas con requireProfile(["admin"])
--   intercall_break_until  -> src/app/actions/calls.ts:29 y :84, cliente del
--                             usuario, sobre su propia fila
--   full_name, email, role,
--   team_id, is_demo       -> src/app/actions/admin.ts:75 y :249, ambos con
--                             createAdminClient() (service_role), que ignora
--                             GRANTs y RLS y por lo tanto no se ve afectado
--
-- `updated_at` lo escribe el trigger, que no pasa por el control de columnas.
--
-- Para revertir, si algo se rompiera:
--   grant update on public.profiles to authenticated;

revoke update on public.profiles from authenticated, anon;

grant update (active, intercall_break_until) on public.profiles to authenticated;
