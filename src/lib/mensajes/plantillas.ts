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

export type ClavePlantilla = "cita_confirmar" | "cita_recordatorio" | "vacuna" | "presupuesto" | "control" | "enlace_pago" | "libre";

export const PLANTILLAS: Record<ClavePlantilla, { nombre: string; cuerpo: string }> = {
  cita_confirmar: {
    nombre: "Cita de mañana, por confirmar",
    cuerpo:
      "Hola {{nombre}}, te recordamos {{de_quien}} mañana a las {{hora}} con {{profesional}} en {{clinica}} ({{motivo}}). ¿Nos confirmas que vienes? Responde SÍ y queda confirmada.",
  },
  cita_recordatorio: {
    nombre: "Cita de mañana, confirmada",
    cuerpo: "Hola {{nombre}}, mañana a las {{hora}} te esperamos en {{clinica}} con {{profesional}} ({{motivo}}{{mascota_sufijo}}). Si no puedes venir, avísanos por acá.",
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
  enlace_pago: {
    nombre: "Enlace de pago",
    cuerpo: "Hola {{nombre}}, te dejamos el enlace para pagar {{monto}} en {{clinica}}: {{url}} . Puedes pagar con débito o crédito. Cualquier duda, por acá.",
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
  cita_manana: "Cita de mañana",
  vacuna: "Vacuna",
  presupuesto: "Presupuesto",
  control: "Control",
  enlace_pago: "Enlace de pago",
  manual: "Manual",
  campana: "Campaña",
};

/** Rellena una plantilla con sus variables. Las que faltan quedan vacías, sin llaves sueltas. */
export function renderizarPlantilla(clave: string, variables: Record<string, unknown>): string {
  const plantilla = PLANTILLAS[clave as ClavePlantilla] ?? PLANTILLAS.libre;
  const valores: Record<string, string> = {};
  for (const [nombre, valor] of Object.entries(variables)) {
    valores[nombre] = valor === null || valor === undefined ? "" : String(valor);
  }
  // Derivadas: una mascota cambia la frase ("la hora de Luna" / "tu hora").
  const mascota = valores.mascota?.trim();
  valores.de_quien = mascota ? `la hora de ${mascota}` : "tu hora";
  valores.mascota_sufijo = mascota ? ` · ${mascota}` : "";
  valores.vence_o_vencio = variables.vencida === true || variables.vencida === "true" ? "venció" : "vence";
  return plantilla.cuerpo
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, nombre: string) => valores[nombre] ?? "")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}
