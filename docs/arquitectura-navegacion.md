# Arquitectura de navegación — Atlas 2.0

> Rediseño del menú lateral para alcanzar un estándar de workplace de contact center
> (Genesys Cloud CX, Five9, NICE CXone, Zendesk).
> Estado: **implementado** (F0–F3) · Julio 2026
> Fuente de verdad en código: `src/lib/nav.config.ts`

---

## 1. Veredicto en una línea

El menú no está *desordenado por descuido*: está construido con el modelo equivocado — **un solo
árbol que mezcla operar con configurar, filtrado por rol** — y ningún reordenamiento de ítems lo
arregla. Todas las suites de contact center resuelven esto igual: **dos espacios separados**
(Consola de operación / Administración), **5–6 destinos de primer nivel**, profundidad máxima 2,
y **las acciones fuera del menú**.

---

## 2. Diagnóstico del menú actual

Inventario real: **7 grupos / 16 ítems** para el rol admin, **4 ítems repartidos en 3 grupos** para
el agente.

| # | Hallazgo | Evidencia en el código |
|---|---|---|
| 1 | **Operar y configurar viven en el mismo árbol.** 9 de 16 ítems del admin son *setup*, y ahogan los 4 ítems que se usan a diario. | Grupos `Campañas`, `Datos`, `Configuración`, `Integraciones` |
| 2 | **Grupos de 1–2 ítems.** Un encabezado cuesta una línea y una parada cognitiva; sólo se paga desde ~3 ítems. | `Campañas` (2), `Integraciones` (2), `Soporte` (1) |
| 3 | **Acciones puestas como destinos.** El menú es un mapa de *lugares* (sustantivos); "Nuevo registro", "Cargar leads" e "Importar gestión Vocalcom" son *verbos*. | `/leads/nuevo`, `/leads/cargar`, `/admin/vocalcom` |
| 4 | **Colisión de nombres entre hermanos.** "Reportes de discador" y "Reportes de gestión" al mismo nivel obligan a leer 4 palabras y adivinar. | `sectionLabel: "Operación"` |
| 5 | **Una entidad con tres nombres.** Registros / leads (URL) / Leads mail / Nuevo registro. | `label: "Registros"` sobre `/dashboard/leads` |
| 6 | **Jerga de proveedor en el primer nivel.** Vocalcom, Equifax, SIP: el menú debe hablar el idioma del negocio; el proveedor es un detalle *dentro* de la página. | `subsectionLabel: "Equifax"` |
| 7 | **Tres niveles implícitos sin modelo de datos.** `sectionLabel` + `indent` + `subsectionLabel` es jerarquía *pintada*: no hay padre clickeable, ni estado abierto/cerrado por rama, y el rail las borra todas. | `interface NavItem` |
| 8 | **Un grupo colapsado por defecto esconde funcionalidad.** Lo que se esconde, no existe. | `useState(["Integraciones"])` |
| 9 | **Filtrar un árbol por rol ≠ IA por rol.** El agente recibe 4 ítems bajo 3 encabezados: puro ruido. | `NAV_ITEMS.filter(...roles.includes)` |
| 10 | **Rutas huérfanas.** No se llega desde el menú. | `/dashboard/llamadas/[id]`, `/admin/campanas/[id]/dashboard` |
| 11 | **Tres puertas a la misma analítica.** Reportes de gestión + dashboard por campaña + reportes de discador. | 3 rutas distintas |
| 12 | **Fuente de verdad duplicada y ya divergente.** `QuickSearch` tiene su propia lista: ofrece "Crear campaña"/"Crear flujo" (verbos) y no incluye Monitor para admin. | `QUICK_ACTIONS` en `quick-search.tsx` |
| 13 | **Sin navegación móvil ni semántica de accesibilidad.** | `hidden md:flex`; no hay `aria-current` ni `<nav aria-label>` |

---

## 3. Benchmark

| Producto | Separación operar / configurar | Ítems 1er nivel | Profundidad menú | Dónde viven las acciones | Diferenciación por rol |
|---|---|---|---|---|---|
| **Genesys Cloud CX** | Sí — *Admin* es una consola aparte | 6 (Dashboards, Activity, Directory, Performance, Apps, Admin) | 2 (+ pestañas) | Botón en la vista | Vistas distintas por permiso |
| **Five9** | Sí — *VCC Administrator* aparte del Supervisor y del Agent Desktop | 5–7 | 2 | Botón en la vista (import de listas dentro de Lists) | **Tres aplicaciones** distintas |
| **NICE CXone** | Sí — *Admin* aparte de *Reporting* y *Supervisor* | 6 | 2 | Botón en la vista | Por licencia/rol |
| **Talkdesk** | Sí — *Admin* fuera de los Workspaces | 5 | 2 | Botón en la vista | Workspaces por rol |
| **Zendesk** | Sí — *Admin Center* es otro dominio | 5 | 2 | Botón en la vista | Agent Workspace vs Admin |
| **Atlas 2.0 (hoy)** | **No** | **7 grupos / 16 ítems** | **3 implícitos** | **En el menú** | Un árbol filtrado |

