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
};

export const CONFIGURACION_POR_DEFECTO: ConfiguracionAgenda = {
  recordatorio_dias_antes: 1,
  recordatorio_desde: "10:00",
  confirmacion_automatica: true,
  textos: {},
};

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
