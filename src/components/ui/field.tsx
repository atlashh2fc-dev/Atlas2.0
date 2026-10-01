import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Etiqueta + control en columna. Envuelve un Input/Select con su label. */
export function Field({
  label,
  hideLabel = false,
  className,
  children,
}: {
  label: ReactNode;
  /** Barras de filtros: el control ya dice qué es ("Todas las campañas"); la
   *  etiqueta queda para lectores de pantalla. */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={hideLabel ? "sr-only" : "text-[13px] font-medium text-foreground"}>{label}</span>
      {children}
    </label>
  );
}

export type FieldSize = "sm" | "md";

const FIELD_BASE =
  "w-full rounded-lg border border-border-strong/70 bg-surface text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";

const FIELD_SIZES: Record<FieldSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3 text-sm",
};

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  fieldSize?: FieldSize;
}

export function Input({ fieldSize = "md", className, ...props }: InputProps) {
  return <input className={cn(FIELD_BASE, FIELD_SIZES[fieldSize], className)} {...props} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  fieldSize?: FieldSize;
}

export function Select({ fieldSize = "md", className, children, ...props }: SelectProps) {
  return (
    <select className={cn(FIELD_BASE, FIELD_SIZES[fieldSize], className)} {...props}>
      {children}
    </select>
  );
}
