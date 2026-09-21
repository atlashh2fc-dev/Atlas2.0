/** Segmentos de una campaña de clínica. Puro: lo usan servidor y cliente. */

export const SEGMENTOS = [
  { id: "vacuna_por_vencer", label: "Vacuna vencida o por vencer", parametro: "dias", ayuda: "Días hacia adelante", porDefecto: "30", soloVet: true },
  { id: "sin_control", label: "Sin control hace más de", parametro: "meses", ayuda: "Meses sin venir", porDefecto: "6", soloVet: false },
  { id: "presupuesto_abierto", label: "Con presupuesto abierto", parametro: null, ayuda: "", porDefecto: "", soloVet: false },
  { id: "especie", label: "Por especie", parametro: "especie", ayuda: "Perro, Gato u Otro", porDefecto: "Perro", soloVet: true },
  { id: "cumple_mascota", label: "Mascotas que cumplen años este mes", parametro: null, ayuda: "", porDefecto: "", soloVet: true },
  { id: "todos", label: "Todas las fichas con contacto", parametro: null, ayuda: "", porDefecto: "", soloVet: false },
] as const;

export type SegmentoId = (typeof SEGMENTOS)[number]["id"];

export const ETIQUETA_CANAL: Record<string, string> = { auto: "WhatsApp, o correo si no hay celular", whatsapp: "Solo WhatsApp", correo: "Solo correo" };

export const ETIQUETA_ESTADO_CAMPANA: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  borrador: { label: "Borrador", tone: "neutral" },
  programada: { label: "Programada", tone: "info" },
  enviada: { label: "Enviada", tone: "success" },
  cancelada: { label: "Cancelada", tone: "neutral" },
};
