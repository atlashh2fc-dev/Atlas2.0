import type { BadgeTone } from "@/components/ui";

/**
 * Las plantillas de lo que Atlas le escribe a un paciente, y los estados de
 * un mensaje saliente. Puro: lo usan servidor y cliente.
 *
 * Cada plantilla es un texto con variables entre llaves dobles. El despacho
 * las rellena con lo que la regla guardó (nombre, hora, mascota, clínica).
 * Cuando el canal exija plantillas aprobadas por Meta, `meta` es el nombre
 * de la plantilla registrada allá y las variables van en el mismo orden.
 */

/** Dirección pública de Atlas para los enlaces que salen en los mensajes. */
export const URL_PUBLICA = (typeof process !== "undefined" && process.env?.ATLAS_URL_PUBLICA) || "https://atlascrm.geimser.cl";

export type ClavePlantilla = "cita_confirmar" | "cita_recordatorio" | "cita_confirmada" | "cita_cancelada" | "cita_reagendar" | "reserva_recibida" | "vacuna" | "presupuesto" | "control" | "mantencion" | "look" | "enlace_pago" | "seguimiento_propuesta" | "libre";

export const PLANTILLAS: Record<ClavePlantilla, { nombre: string; cuerpo: string }> = {
  cita_confirmar: {
    nombre: "Cita próxima, por confirmar",
    cuerpo:
      "Hola {{nombre}}, te recordamos {{de_quien}} {{cuando}} a las {{hora}} con {{profesional}} en {{clinica}} ({{motivo}}). ¿Nos confirmas que vienes? Responde SÍ y queda confirmada, o NO si no puedes.",
  },
  cita_recordatorio: {
    nombre: "Cita próxima, ya confirmada",
    cuerpo: "Hola {{nombre}}, {{cuando}} a las {{hora}} te esperamos en {{clinica}} con {{profesional}} ({{motivo}}{{mascota_sufijo}}). Si no puedes venir, responde NO y liberamos la hora.",
  },
  cita_confirmada: {
    nombre: "Respuesta: cita confirmada",
    cuerpo: "¡Listo, {{nombre}}! Tu hora del {{fecha}} quedó confirmada. Te esperamos en {{clinica}}.",
  },
  cita_cancelada: {
    nombre: "Respuesta: cita cancelada",
    cuerpo: "Gracias por avisar, {{nombre}}. Cancelamos tu hora del {{fecha}}. Si quieres otra, responde por acá y te damos la primera disponible.",
  },
  cita_reagendar: {
    nombre: "Respuesta: quiere otra hora",
    cuerpo: "Perfecto, {{nombre}}. Te escribimos en un rato con otras horas disponibles en {{clinica}}. Tu hora del {{fecha}} sigue reservada mientras tanto.",
  },
  reserva_recibida: {
    nombre: "Reserva en línea recibida",
    cuerpo: "Hola {{nombre}}, tu hora en {{clinica}} quedó reservada para el {{fecha}} con {{profesional}} ({{motivo}}). Antes de la cita te pedimos confirmarla. Si necesitas cancelar: {{url_cita}}",
  },
  vacuna: {
    nombre: "Vacuna por vencer o vencida",
    cuerpo: "Hola {{nombre}}, la vacuna de {{mascota}} {{vence_o_vencio}} el {{fecha}}. ¿Agendamos una hora en {{clinica}}? Responde por acá y te damos la primera disponible.",
  },
  presupuesto: {
    nombre: "Presupuesto sin respuesta",
    cuerpo: 'Hola {{nombre}}, te escribimos de {{clinica}} por el presupuesto "{{presupuesto}}" ({{monto}}). ¿Te quedó alguna duda o quieres que agendemos? Estamos por acá.',
  },
  control: {
    nombre: "Control pendiente",
    cuerpo: "Hola {{nombre}}, en {{clinica}} notamos que hace más de {{meses}} meses no vienes a control. ¿Agendamos una hora? Responde por acá y coordinamos.",
  },
  mantencion: {
    nombre: "Mantención del corte",
    cuerpo: "Hola {{nombre}}, ya van {{semanas}} semanas desde tu último corte en {{clinica}}. ¿Te reservamos hora para la mantención? Responde por acá y te damos la primera disponible.",
  },
  look: {
    nombre: "Look aprobado",
    cuerpo: "Hola {{nombre}}, te dejamos el look que elegiste en {{clinica}}: {{url}} . Guárdalo: así lo pedimos igual la próxima vez.",
  },
  enlace_pago: {
    nombre: "Enlace de pago",
    cuerpo: "Hola {{nombre}}, te dejamos el enlace para pagar {{monto}} en {{clinica}}: {{url}} . Puedes pagar con débito o crédito. Cualquier duda, por acá.",
  },
  seguimiento_propuesta: {
    nombre: "Seguimiento de propuesta",
    cuerpo: "Hola {{nombre}}, te escribo de {{remitente}} por la propuesta que le enviamos a {{empresa}} ({{negocio}}). ¿Te quedó alguna duda o quieres que agendemos una llamada corta para revisarla? Quedo atento.",
  },
  libre: { nombre: "Mensaje libre", cuerpo: "{{texto}}" },
};

export type EstadoMensaje = "programado" | "enviando" | "enviado" | "entregado" | "leido" | "respondido" | "fallido" | "cancelado";

