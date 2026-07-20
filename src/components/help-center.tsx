"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileUp,
  History,
  LineChart,
  MailCheck,
  Megaphone,
  MonitorPlay,
  PhoneCall,
  Search,
  Settings2,
  ShieldCheck,
  UserPlus,
  Users,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/types";

type Guide = {
  title: string;
  description: string;
  href: string;
  action: string;
  icon: LucideIcon;
  roles: AppRole[];
  tags: string[];
  steps: string[];
};

const GUIDES: Guide[] = [
  {
    title: "Buscar y gestionar registros",
    description: "Encuentra un lead, revisa su historial y registra una gestión completa.",
    href: "/dashboard/leads",
    action: "Abrir registros",
    icon: Users,
    roles: ["agente", "supervisor", "admin"],
    tags: ["buscar lead", "rut", "teléfono", "llamada", "gestionar"],
    steps: [
      "Usa ⌘/Ctrl + K para buscar por RUT, teléfono o nombre desde cualquier pantalla.",
      "Abre el registro y completa el flujo de gestión indicado para su campaña.",
      "Guarda el resultado y agenda el siguiente contacto cuando corresponda.",
    ],
  },
  {
    title: "Organizar mi agenda",
    description: "Prioriza tus seguimientos y evita que se venzan compromisos con clientes.",
    href: "/dashboard/agenda",
    action: "Abrir mi agenda",
    icon: CalendarClock,
    roles: ["agente"],
    tags: ["agenda", "seguimiento", "recordatorio", "pendiente"],
    steps: [
      "Revisa primero los seguimientos vencidos y los que corresponden para hoy.",
      "Abre cada registro desde la agenda y realiza o reprograma la gestión.",
      "Deja siempre un resultado y una nueva fecha cuando el caso requiera seguimiento.",
    ],
  },
  {
    title: "Controlar mi equipo",
    description: "Revisa carga de trabajo, progreso y registros de los ejecutivos a tu cargo.",
    href: "/dashboard/team",
    action: "Abrir mi equipo",
    icon: UsersRound,
    roles: ["supervisor"],
    tags: ["equipo", "ejecutivos", "asignar", "supervisor", "carga"],
    steps: [
      "Revisa los ejecutivos y sus registros pendientes o sin gestión.",
      "Entra a los registros que requieren apoyo, reasignación o seguimiento.",
      "Si no aparece tu equipo, solicita al administrador que te asocie a uno.",
    ],
  },
  {
    title: "Monitorear la operación en vivo",
    description: "Sigue disponibilidad, actividad y estado de los ejecutivos durante la jornada.",
    href: "/dashboard/supervision/monitor",
    action: "Abrir monitor",
    icon: MonitorPlay,
    roles: ["supervisor", "admin"],
    tags: ["monitor", "en vivo", "disponibilidad", "pausa", "discador"],
    steps: [
      "Abre el monitor durante la operación para identificar capacidad disponible.",
      "Detecta pausas, baja disponibilidad o ejecutivos sin actividad.",
      "Complementa la vista con reportes antes de cambiar la distribución del trabajo.",
    ],
  },
  {
    title: "Consultar reportes de gestión",
    description: "Mide avance, contactabilidad, tipificaciones y desempeño por ejecutivo.",
    href: "/dashboard/reportes",
    action: "Ver reportes de gestión",
    icon: BarChart3,
    roles: ["supervisor", "admin"],
    tags: ["reporte", "contactabilidad", "tipificación", "kpi", "desempeño"],
    steps: [
      "Selecciona el período que quieres analizar.",
      "Compara indicadores y resultados por ejecutivo o equipo.",
      "Usa los hallazgos para acompañar, reasignar o ajustar la operación.",
    ],
  },
  {
    title: "Revisar el discador",
    description: "Analiza llamadas, abandono, AHT, ocupación y adherencia operacional.",
    href: "/dashboard/supervision/reportes",
    action: "Ver reportes de discador",
    icon: LineChart,
    roles: ["supervisor", "admin"],
    tags: ["discador", "llamadas", "aht", "abandono", "ocupación"],
    steps: [
      "Define el rango de fechas del análisis.",
      "Revisa el nivel de servicio, abandono y tiempos de llamadas.",
      "Contrasta capacidad por ejecutivo antes de modificar ratios o pausas.",
    ],
  },
  {
    title: "Crear y preparar una campaña",
    description: "Configura la operación completa antes de activar el discador o cargar la base.",
    href: "/dashboard/admin/campanas",
    action: "Ir a campañas",
    icon: Megaphone,
    roles: ["admin"],
    tags: ["campaña", "crear campaña", "configurar", "activar", "discador"],
    steps: [
      "Crea la campaña y define su flujo productivo, o crea uno nuevo desde la misma ficha.",
      "Asigna ejecutivos, carga la base y configura la cola y modo de discado.",
      "Revisa el checklist de la campaña y actívala solo cuando no queden pendientes.",
    ],
  },
  {
    title: "Diseñar un flujo de gestión",
    description: "Crea el guion y las decisiones obligatorias que verá el ejecutivo por campaña.",
    href: "/dashboard/admin/flujos",
    action: "Ir a flujos",
    icon: Workflow,
    roles: ["admin"],
    tags: ["flujo", "script", "preguntas", "tipificación", "campaña"],
    steps: [
      "Crea un flujo desde cero o selecciona una plantilla.",
      "Define pasos, respuestas permitidas, obligatoriedad y conexiones entre alternativas.",
      "Vincúlalo a una campaña y vuelve a ella para completar su configuración.",
    ],
  },
  {
    title: "Cargar una base de leads",
    description: "Importa registros y asócialos a la campaña correcta antes de iniciar la gestión.",
    href: "/dashboard/leads/cargar",
    action: "Cargar leads",
    icon: FileUp,
    roles: ["admin"],
    tags: ["cargar excel", "importar", "base", "leads", "archivo"],
    steps: [
      "Selecciona el archivo y valida las columnas detectadas.",
      "Elige la campaña que recibirá la base y confirma la carga.",
      "Valida el total cargado desde la ficha de la campaña o Registros.",
    ],
  },
  {
    title: "Administrar usuarios y equipos",
    description: "Crea cuentas, asigna roles, equipos y responsables de supervisión.",
    href: "/dashboard/admin/usuarios",
    action: "Ir a usuarios",
    icon: ShieldCheck,
    roles: ["admin"],
    tags: ["usuario", "rol", "equipo", "supervisor", "ejecutivo"],
    steps: [
      "Crea la cuenta y asigna el rol correcto: Agente, Supervisor o Administrador.",
      "Asocia a cada agente a su equipo y define el supervisor del equipo.",
      "Confirma que la cuenta esté activa antes de asignarla a una campaña.",
    ],
  },
  {
    title: "Configurar telefonía y estados",
    description: "Provisiona extensiones SIP y define los estados de pausa disponibles para agentes.",
    href: "/dashboard/admin/agentes-sip",
    action: "Configurar telefonía",
    icon: PhoneCall,
    roles: ["admin"],
    tags: ["sip", "extensión", "telefonía", "pausa", "estado agente"],
    steps: [
      "Crea o revisa la extensión SIP de cada ejecutivo antes de operar el discador.",
      "En Estados de agente configura las razones de pausa que sacan al ejecutivo de la cola.",
      "Prueba la disponibilidad antes de habilitar el discado automático.",
    ],
  },
  {
    title: "Importar gestión desde Vocalcom",
    description: "Incorpora resultados históricos o externos y revísalos antes de impactar la operación.",
    href: "/dashboard/admin/vocalcom",
    action: "Abrir importación Vocalcom",
    icon: PhoneCall,
    roles: ["admin"],
    tags: ["vocalcom", "importar gestión", "histórico", "llamadas", "carga"],
    steps: [
      "Carga el archivo exportado desde Vocalcom y revisa el resumen de detección.",
      "Confirma los campos y los resultados que se asociarán a cada registro.",
      "Valida la importación antes de usar los reportes para tomar decisiones.",
    ],
  },
  {
    title: "Reactivar un ejecutivo histórico",
    description: "Recupera el acceso de un ejecutivo sin perder su trazabilidad operacional anterior.",
    href: "/dashboard/admin/ejecutivos-historicos",
    action: "Ver ejecutivos históricos",
    icon: History,
    roles: ["admin"],
    tags: ["ejecutivo histórico", "reactivar", "usuario anterior", "trazabilidad"],
    steps: [
      "Busca al ejecutivo inactivo que necesitas recuperar.",
      "Revisa el historial antes de reactivarlo o asociarlo a su nuevo equipo.",
      "Confirma su rol, equipo y extensión antes de incluirlo en una campaña.",
    ],
  },
  {
    title: "Gestionar leads de correo",
    description: "Revisa, asigna y controla los leads que ingresan por los canales de correo.",
    href: "/dashboard/mail",
    action: "Abrir leads mail",
    icon: MailCheck,
    roles: ["supervisor", "admin"],
    tags: ["correo", "mail", "asignar", "entrada", "leads"],
    steps: [
      "Revisa los correos pendientes y los tiempos de respuesta.",
      "Asigna o deriva los leads al ejecutivo y campaña correctos.",
      "Controla que queden gestionados y con seguimiento si aplica.",
    ],
  },
  {
    title: "Crear un registro manual",
    description: "Incorpora un lead individual sin esperar una carga masiva.",
    href: "/dashboard/leads/nuevo",
    action: "Nuevo registro",
    icon: UserPlus,
    roles: ["supervisor", "admin"],
    tags: ["nuevo lead", "manual", "registro", "crear"],
    steps: [
      "Completa los datos de contacto disponibles.",
      "Selecciona campaña, equipo o ejecutivo según tu permiso.",
      "Guarda el registro y verifica que aparezca en la operación correcta.",
    ],
  },
];

