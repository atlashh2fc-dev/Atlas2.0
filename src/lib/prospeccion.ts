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

const NOMBRES_DE_RELLENO = new Set(["un cliente", "un lead", "sin nombre"]);
const SUFIJO_LEGAL = /\s*(,|\.)?\s*\b(limitada|ltda\.?|s\.?\s?p\.?\s?a\.?|spa|s\.?\s?a\.?|e\.?\s?i\.?\s?r\.?\s?l\.?|y\s+c[ií]a\.?)\s*$/i;
const PREFIJO_LEGAL = /^(sociedad|soc\.?)\s+(de\s+)?(comercial\s+|agr[ií]c(ola)?\.?\s+)?/i;
const PALABRAS_MENORES = new Set(["y", "e", "de", "del", "la", "las", "los", "el", "en"]);

/** "Sociedad de Transportes Hermosilla y Hermosilla Limitada" → "Transportes Hermosilla y Hermosilla". */
export function nombreComoSeDice(razonSocial: string | null | undefined): string | null {
  let nombre = (razonSocial ?? "").replace(/\s+/g, " ").trim();
  if (!nombre || NOMBRES_DE_RELLENO.has(nombre.toLowerCase())) return null;
  nombre = nombre.replace(PREFIJO_LEGAL, "");
  for (let vuelta = 0; vuelta < 2; vuelta += 1) nombre = nombre.replace(SUFIJO_LEGAL, "").trim();
  const palabras = nombre.split(" ").filter(Boolean);
  // Más de cinco palabras suena a registro, no a empresa: mejor sin nombre.
  if (palabras.length === 0 || palabras.length > 5) return null;
  return palabras
    .map((palabra, i) => (i > 0 && PALABRAS_MENORES.has(palabra.toLowerCase()) ? palabra.toLowerCase() : palabra))
    .join(" ");
}

/** Lo que el cliente de esa empresa pide por WhatsApp; la bandeja no trae rubro, así que se lee del nombre. */
function loQuePide(empresa: string | null): { pide: string; pierde: string } {
  const nombre = (empresa ?? "").toLowerCase();
  if (/(restaurant|resto|comida|gastronom|cafeter|sushi|pizzer)/.test(nombre)) return { pide: "una reserva", pierde: "reserve en otro lugar" };
  if (/(cl[ií]nica|dental|odontol|veterin|m[eé]dic|salud|est[eé]tica|belleza|peluquer|kine)/.test(nombre)) return { pide: "una hora", pierde: "la reserve en otro lugar" };
  return { pide: "una cotización", pierde: "cotice con otra empresa" };
}

/**
 * El mismo mensaje que propone el resumen de Atlas Lead, firmado por quien
 * escribe. Habla del cliente y no de nosotros, hace una sola pregunta y nunca
 * menciona que abrió el correo. Si ya le escribimos, va el seguimiento; si
 * respondió el correo, se retoma esa conversación.
 */
export function mensajeDeWhatsapp({ remitente, empresaPropia, empresa, respondio = false, toques = 0 }: {
  remitente: string;
  empresaPropia: string;
  empresa: string | null;
  respondio?: boolean;
  toques?: number;
}): string {
  const nombre = nombreComoSeDice(empresa);
  if (respondio) {
    return [
      `Hola, soy ${remitente}, de ${empresaPropia}.`,
      `Recibí su respuesta${nombre ? ` de ${nombre}` : ""} a nuestro correo y preferí escribirle directamente.`,
      "¿Le acomoda que sigamos la conversación por aquí?",
    ].join(" ");
  }
  if (toques > 0) {
    return [
      "Le dejo el dato por si le sirve: hacemos que la web y el WhatsApp de empresas como la suya respondan solos, con la información que ustedes aprueban.",
      "¿Le interesa que le envíe un ejemplo de cómo quedaría?",
      "Si no es un tema para ustedes, me avisa y no vuelvo a escribirle.",
    ].join(" ");
  }
  const { pide, pierde } = loQuePide(empresa);
  return [
    `Hola, soy ${remitente}, de ${empresaPropia}, en Santiago.`,
    `Una pregunta breve${nombre ? ` para ${nombre}` : ""}:`,
    `si un cliente les pide ${pide} a las 10 de la noche, ¿alguien alcanza a responderle antes de que ${pierde}?`,
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
