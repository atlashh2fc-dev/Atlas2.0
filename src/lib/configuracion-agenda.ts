/**
 * Cómo trabaja la agenda de una empresa: cuándo sale el recordatorio de
 * cita, si la respuesta de la persona confirma o cancela sola, y los textos
 * propios de cada mensaje. Puro: lo usan servidor y cliente.
 *
 * Sin fila en `configuracion_agenda` valen los valores por defecto, que son
 * los mismos de la base.
 */

export type ConfiguracionAgenda = {
  recordatorio_dias_antes: number;
  recordatorio_desde: string;
  confirmacion_automatica: boolean;
  textos: Record<string, string>;
  reserva_activa: boolean;
  reserva_slug: string | null;
  reserva_anticipacion_horas: number;
  reserva_dias: number;
  reserva_intervalo_min: number;
  reserva_mensaje: string | null;
};

export const CONFIGURACION_POR_DEFECTO: ConfiguracionAgenda = {
  recordatorio_dias_antes: 1,
  recordatorio_desde: "10:00",
  confirmacion_automatica: true,
  textos: {},
  reserva_activa: false,
  reserva_slug: null,
  reserva_anticipacion_horas: 2,
  reserva_dias: 30,
  reserva_intervalo_min: 15,
  reserva_mensaje: null,
};

export const OPCIONES_RESERVA = {
  anticipacion: [
    { valor: 0, etiqueta: "Hasta la hora misma" },
    { valor: 1, etiqueta: "1 hora antes" },
    { valor: 2, etiqueta: "2 horas antes" },
    { valor: 4, etiqueta: "4 horas antes" },
    { valor: 12, etiqueta: "12 horas antes" },
    { valor: 24, etiqueta: "Un día antes" },
    { valor: 48, etiqueta: "Dos días antes" },
  ],
  dias: [
    { valor: 7, etiqueta: "La próxima semana" },
    { valor: 14, etiqueta: "Las próximas 2 semanas" },
    { valor: 30, etiqueta: "El próximo mes" },
    { valor: 60, etiqueta: "Los próximos 2 meses" },
    { valor: 90, etiqueta: "Los próximos 3 meses" },
  ],
  intervalo: [
    { valor: 10, etiqueta: "Cada 10 minutos" },
    { valor: 15, etiqueta: "Cada 15 minutos" },
    { valor: 20, etiqueta: "Cada 20 minutos" },
    { valor: 30, etiqueta: "Cada 30 minutos" },
    { valor: 60, etiqueta: "Cada hora" },
  ],
} as const;

export const OPCIONES_ANTICIPACION = [
  { valor: 0, etiqueta: "El mismo día de la cita" },
  { valor: 1, etiqueta: "1 día antes" },
  { valor: 2, etiqueta: "2 días antes" },
  { valor: 3, etiqueta: "3 días antes" },
] as const;

/** Horas en que puede empezar a salir el recordatorio: de 07:00 a 20:00. */
export const HORAS_DE_ENVIO = Array.from({ length: 14 }, (_, indice) => `${String(indice + 7).padStart(2, "0")}:00`);

/** Normaliza lo que viene de la base ("10:00:00" → "10:00"). */
export function configuracionDesdeFila(fila: Partial<Record<keyof ConfiguracionAgenda, unknown>> | null | undefined): ConfiguracionAgenda {
  if (!fila) return { ...CONFIGURACION_POR_DEFECTO, textos: {} };
  const entero = (valor: unknown, porDefecto: number) => (Number.isInteger(Number(valor)) && valor !== null && valor !== undefined ? Number(valor) : porDefecto);
  const dias = Number(fila.recordatorio_dias_antes);
  const desde = typeof fila.recordatorio_desde === "string" ? fila.recordatorio_desde.slice(0, 5) : CONFIGURACION_POR_DEFECTO.recordatorio_desde;
  const textos: Record<string, string> = {};
  if (fila.textos && typeof fila.textos === "object") {
    for (const [clave, valor] of Object.entries(fila.textos as Record<string, unknown>)) {
      if (typeof valor === "string" && valor.trim()) textos[clave] = valor;
    }
  }
  return {
    recordatorio_dias_antes: Number.isInteger(dias) && dias >= 0 && dias <= 3 ? dias : CONFIGURACION_POR_DEFECTO.recordatorio_dias_antes,
    recordatorio_desde: /^\d{2}:\d{2}$/.test(desde) ? desde : CONFIGURACION_POR_DEFECTO.recordatorio_desde,
    confirmacion_automatica: fila.confirmacion_automatica !== false,
    textos,
    reserva_activa: fila.reserva_activa === true,
    reserva_slug: typeof fila.reserva_slug === "string" && fila.reserva_slug ? fila.reserva_slug : null,
    reserva_anticipacion_horas: entero(fila.reserva_anticipacion_horas, CONFIGURACION_POR_DEFECTO.reserva_anticipacion_horas),
    reserva_dias: entero(fila.reserva_dias, CONFIGURACION_POR_DEFECTO.reserva_dias),
    reserva_intervalo_min: entero(fila.reserva_intervalo_min, CONFIGURACION_POR_DEFECTO.reserva_intervalo_min),
    reserva_mensaje: typeof fila.reserva_mensaje === "string" && fila.reserva_mensaje.trim() ? fila.reserva_mensaje : null,
  };
}

