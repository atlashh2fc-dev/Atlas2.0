/**
 * Atlas le escribe por WhatsApp a quien mostró interés en la campaña de correo.
 *
 * Antes era trabajo a mano: el resumen diario de Atlas Lead y Por contactar
 * armaban el enlace de WhatsApp y una persona lo enviaba desde el teléfono.
 * Con el número conectado a Atlas (coexistencia con la app), el primer mensaje
 * sale solo y la conversación sigue en el teléfono, en manos de una persona:
 * lo automático es abrir la puerta, no conversar.
 *
 * Reglas, en orden de importancia:
 * - Solo a quien abrió o hizo clic, con celular, sin «no contactar» y sin
 *   respuesta: quien respondió ya está conversando con una persona.
 * - Dos mensajes automáticos por persona, como máximo: la pregunta y, si no
 *   contesta en tres días, un solo seguimiento. Después decide una persona.
 * - Nunca dice que abrió el correo, y espera una hora desde la última señal:
 *   un WhatsApp a los dos minutos de abrir se siente vigilancia.
 * - De lunes a viernes, de 10:00 a 19:00 de Chile, con tope diario.
 * - Cada mensaje trae el botón «No me interesa, gracias»: la baja en un clic
 *   (Ley 19.496, art. 28 B). Quien lo toca sale de la bandeja.
 *
 * WhatsApp exige una plantilla aprobada por Meta para escribirle primero a
 * alguien; por eso el texto vive acá con sus variables. Puro: sin red ni base.
 */

import { celularChileno, loQuePide, nombreComoSeDice, type Prospecto } from "./prospeccion.ts";

/** Las empresas cuyo agente escribe solo (las plantillas están a su nombre). */
export const EMPRESAS_CON_WHATSAPP_AUTOMATICO = ["altius"] as const;

export type ClavePlantillaProspeccion = "pregunta" | "seguimiento";

export type PlantillaDeProspeccion = {
  /** Nombre en Meta: minúsculas, números y guion bajo. Si el texto cambia, se registra con otro nombre. */
  nombre: string;
  idioma: "es";
  categoria: "MARKETING";
  /** Texto con {{1}}, {{2}}… en orden. */
  cuerpo: string;
  /** Valores de ejemplo para la revisión de Meta, en el mismo orden. */
  ejemplo: string[];
  /** Respuesta rápida: la baja en un clic. */
  boton: string;
};

export const BOTON_DE_BAJA = "No me interesa, gracias";

/** Las dos únicas cosas que Atlas dice solo. De tú, firmadas y con una sola pregunta (ver mensajeDeWhatsapp). */
export const PLANTILLAS_DE_PROSPECCION: Record<ClavePlantillaProspeccion, PlantillaDeProspeccion> = {
  pregunta: {
    nombre: "altius_prospecto_pregunta_v1",
    idioma: "es",
    categoria: "MARKETING",
    cuerpo:
      "Hola, soy Hugo, de Altius, en Santiago. Una pregunta corta sobre {{1}}: si un cliente te pide {{2}} a las 10 de la noche, ¿alguien alcanza a responderle antes de que {{3}}?",
    ejemplo: ["Ferretería Los Andes", "una cotización", "cotice con otra empresa"],
    boton: BOTON_DE_BAJA,
  },
  seguimiento: {
    nombre: "altius_prospecto_seguimiento_v1",
    idioma: "es",
    categoria: "MARKETING",
    cuerpo:
      "Te dejo el dato por si te sirve: en Altius hacemos que la web y el WhatsApp de empresas como {{1}} respondan solos, con la información que ustedes aprueban. ¿Te mando un ejemplo de cómo quedaría?",
    ejemplo: ["Ferretería Los Andes"],
    boton: BOTON_DE_BAJA,
  },
};

export const REGLAS = {
  porDiaPorDefecto: 15,
  /** Pocos por corrida: los mensajes salen repartidos en el día, no en ráfaga. */
  porCorrida: 3,
  esperaDesdeLaSenalMs: 60 * 60 * 1000,
  diasHastaElSeguimiento: 3,
  diasDespuesDelSeguimiento: 4,
  horaDesde: 10,
  horaHasta: 19,
} as const;

/**
 * Lo que queda anotado en la bandeja. Sin autor: las escribe Atlas, y la
 * bandeja las reconoce por el comienzo (ver esNotaDeAtlas).
 */
export const NOTAS = {
  pregunta: "Atlas le escribió por WhatsApp",
  seguimiento: "Atlas le escribió por WhatsApp (seguimiento)",
  baja: "Atlas: pidió no recibir más mensajes por WhatsApp",
  numeroSinWhatsapp: "Atlas: WhatsApp no pudo entregarle el mensaje; el número no usaría WhatsApp. Llámalo o escríbele por correo.",
  noEntregado: "Atlas: WhatsApp no entregó el mensaje automático. Escríbele tú.",
} as const;

export function esNotaDeAtlas(nota: string | null | undefined): boolean {
  return typeof nota === "string" && nota.startsWith("Atlas");
}

/** El texto tal como lo recibe la persona. */
export function textoDePlantilla(clave: ClavePlantillaProspeccion, parametros: string[]): string {
  return PLANTILLAS_DE_PROSPECCION[clave].cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => parametros[Number(n) - 1] ?? "");
}

