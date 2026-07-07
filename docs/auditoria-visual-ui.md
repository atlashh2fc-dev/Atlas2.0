# Auditoría visual & UI — Atlas 2.0

_Revisión pantalla por pantalla de las 24 rutas del dashboard y los componentes compartidos, con el objetivo de llevar la consistencia a nivel de HubSpot / Five9 / Genesys._

Fecha: 2026-07-07 · Alcance: `src/app/dashboard/**` + `src/components/**`

---

## 1. Veredicto en una línea

El problema **no es el estilo base — es la ausencia de una capa de componentes compartidos.** Los tokens de color y la tipografía están bien definidos y se respetan (0 hex sueltos, 0 colores fuera de paleta). Pero cada pantalla reconstruye botones, tarjetas, inputs, tablas y badges a mano copiando strings de Tailwind. Eso produce: (a) deriva ya visible en ~15–20% de las instancias, (b) mantenimiento frágil, y (c) ausencia de los "sistemas" de UX que distinguen a un CRM/contact-center profesional (toasts, skeletons, data-grid unificado, semántica de estados).

**Puntaje de madurez visual: 6.5/10.** Base tokenizada sólida, ejecución artesanal e inconsistente.

---

## 2. Fortalezas actuales (conservar)

- **Sistema de tokens limpio** (`app/globals.css`): color corporativo, dark mode completo, semántica `success/warning/danger` con `-bg`, `--ring` de foco. Todo consumido vía `@theme inline`.
- **Disciplina de color real**: 0 valores hex hardcodeados en TSX, 0 clases de paleta cruda (`gray-400`, `blue-500`, etc.). Esto es raro y muy valioso.
- **Sidebar por rol bien pensado** (`components/sidebar.tsx`): agrupación por secciones (Operación / Supervisión / Discador / Datos / Administración), indentación jerárquica, indicador activo. Es lo más "producto" del proyecto.
- **`StatCard` existe y es correcto** — solo falta usarlo en todos lados.
- **Títulos de página consistentes**: casi todas las rutas usan `<h1 className="text-xl font-semibold">` (23 de 24). Buen punto de partida para un `PageHeader`.

---

## 3. Hallazgos sistémicos (afectan a todos los perfiles)

| # | Hallazgo | Severidad | Evidencia |
|---|----------|-----------|-----------|
| S1 | **No existe `components/ui/`.** No hay primitivas compartidas (Button, Card, Input, Badge, Table, PageHeader, EmptyState). | 🔴 Alta | Carpeta ausente |
| S2 | **231 bloques de tarjeta inline** vs `StatCard` usado solo en 3 archivos. | 🔴 Alta | `rounded-* border` ×231 |
| S3 | **18 tablas hechas a mano** en 12 archivos, cada una con su `<thead>`, padding y estado vacío propios. | 🔴 Alta | `<thead>` ×18 |
| S4 | **Botón primario reinventado en 5+ variantes de tamaño** (`px-3 py-2 text-sm`, `px-2.5 py-1 text-xs`, `px-4 py-2`, `px-3 py-1.5`). No hay componente `Button`. | 🟠 Media | ~152 instancias de botón inline |
| S5 | **Inputs con foco inconsistente**: 8 archivos usan `focus-visible:ring-2 focus-visible:ring-ring` (correcto), 2 usan `outline-none focus:border-foreground/30` (ad-hoc, ej. `cti-bar.tsx`), 1 input sin estilo de foco. | 🟠 Media | grep foco |
| S6 | **Mezcla de radios de esquina** sin regla: `rounded-lg` ×194, `rounded-xl` ×88, `rounded-full` ×53, `rounded-md` ×10, `rounded-2xl` ×3. Las tarjetas son mayormente `xl` pero algunas caen en `lg`/`2xl`. | 🟠 Media | grep radios |
| S7 | **Padding de celda de tabla no uniforme**: `px-5 py-3` (dominante, ~55) pero también `px-4 py-3`, `px-3 py-2`, `py-1.5`. | 🟡 Baja | grep `<td>` |
| S8 | **Deriva de token: `text-white` hardcodeado** en 5 componentes en vez de `text-primary-foreground` / `text-*-foreground`. | 🟡 Baja | `campanas/[id]`, `call-typification-form`, `workflow-canvas`, `cti-bar` (×2), `agenda-reminder` |
| S9 | **Sin sistema de notificaciones (0 toasts).** No hay feedback consistente tras guardar/asignar/tipificar — patrón esencial en HubSpot/Five9. | 🔴 Alta | 0 `toast`/`sonner` |
| S10 | **Sin skeletons ni estados de carga unificados.** Estados vacíos ad-hoc (mensaje distinto por tabla). | 🟠 Media | 15 empty states one-off |
| S11 | **Badges/pills de estado sin sistema.** ~15 variantes one-off para prioridad, estado de lead, estado de agente. No hay `StatusBadge` semántico. | 🟠 Media | grep `rounded-full ... text-xs` |