/** La frase que resume cuándo sale el recordatorio, para mostrarla en pantalla. */
export function resumenRecordatorio(configuracion: ConfiguracionAgenda): string {
  const cuando = configuracion.recordatorio_dias_antes === 0
    ? "el mismo día de la cita"
    : configuracion.recordatorio_dias_antes === 1
      ? "el día anterior"
      : `${configuracion.recordatorio_dias_antes} días antes`;
  return `Sale ${cuando}, desde las ${configuracion.recordatorio_desde}`;
}

/** Lunes = 1 … domingo = 7, como `isodow` en la base. */
export const NOMBRE_DIA: Record<number, string> = { 1: "lunes", 2: "martes", 3: "miércoles", 4: "jueves", 5: "viernes", 6: "sábado", 7: "domingo" };

export type TramoHorario = { dia_semana: number; desde: string; hasta: string };

/** Sin horario cargado la agenda ofrece esto, igual que la base. */
export const HORARIO_POR_DEFECTO: TramoHorario[] = [
  ...[1, 2, 3, 4, 5].map((dia) => ({ dia_semana: dia, desde: "09:00", hasta: "19:00" })),
  { dia_semana: 6, desde: "10:00", hasta: "14:00" },
];

/** Los tramos de cada día (hasta dos), ordenados. */
export function tramosPorDia(tramos: TramoHorario[]): Record<number, { desde: string; hasta: string }[]> {
  const porDia: Record<number, { desde: string; hasta: string }[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (const tramo of tramos) {
    porDia[tramo.dia_semana]?.push({ desde: tramo.desde.slice(0, 5), hasta: tramo.hasta.slice(0, 5) });
  }
  for (const dia of Object.keys(porDia)) porDia[Number(dia)].sort((a, b) => a.desde.localeCompare(b.desde));
  return porDia;
}

const DIA_CORTO: Record<number, string> = { 1: "lun", 2: "mar", 3: "mié", 4: "jue", 5: "vie", 6: "sáb", 7: "dom" };

/** «lun a vie 09:00–13:30 y 14:30–19:00 · sáb 10:00–14:00»: días seguidos con el mismo horario van juntos. */
export function resumenHorario(porDia: Record<number, { desde: string; hasta: string }[]>): string {
  const firma = (dia: number) => (porDia[dia] ?? []).map((tramo) => `${tramo.desde}–${tramo.hasta}`).join(" y ");
  const partes: string[] = [];
  let dia = 1;
  while (dia <= 7) {
    const actual = firma(dia);
    if (!actual) {
      dia += 1;
      continue;
    }
    let fin = dia;
    while (fin < 7 && firma(fin + 1) === actual) fin += 1;
    partes.push(`${fin === dia ? DIA_CORTO[dia] : `${DIA_CORTO[dia]} a ${DIA_CORTO[fin]}`} ${actual}`);
    dia = fin + 1;
  }
  return partes.length ? partes.join(" · ") : "sin días abiertos";
}

/** El rango que la grilla de la agenda tiene que mostrar: de la primera apertura a la última hora de cierre. */
export function rangoDeLaGrilla(tramos: { desde: string; hasta: string }[]): { apertura: number; cierre: number } {
  if (tramos.length === 0) return { apertura: 8, cierre: 20 };
  const minimo = Math.min(...tramos.map((tramo) => Number(tramo.desde.slice(0, 2))));
  const maximo = Math.max(...tramos.map((tramo) => Math.ceil((Number(tramo.hasta.slice(0, 2)) * 60 + Number(tramo.hasta.slice(3, 5))) / 60)));
  return { apertura: Math.max(0, Math.min(minimo, 23)), cierre: Math.min(24, Math.max(maximo, minimo + 1)) };
}
