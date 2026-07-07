import { clsx, type ClassValue } from "clsx";

/**
 * Une clases condicionales. Envuelve `clsx` para tener un único punto de
 * entrada en toda la app (y poder añadir tailwind-merge más adelante sin
 * tocar los consumidores).
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
