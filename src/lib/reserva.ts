/**
 * La reserva en línea, lo que comparten la página pública y la
 * configuración: tipos de lo que expone la base, el armado del enlace y la
 * forma de agrupar horas. Puro: lo usan servidor y cliente.
 */

import { URL_PUBLICA } from "./mensajes/plantillas.ts";

export type ServicioPublico = {
  id: string;
  nombre: string;
  categoria: string | null;
  duracion: number;
  precio: number | null;
  descripcion: string | null;
};

export type ProfesionalPublico = { id: string; nombre: string; especialidad: string | null; color: string };

export type ReservaPublica = {
  empresa: string;
  edicion: "dental" | "vet" | "barber" | string;
  mensaje: string | null;
  dias: number;
  servicios: ServicioPublico[];
  profesionales: ProfesionalPublico[];
};

export type HoraLibre = { inicio: string; hora: string; profesional_id: string };

export type ReservaHecha = { token: string; inicio: string; profesional: string; servicio: string; empresa: string };

export const SLUG_VALIDO = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
export const SLUGS_RESERVADOS = new Set(["cita", "admin", "api"]);

/** El texto que la empresa escribe para su enlace, llevado a un slug válido. */
export function normalizarSlug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function enlaceDeReserva(slug: string): string {
  return `${URL_PUBLICA}/reservar/${slug}`;
}

/** Código para pegar la reserva dentro de la web de la clínica. */
export function codigoParaWeb(slug: string): string {
  return `<iframe src="${enlaceDeReserva(slug)}?embebido=1" title="Reserva tu hora" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>`;
}

/** Las horas libres en mañana (antes de las 13:00) y tarde. */
export function agruparHoras(horas: HoraLibre[]): { titulo: string; horas: HoraLibre[] }[] {
  const manana = horas.filter((hora) => hora.hora < "13:00");
  const tarde = horas.filter((hora) => hora.hora >= "13:00");
  return [
    { titulo: "Mañana", horas: manana },
    { titulo: "Tarde", horas: tarde },
  ].filter((grupo) => grupo.horas.length > 0);
}

/** Celular chileno tolerante: «9 8765 4321», «+56 9 8765-4321» o «56987654321». */
export function celularValido(texto: string): boolean {
  const digitos = texto.replace(/\D/g, "");
  return (digitos.length === 9 && digitos.startsWith("9")) || (digitos.length === 11 && digitos.startsWith("569"));
}

/** Los servicios agrupados por categoría, en el orden en que llegan. */
export function serviciosPorCategoria(servicios: ServicioPublico[]): { categoria: string; servicios: ServicioPublico[] }[] {
  const grupos = new Map<string, ServicioPublico[]>();
  for (const servicio of servicios) {
    const categoria = servicio.categoria?.trim() || "Servicios";
    grupos.set(categoria, [...(grupos.get(categoria) ?? []), servicio]);
  }
  return [...grupos.entries()].map(([categoria, lista]) => ({ categoria, servicios: lista }));
}

/** Un archivo de calendario (.ics) para que la persona guarde su hora. */
export function archivoCalendario(entrada: { inicio: string; minutos: number; titulo: string; lugar: string; enlace: string }): string {
  const formato = (fecha: Date) => fecha.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const inicio = new Date(entrada.inicio);
  const fin = new Date(inicio.getTime() + entrada.minutos * 60000);
  const limpio = (texto: string) => texto.replace(/[\\;,]/g, (caracter) => `\\${caracter}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Atlas//Reserva//ES",
    "BEGIN:VEVENT",
    `UID:${formato(inicio)}-${Math.abs(hash(entrada.enlace))}@atlas`,
    `DTSTAMP:${formato(new Date())}`,
    `DTSTART:${formato(inicio)}`,
    `DTEND:${formato(fin)}`,
    `SUMMARY:${limpio(entrada.titulo)}`,
    `LOCATION:${limpio(entrada.lugar)}`,
    `DESCRIPTION:${limpio(`Para ver o cancelar tu hora: ${entrada.enlace}`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Tu hora es en 2 horas",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function hash(texto: string): number {
  let valor = 0;
  for (let indice = 0; indice < texto.length; indice += 1) valor = (valor * 31 + texto.charCodeAt(indice)) | 0;
  return valor;
}
