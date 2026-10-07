/**
 * Las plantillas de WhatsApp que se registran en Meta.
 *
 * WhatsApp solo deja escribir texto libre dentro de las 24 horas siguientes
 * al último mensaje de la persona. Un recordatorio que la clínica inicia (la
 * cita de mañana, la vacuna, el control) cae casi siempre fuera de esa
 * ventana, y ahí Meta exige una plantilla aprobada con sus variables en
 * orden. Esta lista es la fuente: de acá sale el texto que se envía a
 * aprobación (docs/whatsapp-plantillas-meta.md) y los parámetros que el
 * despacho manda en cada envío. Puro.
 *
 * Los nombres y el orden de las variables no se cambian una vez aprobados:
 * si el texto cambia, se registra una plantilla nueva con otro nombre.
 */

import { valoresDePlantilla } from "./plantillas.ts";

export type PlantillaMeta = {
  /** Nombre en Meta: minúsculas, números y guion bajo. */
  nombre: string;
  idioma: "es";
  categoria: "UTILITY" | "MARKETING";
  /** Texto con {{1}}, {{2}}… en el orden de `variables`. */
  cuerpo: string;
  variables: string[];
  /** Valores de ejemplo para la revisión de Meta, en el mismo orden. */
  ejemplo: string[];
};

export const PLANTILLAS_META: Record<string, PlantillaMeta> = {
  cita_confirmar: {
    nombre: "atlas_cita_por_confirmar_v1",
    idioma: "es",
    categoria: "UTILITY",
    cuerpo: "Hola {{1}}, te recordamos {{2}} {{3}} a las {{4}} con {{5}} en {{6}}. ¿Nos confirmas que vienes? Responde SÍ y queda confirmada, o NO si no puedes.",
    variables: ["nombre", "de_quien", "cuando", "hora", "profesional", "clinica"],
    ejemplo: ["Camila", "tu hora", "mañana", "10:30", "Dra. Vidal", "Clínica Sonríe"],
  },
  cita_recordatorio: {
    nombre: "atlas_cita_confirmada_v1",
    idioma: "es",
    categoria: "UTILITY",
    cuerpo: "Hola {{1}}, {{2}} a las {{3}} te esperamos en {{4}} con {{5}}. Si no puedes venir, responde NO y liberamos la hora.",
    variables: ["nombre", "cuando", "hora", "clinica", "profesional"],
    ejemplo: ["Camila", "mañana", "10:30", "Clínica Sonríe", "Dra. Vidal"],
  },
  reserva_recibida: {
    nombre: "atlas_reserva_recibida_v1",
    idioma: "es",
    categoria: "UTILITY",
    cuerpo: "Hola {{1}}, tu hora en {{2}} quedó reservada para el {{3}} con {{4}}. Para verla o cancelarla entra a {{5}} desde tu celular. Antes de la cita te pedimos confirmarla.",
    variables: ["nombre", "clinica", "fecha", "profesional", "url_cita"],
    ejemplo: ["Camila", "Clínica Sonríe", "08/10 a las 10:30", "Dra. Vidal", "https://atlascrm.geimser.cl/reservar/cita/ejemplo"],
  },
  vacuna: {
    nombre: "atlas_vacuna_mascota_v1",
    idioma: "es",
    categoria: "UTILITY",
    cuerpo: "Hola {{1}}, la vacuna de {{2}} {{3}} el {{4}}. ¿Agendamos una hora en {{5}}? Responde por acá y te damos la primera disponible.",
    variables: ["nombre", "mascota", "vence_o_vencio", "fecha", "clinica"],
    ejemplo: ["Camila", "Luna", "vence", "15/10", "Veterinaria Patitas"],
  },
  control: {
    nombre: "atlas_control_pendiente_v1",
    idioma: "es",
    categoria: "UTILITY",
    cuerpo: "Hola {{1}}, en {{2}} notamos que hace más de {{3}} meses no vienes a control. ¿Agendamos una hora? Responde por acá y coordinamos.",
    variables: ["nombre", "clinica", "meses"],
    ejemplo: ["Camila", "Clínica Sonríe", "6"],
  },
  mantencion: {
    nombre: "atlas_mantencion_corte_v1",
    idioma: "es",
    categoria: "MARKETING",
    cuerpo: "Hola {{1}}, ya van {{2}} semanas desde tu último corte en {{3}}. ¿Te reservamos hora para la mantención? Responde por acá.",
    variables: ["nombre", "semanas", "clinica"],
    ejemplo: ["Nico", "5", "Barbería El Filo"],
  },
  presupuesto: {
    nombre: "atlas_presupuesto_seguimiento_v1",
    idioma: "es",
    categoria: "UTILITY",
    cuerpo: "Hola {{1}}, te escribimos de {{2}} por el presupuesto «{{3}}». ¿Te quedó alguna duda o quieres que agendemos? Estamos por acá.",
    variables: ["nombre", "clinica", "presupuesto"],
    ejemplo: ["Camila", "Clínica Sonríe", "Tratamiento de conducto"],
  },
};

/** Los parámetros de la plantilla, en orden, con texto no vacío (Meta rechaza parámetros vacíos). */
export function parametrosDePlantillaMeta(clave: string, variables: Record<string, unknown>): string[] | null {
  const plantilla = PLANTILLAS_META[clave];
  if (!plantilla) return null;
  const valores = valoresDePlantilla(variables);
  return plantilla.variables.map((nombre) => {
    const valor = (valores[nombre] ?? "").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
    return valor || "-";
  });
}

/** Dentro de las 24 horas desde el último mensaje de la persona se puede escribir texto libre. */
export function dentroDeVentana(ultimoEntrante: string | null | undefined, ahora = new Date()): boolean {
  if (!ultimoEntrante) return false;
  const instante = new Date(ultimoEntrante).getTime();
  return Number.isFinite(instante) && ahora.getTime() - instante < 24 * 60 * 60 * 1000 - 5 * 60 * 1000;
}
