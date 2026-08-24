# Atlas Dialer Engine

Motor de discado de Atlas 2.0. Proceso Node.js/TypeScript **separado** del CRM
(Next.js en Vercel), pensado para sostener una conexión persistente a
Asterisk (AMI) y un loop de pacing — algo que un entorno serverless no puede
sostener. Ver `docs/dialer-engine-architecture.md` en la raíz del repo para
el razonamiento completo de por qué vive aparte y cómo se integra.

## Qué hace

1. Se conecta a Asterisk por AMI (conexión TCP persistente, reconexión automática).
2. Cada `TICK_MS` corre un ciclo de pacing por campaña activa: calcula cuántas
   llamadas nuevas puede originar según agentes disponibles y el ratio
   configurado, reclama leads vía `claim_next_dial_targets` (RPC transaccional
   con `for update skip locked`, sin doble marcado) y origina cada llamada.
3. Cada llamada saliente contestada se deja directo en una Queue de Asterisk
   (`Application: Queue`) — Asterisk decide a qué agente conectarla. El motor
   no reimplementa distribución de agentes.
4. Traduce eventos AMI (`OriginateResponse`, `DialBegin`, `DialEnd`,
   `AgentConnect`, `Hangup`, `QueueMemberStatus`) a `register_dial_event` /
   `update_agent_dialer_status`, que a su vez alimentan `call_events` — el
   mismo canal que ya usa `DialerListener` en el CRM para el screen-pop.
5. Opcionalmente inicia `MixMonitor` sólo en `AgentConnect` y lo detiene en
   `AgentComplete`/`Hangup`. Al cerrar el audio, Asterisk ejecuta un script
   mínimo que convierte WAV a Opus y lo entrega al endpoint privado del motor.

## Requisitos en Asterisk

- Usuario AMI dedicado en `manager.conf` (no reusar el admin), con permisos
  `system,call,agent,user`.
- Una Queue por campaña (o una compartida) con los agentes como miembros
  (`PJSIP/1001`, etc.).
- Troncal saliente (`DIAL_TRUNK` en `.env`) con contexto de dialplan que
  permita `Originate` hacia el número marcado.
- Para Siptel Chile, el AOR de salida debe usar únicamente `sbc01.siptel.cl` y
  el endpoint debe conservar el ANI `56965906926`; consulta
  [`docs/siptel-403-resuelto.md`](../docs/siptel-403-resuelto.md) antes de
  modificar el troncal.

## Setup local

```bash
cp .env.example .env   # completar SUPABASE_SERVICE_ROLE_KEY, AMI_*, AGENT_EXTENSION_MAP
npm install
npm run dev
```

`npm run typecheck` corre solo el chequeo de tipos sin levantar el proceso —
útil en CI antes de desplegar.

## Variables de entorno

Ver `.env.example`. Las críticas:

- `SUPABASE_SERVICE_ROLE_KEY`: nunca la anon key. Las RPCs del motor están
  revocadas para `authenticated`/`anon`.
- `AGENT_EXTENSION_MAP`: JSON `{"extension": "profile_id"}`. Con 20
  ejecutivos, cargar el mapa completo antes de arrancar. A futuro conviene
  mover esto a una columna `profiles.extension` en el CRM para no mantener
  dos fuentes de verdad.
- `DIALER_CAMPAIGN_IDS`: solo las campañas con discado outbound activo pasan
  por el loop de pacing.
- `AI_VOICE_CAMPAIGN_IDS`: lista separada de campañas atendidas exclusivamente
  por IA. No usan `campaign_agents`, extensiones ni Queue humana. Requieren
  `ELEVENLABS_API_KEY` en la EC2 y una fila activa en
  `ai_voice_campaign_configs` con el número/troncal SIP importado.
- `ELEVENLABS_API_KEY`: secreto exclusivo del motor. Nunca se guarda en
  Supabase, Vercel, el navegador ni los registros de la campaña.