---

## 4. Inventario por perfil

### 4.1 Perfil AGENTE

| Ruta | Estado visual | Observaciones |
|------|---------------|---------------|
| `/dashboard` (Inicio) | OK | Header + CTA + `LiveDashboard`. CTA `px-3 py-2 text-sm` — tamaño de botón #1. |
| `/dashboard/leads` (Mis registros) | Bueno | Barra de filtros en `rounded-xl bg-surface p-4`; inputs con foco correcto. Es el patrón a estandarizar. |
| `/dashboard/leads/[id]` (Ficha 360) | ⚠️ Outlier | **Único `<h1>` en `text-lg`** (el resto es `text-xl`). Layout de 3 columnas condicional bien resuelto, pero todas las tarjetas son inline. |
| `/dashboard/agenda` (Mi agenda) | ⚠️ | Tabla 100% hand-built con su propio `<thead>` y empty state ("No tienes agendas pendientes"). Botón "Llamar ahora" en `px-3 py-1.5 text-xs` — **tamaño de botón #2**, distinto al de Inicio. Overdue con `text-danger` inline. |
| `CtiBar` (barra flotante) | ⚠️ | `rounded-2xl` (único en la app). Inputs con foco ad-hoc `focus:border-foreground/30`. `text-white` hardcodeado ×2. Punto rojo de estado con lógica de color inline — candidato #1 a `StatusDot` compartido. |

**Resumen agente:** experiencia funcional pero con 3 tamaños de botón distintos entre Inicio/Agenda/Ficha, un `<h1>` fuera de escala y la CTI con su propio dialecto de estilos.

### 4.2 Perfil SUPERVISOR

| Ruta | Estado visual | Observaciones |
|------|---------------|---------------|
| `/dashboard` (Control de equipo) | Bueno | Usa `StatCard` (5 KPIs en grid) — **el mejor ejemplo de la app.** Secciones "Alertas operativas" / "Top ejecutivos" en `text-sm font-semibold`. |
| `/dashboard/team` (Mi equipo) | ⚠️ | **3 tablas hand-built** en una sola página, cada una repite el markup de cabecera. Mezcla `StatCard` con tarjetas inline. La más pesada de refactorizar. |
| `/dashboard/supervision/monitor` (Monitor en vivo / wallboard) | Revisar | Componente `live-monitor`. Verificar semántica de color de estados de agente (debe ser consistente con la CTI). |
| `/dashboard/supervision/reportes` (Reportes discador) | ⚠️ | `dialer-reports.tsx`: 2 tablas + charts. Padding de celda mezclado. |
| `/dashboard/reportes` (Reportes de gestión) | OK | Charts vía `reportes-charts`. |
| `/dashboard/mail` (Leads mail) | ⚠️ | **3 `<thead>` en una página** (archivo más grande, 616 líneas). Alta duplicación de tabla. |

**Resumen supervisor:** el dashboard de inicio es el patrón de oro (usa `StatCard`); `team` y `mail` son los focos de deuda por multiplicar tablas a mano.

### 4.3 Perfil ADMIN