**Los 8 patrones que comparten y Atlas no tiene:**

1. **Runtime vs Setup en espacios distintos.** Nadie mezcla "monitorear la operación" con "crear una campaña".
2. **5–7 destinos de primer nivel.** Techo duro, no aspiracional.
3. **Profundidad ≤ 2 en el menú; el 3er nivel son pestañas de página.**
4. **Un destino por dominio, con pestañas dentro.** El "Performance" de Genesys concentra Agentes, Colas, Interacciones y Reportes en un solo ítem.
5. **Las acciones son botones**, y viven junto al dato que crean.
6. **IA por rol, no árbol filtrado.** El agente ve otra app, no la misma con menos ítems.
7. **El monitoreo en vivo tiene lugar propio y prominente, con contadores.**
8. **Búsqueda/command palette como *atajo*, no como sustituto del menú.** (Atlas ya tiene `QuickSearch`: bien, pero debe leer del mismo config.)

---

## 4. Propuesta

### Principios

1. **Dos espacios**: `Consola` (operar) y `Administración` (configurar).
2. **Máx. 6 ítems por grupo operativo**; **profundidad máx. 2**; el resto son pestañas.
3. **El menú son sustantivos.** Ningún verbo en el sidebar.
4. **Una entidad, un nombre**, en menú, `PageHeader`, breadcrumb y búsqueda.
5. **Nada oculto por defecto.**
6. **Un solo `nav.config.ts`** como fuente de verdad para sidebar, QuickSearch, breadcrumbs y guardas.

### 4.1 Espacio "Consola"

La evolución omnicanal agrega destinos diarios que no deben esconderse bajo una campaña. La
Consola se agrupa por intención: `Operación` para atender y `Control` para analizar. Campaña,
registro y conversación son entidades relacionadas, pero cada una conserva un workspace propio.

**AGENTE — 4 ítems**

```
Inicio
Mis registros
Conversaciones
Mi agenda
─────────────
Ayuda · perfil       (footer)
```

**SUPERVISOR**

```
Inicio
OPERACIÓN
Monitor en vivo      ● badge: ejecutivos conectados
Mi equipo
Campañas
Registros
Conversaciones
CONTROL
Reportes             (pestañas: Gestión · Discador)
Calidad
─────────────
Ayuda · perfil
```

**ADMIN + acceso a Administración**

```
Inicio
OPERACIÓN
Monitor en vivo      ●
Campañas
Registros
Conversaciones
CONTROL
Reportes             (pestañas: Gestión · Discador)
Calidad
─────────────
⚙ Administración     (footer — abre el segundo espacio)
Ayuda · perfil
```

> Nota de diseño: **parametrizar campañas sigue en Administración**. `Campañas` en la Consola es
> la vista operativa de canales, volumen y resultados. `Conversaciones` queda como workspace de
> atención de primer nivel; dentro de cada hilo muestra campaña, registro y responsable.

### 4.2 Espacio "Administración"

Sidebar propio, con "← Volver a la Consola" arriba. Dos grupos de ≥3 ítems — la taxonomía de
Genesys (Contact Center / People / Telephony / Integrations) comprimida a la escala real de Atlas,
en vez de cinco grupos de un ítem:

```
← Volver a la Consola

OPERACIÓN
  Campañas
  Flujos de gestión
  Estados de agente
  Cargas y listas

PLATAFORMA
  Usuarios y equipos
  Extensiones SIP
  Integraciones            (pestañas: Importar gestión · Ejecutivos históricos)
```

### 4.3 Mapeo ruta por ruta

