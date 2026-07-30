# Atlas 2.0

CRM para la operación de call center: centraliza la gestión de leads, llamadas, campañas, agentes y supervisión. Se conecta a Supabase para autenticación, datos y tiempo real; el discado automático se ejecuta en un proceso independiente.

## Módulos

- Dashboard operativo, agenda y gestión de llamadas.
- Leads: búsqueda, ficha 360°, alta manual y carga masiva CSV/XLSX.
- Campañas, asignación de leads y flujos de trabajo.
- Administración de usuarios, ejecutivos y credenciales SIP.
- Supervisión en vivo, reportes y métricas por campaña/equipo.
- Importación y seguimiento de resultados de mail y Vocalcom.

Las cargas masivas de leads aceptan solicitudes de hasta **20 MB**.

## Arquitectura

El CRM es una aplicación de **Next.js 16** con **React 19**. Supabase provee autenticación, base de datos, RLS, RPCs y Realtime; los cambios de esquema se versionan en [`supabase/migrations/`](./supabase/migrations/).

El motor de discado está aislado en [`dialer-engine/`](./dialer-engine/): es un servicio Node.js/TypeScript con conexión AMI persistente a Asterisk y no forma parte del proceso Next.js. Consulta su [README](./dialer-engine/README.md) y la [arquitectura del motor](./docs/dialer-engine-architecture.md).

## Requisitos e instalación

Se necesita Node.js con npm y un proyecto Supabase con las migraciones aplicadas.

```bash
cp .env.example .env.local
# Completa las variables de Supabase en .env.local
npm ci
npm run dev
```

La aplicación queda disponible en `http://localhost:3000`.

### Variables de entorno

Usa [`.env.example`](./.env.example) como referencia. El CRM requiere:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (solo servidor; no debe exponerse al cliente)

## Scripts raíz

| Comando | Uso |
| --- | --- |
| `npm run dev` | Inicia Next.js en desarrollo. |
| `npm run build` | Genera la compilación de producción. |
| `npm run start` | Inicia la compilación de producción. |
| `npm run lint` | Ejecuta ESLint. Actualmente presenta incidencias conocidas; revísalas antes de usarlo como validación de aprobación. |

## Migraciones

Las migraciones SQL viven en [`supabase/migrations/`](./supabase/migrations/) y deben aplicarse al proyecto Supabase correspondiente, por ejemplo con la CLI:

```bash
supabase db push
```

No edites una migración ya aplicada: agrega una nueva migración para cada cambio de esquema.

## Despliegue

El CRM y el motor de discado se despliegan por separado:

- **CRM:** despliega la aplicación Next.js con sus variables de Supabase.
- **Motor de discado:** despliega [`dialer-engine/`](./dialer-engine/) como proceso persistente con conectividad privada hacia Asterisk; no en un entorno serverless de vida corta.

## Documentación relacionada

- [Estrategia de Atlas 2.0](./docs/atlas-2-strategy.md)
- [Arquitectura de integraciones externas](./docs/external-integrations-architecture.md)
- [Arquitectura del motor de discado](./docs/dialer-engine-architecture.md)
- [README del motor de discado](./dialer-engine/README.md)
