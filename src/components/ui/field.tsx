import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Etiqueta + control en columna. Envuelve un Input/Select con su label. */
export function Field({
  label,
  className,
  children,
}: {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export type FieldSize = "sm" | "md";

const FIELD_BASE =
  "w-full rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

const FIELD_SIZES: Record<FieldSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
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
