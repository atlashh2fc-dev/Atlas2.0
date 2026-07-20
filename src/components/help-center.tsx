"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  FileUp,
  History,
  LineChart,
  MailCheck,
  Megaphone,
  MonitorPlay,
  PhoneCall,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  UsersRound,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/types";

type TrainingStep = {
  title: string;
  do: string;
  verify: string;
  warning?: string;
};

type Guide = {
  id: string;
  title: string;
  description: string;
  href: string;
  action: string;
  icon: LucideIcon;
  roles: AppRole[];
  tags: string[];
  route: string[];
  before: string[];
  outcome: string;
  screenTitle: string;
  screenControls: string[];
  steps: TrainingStep[];
};

const GUIDES: Guide[] = [
  {
    id: "lead",
    title: "Gestionar un lead paso a paso",
    description: "Encuentra un registro, completa el flujo obligatorio y deja el próximo contacto trazable.",
    href: "/dashboard/leads",
    action: "Abrir Registros",
    icon: Users,
    roles: ["agente", "supervisor", "admin"],
    tags: ["buscar lead", "rut", "teléfono", "gestión", "tipificación", "llamada"],
    route: ["Operación", "Registros"],
    before: ["Ten a mano RUT, teléfono o nombre del contacto.", "Confirma que conoces el objetivo de la campaña antes de registrar el resultado."],
    outcome: "El registro queda con resultado, responsable y seguimiento cuando corresponde.",
    screenTitle: "Registros",
    screenControls: ["Buscador de registros", "Filtros de estado y campaña", "Fila del lead para abrir su ficha"],
    steps: [
      { title: "Ubica el registro", do: "En la barra de búsqueda escribe RUT, teléfono o parte del nombre. También puedes usar ⌘/Ctrl + K desde cualquier pantalla y elegir el resultado.", verify: "Ves una fila que coincide con el contacto y su campaña.", warning: "No gestiones un contacto homónimo sin validar al menos RUT o teléfono." },
      { title: "Abre la ficha", do: "Haz clic sobre el nombre del lead o en la acción para abrirlo. Revisa la campaña y el historial antes de iniciar el contacto.", verify: "La ficha muestra datos del contacto, campaña, historial y el bloque de flujo." },
      { title: "Completa el flujo", do: "Responde cada paso obligatorio en el orden que aparece. Si una respuesta abre alternativas, selecciona la que refleje la conversación real.", verify: "No quedan campos requeridos marcados y puedes guardar la gestión." },
      { title: "Cierra o agenda", do: "Selecciona el resultado final. Si queda algo pendiente, define fecha y hora de próximo contacto antes de guardar.", verify: "El historial muestra tu gestión y el lead aparece gestionado o con seguimiento futuro." },
    ],
  },
  {
    id: "agenda",
    title: "Resolver la agenda de hoy",
    description: "Atiende primero vencidos y compromisos del día sin perder seguimientos.",
    href: "/dashboard/agenda",
    action: "Abrir mi agenda",
    icon: CalendarClock,
    roles: ["agente"],
    tags: ["agenda", "vencido", "seguimiento", "recordatorio", "hoy"],
    route: ["Operación", "Mi agenda"],
    before: ["Empieza por los seguimientos vencidos.", "Reserva tiempo para registrar el resultado de cada contacto, no solo para llamar."],
    outcome: "Los compromisos vencidos quedan resueltos o reprogramados con una nueva fecha real.",
    screenTitle: "Mi agenda",
    screenControls: ["Bloque Vencidos", "Bloque Para hoy", "Enlace Abrir registro"],
    steps: [
      { title: "Prioriza", do: "En la columna de agenda revisa primero Vencidos y después Para hoy. Abre un registro a la vez.", verify: "El lead que abriste tiene una fecha de próximo contacto asociada." },
      { title: "Gestiona el compromiso", do: "Realiza la gestión desde la ficha del lead y registra el resultado en el flujo de la campaña.", verify: "La nueva gestión aparece en el historial del registro." },
      { title: "Reprograma solo si corresponde", do: "Si el cliente pide otro contacto, selecciona una fecha y hora específicas; si se cerró el caso, no crees un seguimiento innecesario.", verify: "El registro desaparece de vencidos o queda en la fecha nueva." },
    ],
  },
  {
    id: "team",
    title: "Acompañar a mi equipo",
    description: "Identifica carga pendiente y ayuda a destrabar registros de los ejecutivos a tu cargo.",
    href: "/dashboard/team",
    action: "Abrir mi equipo",
    icon: UsersRound,
    roles: ["supervisor"],
    tags: ["equipo", "ejecutivos", "supervisor", "carga", "reasignar"],
    route: ["Operación", "Mi equipo"],
    before: ["Debes estar asociado a un equipo.", "Define si el objetivo es acompañar, reasignar o revisar un caso puntual."],
    outcome: "Tienes visibilidad de la carga del equipo y un plan de seguimiento para los casos críticos.",
    screenTitle: "Mi equipo",
    screenControls: ["Listado de ejecutivos", "Indicadores de pendientes", "Acceso a registros del equipo"],
    steps: [
      { title: "Revisa carga", do: "Ubica ejecutivos con pendientes, sin gestión reciente o seguimientos vencidos.", verify: "Puedes identificar quién requiere apoyo antes de intervenir." },
      { title: "Entra al caso", do: "Abre el registro desde la vista del equipo y revisa historial, campaña y próximo contacto.", verify: "La decisión se basa en datos de la ficha y no solo en el total de pendientes." },
      { title: "Define la acción", do: "Coordina con el ejecutivo o reasigna solo cuando la operación lo exige y tus permisos lo permiten.", verify: "El responsable y el seguimiento quedan claros para el equipo." },
    ],
  },
  {
    id: "monitor",
    title: "Monitorear la operación en vivo",
    description: "Controla disponibilidad, pausas y actividad antes de tomar decisiones operativas.",
    href: "/dashboard/supervision/monitor",
    action: "Abrir monitor",
    icon: MonitorPlay,
    roles: ["supervisor", "admin"],
    tags: ["monitor", "en vivo", "pausa", "disponibilidad", "discador"],
    route: ["Operación", "Monitor en vivo"],
    before: ["Confirma el período operativo que estás supervisando.", "Usa esta vista junto con reportes; el monitor muestra el estado actual, no toda la historia."],
    outcome: "Detectas oportunamente baja disponibilidad, pausas prolongadas o capacidad sin utilizar.",
    screenTitle: "Monitor en vivo",
    screenControls: ["Indicadores de disponibilidad", "Estado por ejecutivo", "Actividad reciente"],
    steps: [
      { title: "Lee los indicadores", do: "Revisa disponibilidad, estados y ejecutivos activos antes de concluir que hay un problema.", verify: "Distingues entre ejecutivos disponibles, en pausa y fuera de operación." },
      { title: "Aísla el desvío", do: "Ubica el ejecutivo o grupo con estado prolongado y contrástalo con la carga que tiene asignada.", verify: "Puedes explicar qué ocurre y con quién antes de escalar." },
      { title: "Actúa y registra", do: "Contacta al responsable, corrige la configuración si eres administrador o deja el seguimiento operativo acordado.", verify: "El desvío tiene dueño, acción y hora de revisión." },
    ],
  },
  {
    id: "reports",
    title: "Leer reportes de gestión",
    description: "Convierte contactabilidad y tipificaciones en decisiones concretas para el equipo.",
    href: "/dashboard/reportes",
    action: "Ver reportes de gestión",
    icon: BarChart3,
    roles: ["supervisor", "admin"],
    tags: ["reporte", "contactabilidad", "kpi", "tipificación", "desempeño"],
    route: ["Operación", "Reportes de gestión"],
    before: ["Define el rango de fechas y la pregunta que quieres responder.", "No compares períodos con distinta duración sin normalizar el análisis."],
    outcome: "Sales con una acción concreta: coaching, priorización, ajuste de base o seguimiento de campaña.",
    screenTitle: "Reportes de gestión",
    screenControls: ["Selector de período", "Indicadores", "Desglose por ejecutivo, campaña o resultado"],
    steps: [
      { title: "Selecciona período", do: "Elige fechas comparables y aplica los filtros necesarios antes de leer los indicadores.", verify: "El encabezado y los gráficos reflejan exactamente el período elegido." },
      { title: "Cruza métricas", do: "Mira volumen gestionado, contactabilidad y resultados; no uses un indicador aislado para evaluar desempeño.", verify: "Puedes detectar dónde se concentra el desvío: campaña, ejecutivo o resultado." },
      { title: "Baja a una decisión", do: "Define una acción verificable y vuelve a medir en el siguiente corte.", verify: "La decisión tiene responsable y métrica para confirmar si funcionó." },
    ],
  },
  {
    id: "dialer-reports",
    title: "Analizar el discador",
    description: "Revisa servicio, abandono, ocupación y AHT sin confundir capacidad con gestión.",
    href: "/dashboard/supervision/reportes",
    action: "Ver reportes de discador",
    icon: LineChart,
    roles: ["supervisor", "admin"],
    tags: ["discador", "aht", "abandono", "ocupación", "llamadas"],
    route: ["Operación", "Reportes de discador"],
    before: ["Selecciona un período cerrado o un corte horario claro.", "Revisa primero si existía capacidad de agentes disponible."],
    outcome: "Puedes diferenciar un problema de base, de dotación o de configuración del discador.",
    screenTitle: "Reportes de discador",
    screenControls: ["Rango de fechas", "Nivel de servicio", "Abandono, AHT y ocupación"],
    steps: [
      { title: "Fija el corte", do: "Selecciona rango de fechas y, si aplica, la campaña que quieres revisar.", verify: "Todos los indicadores se actualizan para el mismo corte." },
      { title: "Interpreta en conjunto", do: "Compara abandono y nivel de servicio con disponibilidad y ocupación; revisa AHT como señal de complejidad, no como sentencia aislada.", verify: "Tienes una hipótesis respaldada por más de una métrica." },
      { title: "Evita cambios a ciegas", do: "Antes de cambiar ratios o pausas, confirma el efecto esperado con el responsable de operación.", verify: "La configuración no se modifica solo por una variación puntual." },
    ],
  },
  {
    id: "campaign",
    title: "Crear y dejar lista una campaña",
    description: "Construye el ecosistema completo: flujo, personas, base y discador antes de activar.",
    href: "/dashboard/admin/campanas",
    action: "Ir a campañas",
    icon: Megaphone,
    roles: ["admin"],
    tags: ["campaña", "crear campaña", "activar", "configurar", "discador"],
    route: ["Discador", "Campañas", "Crear campaña"],
    before: ["Define nombre, objetivo y responsables de la campaña.", "Ten el flujo y la base preparados o identifica quién los proveerá."],
    outcome: "La campaña queda lista para operar, sin pendientes de flujo, ejecutivos, base ni discador.",
    screenTitle: "Campañas",
    screenControls: ["Tabla de campañas", "Bloque Crear campaña", "Botón Crear y configurar"],
    steps: [
      { title: "Crea la ficha", do: "En Crear campaña escribe Nombre de la campaña, agrega descripción si aporta contexto y pulsa Crear y configurar.", verify: "Se abre la ficha de la campaña recién creada." },
      { title: "Asigna o crea el flujo", do: "En Flujo productivo abre el selector. Si no existe, usa Crear un flujo desde cero; al guardarlo volverás a esta campaña con el flujo conectado.", verify: "El selector muestra el nombre del flujo y al guardar queda asignado." },
      { title: "Completa el checklist", do: "Asigna ejecutivos, carga leads y configura cola/modo de discado desde los bloques de la ficha.", verify: "Los pendientes de configuración pasan a Configurado." },
      { title: "Activa con evidencia", do: "Activa solo después de validar que el flujo, la base, los ejecutivos y el discador estén listos.", verify: "La campaña aparece Activa y el checklist no tiene bloqueadores." },
    ],
  },
  {
    id: "workflow",
    title: "Crear un flujo conectado a campaña",
    description: "Diseña el guion, sus decisiones y déjalo vinculado a la campaña correcta.",
    href: "/dashboard/admin/flujos",
    action: "Ir a flujos",
    icon: Workflow,
    roles: ["admin"],
    tags: ["flujo", "script", "plantilla", "pregunta", "campaña"],
    route: ["Administración", "Flujos", "Crear flujo desde cero"],
    before: ["Define las preguntas, alternativas y resultados que el ejecutivo debe registrar.", "Identifica la campaña que recibirá el flujo."],
    outcome: "El flujo queda activo, con pasos obligatorios y conectado a la campaña elegida.",
    screenTitle: "Flujos de gestión",
    screenControls: ["Tarjeta Crear flujo desde cero", "Nombre del flujo", "Selector Conectar a una campaña", "Crear y configurar flujo"],
    steps: [
      { title: "Nómbralo", do: "En Crear flujo desde cero escribe un nombre reconocible y una descripción breve. Evita nombres genéricos como “nuevo flujo”.", verify: "El nombre permite identificar campaña y objetivo sin abrir el editor." },
      { title: "Conéctalo", do: "En Conectar a una campaña selecciona la campaña objetivo. Si llegaste desde una campaña, esa relación ya aparece informada.", verify: "Ves la campaña seleccionada antes de crear el flujo." },
      { title: "Abre el editor", do: "Pulsa Crear y configurar flujo. Agrega pasos, define respuestas permitidas, obligatoriedad y conexiones entre alternativas.", verify: "El lienzo muestra un paso inicial y los nodos que agregaste." },
      { title: "Vuelve a la campaña", do: "Guarda el flujo y regresa a la campaña para revisar que el selector Flujo productivo lo muestre asignado.", verify: "La ficha de la campaña informa que el flujo está configurado." },
    ],
  },
  {
    id: "upload",
    title: "Cargar una base de leads",
    description: "Importa una base, valida columnas y asóciala a la campaña correcta.",
    href: "/dashboard/leads/cargar",
    action: "Cargar leads",
    icon: FileUp,
    roles: ["admin"],
    tags: ["excel", "csv", "importar", "base", "leads"],
    route: ["Datos", "Cargar leads"],
    before: ["Revisa que el archivo no tenga datos duplicados o columnas mezcladas.", "Confirma la campaña destino antes de subirlo."],
    outcome: "La base queda asociada a la campaña y puedes comprobar el total cargado.",
    screenTitle: "Cargar leads",
    screenControls: ["Selector de archivo", "Mapeo de columnas", "Selector de campaña", "Resumen de carga"],
    steps: [
      { title: "Selecciona el archivo", do: "Carga el archivo de la base y espera a que el sistema detecte encabezados y filas.", verify: "Ves la previsualización o el resumen de columnas detectadas." },
      { title: "Valida campos", do: "Confirma que nombre, RUT, teléfono, correo y campos operativos estén mapeados al destino correcto.", verify: "Ninguna columna relevante queda asignada a un campo equivocado." },
      { title: "Elige la campaña", do: "En el selector Campaña elige la campaña que recibirá los registros y confirma la carga.", verify: "El resumen final indica cuántos registros se importaron y a qué campaña." },
      { title: "Controla el resultado", do: "Abre la ficha de la campaña o Registros y contrasta el total esperado con el total disponible.", verify: "Puedes explicar diferencias por duplicados, filas inválidas o filtros." },
    ],
  },
  {
    id: "users",
    title: "Administrar usuarios, roles y equipos",
    description: "Crea accesos correctos y evita entregar permisos operativos que no corresponden.",
    href: "/dashboard/admin/usuarios",
    action: "Ir a usuarios",
    icon: ShieldCheck,
    roles: ["admin"],
    tags: ["usuario", "rol", "equipo", "supervisor", "agente"],
    route: ["Administración", "Usuarios"],
    before: ["Confirma nombre, correo, rol y equipo con el responsable del área.", "Define quién supervisa al equipo antes de crear agentes."],
    outcome: "Cada persona ve solo las funciones que necesita y queda trazable en su equipo.",
    screenTitle: "Usuarios",
    screenControls: ["Crear usuario", "Selector de rol", "Selector de equipo", "Listado de cuentas activas"],
    steps: [
      { title: "Crea la cuenta", do: "Ingresa los datos solicitados y verifica el correo antes de guardar.", verify: "La cuenta aparece en el listado con el nombre correcto." },
      { title: "Selecciona el rol", do: "Elige Agente para gestión diaria, Supervisor para control de equipo o Administrador para configuración global.", verify: "El rol visible corresponde a las funciones que esa persona realmente realizará." },
      { title: "Asocia el equipo", do: "Para agentes y supervisores, selecciona el equipo correcto y confirma el responsable de supervisión.", verify: "El usuario aparece en el equipo esperado y puede acceder a su operación." },
      { title: "Valida antes de operar", do: "Confirma estado activo y, para agentes de discador, continúa con la extensión SIP antes de asignarlo a campaña.", verify: "No quedan cuentas activas sin rol, equipo o telefonía cuando aplique." },
    ],
  },
  {
    id: "phone",
    title: "Configurar telefonía y estados",
    description: "Provisiona extensiones SIP y define pausas operativas para que el discador tenga capacidad real.",
    href: "/dashboard/admin/agentes-sip",
    action: "Configurar telefonía",
    icon: PhoneCall,
    roles: ["admin"],
    tags: ["sip", "extensión", "telefonía", "pausa", "estado agente"],
    route: ["Discador", "Extensiones SIP"],
    before: ["El agente debe existir, estar activo y asociado a su equipo.", "Ten los datos de extensión entregados por telefonía."],
    outcome: "El agente puede quedar disponible para la cola y sus pausas quedan identificables.",
    screenTitle: "Extensiones SIP",
    screenControls: ["Crear o editar extensión", "Agente asociado", "Credenciales/estado de extensión", "Estados de agente"],
    steps: [
      { title: "Provisiona la extensión", do: "En Extensiones SIP crea o edita la extensión y asóciala al ejecutivo correcto.", verify: "El agente aparece vinculado a una extensión activa." },
      { title: "Configura pausas", do: "Desde Discador > Estados de agente define las razones de pausa disponibles y sus nombres operativos.", verify: "Los estados permiten distinguir motivos y no son etiquetas ambiguas." },
      { title: "Valida disponibilidad", do: "Confirma con el agente que puede iniciar sesión y cambiar entre disponible y pausas autorizadas.", verify: "El monitor en vivo refleja el estado esperado del ejecutivo." },
    ],
  },
  {
    id: "vocalcom",
    title: "Importar gestión desde Vocalcom",
    description: "Incorpora resultados históricos con control previo, sin contaminar la operación activa.",
    href: "/dashboard/admin/vocalcom",
    action: "Abrir importación Vocalcom",
    icon: History,
    roles: ["admin"],
    tags: ["vocalcom", "histórico", "importar gestión", "resultado"],
    route: ["Datos", "Cargar Vocalcom"],
    before: ["Confirma período, origen y formato del archivo exportado.", "Evita cargar dos veces el mismo corte."],
    outcome: "Los resultados históricos quedan revisados y disponibles para análisis sin duplicaciones conocidas.",
    screenTitle: "Cargar Vocalcom",
    screenControls: ["Archivo de origen", "Resumen de detección", "Validación de campos", "Confirmación de importación"],
    steps: [
      { title: "Carga el export", do: "Selecciona el archivo proveniente de Vocalcom y espera el resumen de detección.", verify: "El sistema reconoce filas y campos del archivo." },
      { title: "Revisa la equivalencia", do: "Confirma qué campo identifica el lead, cuál representa el resultado y cuál contiene fecha/hora.", verify: "Puedes explicar cómo cada columna impactará el historial." },
      { title: "Confirma con un control", do: "Contrasta totales y período antes de ejecutar la importación.", verify: "El total importado coincide con el resumen esperado o queda documentada la diferencia." },
    ],
  },
  {
    id: "mail",
    title: "Gestionar leads de correo",
    description: "Clasifica, asigna y controla que cada solicitud por mail tenga responsable y respuesta.",
    href: "/dashboard/mail",
    action: "Abrir leads mail",
    icon: MailCheck,
    roles: ["supervisor", "admin"],
    tags: ["correo", "mail", "asignar", "entrada", "sla"],
    route: ["Datos", "Leads mail"],
    before: ["Define qué campaña y equipo atienden el canal.", "Revisa tiempos de respuesta comprometidos."],
    outcome: "Cada correo relevante tiene campaña, responsable y seguimiento verificable.",
    screenTitle: "Leads mail",
    screenControls: ["Bandeja de ingresos", "Asignación de campaña/ejecutivo", "Estado de atención"],
    steps: [
      { title: "Revisa pendientes", do: "Ordena o filtra por ingresos sin asignar y por tiempo transcurrido.", verify: "Identificas primero los casos que pueden incumplir respuesta." },
      { title: "Clasifica y asigna", do: "Selecciona la campaña y el ejecutivo que corresponde al contenido del correo.", verify: "El caso deja de estar sin dueño y aparece en la operación correcta." },
      { title: "Controla el cierre", do: "Revisa que el ejecutivo haya gestionado el lead o generado un seguimiento cuando no se resuelve en el primer contacto.", verify: "El estado final y la trazabilidad coinciden con la atención realizada." },
    ],
  },
  {
    id: "manual-lead",
    title: "Crear un registro manual",
    description: "Incorpora un lead individual, con campaña y responsable correctos, sin esperar una carga masiva.",
    href: "/dashboard/leads/nuevo",
    action: "Nuevo registro",
    icon: UserPlus,
    roles: ["supervisor", "admin"],
    tags: ["nuevo lead", "manual", "registro", "crear"],
    route: ["Datos", "Nuevo registro"],
    before: ["Busca primero por RUT, teléfono y correo para evitar duplicados.", "Define la campaña y responsable antes de guardar."],
    outcome: "El lead queda disponible en la campaña correcta con información suficiente para ser gestionado.",
    screenTitle: "Nuevo registro",
    screenControls: ["Datos de contacto", "Selector de campaña", "Equipo/ejecutivo", "Guardar"],
    steps: [
      { title: "Descarta duplicado", do: "Usa el buscador rápido por RUT, teléfono o correo antes de crear un registro nuevo.", verify: "No existe una ficha activa que represente al mismo contacto." },
      { title: "Completa datos útiles", do: "Ingresa los datos de contacto disponibles con formato consistente y sin usar campos libres para información estructurada.", verify: "Otro ejecutivo puede contactar al lead sin pedirte información adicional." },
      { title: "Asigna el destino", do: "Selecciona campaña, equipo o ejecutivo según tus permisos y guarda.", verify: "El lead aparece en Registros con campaña y responsable correctos." },
    ],
  },
];

