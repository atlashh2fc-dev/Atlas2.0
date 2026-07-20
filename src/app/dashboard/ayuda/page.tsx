import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  ClipboardList,
  FileUp,
  LineChart,
  Megaphone,
  MonitorPlay,
  UserPlus,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { requireProfile } from "@/lib/auth";

type Guide = {
  title: string;
  description: string;
  href: string;
  action: string;
  icon: LucideIcon;
  steps: string[];
  adminOnly?: boolean;
  supervisorOnly?: boolean;
};

const GUIDES: Guide[] = [
  {
    title: "Crear una campaña",
    description: "Prepara el espacio de trabajo de una nueva operación antes de cargar su base.",
    href: "/dashboard/admin/campanas",
    action: "Ir a campañas",
    icon: Megaphone,
    adminOnly: true,
    steps: [
      "Abre Campañas y escribe el nombre y una descripción opcional.",
      "Selecciona Crear y configurar para entrar al detalle de la campaña.",
      "Asigna sus ejecutivos, conecta un flujo y deja la campaña activa cuando esté lista.",
    ],
  },
  {
    title: "Crear o incorporar un ejecutivo",
    description: "Da acceso a un nuevo integrante y déjalo correctamente asociado a su equipo.",
    href: "/dashboard/admin/usuarios",
    action: "Ir a usuarios",
    icon: UserPlus,
    adminOnly: true,
    steps: [
      "En Usuarios completa nombre, correo y una contraseña de al menos 6 caracteres.",
      "Elige el rol Agente y su equipo; usa Supervisor o Administrador solo cuando corresponda.",
      "Crea la cuenta y confirma que quede Activa. En Equipos puedes definir su supervisor.",
    ],
  },
  {
    title: "Diseñar el flujo de gestión",
    description: "Define las preguntas y respuestas que seguirá el ejecutivo en cada lead.",
    href: "/dashboard/admin/flujos",
    action: "Ir a flujos",
    icon: Workflow,
    adminOnly: true,
    steps: [
      "Crea un flujo desde cero o selecciona una plantilla para la campaña.",
      "Agrega los pasos, define qué respuestas son obligatorias y conecta las alternativas.",
      "Marca el primer paso, revisa el recorrido y verifica que el flujo quede activo.",
    ],
  },
  {
    title: "Cargar una base de leads",
    description: "Importa registros y asócialos a la campaña correcta antes de iniciar la gestión.",
    href: "/dashboard/leads/cargar",
    action: "Cargar leads",
    icon: FileUp,
    adminOnly: true,
    steps: [
      "Ingresa a Cargar leads y selecciona el archivo de la base.",
      "Revisa la campaña elegida y los campos antes de confirmar la carga.",
      "Cuando finalice, valida el total importado en Registros y asigna la operación si corresponde.",
    ],
  },
  {
    title: "Ver reportes de gestión",
    description: "Consulta avance, contactabilidad, tipificaciones y resultados por ejecutivo.",
    href: "/dashboard/reportes",
    action: "Ver reportes de gestión",
    icon: BarChart3,
    steps: [
      "Abre Reportes de gestión desde el menú de Supervisión.",
      "Revisa los indicadores del período y compara el desempeño por ejecutivo.",
      "Usa las tablas y gráficos para detectar oportunidades, agendas vencidas o seguimientos necesarios.",
    ],
  },
  {
    title: "Revisar el discador",
    description: "Analiza la operación telefónica: tiempos, abandono, ocupación y adherencia.",
    href: "/dashboard/supervision/reportes",
    action: "Ver reportes de discador",
    icon: LineChart,
    steps: [
      "En Reportes de discador define el rango de fechas que quieres analizar.",
      "Consulta métricas de llamadas, AHT, nivel de servicio y abandono.",
      "Contrasta la actividad por ejecutivo para gestionar capacidad y adherencia del equipo.",
    ],
  },
  {
    title: "Monitorear la operación",
    description: "Sigue en tiempo real la disponibilidad y actividad de los ejecutivos.",
    href: "/dashboard/supervision/monitor",
    action: "Abrir monitor en vivo",
    icon: MonitorPlay,
    steps: [
      "Abre Monitor en vivo durante la jornada de gestión.",
      "Identifica quién está disponible, ocupado o fuera de operación.",
      "Usa esta vista junto a los reportes para priorizar acompañamiento y ajustes.",
    ],
  },
  {
    title: "Gestionar mi equipo",
    description: "Consulta la carga de trabajo y los registros de los ejecutivos que supervisas.",
    href: "/dashboard/team",
    action: "Ver mi equipo",
    icon: UsersRound,
    supervisorOnly: true,
    steps: [
      "En Mi equipo revisa los ejecutivos que tienes asignados.",
      "Entra a los registros para verificar su avance y datos de contacto.",
      "Si no ves equipo, pide a un administrador que te asocie a uno desde Usuarios.",
    ],
  },
];

export default async function HelpPage() {
  const profile = await requireProfile(["admin", "supervisor"]);
  const isAdmin = profile.role === "admin";
  const guides = GUIDES.filter(
    (guide) => (isAdmin || !guide.adminOnly) && (!isAdmin || !guide.supervisorOnly)
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-8">
      <section className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface to-surface p-6 sm:p-8">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-primary shadow-sm">
            <ClipboardList size={15} /> Centro de ayuda
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Todo lo necesario para operar Atlas
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
            Guías rápidas para configurar la operación, acompañar al equipo y consultar resultados. Elige una tarea y
            ve directo al lugar donde se realiza.
          </p>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Guías paso a paso</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin
                ? "Configuración, datos y supervisión de la operación."
                : "Herramientas para supervisar el desempeño y acompañar a tu equipo."}
            </p>
          </div>
          <span className="hidden rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-muted-foreground sm:block">
            {guides.length} tareas disponibles
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {guides.map((guide) => {
            const Icon = guide.icon;
            return (
              <article key={guide.title} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                <div className="flex gap-4">
                  <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-foreground">{guide.title}</h3>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">{guide.description}</p>
                  </div>
                </div>

                <ol className="mt-4 space-y-2.5">
                  {guide.steps.map((step, index) => (
                    <li key={step} className="flex gap-3 text-sm leading-5 text-foreground">
                      <span className="flex size-5 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-muted-foreground">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>

                <Link
                  href={guide.href}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary-hover"
                >
                  {guide.action} <ArrowRight size={16} />
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-muted/50 p-5">
        <h2 className="text-sm font-semibold text-foreground">¿No encuentras una opción?</h2>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          Revisa el menú lateral: las opciones disponibles dependen de tu rol. Si necesitas acceso a una campaña,
          equipo o usuario, solicita a un administrador que lo configure desde Usuarios.
        </p>
      </section>
    </div>
  );
}
