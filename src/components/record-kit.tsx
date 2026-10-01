import type { ComponentType, ReactNode } from "react";
import { avatarTone, initials } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Piezas de la ficha de un registro (cliente, negocio): cabecera de identidad,
 * franja de datos clave, columna de propiedades y línea de tiempo. Las usan la
 * ficha del registro y la del negocio para que las dos se lean igual, como un
 * registro de HubSpot o Attio y no como un formulario con cajas.
 *
 * Sin "use client" ni dependencias de servidor: sirve en ambos lados.
 */

type IconType = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>;

export type ChipTone = "primary" | "blue" | "teal" | "green" | "amber" | "violet" | "rose" | "slate";

const ZONA = "America/Santiago";

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Día del calendario en Chile ("2026-10-01"), para comparar hoy/ayer sin UTC. */
function dayKey(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: ZONA });
}

/** "24 may" (con año solo si no es el actual), en hora de Chile. */
export function dayLabel(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : parse(value);
  if (!date) return "—";
  const sameYear = date.toLocaleDateString("es-CL", { year: "numeric", timeZone: ZONA })
    === new Date().toLocaleDateString("es-CL", { year: "numeric", timeZone: ZONA });
  return date
    .toLocaleDateString("es-CL", { day: "numeric", month: "short", year: sameYear ? undefined : "numeric", timeZone: ZONA })
    .replace(".", "");
}

/** "09:27" en hora de Chile. */
export function timeLabel(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : parse(value);
  if (!date) return "—";
  return date.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ZONA });
}

/** "24 may · 09:27": la forma corta y legible de una fecha con hora. */
export function dateTimeLabel(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "—";
  return `${dayLabel(date)} · ${timeLabel(date)}`;
}

/**
 * "Hoy · 09:27", "Ayer · 18:02", "Hace 3 días", "Mañana · 10:00", "En 5 días".
 * La granularidad es el día (no el minuto) para que el render del servidor y el
 * del navegador coincidan.
 */
export function relativeLabel(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "—";
  const today = parse(`${dayKey(new Date())}T12:00:00Z`)!;
  const that = parse(`${dayKey(date)}T12:00:00Z`)!;
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (days === 0) return `Hoy · ${timeLabel(date)}`;
  if (days === 1) return `Ayer · ${timeLabel(date)}`;
  if (days === -1) return `Mañana · ${timeLabel(date)}`;
  if (days > 1 && days < 30) return `Hace ${days} días`;
  if (days < -1 && days > -30) return `En ${-days} días`;
  return dayLabel(date);
}

/** Encabezado del grupo de un día en la línea de tiempo: "Hoy", "Ayer", "24 sep". */
export function dayGroupLabel(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "Sin fecha";
  const today = parse(`${dayKey(new Date())}T12:00:00Z`)!;
  const that = parse(`${dayKey(date)}T12:00:00Z`)!;
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  return dayLabel(date);
}

export function dayGroupKey(value: string | null | undefined): string {
  const date = parse(value);
  return date ? dayKey(date) : "sin-fecha";
}

/** Las tipificaciones llegan en mayúsculas desde el flujo; se leen mejor así. */
export function sentenceCase(value: string): string {
  if (value !== value.toUpperCase()) return value;
  const lower = value.toLocaleLowerCase("es-CL");
  return lower.charAt(0).toLocaleUpperCase("es-CL") + lower.slice(1);
}

/* ------------------------------------------------------------------ */
/* Cabecera de identidad                                               */
/* ------------------------------------------------------------------ */

/**
 * Avatar grande y cuadrado de la ficha. El primitivo `Avatar` llega a 44 px; la
 * cabecera de un registro pide más presencia, así que se usa la misma clase
 * `.avatar` (mismo tono por nombre en todo el producto) con otro tamaño.
 */
export function RecordAvatar({ name, seed }: { name: string; seed?: string | null }) {
  return (
    <span
      aria-hidden="true"
      data-tone={avatarTone(seed ?? name)}
      className="avatar size-14 shrink-0 rounded-xl text-lg"
    >
      {initials(name)}
    </span>
  );
}

/**
 * Cabecera del registro: avatar, nombre, identificadores en una línea y las
 * acciones a la derecha. Debajo, opcional, la franja de datos clave.
 */
