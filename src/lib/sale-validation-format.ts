/**
 * Formato de la validación de ventas. Vive fuera de los componentes de
 * cliente porque las páginas del servidor también lo usan: una función de un
 * módulo "use client" no se puede ejecutar en el servidor.
 */
export function formatUf(value: number | null | undefined) {
  if (value == null) return "—";
  return `${value.toLocaleString("es-CL", { maximumFractionDigits: 2 })} UF`;
}