const ROLE_COPY: Record<AppRole, { title: string; description: string; scope: string; searches: string[] }> = {
  agente: {
    title: "Capacitación para tu operación diaria",
    description: "Guías prácticas para encontrar registros, completar una gestión y cumplir tus seguimientos sin depender de otra persona.",
    scope: "Como Agente, ves solo los registros y acciones habilitados para tu operación.",
    searches: ["Buscar un lead", "Resolver agenda", "Registrar una gestión"],
  },
  supervisor: {
    title: "Capacitación para supervisión",
    description: "Controla equipo, prioridades y resultados con instrucciones que explican exactamente dónde entrar y qué revisar.",
    scope: "Como Supervisor, ves la operación y los equipos que se te han asignado.",
    searches: ["Monitor en vivo", "Mi equipo", "Reportes", "Leads mail"],
  },
  admin: {
    title: "Manual operativo de administración",
    description: "Configura campañas, flujos, personas, datos y discador con recorridos completos y controles de validación.",
    scope: "Como Administrador, puedes configurar la operación global. Cada cambio puede afectar a otros equipos.",
    searches: ["Crear campaña", "Crear flujo", "Cargar base", "Usuarios", "Extensión SIP"],
  },
};

function ScreenMap({ guide }: { guide: Guide }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground"><span className="flex size-5 items-center justify-center rounded bg-primary text-[10px] text-primary-foreground">A</span> Atlas · CRM</div>
        <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">Buscar o ir a...</span>
      </div>
      <div className="grid min-h-56 grid-cols-[92px_1fr] sm:grid-cols-[120px_1fr]">
        <aside className="border-r border-border bg-surface-muted/40 p-2 text-[10px] text-muted-foreground">
          <p className="px-1.5 py-1 font-semibold text-foreground">Menú Atlas</p>
          {guide.route.map((item, index) => <p key={item} className={`mt-1 rounded px-1.5 py-1 ${index === guide.route.length - 1 ? "bg-primary/10 font-semibold text-primary" : ""}`}>{item}</p>)}
        </aside>
        <div className="p-4">
          <p className="text-[10px] font-medium text-primary">Pantalla de referencia</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">{guide.screenTitle}</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {guide.screenControls.map((control, index) => (
              <div key={control} className={`rounded-lg border px-2.5 py-2 text-[11px] ${index === 0 ? "border-primary/40 bg-primary/5 text-foreground" : "border-border bg-surface text-muted-foreground"}`}>
                <span className="mr-1.5 inline-flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{index + 1}</span>{control}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-4 text-muted-foreground">Usa esta referencia para ubicarte. Abajo puedes cargar la pantalla real de Atlas con tus propios permisos.</p>
        </div>
      </div>
    </div>
  );
}

