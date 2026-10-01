import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Avatar, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Piezas de diseño de Configuración y Plataforma (carpeta privada: no es ruta).
 *
 * Los ajustes se leen como los de Vercel, Stripe o Linear: listas de entidades
 * con identidad, detalles con cabecera y pestañas, y formularios por grupos con
 * nombre. Viven acá y no en `components/ui` porque solo los usa esta área.
 */

/**
 * Un grupo del formulario: a la izquierda qué es y para qué sirve, a la
 * derecha los campos. Igual que en Correo de envío: diez campos seguidos en dos
 * columnas se leían como una planilla; en grupos con nombre se entiende qué
 * falta llenar.
 */
export function Grupo({
  titulo,
  descripcion,
  children,
  columnas = 2,
  className,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  children: ReactNode;
  /** Columnas de los campos en pantallas medianas. */
  columnas?: 1 | 2;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-8", className)}>
      <div>
        <h3 className="text-sm font-medium text-foreground">{titulo}</h3>
        {descripcion && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{descripcion}</p>}
      </div>
      <div className={cn("grid content-start gap-4", columnas === 2 && "sm:grid-cols-2")}>{children}</div>
    </div>
  );
}

/** Pie del formulario: el botón de guardar a la derecha, sobre la franja de pies. */
export function PieDeFormulario({ nota, children }: { nota?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 bg-surface-raised px-5 py-3">
      {nota && <p className="mr-auto text-xs text-muted-foreground">{nota}</p>}
      {children}
    </div>
  );
}

/** Ruta de vuelta: «Campañas / Ventas Hogar». El último tramo es donde estás. */
export function Migas({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Ruta" className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && (
            <span aria-hidden="true" className="text-border-strong">
              /
            </span>
          )}
          {item.href ? (
            <Link href={item.href} className="shrink-0 transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" className="truncate text-foreground">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/**
 * Cabecera de una entidad (campaña, cola, flujo, empresa): su avatar cuadrado,
 * el nombre, una línea de metadatos con su estado y, a la derecha, lo que se
 * opera sobre ella. Debajo van las pestañas del detalle.
 */
export function CabeceraDeEntidad({
  nombre,
  seed,
  icon,
  descripcion,
  meta,
  acciones,
  apagada = false,
}: {
  nombre: string;
  seed?: string;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;
  descripcion?: ReactNode;
  /** Estado y datos cortos, separados por puntos. */
  meta?: ReactNode;
  acciones?: ReactNode;
  /** Entidad inactiva: el avatar se apaga. */
  apagada?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3.5">
        <Avatar name={nombre} seed={seed} icon={icon} size="lg" shape="square" className={cn("mt-0.5", apagada && "opacity-50")} />
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">{nombre}</h1>
          {descripcion && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{descripcion}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">{meta}</div>}
        </div>
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  );
}

/** Flecha al final de una fila navegable; la fila entera ya es el enlace o la tiene. */
export function FlechaDeFila({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-surface-muted hover:text-foreground"
    >
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );
}

/** Cifra de conteo junto a un título: caja gris pequeña, sin color. */
export function Conteo({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1.5 inline-flex rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

const PUNTO: Record<BadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-primary",
  neutral: "bg-muted-foreground/45",
};

export type CeldaDeEstado = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** Con tono la celda lleva punto de estado; sin tono es un dato configurado. */
  tone?: BadgeTone;
  icon?: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>;
};

/**
 * Franja de estado de una conexión o configuración: una tarjeta dividida en
 * celdas (como la franja de indicadores de Reportes), cada una con su punto de
 * estado. Reemplaza las baldosas sueltas con borde de color.
 */
export function FranjaDeEstado({ celdas, className }: { celdas: CeldaDeEstado[]; className?: string }) {
  const columnas = celdas.length >= 4 ? "lg:grid-cols-4" : celdas.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return (
    <dl
      className={cn(
        "atlas-panel grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm sm:grid-cols-2",
        columnas,
        className
      )}
    >
      {celdas.map((celda) => {
        const Icon = celda.icon;
        return (
          <div key={celda.label} className="flex min-w-0 flex-col bg-surface px-5 py-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {Icon && <Icon size={14} className="shrink-0" aria-hidden="true" />}
              <span className="truncate">{celda.label}</span>
            </dt>
            <dd className="mt-2 flex min-w-0 items-center gap-2">
              {celda.tone && <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", PUNTO[celda.tone])} />}
              <span className={cn("truncate text-base font-semibold tracking-tight", celda.tone === "danger" ? "text-danger" : "text-foreground")}>
                {celda.value}
              </span>
            </dd>
            {celda.detail && <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">{celda.detail}</dd>}
          </div>
        );
      })}
    </dl>
  );
}

/** «24 may · 09:27», en hora de Chile. */
const DIA = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short" });
const HORA = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false });

export function fechaLegible(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${DIA.format(date).replace(".", "")} · ${HORA.format(date)}`;
}
