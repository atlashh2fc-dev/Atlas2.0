import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-foreground shadow-sm hover:bg-surface-muted",
  ghost: "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
  danger: "bg-danger text-primary-foreground shadow-sm hover:opacity-90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
};

/**
 * Devuelve las clases de un botón. Úsalo cuando necesites el estilo de botón
 * sobre otro elemento (p. ej. `<Link className={buttonClasses()}>`).
 */
export function buttonClasses(opts?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): string {
  const { variant = "primary", size = "md", className } = opts ?? {};
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={buttonClasses({ variant, size, className })} {...props} />;
}
