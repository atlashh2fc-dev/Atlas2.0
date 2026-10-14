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
 * - Dos mensajes automáticos por persona, como máximo: un saludo que retoma
 *   el correo («te mandé un correo sobre…») y pregunta si quiere que le
 *   cuenten, y, si no contesta en tres días, un último mensaje. Ese «último,
 *   prometido» se cumple: después sale de Por contactar, salvo que responda o
 *   vuelva a abrir un correo.
 * - Tono Hugo: humano, liviano, con humor y sin presión (nada de vendedor ni
 *   de bot). Dice que se le mandó un correo, nunca que lo abrió, y espera una
 *   hora desde la última señal: un WhatsApp a los dos minutos de abrir se
 *   siente vigilancia.
 * - De lunes a viernes, de 10:00 a 19:00 de Chile, con tope diario.
 * - Cada mensaje trae el botón «No, gracias»: la baja en un clic (Ley 19.496,
 *   art. 28 B). Quien lo toca sale de la bandeja y no recibe nada más.
 *
 * WhatsApp exige una plantilla aprobada por Meta para escribirle primero a
 * alguien; por eso el texto vive acá con sus variables. Puro: sin red ni base.
 */

import { celularChileno, nombreComoSeDice, type CorreoEnviado, type Prospecto } from "./prospeccion.ts";

/** Las empresas cuyo agente escribe solo (las plantillas están a su nombre). */
export const EMPRESAS_CON_WHATSAPP_AUTOMATICO = ["altius"] as const;

export type ClavePlantillaProspeccion = "saludo" | "ultimo";

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

export const BOTON_DE_BAJA = "No, gracias";

/**
 * Las dos únicas cosas que Atlas dice solo, con el texto que eligió Hugo el
 * 14-10-2026 (retomar el correo, menos máquina, estilo Virgin). De tú y
 * firmadas. El saludo no vende: pregunta si quiere que le cuenten, y su «sí»
 * abre la conversación para que siga una persona.
 */
export const PLANTILLAS_DE_PROSPECCION: Record<ClavePlantillaProspeccion, PlantillaDeProspeccion> = {
  saludo: {
    nombre: "altius_prospecto_saludo_v1",
    idioma: "es",
    categoria: "MARKETING",
    cuerpo:
      "Hola, soy Hugo, de Altius 👋 Hace poco te mandé un correo sobre {{1}}. Como los correos se pierden entre facturas y promociones, preferí escribirte por acá. ¿Te cuento en dos líneas de qué se trata?",
    ejemplo: ["cómo responderle a tus clientes a las 11 de la noche sin estar despierto"],
    boton: BOTON_DE_BAJA,
  },
  ultimo: {
    nombre: "altius_prospecto_ultimo_v1",
    idioma: "es",
    categoria: "MARKETING",
    cuerpo:
      "Último mensaje, prometido 🤞 Si algún día quieres que la web y el WhatsApp de {{1}} respondan solos a cualquier hora, con lo que ustedes aprueban, me escribes y lo vemos. Y si no es tema, cero drama.",
    ejemplo: ["Ferretería los Andes"],
    boton: BOTON_DE_BAJA,
  },
};

/**
 * De qué le hablamos, en palabras de WhatsApp, según el asunto del correo. Los
 * temas concretos ganan al genérico («Último correo sobre su sitio web»).
 */
const TEMAS_CONCRETOS: { patron: RegExp; tema: string }[] = [
  { patron: /(atlas pulso|11 de la noche|pregunta r[aá]pida)/i, tema: "cómo responderle a tus clientes a las 11 de la noche sin estar despierto" },
  { patron: /(chatgpt|google|\bla ia\b)/i, tema: "cómo lograr que Google y ChatGPT recomienden a tu empresa" },
];
const TEMAS_GENERICOS: { patron: RegExp; tema: string }[] = [{ patron: /sitio web/i, tema: "tu sitio web" }];

