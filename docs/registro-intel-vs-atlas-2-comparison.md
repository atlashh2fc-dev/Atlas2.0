# Registro Intel vs Atlas 2.0: comparacion real

## Alcance revisado

Registro Intel fue revisado desde `/Users/hh/Projects/active/registro-intel`.

Fuentes usadas:

- Codigo Next.js, componentes, rutas y acciones.
- `README.md`, `package.json`, `supabase/full_setup.sql` y migraciones.
- Documentos internos: roadmap predictivo, arquitectura del motor, plan de mejoras enterprise, plan de discado global, omnicanalidad email y filtros Equifax.

## Resumen ejecutivo

Atlas 2.0 no debe intentar copiar Registro Intel modulo por modulo. Registro Intel contiene aprendizajes operativos muy valiosos, pero tambien arrastra complejidad acumulada: muchas rutas, mucha logica especifica por campana, numerosos scripts de reparacion y un modelo de BDD con mucha inteligencia distribuida entre triggers, RPCs, caches y pantallas.

La oportunidad de Atlas 2.0 es quedarse con el nucleo que si funciona:

- ficha unica de lead/contacto;
- busqueda rapida exacta;
- agenda visible globalmente;
- llamada abierta recuperable;
- tipificacion guiada;
- cola de trabajo por campana;
- trazabilidad por eventos;
- reportes precalculados;
- migraciones versionadas;
- RLS y roles estrictos.

Y evitar lo que hizo pesado a Registro Intel:

- demasiadas superficies operativas simultaneas;
- rutas especializadas por cliente/campana;
- reparaciones de datos dentro del camino de render;
- snapshots reconstruidos en TypeScript con muchas queries;
- polling frecuente combinado con Realtime sin debounce;
- pre-queries redundantes antes de claims;
- UI con demasiada informacion contextual en primera vista.

## Metricas comparativas

| Area | Registro Intel | Atlas 2.0 actual |
| --- | ---: | ---: |
| Archivos TS/TSX en `src` | 290 | 54 |
| Lineas TS/TSX en `src` | 125.364 | 8.106 |
| Componentes/archivos client | 80 | 14 |
| Pages/routes/layouts App Router | 69 | 21 |
| Migraciones SQL | 177 | 0 |
| Tests | 22 | 0 |
| Dependencias runtime | 28 | 14 |
| Dev dependencies | 16 | 8 |

Lectura: Atlas ya es mucho mas ligero. La deuda principal de Atlas no es frontend pesado, sino falta de BDD versionada, tests y parte de la madurez operacional que Registro Intel si tiene.

## Frente funcional

### Funcionalidad de Registro Intel que Atlas debe conservar

- Gestion de llamadas con llamada abierta recuperable.
- Agenda global con vencidas, del dia y futuras.
- Busqueda por RUT, telefono y nombre, idealmente exacta primero.
- Colas por campana y reglas de claim en base de datos.
- Historial unificado por lead/contacto.
- Roles y visibilidad por admin, supervisor y agente.
- Importacion CSV/XLSX con validacion y trazabilidad.
- Eventos atomicos (`call_events` o equivalente) para auditoria y reportes.
- Reportes leidos desde vistas/RPCs/caches, no desde calculos pesados en cliente.

### Funcionalidad que Atlas debe redisenar

- `Command Center`: debe ser un resumen precalculado por campana/equipo, no un snapshot reconstruido con 5-6 queries cada pocos segundos.
- Motor de discado: debe llamar un unico RPC de claim que decida fuente, prioridad y fallback. Evitar pre-counts seriales.
- Agenda: debe vivir como cola operativa unica, no como multiples pantallas con reglas duplicadas.
- Campanas: mantener configuracion, miembros, flujo y bases, pero evitar rutas especificas por cliente como default de producto.
- Omnicanalidad: dejarla como modulo posterior. El CRM base debe cerrar telefono y agenda antes de incorporar email/chat.
- Motor predictivo: usar el principio de Registro Intel, pero no implementarlo en la primera version de Atlas. Primero dejar `lead_scores` preparado para lectura.

### Funcionalidad que Atlas deberia eliminar o postergar

- Softphone SIP embebido completo como primera version.
- Chat y omnichannel email en el nucleo inicial.
- Reportes comerciales muy especificos por Equifax/DICOM en el core.
- Scripts de reparacion ejecutados desde paginas.
- Contexto excesivo en panels laterales si no acciona una decision inmediata.

## Base de datos

### Hallazgos de Registro Intel

Registro Intel tiene una BDD avanzada:

- 118 declaraciones de tablas detectadas.
- 380 declaraciones de funciones/RPC.
- 268 declaraciones de indices.
- 271 politicas RLS.
- Cola materializada y/o sincronizada por triggers.
- RPCs de claim con locks y reglas de prioridad.
- Tablas de eventos y caches para reportes.

Esto muestra madurez, pero tambien riesgo de mantenimiento: mucha logica vive en SQL distribuido en 177 migraciones.

### Lo que Atlas debe copiar de BDD

- Migraciones versionadas desde el inicio.
- Indices dedicados para busqueda, agenda y cola:
  - `leads(managed_by, next_action_at)`;
  - `leads(campaign_id, status, updated_at)`;
  - indices normalizados para RUT y telefono;
  - indices de llamadas por agente/campana/fecha.