function GuideDetail({ guide, onClose }: { guide: Guide; onClose: () => void }) {
  const [liveScreen, setLiveScreen] = useState(false);
  const Icon = guide.icon;

  return (
    <section className="rounded-2xl border border-primary/30 bg-surface p-4 shadow-sm sm:p-6" aria-label={`Capacitación: ${guide.title}`}>
      <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
        <div className="flex gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon size={22} /></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Guía práctica</p><h2 className="mt-1 text-xl font-semibold text-foreground">{guide.title}</h2><p className="mt-1 text-sm text-muted-foreground">{guide.description}</p></div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground" aria-label="Cerrar guía"><X size={18} /></button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-background p-4">
            <p className="text-xs font-semibold text-foreground">Ruta exacta en el menú</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              {guide.route.map((item, index) => <span key={item} className="inline-flex items-center gap-1.5">{index > 0 && <ChevronRight size={14} className="text-muted-foreground" />}<span className={index === guide.route.length - 1 ? "rounded-md bg-primary px-2 py-1 font-semibold text-primary-foreground" : "rounded-md border border-border bg-surface px-2 py-1 text-foreground"}>{item}</span></span>)}
            </div>
          </div>
          <ScreenMap guide={guide} />
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-foreground">Pantalla real del CRM</p><p className="mt-1 text-xs text-muted-foreground">Se abre con tu sesión y tus permisos; no es una maqueta.</p></div><button type="button" onClick={() => setLiveScreen((value) => !value)} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-hover">{liveScreen ? "Ocultar pantalla" : "Cargar pantalla real"}</button></div>
            {liveScreen && <iframe title={`Pantalla real: ${guide.screenTitle}`} src={guide.href} className="mt-4 h-[520px] w-full rounded-lg border border-border bg-background" />}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-background p-4"><p className="text-xs font-semibold text-foreground">Antes de empezar</p><ul className="mt-2 space-y-2">{guide.before.map((item) => <li key={item} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />{item}</li>)}</ul></div>
          <div className="rounded-xl border border-success/25 bg-success-bg/30 p-4"><p className="text-xs font-semibold text-foreground">Resultado esperado</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{guide.outcome}</p></div>
          <Link href={guide.href} className="flex items-center justify-center gap-2 rounded-lg border border-primary bg-surface px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/5">{guide.action}<ArrowRight size={16} /></Link>
        </aside>
      </div>

      <div className="mt-6 border-t border-border pt-5"><div className="flex items-center gap-2"><ClipboardCheck size={18} className="text-primary" /><h3 className="text-base font-semibold text-foreground">Qué hacer, qué seleccionar y cómo comprobarlo</h3></div><ol className="mt-4 grid gap-3 lg:grid-cols-2">{guide.steps.map((step, index) => <li key={step.title} className="rounded-xl border border-border bg-background p-4"><div className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span><div><h4 className="text-sm font-semibold text-foreground">{step.title}</h4><p className="mt-1 text-xs leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Haz esto: </span>{step.do}</p><p className="mt-2 text-xs leading-5 text-muted-foreground"><span className="font-semibold text-success">Comprueba: </span>{step.verify}</p>{step.warning && <p className="mt-2 flex gap-1.5 text-xs leading-5 text-amber-700 dark:text-amber-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{step.warning}</p>}</div></div></li>)}</ol></div>
    </section>
  );
}

