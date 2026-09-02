# Atlas 2.0

CRM para operaciones de contact center: permite cargar una base, distribuir leads, contactar por voz y WhatsApp, registrar gestiones, agendar, supervisar y evaluar la calidad desde una misma plataforma.

**Producción:** [atlascrm.geimser.cl](https://atlascrm.geimser.cl) · **Proyecto Vercel:** `atlas2-0` · **Documentación actualizada:** 30 de agosto de 2026.

> Este README describe el código del árbol de trabajo local, incluidos los cambios de espacios de trabajo y permisos en curso. No certifica que esos cambios estén publicados ni que cada integración esté activa. La operación depende de las migraciones, credenciales, servicios externos y configuración de cada campaña.

## Capacidades

| Área | Funcionalidad |
| --- | --- |
| Registros y leads | Búsqueda por nombre, RUT y teléfono; ficha de contacto, historial, alta manual e importación CSV/XLSX. |
| Campañas y asignación | Campañas, equipos, ejecutivos, distribución de leads, priorización y canales habilitados por campaña. |
| Telefonía y CTI | Softphone SIP/WebRTC, llamadas entrantes y salientes, discado manual y automático, operación híbrida, estados del agente y pausas AUX. |
| Gestión y agenda | Tipificaciones, notas, guiones y flujos configurables; seguimientos y citas durante la atención. |
| WhatsApp | Webhooks Meta/YCloud, conversaciones vinculadas a leads y campañas, mensajes y adjuntos, estados de entrega, asignación y consulta de historial. |
| Asistencia IA | Respuestas de WhatsApp con contexto y conocimiento de productos, derivación a atención humana, campañas de voz IA mediante ElevenLabs y Loop IA post-llamada en modo de observación. |
| Supervisión | Visibilidad de colas de voz y WhatsApp, capacidad, excepciones, equipos y actividad dentro del alcance autorizado. |
| Calidad | Grabaciones privadas, reproducción, transcripción con Groq, evaluación con Mercury 2 de Inception Labs y revisión supervisada del Loop IA. |
| Reportes e integridad | Indicadores de gestión y discador, análisis por campaña/equipo y señales de integridad de tipificaciones. |
| Correo e integraciones | Sincronización IMAP, resultados de mailing y Vocalcom, e intercambio de eventos con Atlas Lead y Bigdata. |

Next.js configura un límite de **20 MB por solicitud de Server Actions** para las cargas masivas. El proveedor de hosting o un proxy puede imponer un límite adicional.

### Espacios de trabajo y roles

La navegación actual distingue responsabilidades; el rol administrador no equivale a un agente con acceso ampliado a la atención.

| Rol | Espacio | Responsabilidad |
| --- | --- | --- |
| `admin` | Control y Administración | Visibilidad global, campañas, datos, reportes y configuración de la plataforma; sin atención de chats como ejecutivo. |
| `supervisor` | Supervisión | Operación y carga de sus equipos, asignación, consulta autorizada de historial, calidad y resultados. |
| `agente` | Atención | Jornada, interacciones asignadas, llamadas, registros propios y agenda. |

La fuente de navegación es [`src/lib/nav.config.ts`](./src/lib/nav.config.ts). Ocultar un acceso no reemplaza la autorización en páginas, acciones, endpoints y base de datos. Consulta la [arquitectura de espacios de trabajo](./docs/arquitectura-navegacion.md) para los límites y criterios de verificación.

## Arquitectura

| Componente | Tecnología y responsabilidad |
| --- | --- |
| CRM web | Next.js **16.2.9**, React **19.2.4**, TypeScript y Tailwind CSS 4. Interfaz, Server Actions y rutas API; despliegue en Vercel. |
| Datos y autenticación | Supabase: PostgreSQL, Auth, RLS, RPCs, Realtime y Storage para archivos privados. |
| Motor de discado | Servicio Node.js/TypeScript independiente con conexión AMI persistente a Asterisk, pacing, eventos, grabaciones e integración de voz IA. |
| Orquestador de leads | Servicio independiente que selecciona, reserva y asigna leads a ejecutivos disponibles. No se conecta a Asterisk ni origina llamadas. |
| Telefonía | SIP.js en el navegador y Asterisk para SIP/WebRTC, colas y conexión con la troncal. |
| Integraciones | Rutas API para WhatsApp, correo y eventos v2; procesamiento periódico definido en `vercel.json`. |
| IA post-llamada | Worker independiente del flujo humano que analiza transcripciones elegibles, genera decisiones trazables y registra revisión y feedback sin cambiar automáticamente la operación. |

Los tres paquetes Node tienen instalación, compilación y despliegue separados. Iniciar el CRM **no inicia** el motor ni el orquestador.

### Estructura del repositorio

```text
src/app/                 Páginas, Server Actions y rutas API
src/components/          Interfaz, CTI, atención y componentes compartidos
src/lib/                 Dominio, permisos, clientes e integraciones
supabase/migrations/     Esquema, funciones SQL y políticas de acceso
dialer-engine/           Motor de telefonía y voz IA
lead-orchestrator/       Servicio de priorización y asignación
contracts/               Contrato de eventos de integración v2
tests/                   Pruebas del CRM y contratos
scripts/                 Herramientas de operación y verificación
docs/                    Arquitectura, seguridad y runbooks
```

## Desarrollo local

### Requisitos

- **Node.js 22 o superior** y npm; la raíz y el motor requieren Node 22. Consulta [`.nvmrc`](./.nvmrc).
- Un proyecto Supabase de desarrollo con las migraciones correspondientes y un usuario/perfil autorizado.
- Para probar telefonía, acceso al motor y a Asterisk, extensión SIP y permiso de micrófono en el navegador.
- Para probar integraciones, credenciales y configuración del proveedor correspondiente.

Desde la raíz:

```bash
cp .env.example .env.local
# Completar las variables para el entorno de desarrollo.
npm ci
npm run dev
```

Abre [localhost:3000](http://localhost:3000). No uses credenciales de producción para pruebas que puedan modificar datos, enviar mensajes u originar llamadas.

Para los servicios persistentes, sigue sus instrucciones separadas: [motor de discado](./dialer-engine/README.md) y [orquestador de leads](./lead-orchestrator/README.md).

### Variables de entorno del CRM

[`.env.example`](./.env.example) es la base, pero no incluye todas las variables opcionales consumidas por el código actual. Añade a `.env.local` únicamente las necesarias para los módulos que vas a usar.

| Variables | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Conexión pública del cliente y autenticación. |
| `SUPABASE_SERVICE_ROLE_KEY` | Operaciones privilegiadas del servidor; nunca exponer al navegador. |
| `NEXT_PUBLIC_SIP_DOMAIN`, `NEXT_PUBLIC_SIP_WSS_SERVER` | Dominio SIP y endpoint WSS del softphone. |
| `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_SUPPORT_EMAIL` | Etiqueta de entorno y contacto de soporte en el acceso; opcionales. |
| `CRON_SECRET` | Autorización de las tareas programadas, incluida la sincronización de correo y el cierre de WhatsApp. |
| `AI_LOOP_ENABLED`, `AI_LOOP_WORKER_SECRET` | Activación explícita y autorización alternativa del worker del Loop IA post-llamada. Por defecto el circuito permanece apagado. |
| `INTEGRATION_HMAC_SECRETS_JSON`, `INTEGRATION_WORKER_SECRET`, `INTEGRATION_OUTBOX_DESTINATIONS_JSON` | Firmas por fuente, autorización del worker y destinos de salida de integraciones v2. |
| `WHATSAPP_PROVIDER` | Selección de proveedor: `meta` por defecto o `ycloud`. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_META_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Credenciales y validación de webhooks para Meta. |
| `WHATSAPP_GRAPH_API_VERSION` | Versión de Graph API utilizada por el cliente Meta; opcional. |
| `WHATSAPP_YCLOUD_API_KEY`, `WHATSAPP_YCLOUD_WEBHOOK_SECRET` | Credenciales y validación de webhooks para YCloud. |
| `INCEPTION_API_KEY` | Respuestas IA de WhatsApp, evaluación de calidad y extracción estructurada del Loop IA con Mercury 2. |
| `GROQ_API_KEY` | Transcripción de grabaciones. |
| `INBOUND_MAIL_HOST`, `INBOUND_MAIL_PORT` | Servidor y puerto IMAP; opcionales, con valores predeterminados en el código. |

Las credenciales de ElevenLabs (`ELEVENLABS_API_KEY`), AMI y las variables del motor se configuran en el **servicio de discado**, no en el cliente ni en el entorno del CRM. Consulta [`dialer-engine/.env.example`](./dialer-engine/.env.example). El orquestador tiene su propio [archivo de ejemplo](./lead-orchestrator/.env.example).

No publiques archivos `.env`, tokens, contraseñas ni claves privadas. Todo valor `NEXT_PUBLIC_*` puede llegar al navegador; no lo uses para secretos.

## Integraciones y tareas programadas

### WhatsApp

El canal y su campaña de destino se configuran en `/dashboard/admin/integraciones/whatsapp`. Las rutas disponibles son:

- Meta: `/api/integrations/meta/whatsapp/webhook`.
- YCloud: `/api/integrations/ycloud/whatsapp/webhook`.
- Cierre por inactividad: `/api/integrations/meta/whatsapp/timeouts`, protegido por `CRON_SECRET`.

El cierre por inactividad usa una configuración por campaña, con **30 minutos por defecto**, y procesamiento periódico. Por ello, no debe interpretarse como un cierre exacto al minuto 30. El código contempla tipificación de cierre, contexto, derivación humana y agendamiento; los ciclos adicionales de reconexión o recuperación deben verificarse por separado.

Tener rutas, credenciales o un canal marcado como activo no acredita una integración completa. La aceptación requiere comprobar un mensaje entrante real, su campaña y asignación, respuesta saliente y estado de entrega. La disponibilidad del número y la coexistencia con la aplicación móvil dependen del proveedor.

### Eventos v2

La integración incluye recepción de lotes, validación de contrato, firmas HMAC, worker, outbox, feedback y verificaciones de salud. El contrato está en [`contracts/integration-event-v2.schema.json`](./contracts/integration-event-v2.schema.json); los ejemplos de configuración, en [`docs/integration-v2.env.example`](./docs/integration-v2.env.example).

### Loop IA post-llamada

El primer circuito vertical conecta una llamada finalizada y su transcripción existente con extracción de hechos respaldados por citas, una decisión `callback-v1`, revisión del supervisor y feedback auditable. Reutiliza los registros actuales de leads, llamadas, grabaciones y transcripciones; no crea un maestro de clientes paralelo ni consume conversaciones de WhatsApp.

La activación es por campaña y comienza en modo `shadow`: observa y registra, pero no cambia prioridades, no crea citas, no contacta clientes, no modifica prompts o políticas y no entrena modelos automáticamente. El worker no inicia nuevas transcripciones; solo procesa fuentes elegibles y vuelve a validar permisos, campaña, alcance y vigencia al completar el ciclo. Consulta la [documentación del Loop IA](./docs/ai-learning-loop.md) para el recorrido, los límites y la verificación operativa.

### Programación declarada en Vercel

| Ruta | Frecuencia configurada |
| --- | --- |
| `/api/ai/learning-loop/worker` | Cada 2 minutos. |
| `/api/mail/inbound/sync` | Cada 10 minutos. |
| `/api/integrations/v2/worker` | Cada 2 minutos. |
| `/api/integrations/v2/feedback/generate` | Diaria, expresión cron `7 3 * * *`. |
| `/api/integrations/v2/outbox/dispatch` | Cada 5 minutos. |
| `/api/integrations/v2/canary` | Cada hora, en el minuto 17. |
| `/api/integrations/meta/whatsapp/timeouts` | Cada 10 minutos. |

La fuente es [`vercel.json`](./vercel.json). `npm run dev` no ejecuta automáticamente estas tareas; su presencia en el archivo no demuestra que estén ejecutándose en producción.

## Pruebas y validación

| Comando desde la raíz | Uso |
| --- | --- |
| `npm run dev` | Desarrollo del CRM. |
| `npm run build` | Compilación de producción del CRM. |
| `npm run start` | Inicio del CRM previamente compilado. |
| `npm run lint` | ESLint. |
| `npm test` | Pruebas TypeScript de `tests/*.test.ts` mediante el runner de Node. |
| `npx tsc --noEmit` | Comprobación de tipos del CRM. |
| `npm --prefix dialer-engine test` | Compila y ejecuta las pruebas del motor. |
| `npm --prefix dialer-engine run typecheck` | Comprobación de tipos del motor. |
| `npm --prefix lead-orchestrator test` | Compila y ejecuta las pruebas del orquestador. |
| `npm --prefix lead-orchestrator run typecheck` | Comprobación de tipos del orquestador. |

Instala las dependencias de cada servicio antes de ejecutar sus comandos. La [CI de contratos](./.github/workflows/integration-contract-v2.yml) ejecuta pruebas específicas de integración v2; no sustituye la suite completa ni las pruebas de interfaz.

Para cambios funcionales, complementa los checks con pruebas autenticadas del rol y campaña afectados. Un build correcto o un estado de salud no demuestra que una llamada, conversación, grabación o asignación funcione de extremo a extremo.

## Base de datos y migraciones

Las migraciones viven en [`supabase/migrations/`](./supabase/migrations/). Antes de aplicarlas, confirma el proyecto de destino, revisa el SQL y el respaldo disponible. No edites migraciones ya aplicadas: agrega una nueva para cada cambio.

Valida RLS, permisos de ejecución, funciones y triggers con el rol real afectado. Una consulta con `service_role` no demuestra que el usuario pueda realizar la misma operación. No ejecutes migraciones ni restauraciones de producción como parte del arranque local.

## Despliegue y operación

### CRM: dominio exclusivo

El único dominio oficial de producción es **`atlascrm.geimser.cl`**, asociado al proyecto Vercel **`atlas2-0`**. Las reglas completas están en [`AGENTS.md`](./AGENTS.md).

**`atlas.geimser.cl` pertenece a otro SaaS: no modificarlo, asignarlo, eliminarlo, promoverlo ni inspeccionarlo como parte de este proyecto.**

Después de cada push o despliegue a producción:

1. Confirma que el deployment pertenece a `atlas2-0` y corresponde al commit que se quiere publicar.
2. Inspecciona el dominio oficial:

   ```bash
   vercel inspect https://atlascrm.geimser.cl --scope team_IJlj5eIFM7pBtOCDNOQN0eZs
   ```

3. Comprueba que apunta al deployment y commit recién publicados. Si sigue apuntando a una versión anterior, corrige el alias únicamente hacia ese dominio, tras confirmar el destino.
4. Verifica la funcionalidad afectada con una sesión autenticada en el dominio oficial antes de dar el despliegue por completo.

### Servicios persistentes

- **Motor de discado:** se despliega por separado con conectividad privada a Asterisk. En la EC2 documentada se administra mediante `systemd`; no levantar una segunda copia manual o con PM2, pues puede duplicar la operación de llamadas.
- **Orquestador:** proceso independiente, habilitado por campaña mediante `lead_orchestrator_configs.is_active`.
- **Salud:** el motor y el orquestador exponen `/health`. El CRM consulta el heartbeat del motor en Supabase y publica estado de autenticación y telefonía en `/api/status`; esto no sustituye una prueba operativa.
- **Grabaciones:** mantener el bucket privado y el ingreso de audio limitado a la red autorizada. No entregar la clave de servicio a Asterisk ni al navegador.

## Documentación relacionada

- [Arquitectura de espacios de trabajo](./docs/arquitectura-navegacion.md)
- [Estrategia de Atlas 2.0](./docs/atlas-2-strategy.md)
- [Arquitectura IA de cinco frentes](./docs/atlas-ai-cinco-frentes-arquitectura-2026-08-27.md)
- [Loop IA post-llamada](./docs/ai-learning-loop.md)
- [Arquitectura de integraciones externas](./docs/external-integrations-architecture.md)
- [Evaluación de capacidad de integraciones v2](./docs/integration-v2-capacity-evaluation.md)
- [Arquitectura del motor de discado](./docs/dialer-engine-architecture.md)
- [README del motor de discado](./dialer-engine/README.md)
- [README del orquestador de leads](./lead-orchestrator/README.md)
- [Pantalla de acceso y estado de servicios](./docs/pantalla-de-acceso.md)
- [Protección de tipificaciones automatizadas](./docs/proteccion-tipificaciones-automatizadas.md)
- [Funciones privilegiadas permitidas](./docs/security/security-definer-allowlist.md)
- [Recuperación ante desastres](./docs/runbooks/disaster-recovery.md)
- [Validación de consolidación de autenticación](./docs/runbooks/auth-consolidation-gate.md)
