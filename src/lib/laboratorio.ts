import type { BadgeTone } from "@/components/ui";

/** Estados de una orden de laboratorio y lo que sigue en cada uno. Puro. */
export const ESTADO_ORDEN: Record<string, { label: string; tone: BadgeTone; siguiente?: { estado: string; label: string } }> = {
  enviada: { label: "En el laboratorio", tone: "info", siguiente: { estado: "recibida", label: "Llegó" } },
  en_prueba: { label: "En prueba", tone: "warning", siguiente: { estado: "recibida", label: "Llegó" } },
  recibida: { label: "Recibida", tone: "success", siguiente: { estado: "instalada", label: "Instalada" } },
  instalada: { label: "Instalada", tone: "neutral" },
  cancelada: { label: "Cancelada", tone: "neutral" },
};

/** Atrasada: se esperaba antes de hoy y todavía no llega. */
export function ordenAtrasada(orden: { estado: string; entrega_estimada: string | null }, hoy: string): boolean {
  return (orden.estado === "enviada" || orden.estado === "en_prueba") && Boolean(orden.entrega_estimada) && (orden.entrega_estimada as string) < hoy;
}