- Claim transaccional en Postgres con locks para evitar doble asignacion.
- Eventos auditables por cada mutacion operacional.
- Vistas/RPCs para dashboard en vez de multiples conteos desde componentes.
- RLS por rol y por pertenencia a campana/equipo.

### Lo que Atlas debe evitar de BDD

- Triggers y funciones duplicadas por variante de cliente.
- Reparaciones operativas invocadas desde render de paginas.
- Caches sin propietario claro o sin politica de refresco.
- RPCs demasiado grandes que mezclen claim, reparacion, reporting y side effects.

### Decision recomendada

Atlas debe seguir usando Postgres/Supabase como base principal. No conviene NoSQL para el core: el producto requiere relaciones, auditoria, RLS, reportes, transacciones y filtros complejos. JSONB si es apropiado para `extra`, payloads de importacion y metadata de eventos.

## Frontend y arquitectura

### Hallazgos de Registro Intel

Registro Intel usa Next.js 16, React 19, Supabase SSR, Server Actions, shadcn/ui, Zustand, Realtime, TanStack Table, Recharts, XLSX/PapaParse y modulos de mail/softphone.

El frontend tiene potencia, pero mucha superficie:

- `AppShell` concentra navegacion, busqueda, recordatorios, prefetch, mobile sheet, quick panel y sesion.
- `OperationalContextProvider` coordina campana activa, llamada abierta, presencia, Realtime y polling.
- El softphone embebido carga SIP.js desde CDN, maneja estado de llamada, registro, eventos y grabacion.
- Varias pantallas usan timeouts defensivos por latencia de queries.

### Lo que Atlas debe copiar

- App Router con lecturas iniciales en Server Components.
- Client Components solo para interaccion real: busqueda, agenda, formularios, realtime.
- Provider operativo unico por usuario/campana cuando haya estado global.
- Debounce de eventos Realtime.
- Fallback de polling solo cuando la pestaña esta visible.
- Timeouts defensivos para datos suplementarios, sin bloquear el flujo principal.

### Lo que Atlas debe evitar

- Un `AppShell` gigante como centro de demasiadas responsabilidades.
- Estado global que re-renderiza arboles enteros cada segundo.
- Carga de librerias pesadas en rutas de agente si solo se usan en reportes/admin.
- Mezclar telefonia, campana activa, agenda, busqueda y navegacion en un solo componente.

## UX/UI

### Aprendizajes de Registro Intel

Registro Intel tiene muchas capacidades utiles, pero la UI expone demasiadas decisiones a la vez. Para agentes, el objetivo no es ver todo: es saber a quien llamar, que decir, como tipificar y que hacer despues.

### Principios para Atlas

- Inicio del agente = cola de trabajo, no dashboard generico.
- Un CTA primario por lead: llamar, retomar llamada, cumplir agenda o cerrar gestion.
- Busqueda global como escape rapido, no como pantalla principal.
- Historial resumido primero, detalle bajo demanda.
- Agenda visible globalmente, pero sin duplicar consultas.
- Supervisores ven excepciones, vencidas, productividad y calidad; no toda la operacion cruda.
- Admin configura campanas/flujos, pero no contamina la experiencia diaria del agente.

## Decision por modulo

| Modulo Registro Intel | Decision para Atlas 2.0 | Motivo |
| --- | --- | --- |
| Contacts/leads | Conservar simplificado | Es el centro del CRM. |
| Calls runner | Conservar redisenado | Valor alto, pero debe ser mas corto y estable. |
| Agenda | Conservar y elevar | Debe ser cola operacional principal. |
| Campaigns | Conservar | Necesario para operacion, asignacion y reportes. |
| Script builder | Postergar o simplificar | Atlas ya tiene flujos; evitar builder pesado al inicio. |
| Command Center | Redisenar | Problemas documentados de queries y rerenders. |
| Softphone embebido | Postergar | Mucho peso tecnico; extension/dialer actual puede cubrir MVP. |
| Omnichannel email | Postergar | Valioso, pero no debe entrar al core inicial. |
| Equifax/DICOM especifico | Convertir en plantillas/modulos | Evitar hardcodear clientes en core. |
| Predictive engine | Preparar BDD, implementar despues | Principio correcto: scores precalculados, cero latencia. |

## Roadmap recomendado desde esta comparacion

1. Versionar BDD de Atlas con migraciones reales.
2. Crear indices/RPCs base: busqueda rapida, agenda, claim, resumen dashboard.
3. Transformar `/dashboard/leads` en cola operativa con filtros de agenda, estado, campana y asignacion.
4. Hacer que el inicio del agente responda "a quien llamo ahora".
5. Implementar reportes desde vistas/RPCs precalculadas.
6. Agregar tests para cierre de llamada, agenda, conflicto de agenda, busqueda y carga masiva.
7. Recien despues evaluar `lead_scores` precalculado y semaforo de prioridad.
8. Dejar softphone, email omnicanal y motor predictivo completo como fases posteriores.

## Conclusión

Registro Intel es una base de aprendizaje, no una plantilla para copiar. Atlas 2.0 debe tomar sus patrones probados de operacion y BDD, pero con una arquitectura mas estricta: menos modulos por defecto, consultas precalculadas, estado cliente pequeno, flujos de agente mas directos y migraciones desde el dia uno.
