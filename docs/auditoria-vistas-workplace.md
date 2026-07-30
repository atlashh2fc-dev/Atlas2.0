# Auditoría de vistas — de pantallas a workplace

> Segunda capa del rediseño. La navegación ya está resuelta
> (`docs/arquitectura-navegacion.md`); esto es sobre **qué pasa dentro de cada pantalla**.
> Benchmark: Genesys Cloud CX, Five9, NICE CXone, Salesforce Service Cloud, HubSpot, Zendesk.
> Estado: propuesta · Julio 2026

---

## 1. Veredicto

Las pantallas no están mal diseñadas una por una: les faltan **seis primitivos** que en cualquier
CRM de contact center están dados por hecho. Como no existen, cada pantalla los improvisa a medias
y el resultado se siente exactamente como lo describiste — cojo, técnico, incompleto.

El síntoma más claro y más repetido: **la lista y el formulario de creación viven en la misma
página**. En Campañas, Usuarios, Equipos, Estados de agente y Flujos hay un bloque "Crear …"
pegado abajo de la tabla. Ningún producto de referencia hace eso: la lista es la lista, y crear es
un botón primario que abre un panel. Ese solo patrón explica buena parte de la sensación de
herramienta interna en vez de producto.

---

## 2. Los 6 primitivos que faltan (causa raíz)

| # | Primitivo | Qué falta hoy | Impacto |
|---|---|---|---|
| 1 | **`DataTable` real** | Ninguna tabla ordena, pagina, selecciona filas ni exporta. La cola de registros **corta en 75 filas con un `.slice(0, 75)`** sin decírselo al usuario. | El supervisor no puede trabajar en lote: asignar 200 leads, reagendar en masa, cambiar de campaña. Es el 80 % de su día. |
| 2 | **`SlideOver` (panel lateral)** | Solo existe `agent-campaigns-dialog`. Todo lo demás es formulario incrustado o navegación a otra página. | Crear/editar saca al usuario de su contexto y obliga a perder la lista y los filtros. |
| 3 | **`FilterBar` + vistas guardadas** | Cada pantalla reinventa su barra de filtros; nada se recuerda entre visitas. | Se repite el mismo filtrado 20 veces al día. Five9 y HubSpot resuelven esto con vistas guardadas como pestañas. |
| 4 | **Drill-down desde la métrica** | Ningún número lleva a la lista que lo compone ("4 agendas vencidas" no es clickeable). | Un dashboard sin drill-down es un póster, no una herramienta de gestión. |
| 5 | **Definiciones en línea (ⓘ) + glosario** | AHT, NS 20s, ACW, Ocupación, Adherencia, "Interrupción legal", `workflow_status` aparecen crudos. | El usuario no sabe qué mide la columna, así que no confía en el número. |
| 6 | **Comparación y meta** | Ningún KPI trae "vs. período anterior" ni umbral/objetivo. | Un número sin referencia no permite decidir nada. |

A eso se suma un séptimo transversal: **acciones de supervisión en vivo** (escuchar, susurrar,
irrumpir, sacar de pausa, forzar estado, mensaje al agente). En Genesys y Five9 son la razón de
existir de la pantalla de monitoreo; en Atlas el monitor es solo lectura.

---

## 3. Los 7 patrones de pantalla del estándar

1. **Un solo shell de página**: título → filtros/pestañas guardadas → tabla o grid → panel de detalle.
2. **Master-detail**: la fila abre un panel a la derecha sin perder la lista (Zendesk, Salesforce, Five9 Supervisor).
3. **La acción vive junto al dato**: botón primario arriba a la derecha; acciones de fila al hover; acciones masivas en una barra que aparece al seleccionar.
4. **Toda métrica es un enlace** a su detalle.
5. **Toda tabla se exporta** (CSV/XLSX) y toda columna numérica ordena.
6. **Estado explícito**: skeleton al cargar, vacío con instrucción y CTA, error con reintento. Nunca un `—` sin explicación.
7. **Configuración con contexto**: cada pantalla de administración dice qué rompe si se cambia, quién lo cambió la última vez y permite previsualizar.

---

## 4. Pantalla por pantalla

### 4.1 Inicio (3 variantes por rol)

**Hoy:** tarjetas de conteo + "Alertas operativas" y "Pendientes de configuración" como tarjetas
sueltas. Los números no llevan a ninguna parte y el ejecutivo no ve su propio día.

