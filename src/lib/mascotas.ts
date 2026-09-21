/**
 * Semáforo de la vacuna de una mascota, como el de los sistemas veterinarios:
 * vencida (rojo), por vencer en los próximos 30 días (ámbar) o al día.
 */
export type EstadoVacuna = "vencida" | "por_vencer" | "al_dia" | "sin_dato";

const DIA = 24 * 60 * 60 * 1000;

export function estadoVacuna(proxima: string | null, ahora = new Date()): EstadoVacuna {
  if (!proxima) return "sin_dato";
  const dias = (new Date(`${proxima}T12:00:00`).getTime() - ahora.getTime()) / DIA;
  if (dias < 0) return "vencida";
  if (dias <= 30) return "por_vencer";
  return "al_dia";
}

export const ETIQUETA_VACUNA: Record<EstadoVacuna, string> = {
  vencida: "Vacuna vencida",
  por_vencer: "Vacuna por vencer",
  al_dia: "Vacuna al día",
  sin_dato: "Sin registro de vacuna",
};

/** Edad legible a partir de la fecha de nacimiento: "3 años", "8 meses". */
export function edad(nacimiento: string | null | undefined, ahora = new Date()): string | null {
  if (!nacimiento) return null;
  const nacio = new Date(`${nacimiento}T12:00:00`);
  if (Number.isNaN(nacio.getTime())) return null;
  let meses = (ahora.getFullYear() - nacio.getFullYear()) * 12 + (ahora.getMonth() - nacio.getMonth());
  if (ahora.getDate() < nacio.getDate()) meses -= 1;
  if (meses < 0) return null;
  if (meses < 12) return `${meses} ${meses === 1 ? "mes" : "meses"}`;
  const anios = Math.floor(meses / 12);
  return `${anios} ${anios === 1 ? "año" : "años"}`;
}
