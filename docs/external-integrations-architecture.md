# Arquitectura de integraciones externas

## Decision

Atlas no replica el modelo pesado de Registro Intel (`contacts` + `campaign_base_leads` + colas paralelas). Mantiene `leads` como entidad CRM unica y agrega una capa modular para:

- ingresar leads desde proyectos BigData;
- conservar referencias externas y eventos auditables;
- cargar resultados de plataforma mail;
- convertir senales mail en prioridad operacional del lead.

## Piezas creadas

- `integration_sources`: catalogo de fuentes externas (`bigdata`, `mail_platform`, etc.).
- `external_import_batches`: auditoria de lotes recibidos desde fuentes externas.
- `lead_external_refs`: enlace estable entre `leads` y claves externas.
- `external_lead_events`: eventos atomicos asociados a un lead o a una fila no matcheada.
- `mail_campaign_bases`: bases/audiencias de mailing por campana.
- `mail_campaigns`: campañas mail sincronizadas desde Atlas Lead, asociadas a una campaña CRM.
- `mail_result_batches` y `mail_result_contacts`: cargas de resultados mail.
- `lead_mail_status`: snapshot compacto de senales mail por lead/campana.

## RPCs operativas

### `upsert_external_leads`

Ingiere filas BigData a `leads` usando match por:

1. referencia externa existente;
2. RUT normalizado;
3. telefono normalizado;
4. email normalizado.

Si no encuentra lead, crea uno en la campana y hereda el workflow de la campana.

### `apply_mail_result_batch`

Procesa resultados de mailing por email, matchea contra `leads` de la campana y actualiza:

- `lead_mail_status`;
- `leads.mail_priority_*`;
- `leads.external_priority_*`.

### `sync_atlas_lead_mail_campaign`

Sincroniza una campaña creada en Atlas Lead. Si la campaña viene bajo `umbrella_key = equifax`, crea o actualiza:

- una campaña CRM (`campaigns`);
- su campaña mail asociada (`mail_campaigns`);
- la referencia externa por `external_campaign_key`.

Si el paraguas no es Equifax, la RPC responde `synced = false` y no crea campaña CRM.

### `apply_atlas_lead_mail_result_batch`

Procesa resultados de mail desde Atlas Lead, asegura primero la campaña mail Equifax y luego registra las señales. Esta RPC soporta `service_role`, para que Atlas Lead pueda integrarse sin depender de una sesión web.

Ranking inicial:

- click: `10`;
- apertura: `20`;
- entregado: `40`;
- enviado: `55`;
- sin senal: `70`;
- rebote/desuscripcion/queja: `99`.

## Permisos

Las escrituras de ingestiones pasan por RPCs `security definer` con validacion explicita de usuario autenticado, rol `admin`/`supervisor` y acceso a campana. Las tablas nuevas tienen RLS y grants explicitos para evitar depender de la exposicion automatica del Data API.

## UI operativa

`/dashboard/mail` muestra a supervisores y admins:

- reportería por campaña mail Equifax;
- leads con apertura o click;
- asignación manual a ejecutivos mediante `assign_lead`.

La pantalla no muestra leads solo enviados/entregados: el contenedor operativo filtra únicamente aperturas y clicks.

## Fuera de alcance por ahora

- UI de configuracion de conectores.
- Envio real de correos desde Atlas.
- Polling hacia plataformas externas (v2 recibe push firmado).
- Programación del worker y entrega del outbox; esta fase deja ambos contratos listos, pero no activa un cron.

## Transporte asíncrono v2

La v2 agrega un inbox/outbox durable propio sobre Postgres. No usa `pgmq` en esta
fase: evita depender de una extensión para el camino crítico y permite mantener
idempotencia, leases, ACK/NACK y DLQ bajo el mismo contrato de Atlas. `pg_cron`
puede invocar el worker más adelante, pero no es parte del deploy de esta fase.

### Ingreso rápido

`POST /api/integrations/v2/batches` acepta como máximo 1 MiB y 500 items. Solo
persiste el sobre y responde `202`; no actualiza leads en la solicitud. La
respuesta no espera al worker: agenda un doorbell con `after()` y el cron cada 2
minutos queda como respaldo.

Headers obligatorios:

- `x-atlas-source`: código activo en `integration_sources` (`bigdata` o `atlas_lead`).
- `idempotency-key`: identidad estable del lote en la fuente.
- `x-atlas-timestamp`: epoch Unix en segundos, con tolerancia de 5 minutos.
- `x-atlas-signature`: HMAC-SHA256 hexadecimal de `<timestamp>.<bytes-del-body>`.

El secreto se obtiene desde `INTEGRATION_HMAC_SECRETS_JSON`. Un reintento con la
misma fuente, key y hash devuelve el mismo `batch_id`; la misma key con contenido
distinto responde conflicto. Cada `event_id` también es único por fuente.
La respuesta `202` confirma `acknowledged: true` y devuelve
`accepted_event_ids`, también cuando el lote es un replay idéntico.

```json
{
  "campaign_key": "equifax-2026-08",
  "schema_version": "2",
  "items": [
    {
      "event_id": "decision-123",
      "event_type": "intelligence.decision.v1",
      "event_source": "urn:geimser:bigdata",
      "subject": "urn:geimser:lead:bigdata-contact-123",
      "external_key": "bigdata-contact-123",
      "occurred_at": "2026-08-25T19:00:00Z",
      "data_schema": "urn:geimser:schema:intelligence.decision.v1",
      "tenant_id": "geimser",
      "entity_version": 7,
      "correlation_id": "journey-123",
      "causation_id": null,
      "payload": { "priority_rank": 10, "priority_reason": "Alta propensión" }
    }
  ]
}
```

