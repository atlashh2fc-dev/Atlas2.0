/**
 * La agenda como archivo iCalendar (RFC 5545). Puro: lo usan la ruta y las
 * pruebas. Cada cita lleva un UID estable para que el calendario la
 * actualice en vez de duplicarla cuando cambia.
 */

import { URL_PUBLICA } from "./mensajes/plantillas.ts";

export type CitaDeCalendario = { id: string; inicio: string; fin: string; motivo: string; estado: string; persona: string; mascota: string | null; box: string | null };

function formato(fecha: string | Date): string {
  return new Date(fecha).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapar(texto: string): string {
  return texto.replace(/\\/g, "\\\\").replace(/[;,]/g, (caracter) => `\\${caracter}`).replace(/\r?\n/g, "\\n");
}

/** Las líneas de más de 75 bytes se doblan, como pide el estándar. */
function doblar(linea: string): string {
  if (linea.length <= 74) return linea;
  const partes: string[] = [];
  for (let indice = 0; indice < linea.length; indice += 73) partes.push((indice === 0 ? "" : " ") + linea.slice(indice, indice + 73));
  return partes.join("\r\n");
}

export function calendarioIcs(profesional: string, empresa: string, citas: CitaDeCalendario[]): string {
  const ahora = formato(new Date());
  const eventos = citas.flatMap((cita) => {
    const quien = cita.mascota ? `${cita.mascota} (${cita.persona})` : cita.persona;
    return [
      "BEGIN:VEVENT",
      `UID:${cita.id}@atlas`,
      `DTSTAMP:${ahora}`,
      `DTSTART:${formato(cita.inicio)}`,
      `DTEND:${formato(cita.fin)}`,
      doblar(`SUMMARY:${escapar(`${quien} · ${cita.motivo}`)}`),
      ...(cita.box ? [doblar(`LOCATION:${escapar(`${empresa} · ${cita.box}`)}`)] : [doblar(`LOCATION:${escapar(empresa)}`)]),
      `STATUS:${cita.estado === "confirmada" || cita.estado === "en_sala" || cita.estado === "atendida" ? "CONFIRMED" : "TENTATIVE"}`,
      "END:VEVENT",
    ];
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Atlas//Agenda//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    doblar(`X-WR-CALNAME:${escapar(`${profesional} · ${empresa}`)}`),
    "X-WR-TIMEZONE:America/Santiago",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
    ...eventos,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function enlaceCalendario(token: string): string {
  return `${URL_PUBLICA}/api/calendario/${token}.ics`;
}

/** Abre Google Calendar con la suscripción lista para aceptar. */
export function enlaceGoogleCalendar(token: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(enlaceCalendario(token).replace(/^https:/, "webcal:"))}`;
}
