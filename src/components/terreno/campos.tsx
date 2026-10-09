import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Controles para el celular: 48 px de alto (dedo, no mouse) y 16 px de letra
 * para que iOS no haga zoom al tocar el campo.
 */
const CONTROL =
  "h-12 w-full rounded-xl border border-border-strong/70 bg-surface px-3.5 text-base text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";

export function CampoTerreno({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-sm text-danger" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function InputTerreno({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

export function SelectTerreno({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "appearance-auto", className)} {...props}>
      {children}
    </select>
  );
}

export const BOTON_PRIMARIO =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground shadow-sm active:bg-primary-hover disabled:pointer-events-none disabled:opacity-60";

export const BOTON_SECUNDARIO =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-5 text-base font-medium text-foreground shadow-sm active:bg-surface-muted disabled:pointer-events-none disabled:opacity-60";
