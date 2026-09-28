/**
 * La bandeja de prospección: quien mostró interés en la campaña de correo y
 * espera que una persona le escriba. El resumen diario de Atlas Lead lo avisa
 * ("Para contactar hoy por WhatsApp"); la gestión se registra acá, fuera del
 * pipeline, porque una apertura es una señal y no un negocio.
 */

export type Prospecto = {
  lead_id: string;
  empresa: string | null;
  contacto: string | null;
  email: string | null;
  telefono: string | null;
  campana: string | null;
  clic: boolean;
  aperturas: number;
  respondio: boolean;
  primera_senal_at: string | null;
  ultima_senal_at: string | null;
  ultimo_resultado: Resultado | null;
  ultimo_toque_at: string | null;
  seguir_at: string | null;
  toques: number;
  estado: "nuevo" | "volvio" | "seguimiento";
  prioridad: number;
};

export const RESULTADOS = ["whatsapp", "llamada", "correo", "posponer", "interesado", "no_interesa", "numero_malo"] as const;
export type Resultado = (typeof RESULTADOS)[number];

export const ETIQUETA_RESULTADO: Record<Resultado, string> = {
  whatsapp: "Le escribiste por WhatsApp",
  llamada: "Lo llamaste",
  correo: "Le escribiste por correo",
  posponer: "Lo pospusiste",
  interesado: "Interesado: pasó al pipeline",
  no_interesa: "No le interesa",
  numero_malo: "El número no sirve",
};

export function esResultado(valor: string): valor is Resultado {
  return (RESULTADOS as readonly string[]).includes(valor);
}

/**
 * Un celular chileno en formato internacional (569XXXXXXXX), o null si es fijo
 * o no se entiende. WhatsApp solo sirve con celular; un fijo se llama.
 */
export function celularChileno(telefono: string | null | undefined): string | null {
  const digitos = (telefono ?? "").replace(/\D/g, "");
  if (digitos.length === 9 && digitos.startsWith("9")) return `56${digitos}`;
  if (digitos.length === 11 && digitos.startsWith("569")) return digitos;
  return null;
}

/** El mismo mensaje que propone el resumen de Atlas Lead, firmado por quien escribe. */
export function mensajeDeWhatsapp({ remitente, empresaPropia, empresa }: { remitente: string; empresaPropia: string; empresa: string | null }): string {
  return [
    `Hola, le escribe ${remitente} de ${empresaPropia}.`,
    `Hace unos días le enviamos un correo${empresa ? ` a ${empresa}` : ""} sobre un sitio web con IA que atiende a sus clientes a cualquier hora.`,
    "¿Le acomoda que le muestre en 10 minutos cómo quedaría el suyo?",
  ].join(" ");
}

export function enlaceWhatsapp(celular: string, mensaje: string): string {
  return `https://wa.me/${celular}?text=${encodeURIComponent(mensaje)}`;
}

/** Lo que hizo la persona, en una frase corta y en orden de temperatura. */
export function senalDe(prospecto: Pick<Prospecto, "respondio" | "clic" | "aperturas">): string {
  if (prospecto.respondio) return "Respondió el correo";
  if (prospecto.clic) return "Hizo clic en el correo";
  if (prospecto.aperturas > 1) return `Abrió ${prospecto.aperturas} veces`;
  return "Abrió el correo";
}

export function haceCuanto(desde: string | null, ahora = new Date()): string {
  if (!desde) return "";
  const minutos = Math.max(0, Math.floor((ahora.getTime() - new Date(desde).getTime()) / 60000));
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}
