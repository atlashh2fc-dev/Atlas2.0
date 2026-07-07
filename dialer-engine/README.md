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

## Requisitos en Asterisk

- Usuario AMI dedicado en `manager.conf` (no reusar el admin), con permisos
  `system,call,agent,user`.
- Una Queue por campaña (o una compartida) con los agentes como miembros
  (`PJSIP/1001`, etc.).
- Troncal saliente (`DIAL_TRUNK` en `.env`) con contexto de dialplan que
  permita `Originate` hacia el número marcado.

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

## Despliegue en AWS

Ver la sección "AWS" en `docs/dialer-engine-architecture.md`. Resumen: EC2
(o un contenedor con red persistente hacia el AMI, no Lambda/Fargate con
scale-to-zero) en la misma VPC/región que Asterisk, `Dockerfile` incluido,
health check en `/health` para el target group.