/**
 * El tema del saludo: el del último correo que leyó y, si ninguno se
 * reconoce, el del último que se le mandó. Sin tema, «una idea para» su
 * empresa: nunca se inventa de qué trataba el correo.
 */
export function temaParaWhatsapp(correos: CorreoEnviado[] | null | undefined, empresa: string | null): string {
  const recientes = [...(correos ?? [])].reverse();
  for (const temas of [TEMAS_CONCRETOS, TEMAS_GENERICOS]) {
    for (const lista of [recientes.filter((c) => c.abierto_at), recientes]) {
      for (const correo of lista) {
        const encontrado = temas.find(({ patron }) => patron.test(correo.asunto ?? ""));
        if (encontrado) return encontrado.tema;
      }
    }
  }
  return `una idea para ${nombreComoSeDice(empresa) ?? "tu negocio"}`;
}

export const REGLAS = {
  porDiaPorDefecto: 15,
  /** Pocos por corrida: los mensajes salen repartidos en el día, no en ráfaga. */
  porCorrida: 3,
  esperaDesdeLaSenalMs: 60 * 60 * 1000,
  diasHastaElSeguimiento: 3,
  /**
   * «Último mensaje, prometido»: queda esperando hasta salir de la ventana de
   * la bandeja (14 días sin señales). Solo vuelve si responde o abre otro correo.
   */
  diasDespuesDelUltimo: 30,
  horaDesde: 10,
  horaHasta: 19,
} as const;

/**
 * Lo que queda anotado en la bandeja. Sin autor: las escribe Atlas, y la
 * bandeja las reconoce por el comienzo (ver esNotaDeAtlas).
 */
export const NOTAS = {
  saludo: "Atlas le escribió por WhatsApp",
  ultimo: "Atlas le mandó el último WhatsApp automático",
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

const sinTildes = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * ¿Pide que no le escriban más? El botón, o lo mismo escrito corto. Un «No»
 * solo no cuenta: puede ser la respuesta a «¿Te cuento en dos líneas?» dicha
 * a medias, y de todos modos cualquier respuesta frena lo automático.
 */
export function esBaja(texto: string | null | undefined): boolean {
  const limpio = sinTildes((texto ?? "").toLowerCase()).replace(/[¡!¿?.]/g, "").replace(/\s+/g, " ").trim();
  if (!limpio || limpio.length > 80) return false;
  if (limpio === sinTildes(BOTON_DE_BAJA.toLowerCase())) return true;
  return /^(no (me|nos) interesa|no,? gracias|no (estoy|estamos) interesad|no (me|nos) (vuelvas a )?escrib|no (me|nos) (molest|contact)|baja$|stop$|detener$)/.test(limpio);
}

export type FilaDeBandeja = Pick<
  Prospecto,
  "lead_id" | "empresa" | "telefono" | "respondio" | "ultima_senal_at" | "ultimo_resultado" | "ultimo_toque_at" | "toques" | "estado" | "prioridad" | "no_contactar" | "correos"
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
  if (fila.toques === 0 && fila.estado === "nuevo") return "saludo";
  const seguimientoDesde = ahora.getTime() - REGLAS.diasHastaElSeguimiento * 24 * 60 * 60 * 1000;
  if (
    fila.toques === 1 &&
    fila.ultimo_resultado === "whatsapp" &&
    (fila.estado === "seguimiento" || fila.estado === "volvio") &&
    antesDe(fila.ultimo_toque_at, seguimientoDesde)
  ) {
    return "ultimo";
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
    const parametros = clave === "saludo" ? [temaParaWhatsapp(fila.correos, fila.empresa)] : [nombreComoSeDice(fila.empresa) ?? "tu empresa"];
    envios.push({
      leadId: fila.lead_id,
      empresa: fila.empresa,
      celular,
      clave,
      parametros,
      texto: textoDePlantilla(clave, parametros),
      nota: NOTAS[clave],
      seguirEnDias: clave === "saludo" ? REGLAS.diasHastaElSeguimiento : REGLAS.diasDespuesDelUltimo,
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
