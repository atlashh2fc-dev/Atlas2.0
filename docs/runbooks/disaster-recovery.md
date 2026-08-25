# Runbook de recuperación y rollback de Atlas 2.0

Este procedimiento cubre base de datos, variables y despliegue sin confundir los componentes del ecosistema.

## Identidad inmutable del servicio

- Supabase: `lxdclavsycdidmzlbaid`
- Proyecto Vercel: `atlas2-0`
- Scope Vercel: `team_IJlj5eIFM7pBtOCDNOQN0eZs`
- Dominio oficial: `atlascrm.geimser.cl`

El motor de discado y `lead-orchestrator` son servicios persistentes separados. Un rollback del frontend no revierte automáticamente esos procesos.

## Preparación obligatoria

1. Abrir una ventana de cambio con responsable, motivo y criterio de aborto.
2. Ejecutar `scripts/atlas2-dr-preflight.sh` y guardar el resultado en el ticket.
3. Registrar SHA, deployment ID, última migración, versión de Postgres y hora UTC.
4. Registrar solamente nombres de variables; los valores deben quedar en un vault cifrado, nunca en Git ni en el ticket.
5. Identificar el punto de restauración anterior al incidente y comprobar que el backup existe.
6. Pausar productores que puedan escribir durante una restauración: cron de integración, dialer y orquestador. No borrar colas.

## Ensayo de base de datos

El ensayo siempre ocurre sobre un proyecto aislado. Nunca se restaura por primera vez sobre producción.

Para un respaldo portable, la documentación de Supabase recomienda separar roles, esquema y datos:

```bash
supabase db dump --db-url "$ATLAS2_SOURCE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$ATLAS2_SOURCE_DB_URL" -f schema.sql
supabase db dump --db-url "$ATLAS2_SOURCE_DB_URL" -f data.sql --use-copy --data-only
```

Los archivos contienen datos sensibles: usar un volumen cifrado, permisos `0600`, checksum SHA-256 y fecha de eliminación. El restore se ejecuta primero contra un destino aislado y luego se valida con:

```bash
psql "$ATLAS2_REHEARSAL_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f scripts/atlas2-verify-db-restore.sql
```

Comparar los conteos y la última migración contra la línea base. Además probar login, una lectura con RLS, una escritura controlada con rollback, un canary Integration v2 y una lectura del historial; no generar llamadas ni correos.

## Restauración de producción

1. Confirmar autorización explícita del responsable y que el destino sea `lxdclavsycdidmzlbaid`.
2. Mantener productores pausados y registrar el inicio del downtime.
3. Restaurar el backup/PITR desde Supabase Dashboard conforme al plan contratado.
4. Revalidar credenciales: Supabase corrigió en julio de 2026 un caso de credenciales obsoletas después de restore, pero igual se debe probar conexión y Auth.
5. Ejecutar `scripts/atlas2-verify-db-restore.sql` y comparar con la línea base.
6. Aplicar solo migraciones posteriores que hayan sido aprobadas para el punto recuperado.
7. Reanudar primero consumidores con concurrencia mínima; después productores. Observar p95, cola, DLQ y errores antes de habilitar discado.

Si la restauración falla o los invariantes no coinciden, no se encadenan arreglos improvisados: mantener productores pausados, preservar evidencia y volver al backup probado.

## Variables de entorno

Antes de una liberación, exportar las variables del entorno Production a un vault seguro y etiquetarlas con SHA/deployment. El rollback debe restaurar el conjunto completo, no variables individuales recordadas de memoria.

Después de restaurarlas:

1. Verificar que las variables públicas y server-only estén en el entorno correcto.
2. Re-desplegar para que el runtime capture el snapshot restaurado.
3. Probar login, estado y canary.
4. Rotar cualquier secreto que haya podido quedar expuesto durante el incidente.

## Rollback de despliegue

El rollback requiere el deployment ID previamente validado:

```bash
vercel rollback "$ATLAS2_PREVIOUS_DEPLOYMENT_ID" \
  --scope team_IJlj5eIFM7pBtOCDNOQN0eZs
```

Después, la fuente de verdad es el dominio oficial:

```bash
vercel inspect https://atlascrm.geimser.cl \
  --scope team_IJlj5eIFM7pBtOCDNOQN0eZs
```

No declarar éxito hasta que el dominio oficial muestre el deployment y SHA esperados. Si el rollback de aplicación depende de un esquema incompatible, restaurar primero la compatibilidad mediante una migración forward-safe o usar el punto de base previamente ensayado.

## Criterio de cierre

- Dominio oficial verificado contra deployment y SHA.
- Login y autorización por rol correctos.
- Invariantes y conteos de base comparados.
- Canary E2E aprobado sin efecto comercial.
- Cola y DLQ estables; circuit breaker cerrado.
- Productores reanudados de forma gradual.
- Cronología, comandos, resultados y responsables anexados al incidente.

Referencias: [Backups de Supabase](https://supabase.com/docs/guides/platform/backups), [restauración desde Dashboard](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore) y [Database Advisors](https://supabase.com/docs/guides/database/database-advisors).
