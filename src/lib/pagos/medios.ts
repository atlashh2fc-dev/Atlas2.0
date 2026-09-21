import type { BadgeTone } from "@/components/ui";

/** Medios de pago y estados, con sus etiquetas. Puro: lo usan servidor y cliente. */

export const MEDIOS_EN_CAJA = ["efectivo", "debito", "credito", "transferencia", "otro"] as const;
export type MedioEnCaja = (typeof MEDIOS_EN_CAJA)[number];
export type MedioDePago = MedioEnCaja | "webpay";

export const ETIQUETA_MEDIO: Record<MedioDePago, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  webpay: "En línea (Webpay)",
  otro: "Otro",
};

export type EstadoPago = "pendiente" | "pagado" | "fallido" | "anulado";

export const ETIQUETA_ESTADO_PAGO: Record<EstadoPago, { label: string; tone: BadgeTone }> = {
  pendiente: { label: "Pendiente", tone: "warning" },
  pagado: { label: "Pagado", tone: "success" },
  fallido: { label: "Rechazado", tone: "danger" },
  anulado: { label: "Anulado", tone: "neutral" },
};

export function esMedioEnCaja(valor: string): valor is MedioEnCaja {
  return (MEDIOS_EN_CAJA as readonly string[]).includes(valor);
}