export const ETIQUETA_ESTADO_MENSAJE: Record<EstadoMensaje, { label: string; tone: BadgeTone }> = {
  programado: { label: "Programado", tone: "neutral" },
  enviando: { label: "Enviando", tone: "info" },
  enviado: { label: "Enviado", tone: "info" },
  entregado: { label: "Entregado", tone: "success" },
  leido: { label: "Leído", tone: "success" },
  respondido: { label: "Respondió", tone: "success" },
  fallido: { label: "Falló", tone: "danger" },
  cancelado: { label: "Cancelado", tone: "neutral" },
};

export const ETIQUETA_REGLA: Record<string, string> = {
  cita_manana: "Cita próxima",
  cita_respuesta: "Respuesta a la cita",
  reserva_online: "Reserva en línea",
  vacuna: "Vacuna",
  presupuesto: "Presupuesto",
  control: "Control",
  mantencion: "Mantención",
  look: "Look",
  enlace_pago: "Enlace de pago",
  manual: "Manual",
  campana: "Campaña",
  seguimiento: "Seguimiento",
};

/**
 * Las plantillas que cada empresa puede reescribir con su propio tono, con
 * las variables que puede usar en cada una. Las de campañas, pagos y el
 * mensaje libre no: su texto ya lo escribe quien las manda.
 */
export const PLANTILLAS_EDITABLES: Partial<Record<ClavePlantilla, string[]>> = {
  cita_confirmar: ["nombre", "de_quien", "cuando", "hora", "profesional", "clinica", "motivo"],
  cita_recordatorio: ["nombre", "cuando", "hora", "profesional", "clinica", "motivo", "mascota_sufijo"],
  cita_confirmada: ["nombre", "fecha", "clinica"],
  cita_cancelada: ["nombre", "fecha", "clinica"],
  cita_reagendar: ["nombre", "fecha", "clinica"],
  reserva_recibida: ["nombre", "fecha", "profesional", "motivo", "clinica", "url_cita"],
  vacuna: ["nombre", "mascota", "vence_o_vencio", "fecha", "clinica"],
  presupuesto: ["nombre", "presupuesto", "monto", "clinica"],
  control: ["nombre", "meses", "clinica"],
  mantencion: ["nombre", "semanas", "clinica"],
};

/** Ejemplo para la vista previa de un texto propio. */
export const VARIABLES_DE_EJEMPLO: Record<string, string> = {
  nombre: "Camila",
  cuando: "mañana",
  hora: "10:30",
  profesional: "Dra. Vidal",
  clinica: "tu clínica",
  motivo: "Control",
  mascota: "Luna",
  fecha: "09/10 a las 10:30",
  url_cita: `${URL_PUBLICA}/reservar/cita/…`,
  presupuesto: "Tratamiento de conducto",
  monto: "$180.000",
  meses: "6",
  semanas: "5",
};

/** Un texto propio es válido si no está vacío, cabe en un WhatsApp y solo usa variables conocidas. */
export function validarTextoPropio(clave: ClavePlantilla, texto: string): string | null {
  const limpio = texto.trim();
  if (limpio.length < 10) return "El mensaje es muy corto.";
  if (limpio.length > 900) return "El mensaje no puede pasar de 900 caracteres.";
  const permitidas = new Set(PLANTILLAS_EDITABLES[clave] ?? []);
  for (const [, nombre] of limpio.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    if (!permitidas.has(nombre)) return `{{${nombre}}} no existe en este mensaje.`;
  }
  return null;
}

/**
 * Las variables de un mensaje como texto, más las derivadas: una mascota
 * cambia la frase («la hora de Luna» / «tu hora»), los recordatorios
 * antiguos no traen «cuando», y la reserva en línea arma su enlace. Lo usan
 * el texto libre y las plantillas aprobadas por Meta.
 */
export function valoresDePlantilla(variables: Record<string, unknown>): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const [nombre, valor] of Object.entries(variables)) {
    valores[nombre] = valor === null || valor === undefined ? "" : String(valor);
  }
  const mascota = valores.mascota?.trim();
  valores.de_quien = mascota ? `la hora de ${mascota}` : "tu hora";
  valores.mascota_sufijo = mascota ? ` · ${mascota}` : "";
  valores.cuando = valores.cuando?.trim() || "mañana";
  valores.url_cita = valores.token ? `${URL_PUBLICA}/reservar/cita/${valores.token}` : valores.url_cita ?? "";
  valores.vence_o_vencio = variables.vencida === true || variables.vencida === "true" ? "venció" : "vence";
  return valores;
}

/**
 * Rellena una plantilla con sus variables. Las que faltan quedan vacías, sin
 * llaves sueltas. Si la empresa escribió su propio texto para esa plantilla,
 * se usa ese.
 */
export function renderizarPlantilla(clave: string, variables: Record<string, unknown>, textosPropios?: Record<string, unknown> | null): string {
  const propio = textosPropios?.[clave];
  const plantilla = typeof propio === "string" && propio.trim() && clave in PLANTILLAS_EDITABLES
    ? { cuerpo: propio }
    : PLANTILLAS[clave as ClavePlantilla] ?? PLANTILLAS.libre;
  const valores = valoresDePlantilla(variables);
  return plantilla.cuerpo
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, nombre: string) => valores[nombre] ?? "")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}
