/**
 * Instagram Direct y Messenger: los dos llegan por la plataforma de Messenger
 * de Meta con la misma forma (`entry[].messaging[]`). Aquí solo se aplanan los
 * mensajes; lecturas, entregas y reacciones no mueven la bandeja y se ignoran.
 */

export type CanalSocial = "instagram" | "messenger";
export type CanalDeMensajeria = "whatsapp" | CanalSocial;

export const NOMBRE_DEL_CANAL: Record<CanalDeMensajeria, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

export function esCanalSocial(canal: unknown): canal is CanalSocial {
  return canal === "instagram" || canal === "messenger";
}

export function canalDeMensajeria(canal: unknown): CanalDeMensajeria {
  return esCanalSocial(canal) ? canal : "whatsapp";
}

export type MensajeSocial = {
  canal: CanalSocial;
  /** Página (Messenger) o cuenta profesional de Instagram que recibe el webhook. */
  cuentaId: string;
  /** Identificador del contacto en esa página o cuenta (PSID / IGSID). */
  contactoId: string;
  direction: "inbound" | "outbound";
  providerMessageId: string;
  messageType: "text" | "image" | "audio" | "video" | "file" | "unknown";
  textBody: string | null;
  /** URL del adjunto en el CDN de Meta; caduca, sirve para abrirlo al rato. */
  adjuntoUrl: string | null;
  timestamp: string;
  eventKey: string;
  payload: Record<string, unknown>;
};

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const ETIQUETA_ADJUNTO: Record<string, string> = {
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  file: "Archivo",
  share: "Publicación compartida",
  story_mention: "Te mencionó en una historia",
  ig_reel: "Reel compartido",
  reel: "Reel compartido",
};

function tipoDeAdjunto(tipo: string | null): MensajeSocial["messageType"] {
  if (tipo === "image" || tipo === "audio" || tipo === "video" || tipo === "file") return tipo;
  return tipo ? "text" : "unknown";
}

export function parseMensajeriaSocial(value: unknown): MensajeSocial[] {
  const envelope = record(value);
  const objeto = text(envelope?.object);
  const canal: CanalSocial | null = objeto === "instagram" ? "instagram" : objeto === "page" ? "messenger" : null;
  if (!canal) return [];

  const mensajes: MensajeSocial[] = [];
  for (const rawEntry of array(envelope?.entry)) {
    const entry = record(rawEntry);
    const cuentaId = text(entry?.id);
    if (!cuentaId) continue;
    for (const rawEvento of array(entry?.messaging)) {
      const evento = record(rawEvento);
      const message = record(evento?.message);
      const postback = record(evento?.postback);
      const emisor = text(record(evento?.sender)?.id);
      const receptor = text(record(evento?.recipient)?.id);
      if (!emisor || !receptor) continue;

      // Un botón tocado en Messenger llega como postback: se lee como el texto del botón.
      const mid = text(message?.mid) ?? text(postback?.mid);
      if (!mid || message?.is_deleted === true || message?.is_unsupported === true) continue;

      const esEco = message?.is_echo === true || emisor === cuentaId;
      const adjunto = record(array(message?.attachments)[0]);
      const tipoAdjunto = text(adjunto?.type);
      const adjuntoUrl = text(record(adjunto?.payload)?.url);
      const texto = text(message?.text) ?? text(postback?.title);
      const messageType = texto && !tipoAdjunto ? "text" : tipoDeAdjunto(tipoAdjunto);
      const etiqueta = tipoAdjunto ? `[${ETIQUETA_ADJUNTO[tipoAdjunto] ?? "Adjunto"}]` : null;
      const ms = Number(evento?.timestamp);

      mensajes.push({
        canal,
        cuentaId,
        contactoId: esEco ? receptor : emisor,
        direction: esEco ? "outbound" : "inbound",
        providerMessageId: mid,
        messageType,
        textBody: texto ?? etiqueta,
        adjuntoUrl,
        timestamp: new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now()).toISOString(),
        eventKey: `${canal}:${mid}`,
        payload: { object: objeto, entry_id: cuentaId, event: evento },
      });
    }
  }
  return mensajes;
}
