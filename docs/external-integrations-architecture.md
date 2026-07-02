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
- Worker/cron de polling hacia plataformas externas.
- Cola paralela tipo Registro Intel.

El siguiente paso razonable es conectar Atlas Lead contra `sync_atlas_lead_mail_campaign` cuando se crea una campaña y contra `apply_atlas_lead_mail_result_batch` cuando llegan resultados de mailing.