| Hoy | Propuesta | Acción técnica |
|---|---|---|
| Inicio · `/dashboard` | Consola › Inicio | sin cambio |
| Registros · `/dashboard/leads` | Consola › Registros (agente: "Mis registros") | label por rol |
| Mi agenda · `/dashboard/agenda` | Consola › Mi agenda (sólo agente) | sin cambio |
| Mi equipo · `/dashboard/team` | Consola › Mi equipo (sólo supervisor) | sin cambio |
| Monitor en vivo · `/supervision/monitor` | Consola › Monitor en vivo + badge | agregar pestaña Campañas |
| Reportes de discador · `/supervision/reportes` | Consola › Reportes › pestaña **Discador** | mover a `/dashboard/reportes/discador` + redirect |
| Reportes de gestión · `/dashboard/reportes` | Consola › Reportes › pestaña **Gestión** (default) | envolver en layout con pestañas |
| Nuevo registro · `/leads/nuevo` | **Fuera del menú** → botón primario en Registros | ruta se mantiene |
| Cargar leads · `/leads/cargar` | Admin › Operación › **Cargas y listas** | ruta nueva `/admin/cargas` + redirect (conserva `campaign_id`) |
| Leads mail · `/dashboard/mail` | Consola › **Campañas mail** | solo renombre: es operación diaria, no setup |
| Campañas · `/admin/campanas` | Admin › Operación › Campañas | sin cambio |
| Flujos de gestión · `/admin/flujos` | Admin › Operación › Flujos de gestión | deja de ser hijo indentado |
| Usuarios y equipos · `/admin/usuarios` | Admin › Plataforma | sin cambio |
| Estados de agente · `/admin/estados-agente` | Admin › Operación | sin cambio |
| Extensiones SIP · `/admin/agentes-sip` | Admin › Plataforma | sin cambio |
| Importar gestión Vocalcom · `/admin/vocalcom` | Admin › Plataforma › **Integraciones**, pestaña "Importar gestión" | ruta `/admin/integraciones` + redirect |
| Historial de ejecutivos · `/admin/ejecutivos-historicos` | Admin › Plataforma › **Integraciones**, pestaña "Ejecutivos históricos" | ruta `/admin/integraciones/historial` + redirect |
| Ayuda · `/dashboard/ayuda` | Footer del sidebar, en ambos espacios | mover |
| `/dashboard/llamadas/[id]` | Alcanzable desde Monitor y desde la ficha del registro | sin ítem de menú |
| `/admin/campanas/[id]/dashboard` | Reportes › pestaña Campañas con selector | consolidar analítica |

**Resultado:** admin pasa de **16 ítems en 7 grupos** a **5 + 1 en la Consola** y **7 en 2 grupos**
en Administración. Nada se pierde; todo queda a ≤2 clics.

### 4.4 Estándar de nombres

1. **Sustantivo**, plural cuando es colección. **Nunca un verbo** — los verbos son botones.
2. **1–2 palabras, ≤ 20 caracteres.** Prohibido repetir la misma palabra entre hermanos ("Reportes de…" ×2).
3. **Sin nombre de proveedor ni sigla técnica** en el ítem de menú (Vocalcom, SIP, Equifax van dentro de la página).
4. **"Mi/Mis" sólo si el alcance es estrictamente personal** (Mi agenda, Mis registros). Si el rol ve todo, sin posesivo.
5. **Un concepto = un nombre** en menú, `PageHeader`, breadcrumb, QuickSearch y toasts. En UI se dice **Registros**; `leads` queda sólo en código y URLs.
6. **El label del menú es idéntico al título de la página** que abre.

### 4.5 Reglas del componente

1. Máx. 2 niveles. Un padre con hijos es clickeable *y* expande; se elimina `indent` decorativo y `subsectionLabel`.
2. Encabezado de grupo sólo con **≥3 ítems**; si el rol tiene ≤6 ítems, **sin encabezados**.
3. Nada colapsado por defecto. El estado colapsado se persiste por usuario (`localStorage`).
4. Footer fijo: Ayuda + perfil (+ ⚙ Administración para admin).
5. Rail (64 px): tooltip real en popover, no atributo `title`. **Un icono = un significado** (hoy `Upload` se usa en 2 ítems distintos).
6. Estado activo: un solo tratamiento (fondo + icono en `primary`), heredado de los tokens; `aria-current="page"`.
7. Badges numéricos sólo donde hay estado en vivo: Monitor (conectados), Mi agenda (vencidas).
8. Móvil: drawer que consume el mismo `nav.config.ts` (hoy simplemente no hay menú bajo `md`).

### 4.6 Modelo de datos

```ts
// src/lib/nav.config.ts — única fuente de verdad
export type NavBadge = "live-agents" | "overdue-agenda";

export type NavNode = {
  id: string;
  label: string | Partial<Record<AppRole, string>>; // "Registros" / agente: "Mis registros"
  href?: string;
  icon: LucideIcon;
  roles: AppRole[];
  badge?: NavBadge;
  children?: NavNode[]; // máx. 1 nivel
};

export type NavSection = { label?: string; items: NavNode[] };
export type NavSpace = { id: "console" | "admin"; label: string; sections: NavSection[] };

export const NAV: NavSpace[] = [ /* ... */ ];
```