`schema_version: "2"` usa identidad `(event_source, event_id)` y orden por
`(tenant_id, subject, entity_version)`. Una versión igual o anterior se confirma
como procesada con resultado `ignored: true`; nunca vuelve a escribir la vista
360. `schema_version: "1"` sigue aceptado: Atlas deriva origen, sujeto, tenant,
correlación y una versión monotónica desde `occurred_at`.

`integration.canary.v1` es la única excepción que no requiere campaña. Se
registra en inbox y `integration_canary_runs`, mide latencia, responde `202` y no
crea leads, interacciones, correos ni llamadas. Un lote canary no puede mezclar
eventos de negocio.

El productor usa `campaign_key`, nunca necesita el UUID interno de Atlas. Para
Atlas Lead se resuelve con `mail_campaigns(source_id, external_campaign_key)`;
para Bigdata se usa `integration_campaign_mappings`. Esa tabla queda cerrada a
`service_role`. `campaign_id` sigue disponible solo para canary/admin y, si se
envían ambas claves, deben resolver a la misma campaña.

La migración asegura el source activo `bigdata`, pero no inventa mappings. Antes
del canary, un operador con `service_role` debe ejecutar
`upsert_integration_campaign_mapping_v2(source_code, campaign_key, campaign_id,
metadata)`. El feedback no produce filas mientras no exista al menos un mapping
exacto. Una decisión Bigdata sin referencia intenta match único por RUT
normalizado dentro de esa campaña y crea solo la referencia; si no hay match o
es ambiguo, reintenta/DLQ y nunca crea un lead desde un score.

Para `engagement.event.v1`, el payload requiere `external_campaign_key` y puede
incluir `email`, `sent`, `delivered`, `opened`, `clicked`, `bounced`,
`complained` y `unsubscribed`. La campaña mail debe existir previamente mediante
`sync_atlas_lead_mail_campaign`.

Atlas Lead también puede enviar su sobre vigente con `external_campaign_key`,
`report_date` (u `occurred_at`) y `rows`. El receiver convierte en memoria los
aliases `mail/correo`, `enviado`, `entregado`, `rebote`, `abierto/open`, `click`,
`queja` y `desuscrito` al contrato canónico. Si una fila no trae `event_id`, se
deriva de `idempotency-key` más su posición, por lo que los reintentos son
estables. No se persiste una copia adicional del payload legacy.

### Worker y backpressure

`POST /api/integrations/v2/worker` exige `Authorization: Bearer
<INTEGRATION_WORKER_SECRET>`. Hace claim de hasta 500 items con lease y
`FOR UPDATE SKIP LOCKED`; el valor operativo recomendado es 100. Agrupa por tipo
y ejecuta una RPC set-based por grupo:

- decisiones Bigdata actualizan `lead_external_refs`, `leads.external_priority_*`
  y el evento de auditoría;
- engagement Atlas Lead actualiza `lead_mail_status`,
  `mail_campaign_lead_status`, `leads.mail_priority_*` y auditoría.

Los errores de dependencia vuelven a `pending` con backoff. Los payloads no
recuperables o el octavo intento llegan a `integration_dead_letters`. Leases
vencidos pueden ser reclamados por otro worker. Las tablas no tienen políticas
RLS para usuarios y sus grants/RPCs quedan limitados a `service_role`.
Las rutas operativas aceptan también `CRON_SECRET`, siempre mediante comparación
timing-safe. Exponen GET para Vercel Cron y POST para ejecución manual.

### Outbox y operación

`integration_outbox_events` y sus RPCs `enqueue/claim/ack/nack` entregan el mismo
contrato durable para feedback Atlas → Bigdata/Atlas Lead.

`POST /api/integrations/v2/feedback/generate` genera incrementalmente hasta 500
`operation.feedback.v1` desde llamadas cerradas y tipificadas. Usa keyset
`(calls.ended_at, calls.id)`, exige referencia externa y mapping de campaña, y
avanza un checkpoint monotónico en la misma transacción que escribe el outbox.
No hay trigger sobre `calls` ni HTTP desde Postgres. El payload entrega solo
`campaign_key`, `external_key`, tiempos y tipificación; no acopla al consumidor
con UUID internos de Atlas.

`POST /api/integrations/v2/outbox/dispatch` reclama hasta 250 eventos (recomendado
100), agrupa por destino y envía requests de máximo 250 items/1 MiB con
HMAC-SHA256. Solo hace ACK con HTTP `202`, `acknowledged: true` y cada
`accepted_event_id` exacto; una confirmación parcial reintenta lo no confirmado.
Redirects, HTML y ACK incompletos nunca se confirman. El retry usa backoff
exponencial con jitter y abre circuito tras cinco fallos consecutivos. Los destinos se
configuran en `INTEGRATION_OUTBOX_DESTINATIONS_JSON`; si falta la variable, la
ruta responde `503` sin reclamar filas. Ambos endpoints requieren el bearer del
worker y pueden ser invocados manualmente o por cron, pero esta fase no activa
ninguna programación.

Antes de producción se deben crear fuentes activas, mappings Bigdata, secretos
por fuente, alertas por edad del item pendiente, leases vencidos y DLQ, y una
ejecución controlada de generación/dispatch.

`GET /api/integrations/v2/health` entrega edad de colas, p95 de punta a punta,
DLQ, referencias 360 antiguas, circuitos, canary y versión desplegada. El canary
local corre cada hora; el canary E2E se origina desde Atlas Lead.

`vercel.json` agenda el worker cada 2 minutos, el dispatcher cada 5 minutos y la
generación de feedback a las 03:07 UTC. Los defaults de ejecución siguen siendo
100 items para worker/dispatcher; el tope del request de salida es 250/1 MiB.
