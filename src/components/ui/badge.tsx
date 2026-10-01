import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const DOT: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground/45",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-primary",
};

/**
 * Estado o etiqueta: un punto de color y el texto, sin cápsula.
 *
 * Antes era una píldora con fondo y borde; con diez por fila la tabla parecía
 * un tablero de fichas y nada destacaba. El punto lleva el color, el texto
 * dice lo que significa (no se depende solo del color) y la fila respira.
 * `neutral` es una etiqueta sin estado: va sin punto, en gris.
 */
export function Badge({
  tone = "neutral",
  dot = tone !== "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  /** Mostrar el punto de color. Por defecto solo en tonos con estado. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium",
        tone === "neutral" ? "text-muted-foreground" : "text-foreground",
        tone === "danger" && "text-danger",
        className
      )}
    >
      {dot && <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />}
      {children}
    </span>
  );
}

/** Punto de estado (registro SIP, disponibilidad de agente, salud de cola). */
export function StatusDot({ tone = "neutral", className }: { tone?: BadgeTone; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 flex-shrink-0 rounded-full", DOT[tone], className)} />;
}