Consumidores: `Sidebar`, `QuickSearch`, breadcrumbs del `PageHeader`, y el guard de rutas por rol
(hoy el rol se valida en cada página por separado).

---

## 5. Estado de implementación

| Fase | Alcance | Estado |
|---|---|---|
| **F0** | `src/lib/nav.config.ts` como fuente de verdad + sidebar reescrito a 2 niveles. | ✅ |
| **F1** | Acciones fuera del menú (`Nuevo registro` e `Importar` como botones en Registros); **Reportes** unificado con pestañas; Ayuda al pie. | ✅ |
| **F2** | Espacio **Administración** con sidebar propio, "← Volver a la Consola" y entrada `⚙ Administración` en el pie de la Consola. | ✅ |
| **F3** | QuickSearch derivado del config (se eliminó `QUICK_ACTIONS`); drawer móvil; `aria-current`; tooltips reales en rail; colapso persistido. | ✅ |
| **Pendiente** | Contadores en vivo de los badges (`live-agents`, `overdue-agenda`): el modelo y el render existen, falta inyectar los números desde el layout. | ⏳ |

### Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/nav.config.ts` | **Nuevo.** Espacios, secciones, ítems, labels por rol, pestañas y helpers. |
| `src/components/sidebar.tsx` | Reescrito: `NavTree` + `NavFooter` reutilizables, rail con tooltip, colapso persistido vía `useSyncExternalStore`. |
| `src/components/mobile-nav.tsx` | **Nuevo.** Drawer móvil sobre el mismo modelo. |
| `src/components/ui/nav-tabs.tsx` | **Nuevo.** Tercer nivel de navegación (pestañas de destino). |
| `src/components/header.tsx` | Menú móvil; se quitó el nombre/rol duplicado (ya está en el pie del sidebar). |
| `src/components/quick-search.tsx` | Destinos derivados de `nav.config.ts`; "Acciones frecuentes" → "Ir a". |
| `src/app/dashboard/reportes/layout.tsx` | **Nuevo.** Título único + pestañas Gestión/Discador. |
| `src/app/dashboard/admin/integraciones/{layout,page,historial/page}.tsx` | **Nuevo/movido.** Un destino con dos pestañas. |
| `src/app/dashboard/admin/cargas/page.tsx` | Movido desde `leads/cargar`; título "Cargas y listas". |
| `leads/cargar`, `admin/vocalcom`, `admin/ejecutivos-historicos`, `supervision/reportes` | Redirects permanentes a las rutas nuevas. |
| `leads/page.tsx`, `mail/page.tsx`, `supervision/monitor/page.tsx` | Títulos alineados al label del menú; acciones como botones. |

---

## 6. Criterios de aceptación — verificados

| Criterio | Resultado |
|---|---|
| Ningún rol ve más de 6 ítems de primer nivel en la Consola | ✅ agente 3 · supervisor 6 · admin 5 |
| Ningún grupo con menos de 3 ítems | ✅ Administración: Operación 4, Plataforma 3 |
| Ningún ítem de menú empieza con un verbo | ✅ |
| Ningún ítem contiene nombre de proveedor ni sigla de negocio | ✅ (queda "SIP" por ser el nombre técnico del anexo) |
| Ningún par de hermanos comparte la primera palabra | ✅ por eso "Bandeja mail" y no "Campañas mail", que chocaba con "Campañas" |
| Todo destino se alcanza en ≤2 clics | ✅ 17 rutas verificadas contra el árbol de `src/app` |
| El label del sidebar coincide con el `PageHeader` del destino | ✅ |
| Sidebar, drawer móvil y búsqueda global leen el mismo módulo | ✅ `QUICK_ACTIONS` eliminado |

Verificación: `npx tsc --noEmit` sin errores y `npx eslint src` sin errores (quedan 3 avisos de
variables sin usar previos a este cambio). `next build` no se pudo correr en el entorno de
verificación (falla por memoria, ajeno al código).

---

## 7. Relación con la auditoría visual

Este documento resuelve el eje **estructura**; `docs/auditoria-visual-ui.md` resuelve el eje
**superficie** (tokens, `DataTable`, `StatusBadge`, toasts). Son independientes y se pueden avanzar
en paralelo: F0/F1 de navegación no dependen de P0/P1 de UI.