export function RecordHeader({
  name,
  seed,
  eyebrow,
  identifiers,
  tags,
  actions,
  facts,
}: {
  name: string;
  seed?: string | null;
  /** Línea chica sobre el nombre (de dónde viene: campaña, cuenta). */
  eyebrow?: ReactNode;
  /** RUT, teléfono, correo: se separan con un punto medio. */
  identifiers?: ReactNode[];
  /** Marcas cortas junto al nombre (Fuera de base). */
  tags?: ReactNode;
  actions?: ReactNode;
  facts?: ReactNode;
}) {
  const ids = (identifiers ?? []).filter(Boolean);
  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <RecordAvatar name={name} seed={seed} />
          <div className="min-w-0">
            {eyebrow && <div className="mb-0.5 truncate text-xs font-medium text-muted-foreground">{eyebrow}</div>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="min-w-0 break-words text-[22px] font-semibold leading-tight tracking-tight text-foreground">
                {name}
              </h1>
              {tags}
            </div>
            {ids.length > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
                {ids.map((item, index) => (
                  <span key={index} className="inline-flex items-center gap-2">
                    {index > 0 && <span aria-hidden="true" className="text-muted-foreground/50">·</span>}
                    {item}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {facts}
    </header>
  );
}

/**
 * Franja de datos clave bajo la cabecera: estado, próxima acción, último
 * contacto, responsable. Sin cajas: columnas separadas por una línea fina,
 * como la barra de "highlights" de un CRM.
 */
export function RecordFacts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-3 lg:flex lg:gap-0 lg:divide-x lg:divide-border">
      {children}
    </dl>
  );
}

export function RecordFact({
  label,
  children,
  detail,
}: {
  label: ReactNode;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 min-w-0 text-sm font-medium text-foreground">{children}</dd>
      {detail && <dd className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</dd>}
    </div>
  );
}

/** Ícono en chip + texto: el estado operativo, sin cápsula. */
export function StateChip({
  icon: Icon,
  tone,
  label,
  danger = false,
}: {
  icon: IconType;
  tone: ChipTone;
  label: ReactNode;
  danger?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="icon-chip size-6 rounded-md" data-tone={tone} aria-hidden="true">
        <Icon size={13} />
      </span>
      <span className={cn("truncate", danger ? "text-danger" : "text-foreground")}>{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Columna de propiedades                                              */
/* ------------------------------------------------------------------ */

/** Contenedor de la columna lateral: un solo panel, grupos separados por línea. */
export function PropertyPanel({
  children,
  className,
  label = "Propiedades del registro",
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <aside
      aria-label={label}
      className={cn("atlas-panel divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-sm", className)}
    >
      {children}
    </aside>
  );
}

/** Un grupo de propiedades con nombre (Contacto, Gestión, Deuda…). */
export function PropertyGroup({
  icon: Icon,
  title,
  meta,
  children,
}: {
  icon?: IconType;
  title: ReactNode;
  /** A la derecha del título: un conteo o una acción chica. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          {Icon && <Icon size={14} className="text-muted-foreground" aria-hidden="true" />}
          {title}
        </h2>
        {meta}
      </div>
      {children}
    </section>
  );
}

/** Lista de propiedades: etiqueta a la izquierda, valor a la derecha. */
export function PropertyList({ children }: { children: ReactNode }) {
  return <dl className="space-y-2.5 text-[13px]">{children}</dl>;
}

export function Property({
  label,
  children,
  empty = false,
}: {
  label: ReactNode;
  children: ReactNode;
  /** Sin dato: el valor va en gris para que lo que sí hay destaque. */
  empty?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-baseline gap-3">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", empty ? "text-muted-foreground/70" : "text-foreground")}>{children}</dd>
    </div>
  );
}

/** Cifra en caja suave (conteos junto a un título). */
export function CountBox({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-surface-muted px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Línea de tiempo                                                     */
/* ------------------------------------------------------------------ */

/** Lista de la línea de tiempo; cada `TimelineItem` dibuja su tramo del conector. */
export function Timeline({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn("relative", className)}>{children}</ol>;
}

/**
 * Un hito: ícono por tipo en chip, conector vertical hacia el siguiente,
 * título, autor con avatar y fecha relativa (la exacta en el `title`).
 */
export function TimelineItem({
  icon: Icon,
  tone,
  title,
  date,
  author,
  authorAvatar,
  meta,
  last = false,
  children,
}: {
  icon: IconType;
  tone: ChipTone;
  title: ReactNode;
  date: string | null;
  author?: string | null;
  /** El avatar del autor; se pasa armado para elegir forma (persona o sistema). */
  authorAvatar?: ReactNode;
  /** Datos cortos junto al autor (canal, estado). */
  meta?: ReactNode;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={cn("relative flex gap-3.5", last ? "pb-1" : "pb-6")}>
      {!last && <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-9 w-px bg-border" />}
      <span className="icon-chip relative size-8 rounded-lg" data-tone={tone} aria-hidden="true">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="min-w-0 text-sm font-medium text-foreground">{title}</p>
          <time
            dateTime={date ?? undefined}
            title={dateTimeLabel(date)}
            suppressHydrationWarning
            className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
          >
            {relativeLabel(date)}
          </time>
        </div>
        {(author || meta) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            {authorAvatar}
            {author && <span className="text-foreground/80">{author}</span>}
            {author && meta && <span aria-hidden="true">·</span>}
            {meta}
          </p>
        )}
        {children && <div className="mt-2 space-y-1.5">{children}</div>}
      </div>
    </li>
  );
}

/** Texto libre de un hito (notas, cuerpo): legible, sin caja. */
export function TimelineNote({ children }: { children: ReactNode }) {
  return <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}
