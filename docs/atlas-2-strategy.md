# Atlas 2.0: estrategia de producto y arquitectura

## Objetivo

Atlas 2.0 debe reemplazar a Registro Intel con un CRM de operación diaria para call center: menos pantallas, menos espera, menos pasos y mayor control de calidad sobre cada gestión.

El criterio de éxito no es tener más módulos, sino reducir el tiempo entre encontrar un lead, llamar, tipificar, agendar y cerrar la gestión.

Esta estrategia debe leerse junto con la comparacion real contra Registro Intel: [registro-intel-vs-atlas-2-comparison.md](./registro-intel-vs-atlas-2-comparison.md).

## Frente funcional

### Mantener y optimizar

- Leads como entidad central: búsqueda por RUT, teléfono y nombre, ficha única e historial consolidado.
- Gestión de llamadas: llamada abierta por agente, guardado parcial, cierre validado, descarte por error técnico y evento auditable.
- Agenda: vencidas y próximas llamadas visibles desde cualquier pantalla.
- Campañas: asignación de flujos, ejecutivos y dashboard operativo por campaña.
- Flujos de gestión: pasos obligatorios configurables para asegurar cumplimiento sin depender de capacitación informal.
- Reportes: rendimiento por ejecutivo, cumplimiento de flujos y métricas de campaña.
- Migración histórica: conservar ejecutivos históricos y trazabilidad de interacciones importadas.

### Reducir o eliminar

- Pantallas redundantes de búsqueda: llamadas ya redirige a leads; el patrón correcto es un buscador global unico.
- Tablas extensas como primera experiencia: reemplazar por colas de trabajo accionables y filtros guardados.
- Reportes de baja accionabilidad en la pantalla inicial: el inicio debe mostrar trabajo pendiente y bloqueos, no solo volumen total.
- Campos libres duplicados: preferir tipificaciones estructuradas y notas solo como complemento.

### Nuevas capacidades prioritarias

- Cola inteligente de trabajo: "vencidas", "para hoy", "nuevos asignados", "reintentos" y "sin contacto" como vistas operativas.
- Siguiente mejor accion: CTA unico por lead segun estado, agenda, flujo y campaña.
- Guardado optimista con estados claros: avance guardado, agenda guardada, gestion cerrada, llamada descartada.
- Calidad de datos en ingreso masivo: prevalidar RUT/telefono, duplicados por campana y columnas desconocidas antes de insertar.
- Auditoria de productividad: eventos compactos para medir tiempo a primera gestion, gestiones por hora y conversion por campaña.

## Base de datos

### Modelo actual inferido

El codigo usa estas tablas/vistas principales: `profiles`, `teams`, `leads`, `interactions`, `calls`, `call_events`, `campaigns`, `campaign_agents`, `workflows`, `workflow_steps`, `workflow_step_branches`, `lead_workflow_progress`, `historical_agents`, `agent_performance` y funciones como `search_leads_quick`, `bulk_insert_leads`, `get_workflow_compliance`.

No hay migraciones SQL versionadas en el repositorio, por lo que el primer paso de BDD debe ser capturar el esquema real de Supabase y versionarlo.

### Recomendaciones

- Versionar el esquema con migraciones Supabase antes de seguir creciendo.
- Indexar busquedas operativas:
  - `leads(managed_by, next_action_at)` para agenda.
  - `leads(status, updated_at)` para cola de trabajo.
  - `leads(campaign_id, rut)` y `leads(campaign_id, phone)` para deduplicacion por campaña.
  - indices funcionales normalizados para RUT y telefono usados por `search_leads_quick`.
- Mantener escrituras normalizadas en `calls`, `interactions` y `call_events`; usar vistas/materializaciones para lectura analitica.
- Crear una vista liviana para el inicio, por ejemplo `dashboard_summary_by_user`, para reemplazar multiples conteos repetidos.
- Activar RLS en tablas expuestas y revisar politicas por rol: agente ve sus leads/campañas, supervisor su equipo, admin todo.
- Evitar NoSQL como base principal: el dominio requiere relaciones, auditoria, filtros y reportes. JSONB es suficiente para extras de lead y metadata de eventos.

## Frontend y arquitectura

### Stack recomendado

El stack actual es correcto para Atlas 2.0: Next.js App Router, React 19, Server Components, Server Actions, Supabase SSR y componentes cliente solo donde hay interaccion real.

### Principios

- Server Components para lecturas iniciales y paginas pesadas.
- Client Components pequeños para busqueda, realtime, formularios y graficos.
- Server Actions para mutaciones con `revalidatePath` acotado.
- Realtime solo en superficies operativas; no montar varias suscripciones para el mismo dato.
- Carga inicial paralela con `Promise.all` cuando las consultas no dependen entre si.
- Consultas especificas por pantalla; evitar `select("*")` salvo en ficha donde realmente se necesita todo el lead.

### Cambios ya aplicados

- El dashboard inicial carga conteos, recientes y agenda en paralelo.
- Header y banner de agenda comparten un solo provider, consulta y suscripcion.
- El dashboard en vivo agrupa eventos cercanos antes de refrescar.
- Tailwind v4 usa nombres literales de Geist para evitar fallback de fuente.

## UX/UI

### Direccion visual

Atlas debe sentirse como una herramienta de trabajo densa, clara y rapida: navegacion persistente, formularios directos, estados visibles y jerarquia sobria. Evitar pantallas decorativas o marketing interno.

### Flujos clave

- Buscar lead: Cmd/Ctrl+K, RUT/telefono exacto abre ficha directo.
- Gestionar llamada: ficha del lead con datos esenciales, historial y formulario de tipificacion en la misma vista.
- Agendar: agenda visible en header, banner para vencidas y pagina completa solo para planificar.
- Supervisar campaña: dashboard por campaña con filtro de ejecutivo, avance y resultados.
- Administrar flujos: editor visual solo para admin; el agente ve solo el siguiente paso obligatorio.

### Metricas de experiencia

- Busqueda exacta a ficha: menos de 1 segundo.
- Cierre de gestion comun: menos de 3 decisiones obligatorias.
- Inicio del agente: debe responder "a quien llamo ahora" sin navegar.
- Agenda vencida: visible globalmente hasta accion o descarte.

## Siguiente fase recomendada

1. Exportar y versionar el esquema real de Supabase.
2. Crear indices y vistas de lectura para agenda, busqueda y dashboard.
3. Convertir `/dashboard/leads` en cola operativa con filtros por estado, campaña, agenda y asignacion.
4. Medir bundle y separar graficos/reportes para que no afecten la experiencia del agente.
5. Agregar pruebas de acciones criticas: cerrar llamada, guardar agenda, conflicto de agenda, busqueda rapida y carga masiva.
