export const SECRETARIA_VIRTUAL_RUBRIC_KEY = "secretaria_virtual_condominios";
export const SECRETARIA_VIRTUAL_RUBRIC_VERSION = 1;
export const SECRETARIA_VIRTUAL_RUBRIC_NAME =
  "Asistente Ejecutiva en Línea — Administradores de Condominios";

export type QualityRubricCriterion = {
  id: string;
  name: string;
  maxScore: number;
  conditional: boolean;
  guidance: string;
};

export const SECRETARIA_VIRTUAL_RUBRIC_CRITERIA: readonly QualityRubricCriterion[] = [
  {
    id: "saludo_presentacion",
    name: "Saludo y presentación",
    maxScore: 15,
    conditional: false,
    guidance:
      "Saluda, confirma que habla con la persona correcta, identifica a Geimser y a la ejecutiva, contextualiza el trabajo con administradores de condominios y pide permiso para continuar.",
  },
  {
    id: "descubrimiento_dolor",
    name: "Gancho y descubrimiento del dolor",
    maxScore: 20,
    conditional: false,
    guidance:
      "Antes de presentar el servicio, pregunta qué ocurre con las llamadas de residentes cuando el administrador está en terreno, reunión o inspección; permite que explique su situación y conecta la respuesta con el problema.",
  },
  {
    id: "propuesta_valor",
    name: "Presentación y propuesta de valor",
    maxScore: 20,
    conditional: false,
    guidance:
      "Explica el servicio especializado para condominios y comunica beneficios pertinentes: atención de residentes/conserjes/proveedores, registro de datos y prioridad, aviso rápido, protocolos, CRM o trazabilidad. No exige recitar todos los beneficios ni usar palabras literales.",
  },
  {
    id: "cualificacion",
    name: "Cualificación del prospecto",
    maxScore: 15,
    conditional: false,
    guidance:
      "Pregunta cuántos edificios o condominios administra y cómo gestiona sus líneas o canales de contacto. Puede obtener información equivalente que permita dimensionar volumen y necesidad.",
  },
  {
    id: "oferta_cierre",
    name: "Oferta y siguiente paso",
    maxScore: 15,
    conditional: false,
    guidance:
      "Presenta la oferta pertinente (plan de entrada de 1 UF o cobertura ampliada) y solicita un siguiente paso concreto: inicio, reunión, envío de información o seguimiento con fecha y hora. Si el cliente pide tiempo, propone seguimiento específico.",
  },
  {
    id: "manejo_objeciones",
    name: "Manejo de objeciones",
    maxScore: 10,
    conditional: true,
    guidance:
      "Solo se puntúa si el cliente formula una objeción. La ejecutiva primero empatiza, luego reformula y responde sin discutir; adapta la respuesta al motivo real y procura un siguiente paso. Si no hubo objeción, marcar no_aplica.",
  },
  {
    id: "escucha_trato",
    name: "Escucha y trato comercial",
    maxScore: 5,
    conditional: false,
    guidance:
      "Mantiene un trato respetuoso, escucha las respuestas, evita confrontar y adapta el discurso a lo dicho por el prospecto. Si la transcripción no permite atribuir turnos con confianza suficiente, marcar no_observable.",
  },
] as const;

export const SECRETARIA_VIRTUAL_OBJECTION_PLAYBOOK = [
  "Yo contesto mis llamadas cuando puedo: validar su capacidad y llevar la conversación a los momentos en que no puede responder.",
  "Tengo secretaria o asistente: posicionar el servicio como respaldo y complemento, no como reemplazo.",
  "¿Saben de condominios?: destacar especialización, lenguaje del rubro y protocolos por tipo de llamada.",
  "¿Cómo contestan en nombre de mi empresa?: explicar inducción, personalización y configuración inicial.",
  "1 UF es mucho: contextualizar como inversión en reputación y operación, sin confrontar el precio.",
  "Estoy ocupado: empatizar y proponer dos alternativas concretas de fecha u hora.",
  "Prefieren WhatsApp: mostrar flexibilidad solo si el servicio lo cubre; si no, comprometerse a verificar.",
  "¿Cómo manejan emergencias?: explicar ruta de derivación y contactos de respaldo.",
  "No entregar información sin consultarme: reforzar que el rol es registrar, avisar y derivar, sin decidir ni divulgar información financiera.",
] as const;

export const SECRETARIA_VIRTUAL_RUBRIC = {
  key: SECRETARIA_VIRTUAL_RUBRIC_KEY,
  version: SECRETARIA_VIRTUAL_RUBRIC_VERSION,
  name: SECRETARIA_VIRTUAL_RUBRIC_NAME,
  campaign: "Secretaria Virtual",
  sourceDocument: "Script y Manejo de Objeciones Asistente Ejecutiva en Linea_Condominios_V1.docx",
  sourceSha256: "490b3d78523b16c503cc2e14ee986fc7595bb19ea4d6c60cc5a0ffd4f0542c40",
  scoring: {
    method: "Cobertura semántica con evidencia; no exige lectura literal del guion.",
    thresholds: { cumple: 85, parcial: 60 },
    notEvaluableWhen:
      "Menos de la mitad del peso resulta observable o no se puede atribuir razonablemente el rol de la ejecutiva.",
  },
  criteria: SECRETARIA_VIRTUAL_RUBRIC_CRITERIA,
  objections: SECRETARIA_VIRTUAL_OBJECTION_PLAYBOOK,
  exclusions: [
    "La investigación previa a marcar no se puntúa porque no es observable en la grabación.",
    "Secretaria Virtual - Inbound no usa esta pauta outbound.",
    "La evaluación no determina intención humana ni reemplaza la revisión del supervisor.",
  ],
} as const;

function normalizedCampaignName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}

export function isSecretariaVirtualAuditCampaign(campaignName: string) {
  return normalizedCampaignName(campaignName) === "secretaria virtual";
}