/** Lo que Meta pide para registrar la plantilla (POST /{waba}/message_templates). */
export function definicionParaMeta(plantilla: PlantillaDeProspeccion) {
  return {
    name: plantilla.nombre,
    language: plantilla.idioma,
    category: plantilla.categoria,
    components: [
      { type: "BODY", text: plantilla.cuerpo, example: { body_text: [plantilla.ejemplo] } },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: plantilla.boton }] },
    ],
  };
}

/** Día de la semana (1 = lunes … 7 = domingo) y hora en Chile. */
export function relojDeChile(ahora: Date): { dia: number; hora: number } {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(ahora);
  const dia = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(partes.find((p) => p.type === "weekday")?.value ?? "") + 1;
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return { dia, hora };
}

export function enHorario(ahora: Date): boolean {
  const { dia, hora } = relojDeChile(ahora);
  return dia >= 1 && dia <= 5 && hora >= REGLAS.horaDesde && hora < REGLAS.horaHasta;
}

const sinTildes = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * ¿Pide que no le escriban más? El botón, o lo mismo escrito corto. Un «No»
 * solo no cuenta: es la respuesta a la pregunta («¿alguien alcanza a
 * responderle?») y es justo el que más interesa.
 */
export function esBaja(texto: string | null | undefined): boolean {
  const limpio = sinTildes((texto ?? "").toLowerCase()).replace(/[¡!¿?.]/g, "").replace(/\s+/g, " ").trim();
  if (!limpio || limpio.length > 80) return false;
  if (limpio === sinTildes(BOTON_DE_BAJA.toLowerCase())) return true;
  return /^(no (me|nos) interesa|no,? gracias|no (estoy|estamos) interesad|no (me|nos) (vuelvas a )?escrib|no (me|nos) (molest|contact)|baja$|stop$|detener$)/.test(limpio);
}

export type FilaDeBandeja = Pick<
  Prospecto,
  "lead_id" | "empresa" | "telefono" | "respondio" | "ultima_senal_at" | "ultimo_resultado" | "ultimo_toque_at" | "toques" | "estado" | "prioridad" | "no_contactar"
>;

export type Envio = {
  leadId: string;
  empresa: string | null;
  celular: string;
  clave: ClavePlantillaProspeccion;
  parametros: string[];
  texto: string;
  nota: string;
  /** En cuántos días vuelve a la bandeja si no contesta. */
  seguirEnDias: number;
};

const antesDe = (instante: string | null, limite: number) => instante !== null && new Date(instante).getTime() <= limite;

/** Qué le toca a esta persona, o null si nada: la decide una persona o todavía es pronto. */
export function pasoQueToca(fila: FilaDeBandeja, ahora: Date): ClavePlantillaProspeccion | null {
  if (fila.no_contactar || fila.respondio) return null;
  if (!antesDe(fila.ultima_senal_at, ahora.getTime() - REGLAS.esperaDesdeLaSenalMs)) return null;
  if (fila.toques === 0 && fila.estado === "nuevo") return "pregunta";
  const seguimientoDesde = ahora.getTime() - REGLAS.diasHastaElSeguimiento * 24 * 60 * 60 * 1000;
  if (
    fila.toques === 1 &&
    fila.ultimo_resultado === "whatsapp" &&
    (fila.estado === "seguimiento" || fila.estado === "volvio") &&
    antesDe(fila.ultimo_toque_at, seguimientoDesde)
  ) {
    return "seguimiento";
  }
  return null;
}

/** A quién escribirle en esta corrida, en el orden de la bandeja (los más interesados primero). */
export function elegirEnvios(filas: FilaDeBandeja[], { ahora, cupo }: { ahora: Date; cupo: number }): Envio[] {
  const envios: Envio[] = [];
  const celulares = new Set<string>();
  for (const fila of [...filas].sort((a, b) => a.prioridad - b.prioridad)) {
    if (envios.length >= cupo) break;
    const celular = celularChileno(fila.telefono);
    if (!celular || celulares.has(celular)) continue;
    const clave = pasoQueToca(fila, ahora);
    if (!clave) continue;
    celulares.add(celular);
    const nombre = nombreComoSeDice(fila.empresa);
    const { pide, pierde } = loQuePide(fila.empresa);
    const parametros = clave === "pregunta" ? [nombre ?? "tu empresa", pide, pierde] : [nombre ?? "la tuya"];
    envios.push({
      leadId: fila.lead_id,
      empresa: fila.empresa,
      celular,
      clave,
      parametros,
      texto: textoDePlantilla(clave, parametros),
      nota: NOTAS[clave],
      seguirEnDias: clave === "pregunta" ? REGLAS.diasHastaElSeguimiento : REGLAS.diasDespuesDelSeguimiento,
    });
  }
  return envios;
}

/** Un fallo de entrega que dice que el número no tiene WhatsApp (Meta 131026). */
export function numeroSinWhatsapp(error: string | null | undefined): boolean {
  return /131026|undeliverable|no se pudo entregar/i.test(error ?? "");
}

/** Un rechazo de Meta que pide frenar: límite de spam o de velocidad. */
export function pideFrenar(error: string | null | undefined): boolean {
  return /131048|130429|131056|spam|rate limit|too many/i.test(error ?? "");
}