**Propuesta:**

- **Agente — "Mi día":** una sola columna de trabajo: próxima llamada sugerida (con botón *Llamar*), agendas de hoy en orden, vencidas destacadas, y mis 4 números del día (gestiones, contactados, agendas, ventas) contra la meta.
- **Supervisor:** fila de KPI con delta vs. ayer, semáforo de SLA, tabla "Requiere tu atención" (agendas vencidas, leads sin asignar, ejecutivos en pausa larga) donde **cada fila tiene su acción** en línea. Genesys llama a esto *Workspace*; sin acciones es solo un póster.
- **Admin — "Salud de la plataforma":** checklist accionable (campañas sin flujo, sin ejecutivos, sin extensión SIP, cargas fallidas) con enlace directo a arreglar cada cosa, más últimos eventos de configuración.
- Todos: cada número clickeable hacia la lista filtrada que lo produce.

**Prioridad: alta** (es la primera pantalla del producto).

### 4.2 Registros (lista)

**Hoy:** pestañas de vista (prioridad, vencidas, hoy, disponibles, bloqueados, gestionados) — buen
punto de partida —, filtros por ejecutivo/campaña/estado, y **corte silencioso en 75 filas**. Sin
orden por columna, sin selección múltiple, sin exportar, sin paginación, sin densidad.

**Propuesta:**

- `DataTable` con paginación server-side (o scroll infinito), orden por columna y contador real ("1–50 de 1.842").
- **Selección múltiple + barra de acciones masivas**: asignar a ejecutivo, cambiar campaña, reagendar, cambiar estado, exportar selección. Este es el cambio de mayor impacto operativo de todo el documento.
- **Vistas guardadas** como pestañas propias del usuario, además de las 6 del sistema.
- Columnas configurables y densidad compacta/cómoda.
- Fila → **panel lateral** con la ficha del registro; el detalle a pantalla completa sigue existiendo por URL.
- Exportar la vista actual respetando filtros.

**Prioridad: alta.**

### 4.3 Ficha del registro (`leads/[id]`)

