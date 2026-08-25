# Gate para consolidar Auth

La consolidación queda bloqueada hasta disponer de acceso propietario o acceso directo autorizado al Postgres de origen. La Admin API no permite trasladar de forma fiel hashes e identidades existentes y no se usarán resets masivos como sustituto.

## Condiciones de entrada

- Acceso de solo lectura al origen para `auth.users`, `auth.identities` y configuración de providers.
- Acceso propietario al destino y backup verificable anterior al cambio.
- Inventario de usuarios, identidades, emails/teléfonos duplicados, providers, MFA y conflictos de UUID.
- Compatibilidad de versiones del esquema Auth confirmada en un entorno aislado.
- Mapa de IDs de usuario hacia `public.profiles` y todas las llaves foráneas dependientes.
- Ventana de mantenimiento, plan de comunicaciones y rollback aprobados.

## Reglas no negociables

- No imprimir, exportar a Git ni adjuntar hashes, tokens, secretos o datos de MFA.
- No crear usuarios con contraseñas temporales ni enviar resets sin autorización comercial explícita.
- No copiar sesiones ni refresh tokens; asumir reautenticación después del cutover.
- No usar `raw_user_meta_data` para autorización. Los roles permanecen en datos controlados por servidor/RLS.
- No escribir en producción antes de restaurar y validar una copia aislada.

## Ensayo requerido

1. Tomar snapshot cifrado del origen y registrar checksums sin exponer contenido.
2. Restaurar usuarios e identidades en un destino aislado compatible.
3. Verificar igualdad de conteos, UUIDs, providers e integridad con `public.profiles`.
4. Probar login con las cuentas acordadas y sus contraseñas existentes, sin reset.
5. Probar recuperación de contraseña, OAuth si aplica, bloqueo, logout y expiración de sesión.
6. Probar RLS por cada rol con casos positivos y negativos.
7. Documentar el tiempo real, errores, rollback y pérdida máxima de datos.

## Go / no-go

Se avanza solo si todas las pruebas pasan, el rollback fue ensayado y el responsable propietario firma el cutover. Cualquier hash inaccesible, identidad huérfana, UUID en conflicto o divergencia de provider es `NO-GO`; el modo Auth actual se mantiene sin afectar la integración de datos.

La restauración completa de base puede preservar `auth.users`, pero los secretos JWT del proyecto son distintos y las sesiones emitidas previamente no deben asumirse válidas. Referencia: [migración y restore de Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