- `DIAL_PREFIX`: prefijo que el carrier requiere delante del destino. Para
  Siptel Chile es `85848994`. El motor elimina separadores y el signo `+` del
  teléfono antes de armar el Request-URI, por lo que los leads deben estar en
  formato internacional (`+56...` o `56...`), no solamente nacional
  (`9...`). Déjalo vacío para carriers que no usan prefijo.

## Despliegue en AWS

Ver la sección "AWS" en `docs/dialer-engine-architecture.md`. Resumen: EC2
(o un contenedor con red persistente hacia el AMI, no Lambda/Fargate con
scale-to-zero) en la misma VPC/región que Asterisk, `Dockerfile` incluido,
health check en `/health` para el target group.

En la EC2 de producción el proceso debe ejecutarse exclusivamente mediante
`systemd`, usando `scripts/atlas-dialer-engine.service`. El binario Node 22 se
instala en `/opt/atlas-node`, el artefacto en `/opt/atlas-dialer-engine`, los
secretos permanecen en `/opt/atlas-dialer-engine/.env` y el SHA desplegado se
inyecta desde `/etc/atlas-dialer-engine/release.env`. Nunca levantar una copia
manual/PM2 en paralelo: dos motores pueden reclamar u originar llamadas a la
vez.

Verificaciones mínimas después de cada despliegue:

```bash
systemctl is-active atlas-dialer-engine
curl -fsS http://127.0.0.1:8080/health
journalctl -u atlas-dialer-engine --since "5 minutes ago" --no-pager
```

`/health` incluye release, versión de Node, conexión AMI y frescura de los
ciclos críticos. El mismo snapshot se publica cada 10 segundos en
`dialer_operational_health`; el CRM lo usa para informar una caída sin abrir
el puerto 8080 a Internet.

## Grabaciones (dos EC2, sin filesystem compartido ni secretos en Asterisk)

`dialer-engine` y `asterisk-atlas` están en instancias distintas. El motor vía
AMI ordena a Asterisk escribir `RECORDING_SPOOL_DIR/<dial_attempt_id>.wav` y
configura como comando post-MixMonitor el script incluido:

```text
dialer-engine/scripts/atlas-recording-upload
  → /usr/local/bin/atlas-recording-upload (root:root, 0755)
```

El script sólo necesita `ffmpeg`, `ffprobe` y `curl`; no recibe la service role.
Por llamada obtiene un token aleatorio de 256 bits que el motor guarda sólo
como SHA-256 y que expira. Genera Opus mono 8 kHz/24 kbps y hace POST al motor
por la red privada. El motor valida token/expiración, calcula por sí mismo el
SHA-256 y tamaño, sube a `YYYY/MM/DD/<dial_attempt_id>.opus` y deja la fila
`ready`. La subida nunca usa overwrite: si el objeto existe exige que hash y
tamaño coincidan. El script elimina el WAV sólo tras recibir HTTP 2xx.

Al recibir `AgentComplete`, el motor conserva `Reason` (`caller`, `agent` o
`transfer`) y `TalkTime`. Calidad muestra el lado técnico que finalizó el tramo
y compara ese tiempo con la duración real del archivo para detectar audios
truncados. `agent` describe el canal del lado ejecutivo; no prueba por sí solo
que la persona haya pulsado intencionalmente “Colgar”.

Para una caída prolongada del motor/Supabase, instala también
`scripts/atlas-recording-retry.{service,timer}` en `/etc/systemd/system/` y
habilita el timer. El script conserva un sidecar mode 0600 con el token efímero
de esa llamada hasta que sube correctamente; nunca persiste la service role.

El endpoint `/internal/recordings/:dial_attempt_id/ingest` debe quedar limitado
por Security Group a la EC2 de Asterisk. El bucket debe ser privado; si es
público, el motor falla al habilitar grabaciones. La service role permanece
exclusivamente en la EC2 del dialer y jamás se entrega a Asterisk o al navegador.