**Hoy:** bloques de datos + "Historial de gestiones" + secciones distintas por rol ("Vista de
supervisión", "Vista administrativa") con campos técnicos expuestos (`workflow_status`, "Flujo:
Equifax" cuando no hay flujo).

**Propuesta:**

- Layout de 3 zonas del estándar (Salesforce/Zendesk): **izquierda** identidad y datos, **centro** línea de tiempo unificada (llamadas, tipificaciones, correos, cambios de asignación, notas) con filtro por tipo, **derecha** próxima acción (agenda, tipificar, llamar).
- Encabezado con acciones fijas: **Llamar · Agendar · Tipificar · Reasignar**, siempre visibles.
- Las "vistas por rol" desaparecen como secciones: es la misma ficha con más o menos campos según permiso. Hoy se lee como tres productos.
- Traducir jerga: `workflow_status` → "Etapa del flujo"; nunca mostrar "Equifax" como nombre de flujo cuando el valor real es "sin flujo".
- Notas internas y adjuntos (falta por completo).

**Prioridad: alta.**

### 4.4 Mi agenda

**Hoy:** una tabla de agendas con `<table>` propia.

**Propuesta:** vista de día/semana con bloques horarios y las vencidas fijas arriba; acción
*Llamar ahora* y *Reagendar* en cada fila; recordatorio ya existe (`agenda-reminder`) y debe abrir
directo la ficha. Contador de vencidas en el menú (el badge ya está modelado en `nav.config.ts`).

**Prioridad: media.**

### 4.5 Mi equipo

**Hoy:** KPI + filtros + tres tablas (agendas vencidas, próximas, asignación de leads) con un
`<select>` + botón *Asignar* fila por fila.

**Propuesta:**

- Asignación en lote con selección múltiple, y **distribución automática** ("repartir 120 leads entre 6 ejecutivos por carga actual"): es lo que hace el *routing* de Five9 y evita 120 clics.
- Tabla de ejecutivos como entidad principal: carga actual, agendas vencidas, gestiones hoy, contactabilidad, estado en vivo — con enlace a su detalle. Hoy el equipo se ve como leads sueltos, no como personas.
- Las tres tablas pasan a pestañas de una sola tabla (Vencidas · Próximas · Sin asignar).

**Prioridad: alta.**

### 4.6 Monitor en vivo

**Hoy:** tarjetas de cola + lista de ejecutivos con estado y cronómetro. Poll cada 2 s. **Solo
lectura**, sin filtros, sin orden, sin resumen agregado, sin umbrales.

**Propuesta (la brecha más grande del producto frente a Genesys/Five9):**

- **Barra de estado agregada**: cuántos disponibles / en llamada / ACW / en pausa / desconectados, con % de ocupación del equipo. Es lo primero que mira un supervisor.
- **Grid de ejecutivos** ordenable y filtrable por estado y campaña, con columnas de turno: estado, tiempo en estado, llamadas hoy, AHT, ocupación, adherencia.
- **Acciones por fila**: escuchar, susurrar, irrumpir, sacar de pausa, forzar estado, mensaje, cerrar sesión. Requiere soporte en el dialer-engine (Asterisk `ChanSpy` para escuchar/susurrar/irrumpir), así que se especifica por separado.
- **Umbrales con color y alerta**: pausa > X min, ACW > Y s, abandono > 6 % (el 6 % ya está en el código, hoy sin explicación visible).
- Colas con las métricas que el estándar considera mínimas: en espera, espera más antigua, ASA, SL %, abandono.
- Reemplazar el poll de 2 s por realtime/SSE cuando haya más de ~20 agentes.

**Prioridad: alta.**

### 4.7 Reportes › Gestión

**Hoy:** KPI + 4 paneles de gráfico con descarga XLSX (bien) sobre una ventana fija de días.

**Propuesta:**

- **Selector de período con presets** (Hoy · Ayer · 7d · 30d · Mes · Personalizado) y **comparación con período anterior** en cada KPI.
- Cada gráfico con drill-down: click en una barra → lista de registros de ese segmento.
- Segmentación por equipo y por ejecutivo, no solo por campaña.
- Metas por KPI (contactabilidad, conversión) para que el color signifique algo.
- Suscripción por correo del reporte (patrón estándar en los cinco productos comparados).

**Prioridad: media-alta.**

### 4.8 Reportes › Discador

**Hoy:** dos tablas de 12 y 10 columnas con siglas sin explicación (NS 20s, Ring prom., AHT,
Ocupación, Adherencia), fechas en formato ISO crudo, sin orden ni exportación. **Bug real: el
filtro de campaña no se aplica a "Actividad por agente"** — la tabla ignora el filtro visible
arriba, lo que hace que los números no cuadren y se pierda la confianza en el reporte.

**Propuesta:**

- Corregir el filtro de campaña en actividad por agente (o marcar explícitamente que es global).
- ⓘ en cada encabezado con definición y fórmula; glosario en Ayuda.
- Fechas en `es-CL`, orden por columna, exportación XLSX, columnas configurables.
- Tendencia sobre la tabla (sparkline por métrica) y semáforo contra umbral.
- Drill-down: agente → sus llamadas del rango; día → detalle de llamadas.

**Prioridad: alta** (el bug del filtro es de confianza en el dato).

### 4.9 Bandeja mail

**Hoy:** KPI de envíos/aperturas/clicks + reportería por campaña + asignación manual.

**Propuesta:** embudo visual (enviado → abierto → click → asignado → contactado → agendado →
venta), asignación en lote, y regla de asignación automática por campaña. Hoy la asignación
manual uno a uno no escala.

**Prioridad: media.**

### 4.10 Campañas (lista) y Campaña (detalle)

**Hoy — lista:** tabla con toggles de campaña y discador (con `title` como única explicación) y
un bloque "Crear campaña" incrustado abajo.

**Hoy — detalle:** 508 líneas con "Preparación de la campaña", ejecutivos asignados, horarios y
"Configuración de discado" en una sola columna larga.

**Propuesta:**

- Lista: crear con **botón primario + panel lateral**; columnas con salud de la campaña (leads disponibles, agotamiento de base, contactabilidad, estado del discador) y estado en `Badge` con leyenda; acciones de fila al hover.
- Detalle en **pestañas**: Resumen · Base · Ejecutivos · Horarios · Discado · Flujo. Es el patrón de Five9 (Campaign Profile) y evita la página infinita.
- **Wizard de creación en 4 pasos** (Datos → Flujo → Ejecutivos → Discado) con checklist de "lista para operar": hoy una campaña puede quedar a medias sin que nadie lo note, y por eso el Inicio del admin necesita alertas de "sin flujo"/"sin ejecutivos".
- Cada parámetro de discado con su explicación en línea (ratio, abandono máximo, reintentos, ventanas legales) — hoy es la pantalla más técnica del producto.
- Consolidar `campanas/[id]/dashboard` como la pestaña Resumen, no como una ruta aparte.

**Prioridad: alta.**

### 4.11 Flujos de gestión

**Hoy:** plantillas + canvas de 710 líneas.

**Propuesta:** panel de propiedades del nodo a la derecha (en vez de edición sobre el lienzo),
**validación antes de publicar** (nodos huérfanos, sin salida, tipificaciones sin destino),
**versionado con publicar/borrador** y previsualización de cómo lo verá el ejecutivo. El
versionado es lo que impide romper una campaña en producción; hoy no existe.

**Prioridad: media-alta.**

### 4.12 Usuarios y equipos

**Hoy:** "Crear usuario" con contraseña en claro en el formulario, "Revisar campaña", tabla de
usuarios y bloque de equipos con su propio formulario de creación. Todo en una página.

**Propuesta:**

- Panel lateral para crear/editar; **invitación por correo** en vez de fijar contraseña a mano (además de ser el estándar, evita manejar contraseñas de terceros).
- Detalle de usuario con pestañas: Perfil · Rol y permisos · Campañas · Extensión SIP · Actividad. Hoy la información de una persona está repartida en tres pantallas.
- Acciones en lote (desactivar, cambiar equipo, asignar campaña) y estado activo/inactivo filtrable.
- Equipos como su propia pestaña, no un bloque al final.
- Registro de auditoría: quién cambió el rol y cuándo (Genesys *Audit Viewer*).

**Prioridad: media-alta.**

### 4.13 Estados de agente, 4.14 Extensiones SIP, 4.15 Cargas y listas, 4.16 Integraciones

- **Estados de agente:** que cada estado declare si es productivo, si cuenta para adherencia y si tiene tope de tiempo — hoy es solo un catálogo de nombres y el reporte de adherencia depende de eso. Vista previa de cómo se ve en el CTI.
- **Extensiones SIP:** mostrar estado de registro en vivo (registrado / no registrado / última vez visto) junto a la credencial. Una extensión sin registro es la causa #1 de "no me entran llamadas".
- **Cargas y listas:** historial de cargas con resultado por archivo (filas leídas, creadas, duplicadas, rechazadas con motivo y **descarga del archivo de errores**), y previsualización con mapeo de columnas antes de confirmar. Hoy se sube a ciegas.
- **Integraciones:** estado de la integración (última sincronización, resultado, errores) además del formulario de carga.

**Prioridad: media** (salvo el estado de registro SIP, que es alta por soporte).

### 4.17 Barra CTI (transversal, 1.527 líneas)

Es el componente más grande del producto y el que el ejecutivo mira todo el día. Merece su propia
revisión, pero dos cosas del estándar faltan seguro: **disposición obligatoria antes de liberar la
llamada** (hoy el ACW se puede evadir) y **temporizadores visibles de estado** con el motivo de
pausa a un clic. Se propone auditarlo aparte para no mezclarlo con esta capa.

---

## 5. Plan por fases

| Fase | Alcance | Resultado |
|---|---|---|
| **P0 — Primitivos** ✅ | `DataTable` (orden, paginación, selección, acciones masivas, columnas, densidad, export, 3 estados), `SlideOver`, `FilterBar` + vistas guardadas, `MetricCard` con delta/meta/drill-down, `InfoTooltip` + `MetricLabel` sobre un glosario único, `usePersistentState`. | Desbloquea todas las pantallas siguientes. Sin esto, cada mejora se vuelve a improvisar. |
| **P1 — Operación diaria** ✅ | Registros (paginación real + acciones en lote), Mi equipo (asignación masiva y reparto por carga), Monitor en vivo (agregados, filtros, umbrales), Reportes › Discador (alcance del filtro, definiciones, orden, export, presets). | Es donde se gana o se pierde el día del supervisor. |
| **P2 — Administración** ✅ | Campañas (lista con salud + detalle en pestañas), Usuarios y equipos (paneles laterales, pestañas, lote), Cargas (previsualización y rechazadas descargables), Flujos (validación antes de operar), Estados de agente (efecto declarado). | Elimina la sensación de herramienta interna. |
| **P3 — Profundidad** ✅ (parcial) | Ficha del registro a 3 zonas con línea de tiempo filtrable, Inicio accionable por rol con KPI enlazados. Pendiente: drill-down en los KPI de Reportes › Gestión, Bandeja mail y el resumen de campaña; suscripción a reportes. | Cierra la brecha con Genesys/Five9. |
| **Aparte** | Escuchar/susurrar/irrumpir (requiere `ChanSpy` en el dialer-engine) y auditoría de la barra CTI. | Especificar antes de estimar. |

---

## 6. Criterios de aceptación

- Ninguna tabla corta filas sin decirlo; toda tabla ordena, pagina y exporta.
- Ninguna página de lista contiene un formulario de creación incrustado.
- Toda métrica de un dashboard es clickeable hacia su detalle.
- Ninguna sigla (AHT, NS 20s, ACW, ocupación, adherencia) aparece sin definición accesible.
- Todo KPI muestra comparación con el período anterior o su meta.
- Todo filtro visible en una pantalla se aplica a **todas** las tablas de esa pantalla.
- Ninguna pantalla expone un nombre de columna de base de datos (`workflow_status`, `wrap_up`).
- Toda pantalla tiene sus tres estados: cargando, vacío con instrucción, error con reintento.

---

## 7. P0 — qué quedó construido

| Archivo | Qué entrega |
|---|---|
| `src/components/ui/data-table.tsx` | Tabla única: orden por columna con `aria-sort`, paginación con conteo real ("1–50 de 1.842"), selección múltiple con barra de acciones masivas, columnas configurables, densidad, exportación XLSX (selección o vista completa) y los tres estados. Modo servidor vía `onPageChange` para listas grandes. |
| `src/components/ui/slide-over.tsx` | Panel lateral con Escape, bloqueo de scroll y foco inicial, para reemplazar los formularios incrustados. |
| `src/components/ui/filter-bar.tsx` | Barra de filtros única + **vistas guardadas** por pantalla. Los filtros siguen en la URL, así que una vista es un querystring con nombre. |
| `src/components/ui/metric-card.tsx` | KPI con variación vs. período anterior (con semántica invertida para abandono y esperas), meta, definición y **enlace al detalle**. |
| `src/components/ui/info-tooltip.tsx` | `InfoTooltip` y `MetricLabel`; funcionan sin JavaScript, así que sirven dentro de tablas y componentes de servidor. |
| `src/lib/metric-definitions.ts` | Glosario único de 14 términos (AHT, ACW, ocupación, adherencia, abandono, NS 20 s, contactabilidad, interrupción legal…). Alimenta los tooltips **y** la sección "Glosario de métricas" del Centro de ayuda. |
| `src/lib/persistent-state.ts` | Preferencias por usuario (densidad, columnas, filas por página, vistas) sin cascadas de render ni desajuste de hidratación. |

Prueba de humo: **Mi agenda** ya usa `DataTable` (orden, export, densidad, vacío con instrucción) y
subió su tope de 100 a 500 filas. Además se corrigieron las 14 rutas de menú del Centro de ayuda,
que quedaron obsoletas con la nueva navegación.

---

## 8. P1 — qué quedó construido

### Registros

La cola pasó de **75 filas visibles con contadores calculados sobre 300 registros cargados** a
paginación real contra la base. Medición en la base de producción al implementarlo: **61.162
registros** — es decir, la pantalla anterior mostraba el 0,1 % y sus pestañas mentían.

- `src/lib/leads-query.ts`: las seis vistas operativas (Prioridad, Vencidas, Hoy, Disponibles, Bloqueados, Gestionados) se resuelven **en SQL**, con `count` exacto por pestaña y `range` por página. La visibilidad la garantiza la política RLS `leads_select`, igual que la RPC anterior.
- Acciones en lote en `src/app/actions/leads.ts` (`bulkAssignLeads`, `bulkRescheduleLeads`): usan la RPC `assign_lead` registro por registro para conservar motivo y origen del cambio, en vez de un `update` sin historia. Tope de 250 por operación.
- La cola usa `DataTable` con selección múltiple, panel lateral para asignar y reagendar, exportación y `FilterBar` con vistas guardadas.

Contadores reales medidos en la verificación: 178 vencidas, 5.893 bloqueadas (sin teléfono),
36.173 disponibles, 18.916 gestionadas.

### Mi equipo

- **Carga por ejecutivo** como tabla principal: cartera asignada, sin gestionar, agendas de hoy y vencidas, con enlace a la cartera filtrada de cada persona.
- **Asignación masiva** y **reparto automático por carga** (`distributeLeads`): cada registro va al ejecutivo con menos cartera en ese momento. Antes eran 120 clics para repartir 120 leads.
- Los cuatro KPI ahora enlazan a la vista filtrada que los produce.

### Monitor en vivo

- **Barra agregada**: ocupación del equipo y conteo por estado (disponibles, en llamada, en cierre, en pausa, sin conexión).
- **Grid filtrable y ordenable** por estado, campaña y nombre/extensión, con exportación.
- **Umbrales**: pausa sobre 15 minutos y cierre de llamada sobre 120 segundos se marcan en rojo, y el encabezado dice cuántos ejecutivos están sobre el umbral. El 6 % de abandono ahora se explica en la tarjeta de cola en vez de ser un número mágico en el código.

### Reportes › Discador

- **Se resolvió la inconsistencia del filtro**: la actividad por ejecutivo no puede atribuirse a una campaña (el tiempo conectado y las pausas son de la jornada completa), así que la tabla lo declara explícitamente y explica por qué. Queda pendiente una migración si se quiere `p_campaign_id` en `get_agent_activity_report`.
- Las 22 columnas de las dos tablas pasan por `DataTable`: orden, densidad, columnas configurables y exportación.
- Toda sigla (AHT, abandono, ocupación, adherencia, nivel de servicio, timbrado) trae su definición del glosario. Fechas en `es-CL`, no ISO.
- Presets de rango (Hoy · 7 días · 30 días), meta visible en abandono y reintento ante error.

### Verificación

`npx tsc --noEmit` y `npx eslint src` sin errores ni avisos. Los seis filtros de vista, la
paginación y el join de asignación se probaron contra la base real antes de dar por terminado el
cambio. `next build` sigue sin poder correrse en el entorno de verificación (falla por memoria).

---

## 9. P2 — qué quedó construido

### Campañas

- **Ningún formulario incrustado**: crear campaña es un botón primario que abre un panel lateral.
- La lista muestra **salud de la campaña**: base, sin gestionar, ejecutivos, estado y discador. Antes traía el `campaign_id` de **todos** los leads de la base (61 mil filas) para contarlos en memoria; ahora son conteos con `head: true`.
- El detalle pasó de **508 líneas en una columna** a cuatro pestañas: **Resumen** (preparación + flujo + tablero), **Base**, **Ejecutivos**, **Discado**.
- `campanas/[id]/dashboard` se consolidó como la pestaña Resumen y redirige.
- La pestaña **Base** entrega los cinco números de la base con enlace a la vista filtrada de Registros: total, sin gestionar, gestionados, con agenda y sin teléfono.
- La pestaña **Discado** —la más técnica del producto— tiene cada parámetro explicado en línea: ratio, tiempo entre llamadas, reintentos con su espera creciente, espera sin ejecutivo, abandono objetivo y detección de contestador. Además avisa arriba si la ruta saliente no es Siptel o si la campaña no tiene flujo.

### Usuarios y equipos

- Dos pestañas (**Usuarios** y **Equipos**) en vez de cuatro bloques apilados con dos formularios incrustados.
- Crear usuario en panel lateral, con la contraseña rotulada como **temporal** y la indicación de cambiarla al primer ingreso.
- Tabla de usuarios sobre `DataTable`: orden, columnas configurables, exportación y **acciones en lote** para activar o desactivar cuentas (`bulkSetUserActive`).
- Filtros de **rol**, **estado** y **campaña** (antes solo campaña).
- Equipos muestra cuántos ejecutivos tiene cada uno.

### Cargas y listas

- **Vista previa antes de confirmar**: las primeras cinco filas tal como quedarán guardadas con el mapeo elegido, marcando en rojo las que no traen teléfono. El botón dice cuántas filas se van a cargar.
- **Descarga de rechazadas**: XLSX con número de fila, motivo del rechazo y los datos originales de esa fila. Antes, corregir un archivo de 20.000 filas era adivinar.

### Flujos de gestión

- `src/lib/workflow-validation.ts`: valida **antes de operar** que haya exactamente un paso inicial, que ningún paso quede inalcanzable, que no haya conexiones a pasos borrados y que cada opción de un paso de selección continúe a algún lado.
- La lista de flujos muestra el resultado de la revisión como badge y **en qué campañas se usa cada flujo** — así se ve el impacto antes de tocarlo.
- El editor muestra los hallazgos arriba del lienzo, separando errores de avisos.

### Estados de agente

- Cada estado declara ahora **si recibe llamadas** y **cómo afecta los reportes** (resta adherencia, no es productivo, o se excluye del cálculo). Era un catálogo de nombres del que dependía el reporte de adherencia sin decirlo.

### Lo que requiere migración (no se hizo)

Tres mejoras del plan dependen de cambios de esquema y quedan propuestas, no aplicadas:

1. **Historial de cargas por archivo**: no existe tabla de cargas; hoy la carga inserta leads sin dejar registro del archivo. Requiere una tabla `lead_uploads`.
2. **Filtro de campaña en actividad por ejecutivo**: `get_agent_activity_report` no recibe `p_campaign_id`.
3. **Versionado de flujos** (borrador/publicado) y **atributos de estado** (productivo, cuenta para adherencia, tope de tiempo) como columnas propias en vez de derivarse de `is_pause`.

### Verificación

`npx tsc --noEmit` y `npx eslint src` sin errores ni avisos. Los conteos por campaña, las tablas de
flujos y el listado de perfiles se probaron contra la base real. Las 17 rutas del menú siguen
resolviendo y no quedaron enlaces a las anclas antiguas (`#ejecutivos`, `#discado`).

---

## 10. P3 y auditoría de cierre (2026-07-30)

### P3 — qué quedó construido

- **Ficha del registro** en tres zonas: identidad y contexto a la izquierda, próxima acción y línea de tiempo al centro. `src/components/lead-timeline.tsx` unifica llamadas y gestiones en un solo hilo con filtro por tipo. Las secciones "Vista de supervisión" y "Vista administrativa" desaparecieron: es la misma ficha con más o menos campos según permiso. `workflow_status` se muestra traducido, nunca crudo.
- **Inicio accionable por rol**: los KPI llevan a la lista filtrada que los produce, y el Inicio del admin ("Salud de la plataforma") lista las campañas concretas que les falta flujo o ejecutivos, cada una con su enlace al lugar donde se arregla.

### Migraciones aplicadas

Las 13 migraciones de esta tanda están en `supabase/migrations/` con el mismo timestamp que en remoto:

| Migración | Qué hace |
|---|---|
| `create_lead_uploads_history` | Tabla `lead_uploads` con RLS: historial por archivo. |
| `agent_status_reason_report_attributes` | `is_productive`, `excludes_from_adherence`, `max_seconds` en los estados de agente. |
| `agent_activity_report_campaign_filter` | `p_campaign_id` en el reporte de actividad; la exclusión de adherencia deja de estar escrita a mano. |
| `workflow_draft_published_state` | `status` y `published_at` en `workflows`. |
| `drop_legacy_agent_activity_report_signature` | Elimina la firma de 2 argumentos que volvía ambigua la llamada. |
| `harden_report_function_role_guard` + `harden_call_metrics_report_guard` | Revoca `anon`/`PUBLIC` y hace NULL-segura la guarda de rol de los tres reportes. |
| `lead_uploads_supervisor_insert_and_workflow_draft_default` | Supervisor puede registrar su carga; los flujos nacen en borrador. |
| `get_lead_view_counts` + 2 correcciones | Los seis contadores de la cola en un recorrido, más el catálogo real de estados. |
| `lead_view_counts_status_catalog_and_team_load` | `get_team_agent_load`: carga por ejecutivo agrupada en la base. |
| `drop_orphan_mail_engagement_queue_signature` | Quita la firma huérfana que podía dar PGRST203. |

### Defectos que encontró la auditoría con agentes y quedaron corregidos

1. **Mi agenda estaba rota**: el embed `campaigns(name)` es ambiguo desde `leads` (PGRST201) y el error se descartaba, así que la pantalla mostraba "no tienes agendas" con cualquier dato. Ahora nombra la clave foránea y muestra el error.
2. **Fuga de datos en un reporte**: `get_agent_activity_report` quedó con `EXECUTE` para `anon` y su guarda de rol era NULL-insegura (`NULL not in (…)` es NULL, así que no lanzaba la excepción). Era invocable sin sesión con solo la clave pública. Corregido en las tres funciones de reporte.
3. **Las migraciones no estaban en el repositorio**: se habían aplicado por MCP. Un entorno nuevo quedaba sin la mitad del esquema.
4. **Los flujos nacían publicados** por el valor por omisión de la columna, esquivando justamente la validación que se acababa de construir.
5. **Pérdida silenciosa de datos en la carga masiva**: las filas con un `status` que la base no acepta se descartaban y se reportaban como "duplicadas". Ahora se normalizan a "nuevo" y se avisa.
6. **Contadores de la cola mal calculados**: la primera versión de `get_lead_view_counts` subcontaba por la lógica de tres valores de SQL (13.460 vs 36.173 disponibles reales). Se detectó comparando dos implementaciones independientes y se corrigió.
7. **El desplegable de estado se colapsaba**: el catálogo se calculaba sobre el conjunto ya filtrado, así que tras elegir un estado no había forma de volver a otro.
8. **KPI falsos en dos pantallas**: "Campañas sin flujo/sin ejecutivos" se calculaba sobre las 8 campañas más recientes, y la carga por ejecutivo sobre las primeras 20.000 filas.
9. **Rango de paginación corrido** ("46–95" en vez de "51–100") y orden por columna que solo ordenaba la página cargada.
10. Más: `rejected_count` contaba errores que no eran filas, la vista previa mostraba el estado sin normalizar, el error del refresco del Inicio del agente se silenciaba, y el clic en un icono de ayuda dentro de un `<label>` activaba el control.

### Qué queda pendiente (con nombre y apellido)

| Pendiente | Dónde |
|---|---|
| Formulario de creación incrustado en la lista | `admin/flujos/page.tsx` (plantillas + "crear desde cero") |
| KPI sin drill-down | `reportes/page.tsx` (12), `mail/page.tsx` (6 + 4), `campaign-dashboard-summary.tsx` (5), `dialer-reports.tsx` (5), `live-monitor.tsx` (barra agregada) |
| `MetricCard` local duplicando el del sistema | `reportes/page.tsx`, `mail/page.tsx` |
| Siglas sin definición | "TMO" (mismo concepto que AHT), "UF", "AUX", "SLA", "pipeline" en `reportes/page.tsx`, `supervisor-agent-metrics-table.tsx`, `campaign-dashboard-summary.tsx`, `cti-bar.tsx` |
| `error` de Supabase descartado sin mostrarlo | ~14 páginas de administración y reportes |
| Sin `loading.tsx` | `team`, `reportes`, `mail`, `admin/campanas`, `admin/usuarios` |
| Cortes de tabla sin declarar | `team` (asignación y agendas), `reportes-charts.tsx` (top 10), `vocalcom-upload-form.tsx` |
| Badges del menú sin contador | `dashboard/layout.tsx` no pasa `badges` al `Sidebar` |
| Rutas del Centro de ayuda escritas a mano | `help-center.tsx` (cuarta lista, hoy correcta salvo un grupo extinto) |
| "lead" vs "registro" y "agente" vs "ejecutivo" | `mail`, `team`, `flujos`, `quick-search`, `help-center` |
| Desfase de zona horaria latente | `leads-query.ts` calcula el día en la TZ de Node y la RPC en UTC |
| Deriva de 3 migraciones antiguas | timestamps locales ≠ remotos (anterior a esta tanda) |
| El CTI (1.527 líneas) sin auditar | `cti-bar.tsx` |

### Verificación de cierre

`npx tsc --noEmit` y `npx eslint src` sin errores ni avisos. Las 17 rutas del menú resuelven y las
21 funciones RPC que invoca el código existen con **una sola firma** cada una. Los seis contadores de
la cola se validaron con dos implementaciones independientes (SQL y PostgREST) sobre 61.162 registros
reales, y con RLS activa. Las cuatro funciones nuevas o modificadas rechazan a `anon` y a un token de
usuario sin perfil activo. **`next build` no se pudo ejecutar en el entorno de verificación** (falla
con "Bus error" por límites de memoria del sandbox, no por el código): conviene correrlo local antes
de desplegar.

---

## 11. Relación con los otros documentos

- `docs/arquitectura-navegacion.md` — cómo se llega a cada pantalla (resuelto).
- `docs/auditoria-visual-ui.md` — tokens, tipografía y componentes base (P0/P1 en curso).
- Este documento — qué debe contener y permitir cada pantalla.
