import type { BadgeTone } from "@/components/ui";

/**
 * La agenda de la clínica: horas en Chile y estados de una cita.
 *
 * Una cita nace reservada, la recepción la confirma (por WhatsApp o
 * teléfono), pasa a sala cuando la persona llega, y termina atendida. Si no
 * se presenta queda como "no vino"; si avisa, cancelada. Las dos últimas
 * liberan el horario.
 */

export const ZONA_CLINICA = "America/Santiago";

export const ESTADOS_CITA = ["reservada", "confirmada", "en_sala", "atendida", "no_vino", "cancelada"] as const;
export type EstadoCita = (typeof ESTADOS_CITA)[number];

export const ETIQUETA_ESTADO: Record<EstadoCita, { label: string; tone: BadgeTone }> = {
  reservada: { label: "Sin confirmar", tone: "neutral" },
  confirmada: { label: "Confirmada", tone: "info" },
  en_sala: { label: "En sala", tone: "warning" },
  atendida: { label: "Atendida", tone: "success" },
  no_vino: { label: "No vino", tone: "danger" },
  cancelada: { label: "Cancelada", tone: "neutral" },
};

/** Los estados que ocupan el horario: lo cancelado y quien no vino lo liberan. */
export function ocupaHorario(estado: EstadoCita): boolean {
  return estado !== "cancelada" && estado !== "no_vino";
}

export type Cita = {
  id: string;
  cuenta_id: string;
  mascota_id: string | null;
  profesional_id: string;
  inicio: string;
  fin: string;
  motivo: string;
  estado: EstadoCita;
  nota: string | null;
  sales_companies: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null;
  mascotas: { nombre: string; especie: string } | { nombre: string; especie: string }[] | null;
};

export type Profesional = {
  id: string;
  nombre: string;
  especialidad: string | null;
  color: string;
  activo: boolean;
};

/** Supabase entrega las relaciones como arreglo; acá siempre es una sola fila. */
export function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

/** "2026-09-21" para un instante, según el reloj de Chile. */
export function fechaEnChile(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_CLINICA, year: "numeric", month: "2-digit", day: "2-digit" }).format(instante);
}

/** Minutos desde la medianoche de Chile hasta el instante. */
export function minutosEnChile(instante: Date): number {
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(instante);
  const hora = Number(partes.find((parte) => parte.type === "hour")?.value ?? 0);
  const minuto = Number(partes.find((parte) => parte.type === "minute")?.value ?? 0);
  return hora * 60 + minuto;
}

/** Desfase de Chile respecto a UTC en ese instante (negativo: -180 o -240). */
function desfaseEnMinutos(instante: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_CLINICA,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value ?? 0);
  const pared = Date.UTC(valor("year"), valor("month") - 1, valor("day"), valor("hour"), valor("minute"), valor("second"));
  return Math.round((pared - instante.getTime()) / 60000);
}

/**
 * El instante que corresponde a una fecha y hora de pared en Chile. Se
 * calcula con el desfase vigente ese mismo día, así los cambios de hora no
 * corren las citas.
 */
export function instanteEnChile(fecha: string, hora = "00:00"): Date {
  if (!FECHA_ISO.test(fecha) || !HORA.test(hora)) throw new Error("Fecha u hora inválida.");
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  const aproximado = new Date(Date.UTC(anio, mes - 1, dia, hh + 3, mm));
  const desfase = desfaseEnMinutos(aproximado);
  return new Date(Date.UTC(anio, mes - 1, dia, hh, mm) - desfase * 60000);
}

/** Suma días a una fecha "2026-09-21" sin pasar por zonas horarias. */
export function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

export function esFechaValida(valor: string | undefined): valor is string {
  return typeof valor === "string" && FECHA_ISO.test(valor) && !Number.isNaN(Date.parse(`${valor}T12:00:00Z`));
}

/** Teléfono chileno para un enlace de WhatsApp: solo dígitos, con el 56 delante. */
export function telefonoWhatsApp(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  const digitos = telefono.replace(/\D/g, "");
  if (digitos.length === 9 && digitos.startsWith("9")) return `56${digitos}`;
  if (digitos.length === 11 && digitos.startsWith("569")) return digitos;
  return digitos.length >= 8 ? digitos : null;
}

export function enlaceWhatsApp(telefono: string | null | undefined, mensaje: string): string | null {
  const numero = telefonoWhatsApp(telefono);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}` : null;
}