const FREQUENT_SEARCHES: Record<AppRole, string[]> = {
  agente: ["Buscar un lead", "Agenda de hoy", "Registrar una llamada"],
  supervisor: ["Mi equipo", "Monitor en vivo", "Reportes de gestión", "Leads mail"],
  admin: ["Crear campaña", "Cargar base", "Crear flujo", "Configurar usuarios", "Discador"],
};

const ROLE_COPY: Record<AppRole, { title: string; description: string; focus: string }> = {
  agente: {
    title: "Tu operación diaria",
    description: "Encuentra registros, completa gestiones y mantén al día tus seguimientos.",
    focus: "Puedes gestionar solo los registros que tienes disponibles y asignados.",
  },
  supervisor: {
    title: "Control de tu equipo",
    description: "Acompaña la operación, prioriza seguimientos y detecta desvíos a tiempo.",
    focus: "Tu acceso está limitado al equipo que tienes asignado.",
  },
  admin: {
    title: "Configuración y control de la operación",
    description: "Prepara campañas, personas, datos y discador; luego monitorea sus resultados.",
    focus: "Tienes acceso a la configuración global y a todas las campañas activas.",
  },
};

export function HelpCenter({ role }: { role: AppRole }) {
  const [query, setQuery] = useState("");
  const [openGuide, setOpenGuide] = useState<string | null>(null);
  const copy = ROLE_COPY[role];
  const normalizedQuery = query.trim().toLocaleLowerCase("es-CL");
  const guides = useMemo(
    () =>
      GUIDES.filter((guide) => {
        if (!guide.roles.includes(role)) return false;
        if (!normalizedQuery) return true;
        return [guide.title, guide.description, ...guide.tags, ...guide.steps]
          .join(" ")
          .toLocaleLowerCase("es-CL")
          .includes(normalizedQuery);
      }),
    [normalizedQuery, role]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-8">
      <section className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface to-surface p-6 sm:p-8">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-primary shadow-sm">
            <ClipboardList size={15} /> Centro de operación
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{copy.title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">{copy.description}</p>
          <div className="relative mt-5 max-w-2xl">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="¿Qué necesitas hacer? Ej.: crear campaña, cargar Excel, agenda..."
              className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-4 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <Settings2 size={20} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Tu alcance en Atlas</h2>
            <p className="mt-1 text-sm text-muted-foreground">{copy.focus}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {FREQUENT_SEARCHES[role].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setQuery(item)}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Guías y acciones</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {normalizedQuery ? `${guides.length} resultado${guides.length === 1 ? "" : "s"} para tu búsqueda.` : `${guides.length} tareas disponibles para tu rol.`}
            </p>
          </div>
        </div>

        {guides.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {guides.map((guide) => {
              const Icon = guide.icon;
              const isOpen = openGuide === guide.title;
              return (
                <article key={guide.title} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                  <div className="flex gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-foreground">{guide.title}</h3>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">{guide.description}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpenGuide(isOpen ? null : guide.title)}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary"
                  >
                    {isOpen ? "Ocultar pasos" : "Ver pasos"}
                    <ChevronDown size={16} className={isOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                  </button>

                  {isOpen && (
                    <ol className="mt-3 space-y-2.5 border-t border-border pt-4">
                      {guide.steps.map((step, index) => (
                        <li key={step} className="flex gap-3 text-sm leading-5 text-foreground">
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-muted-foreground">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  )}

                  <Link href={guide.href} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-hover">
                    {guide.action} <ArrowRight size={16} />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
            <CircleHelp size={24} className="mx-auto text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">No encontramos una guía para “{query.trim()}”.</p>
            <p className="mt-1 text-sm text-muted-foreground">Prueba con campaña, lead, agenda, flujo, carga, usuario o discador.</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface-muted/50 p-5">
        <div className="flex gap-3">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-success" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Atajo para encontrar un lead</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              En cualquier pantalla usa <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-xs">⌘/Ctrl + K</kbd> y escribe RUT, teléfono o nombre. El buscador respeta los permisos de tu rol.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