| Ruta | Estado visual | Observaciones |
|------|---------------|---------------|
| `/dashboard` (Administración) | Bueno | Igual que supervisor: `StatCard` + secciones. Consistente. |
| `/dashboard/admin/campanas` | ⚠️ | Tabla hand-built. |
| `/dashboard/admin/campanas/[id]` | ⚠️ | `text-white` hardcodeado. Tabs/secciones inline. |
| `/dashboard/admin/campanas/[id]/dashboard` | OK | `campaign-dashboard-summary`: 2 tablas + KPIs. |
| `/dashboard/admin/agentes-sip` (Extensiones SIP) | OK | Formulario simple. |
| `/dashboard/admin/estados-agente` | OK | Config de estados — fuente de verdad de la semántica que debería alimentar los badges. |
| `/dashboard/admin/usuarios` | ⚠️ | Tabla hand-built + formularios inline (274 líneas). |
| `/dashboard/admin/flujos` + `/flujos/[id]` | ⚠️ | `workflow-canvas.tsx`: `text-white` hardcodeado; lienzo con estilos propios. |
| `/dashboard/admin/vocalcom` + `/leads/cargar` | ⚠️ | Formularios de carga (`bulk-upload-form`, `vocalcom-upload-form`) con estilos de input duplicados. |
| `/dashboard/admin/ejecutivos-historicos` | ⚠️ | Tabla hand-built. |

**Resumen admin:** es el perfil con más pantallas y más tablas/formularios duplicados. Cada CRUD reinventa tabla + form. Máximo retorno al estandarizar `Table` y `Form/Input`.

---

## 5. Qué hacen HubSpot / Five9 / Genesys que Atlas aún no

1. **Un único data-grid** con orden, filtro, densidad y paginación consistentes en todas las vistas (aquí hay 18 tablas distintas).
2. **Semántica de estado como sistema de diseño**: colores fijos y reutilizables para estado de agente (Disponible/Auxiliar/En llamada/Baño) y resultado de llamada. Crítico para el look de contact-center; hoy vive en lógica inline dispersa.
3. **Feedback inmediato** vía toasts tras cada acción (guardar, asignar, tipificar). Atlas hoy tiene 0.
4. **Estados de carga (skeletons)** en tablas y dashboards en vez de saltos de layout.
5. **Jerarquía y densidad tipográfica** formalizadas (título / subtítulo / meta), aplicadas por un `PageHeader` común.
6. **Shell de página idéntico** entre roles: hoy los 3 dashboards se sienten como apps distintas porque son 3 bloques hand-built.

---

## 6. Plan priorizado

### P0 — Fundaciones (mayor retorno, desbloquea todo)
1. Crear `src/components/ui/`: `Button` (variants primary/secondary/ghost/danger + sizes sm/md), `Card`, `Input`, `Select`, `Badge`/`StatusBadge`, `PageHeader`, `EmptyState`, `Table`/`DataTable`.
2. Añadir un sistema de `Toast` (p. ej. sonner) y montarlo en `dashboard/layout.tsx`.
3. Fijar reglas de radio (contenedores = `xl`, controles = `lg`, pills = `full`) y de foco (`focus-visible:ring-2 ring-ring` universal).

### P1 — Migración de alto impacto
4. Reemplazar las 18 tablas por `<DataTable>`. Empezar por `mail` y `team` (3 tablas c/u).
5. Introducir `StatusBadge`/`StatusDot` alimentado por `estados-agente`; usarlo en CTI, monitor y tablas.
6. Migrar todos los botones primarios/secundarios a `<Button>` (elimina los 3–5 tamaños divergentes).
7. Sustituir los 231 bloques de tarjeta por `<Card>` / `<StatCard>`.

### P2 — Pulido
8. Skeletons de carga en dashboards y tablas.
9. `EmptyState` unificado (icono + texto + CTA) en las 15 vistas vacías.
10. Corregir outliers: `<h1>` de la ficha 360 a `text-xl`; eliminar `text-white` en los 5 componentes; unificar padding de celda a `px-5 py-3`; helper único de fecha `es-CL`.

---

## 7. Estimación de esfuerzo (orientativa)

- **P0** (crear la capa `ui/` + toasts): base para todo lo demás.
- **P1** (migración): el grueso del trabajo, pero mecánico y de bajo riesgo porque los tokens ya existen.
- **P2** (pulido): incremental, se puede hacer pantalla por pantalla.

El riesgo es bajo: como el color y la tipografía ya están tokenizados, la migración es sobre todo **encapsular markup repetido en componentes**, no rediseñar. El salto visual percibido, sin embargo, es grande.
