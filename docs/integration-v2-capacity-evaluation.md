# Evaluación de capacidad del transporte v2

Snapshot previo del 25-08-2026 sobre el proyecto Supabase `atlas-crm`:

- base: 359.025.811 bytes;
- conexiones: 19 de 60, 2 activas;
- inbox/outbox: 0 pendientes, 0 procesando y 0 DLQ;
- tablas mayores: `leads` 117,1 MB, `staging_carga_tipificaciones` 43,1 MB,
  `lead_contacts` 32,9 MB y `calls` 32,8 MB;
- mayor churn visible: `supervisor_report_daily_agent_tipifications` 1.164
  tuplas muertas, `leads` 1.110 y `calls` 620;
- por tiempo acumulado, `refresh materialized view concurrently
  workflow_compliance_mv` domina `pg_stat_statements` (49.051 ejecuciones,
  media 402 ms); la segunda carga es Realtime/WAL y las RPC operativas quedan
  muy por debajo en tiempo medio.

Después de aplicar el esquema, la base quedó en 359.443.603 bytes, con 18 de 60
conexiones (2 activas) y ambas colas todavía en 0 pendientes/0 procesando/0 DLQ.
Las diez tablas mayores y el orden de `pg_stat_statements` no cambiaron; el
refresh de `workflow_compliance_mv` siguió primero con media 402 ms.

El advisor de seguridad pasó de 60 a 46 advertencias y mantuvo 0 errores: se
cerraron 10 `search_path` mutables legítimos y el EXECUTE público/autenticado de
2 funciones de trigger. Los avisos INFO de tablas de integración con RLS sin
políticas son intencionales: no tienen acceso de usuario y sus grants/RPC quedan
limitados a `service_role`.

## Decisión actual

No instalar PGMQ, particiones ni réplica. Con colas vacías y una base menor a
0,4 GB, agregarlas hoy aumenta operación sin remover un cuello de botella real.

Reevaluar PGMQ si durante 7 días la cola supera 100.000 pendientes, el claim
consume más de 15% del tiempo SQL total o la edad p95 incumple el SLA aun con
índices y lotes acotados. Evaluar partición mensual cuando inbox u outbox supere
10 millones de filas o 20 GB y el vacuum/retención afecte el claim. Evaluar una
réplica cuando consultas de reportería superen 30% del tiempo SQL del primario o
la presión sostenida de conexiones llegue a 75% del máximo.

Los umbrales se observan desde `/api/integrations/v2/health`; cualquier cambio
de infraestructura requiere una medición nueva y una prueba de carga separada.