export function HelpCenter({ role }: { role: AppRole }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const copy = ROLE_COPY[role];
  const normalizedQuery = query.trim().toLocaleLowerCase("es-CL");
  const guides = useMemo(() => GUIDES.filter((guide) => guide.roles.includes(role) && (!normalizedQuery || [guide.title, guide.description, ...guide.tags, ...guide.route, ...guide.steps.flatMap((step) => [step.title, step.do, step.verify])].join(" ").toLocaleLowerCase("es-CL").includes(normalizedQuery))), [normalizedQuery, role]);
  const selectedGuide = GUIDES.find((guide) => guide.id === selectedId && guide.roles.includes(role));

  return <div className="mx-auto max-w-7xl space-y-6 pb-8">
    <section className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface to-surface p-6 sm:p-8"><div className="max-w-4xl"><span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-primary shadow-sm"><CircleHelp size={15} /> Centro de capacitación Atlas</span><h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{copy.title}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">{copy.description}</p><div className="relative mt-5 max-w-3xl"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca una tarea: campaña, flujo, carga, agenda, usuarios..." className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-4 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary" /></div><div className="mt-3 flex flex-wrap gap-2">{copy.searches.map((item) => <button key={item} type="button" onClick={() => setQuery(item)} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary">{item}</button>)}</div></div></section>
    <section className="rounded-xl border border-border bg-surface p-4"><p className="text-sm font-semibold text-foreground">Tu alcance</p><p className="mt-1 text-sm text-muted-foreground">{copy.scope}</p><p className="mt-3 flex gap-2 rounded-lg bg-surface-muted/60 p-3 text-xs leading-5 text-muted-foreground"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />Cada guía incluye ruta de menú, una referencia visual, pantalla real cargable y validaciones de término. Así sabes dónde entrar, qué hacer y cuándo está bien hecho.</p></section>
    {selectedGuide && <GuideDetail guide={selectedGuide} onClose={() => setSelectedId(null)} />}
    <section><div className="mb-4"><h2 className="text-lg font-semibold text-foreground">Guías disponibles</h2><p className="mt-1 text-sm text-muted-foreground">{normalizedQuery ? `${guides.length} resultado${guides.length === 1 ? "" : "s"} para tu búsqueda.` : `${guides.length} procedimientos habilitados para tu rol.`}</p></div>{guides.length > 0 ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{guides.map((guide) => { const Icon = guide.icon; return <article key={guide.id} className="flex flex-col rounded-xl border border-border bg-surface p-5 shadow-sm"><div className="flex gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon size={20} /></div><div><h3 className="text-base font-semibold text-foreground">{guide.title}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{guide.description}</p></div></div><div className="mt-4 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">{guide.route.map((item) => <span key={item} className="rounded border border-border bg-background px-2 py-1">{item}</span>)}</div><div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4"><span className="text-xs text-muted-foreground">{guide.steps.length} pasos con validación</span><button type="button" onClick={() => { setSelectedId(guide.id); setQuery(""); }} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover">Ver capacitación <ArrowRight size={16} /></button></div></article>; })}</div> : <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center"><CircleHelp size={24} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-medium text-foreground">No encontramos una guía para “{query.trim()}”.</p><p className="mt-1 text-sm text-muted-foreground">Prueba con campaña, lead, agenda, flujo, carga, usuario o discador.</p></div>}</section>
  </div>;
}
