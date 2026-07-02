# Motor de discado (Asterisk): arquitectura y decisión

## Decisión

El motor de discado vive en un proyecto separado (`dialer-engine/`), como
proceso Node.js/TypeScript independiente del deploy de Next.js en Vercel. No
se integra código de telefonía dentro del CRM.

Razón central: un motor de discado conectado a Asterisk necesita sostener una
conexión AMI persistente y un loop de pacing continuo (decidir cuántas
llamadas originar según agentes libres). Vercel corre funciones serverless de
vida corta y sin estado entre invocaciones — no hay forma limpia de mantener
ese socket ni ese loop ahí. Forzarlo habría significado un antipatrón
arquitectónico, no una optimización.

Acoplar los dos further tendría además dos costos concretos: un bug de
telefonía (troncal caída, evento AMI mal parseado) podría afectar deploys del
CRM y viceversa; y los ciclos de cambio son distintos (el motor cambia por
temas de troncal/compliance de abandono, el CRM por producto). Esto es
consistente con lo ya decidido en
[external-integrations-architecture.md](./external-integrations-architecture.md):
integraciones externas hablan con Atlas vía RPCs `security definer`
autenticadas con `service_role`, nunca compartiendo código ni sesión web.

## Interfaz Asterisk: AMI + Queue, no ARI

Para escalar de una vez a ~20 ejecutivos en una campaña outbound, el motor
usa AMI (Manager Interface) para originar llamadas (`Originate`) y escuchar
eventos/CDR, y delega la distribución de agentes a la **Queue app nativa de
Asterisk** (cada llamada contestada se deja en la queue de la campaña, no se
bridgea manualmente).

Esto es deliberado: es el patrón probado en discadores outbound a esta escala
(similar a lo que usan Vicidial y la mayoría de PBX de call center), y evita
reimplementar en TypeScript lo que Asterisk ya resuelve bien (estrategias
`ringall`/`leastrecent`, pausa de agentes, wrap-up). ARI (REST + WebSocket,
apps Stasis) es superior para control fino por canal — grabación
condicional, whisper coaching, IVR complejo — pero eso no es requisito para
el MVP de 20 agentes. Queda como upgrade posterior si se necesita ese nivel
de control.

## Contrato entre motor y CRM

El motor nunca escribe directo en `leads`/`calls`/`campaigns`. Todo pasa por
tres RPCs `security definer` (migración
`supabase/migrations/20260702203624_dialer_engine_foundation.sql`),
revocadas para `anon`/`authenticated` y otorgadas solo a `service_role`:

- `claim_next_dial_targets(campaign_id, batch_size)`: selecciona leads
  elegibles con `for update skip locked` (sin doble marcado entre ciclos o
  instancias) y crea el `dial_attempt` en `queued`.
- `register_dial_event(dial_attempt_id, event_type, ...)`: registra cada
  transición del intento (originando, ring, contestada, bridged, colgada).
  Cuando el evento es `bridged`, crea la fila en `calls` reutilizando el
  mismo modelo que `getOrCreateOpenCall` (`src/app/actions/calls.ts`), e
  inserta en `call_events` con `event_type = 'dialer.<evento>'`.
- `update_agent_dialer_status(profile_id, campaign_id, extension, status)`:
  reporta presencia del agente en la queue (disponible/en llamada/wrap-up).

Tablas nuevas: `dialer_campaign_configs` (modo de discado y ratio por
campaña), `dialer_agent_sessions` (estado en vivo del agente), `dial_attempts`
(un registro por intento de marcado, previo a existir un `call`).

### Screen-pop: cero cambios en el CRM

Como `register_dial_event` inserta en `call_events` igual que el resto de
Atlas, `DialerListener` (`src/components/dialer-listener.tsx`) — ya escuchando
`call_events` por Realtime para el flujo de Vocalcom — redirige al agente a
la ficha del lead sin ningún cambio. El CRM no necesita saber que existe
Asterisk; solo lee la misma tabla de siempre.

## Pacing

`capacidad = ceil(agentes_disponibles × ratio) − intentos_en_vuelo`, evaluada
cada `TICK_MS` (`dialer-engine/src/dialer/pacing.ts`). Arrancar con
`dial_mode = progressive` y `max_dial_ratio` entre 1.0 y 1.2 (casi 1:1,
abandono bajo). Subir a `predictive` (ratio > 1.3) solo después de medir tasa
de contestación y abandono reales con los 20 ejecutivos — no antes.

## Pendiente / fuera de alcance de esta primera versión

- Mapear extensión → agente vive hoy en una variable de entorno
  (`AGENT_EXTENSION_MAP`) del motor. Si el volumen de agentes crece, conviene
  una columna `profiles.extension` en el CRM para no mantener dos fuentes de
  verdad.
- Detección de contestador (AMD) y validación de compliance de tasa de
  abandono: no implementadas todavía: agregar antes de subir el ratio a modo
  predictivo real.
- ARI para control fino por canal (grabación condicional, whisper): evaluar
  solo si aparece un caso de uso que Queue + AMI no cubra.

## Despliegue en AWS

- **Cómputo**: EC2 (o un contenedor con red persistente) en la misma
  VPC/región que Asterisk — no Lambda ni Fargate con scale-to-zero: el motor
  necesita el socket AMI siempre abierto, no arranca por request.
- **Red**: security group que solo permita tráfico AMI (puerto 5038) desde la
  instancia del motor hacia Asterisk, no expuesto a internet.
- **Secretos**: `SUPABASE_SERVICE_ROLE_KEY` y `AMI_SECRET` vía AWS Secrets
  Manager o SSM Parameter Store, nunca en la imagen ni en variables de entorno
  planas del repo.
- **Proceso**: `Dockerfile` incluido en `dialer-engine/`; en la instancia,
  correrlo con systemd o un orquestador simple (ECS con EC2 launch type si ya
  hay cluster, o directamente Docker + systemd si es una sola instancia).
- **Observabilidad**: logs JSON (`pino`) a CloudWatch Logs; `/health` como
  target de health check si se pone detrás de un target group.
- **Escalamiento a 20 agentes**: una sola instancia moderada (2 vCPU / 2GB)
  alcanza sobrado para el volumen de eventos AMI de 20 ejecutivos. Escalar
  horizontalmente el motor mismo no es necesario a este tamaño — el cuello de
  botella real, si aparece, va a estar en la troncal SIP, no en el proceso
  Node.
