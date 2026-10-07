/**
 * Consentimiento informado: plantillas sugeridas por rubro y el armado de
 * la firma. Puro: lo usan servidor, cliente y pruebas.
 *
 * Las plantillas son un punto de partida redactado en lenguaje claro; cada
 * clínica las revisa y ajusta con su asesoría. Variables: {{nombre}},
 * {{rut}}, {{mascota}}, {{clinica}}, {{fecha}}.
 */

export type PlantillaSugerida = { titulo: string; texto: string };

const PIE =
  "\n\nDeclaro que se me explicó el procedimiento en palabras que entendí, que pude hacer todas mis preguntas y que me fueron respondidas. Sé que puedo retirar este consentimiento antes del procedimiento, avisando a {{clinica}}.\n\nNombre: {{nombre}} · RUT: {{rut}} · Fecha: {{fecha}}";

export const PLANTILLAS_SUGERIDAS: Record<"dental" | "vet" | "barber", PlantillaSugerida[]> = {
  dental: [
    {
      titulo: "Consentimiento general de tratamiento dental",
      texto:
        "Yo, {{nombre}}, autorizo a {{clinica}} a realizar el tratamiento dental indicado en mi presupuesto.\n\nSe me explicó en qué consiste, sus beneficios, los riesgos frecuentes (molestias, sensibilidad, inflamación, sangrado leve) y los poco frecuentes, y las alternativas, incluida la de no tratarme. Entiendo que pueden aparecer hallazgos que obliguen a cambiar el plan; cualquier cambio se conversará y aprobará antes." +
        PIE,
    },
    {
      titulo: "Extracción dental",
      texto:
        "Yo, {{nombre}}, autorizo la extracción de la o las piezas indicadas por mi tratante en {{clinica}}.\n\nSe me explicaron los cuidados posteriores y los riesgos: dolor, inflamación, sangrado, alveolitis, lesión de piezas vecinas y, de forma poco frecuente, alteración transitoria de la sensibilidad. Me comprometo a seguir las indicaciones entregadas." +
        PIE,
    },
    {
      titulo: "Blanqueamiento dental",
      texto:
        "Yo, {{nombre}}, autorizo el blanqueamiento dental en {{clinica}}.\n\nEntiendo que el resultado varía en cada persona, que puede haber sensibilidad transitoria y que las restauraciones (tapaduras, coronas) no cambian de color. Seguiré las indicaciones de alimentación y cuidado." +
        PIE,
    },
  ],
  vet: [
    {
      titulo: "Consentimiento de cirugía y anestesia",
      texto:
        "Yo, {{nombre}}, tutor(a) de {{mascota}}, autorizo a {{clinica}} a realizar la cirugía indicada y la anestesia que requiera.\n\nSe me explicó que toda anestesia tiene riesgos, aun en un paciente sano, y que se tomarán las medidas para reducirlos. Autorizo los procedimientos de urgencia necesarios durante la cirugía. Declaro que mi mascota cumplió el ayuno indicado." +
        PIE,
    },
    {
      titulo: "Hospitalización",
      texto:
        "Yo, {{nombre}}, tutor(a) de {{mascota}}, autorizo su hospitalización en {{clinica}} y los tratamientos y exámenes que el equipo indique.\n\nSe me informará de su evolución y de cualquier cambio en el plan o en los costos estimados antes de realizarlo, salvo urgencia." +
        PIE,
    },
    {
      titulo: "Eutanasia",
      texto:
        "Yo, {{nombre}}, tutor(a) de {{mascota}}, solicito y autorizo a {{clinica}} a realizar su eutanasia.\n\nDeclaro que soy su tutor(a) legal, que se me explicaron las alternativas y que la decisión es libre e informada." +
        PIE,
    },
  ],
  barber: [
    {
      titulo: "Uso de fotos y procedimientos químicos",
      texto:
        "Yo, {{nombre}}, autorizo a {{clinica}} a realizar el servicio acordado.\n\nEn servicios químicos (decoloración, tinte, alisado, permanente) se me consultó por alergias y sensibilidad, y entiendo que el resultado depende del estado del cabello. Autorizo tomar fotos de antes y después para mi ficha; no se publicarán sin mi permiso aparte." +
        PIE,
    },
  ],
};

/** Una firma dibujada: trazos con puntos (x, y) en el lienzo. */
export type Trazo = { x: number; y: number }[];

/** La firma como SVG limpio (solo paths), escalado al ancho y alto del lienzo. */
export function firmaComoSvg(trazos: Trazo[], ancho: number, alto: number): string {
  const caminos = trazos
    .filter((trazo) => trazo.length > 0)
    .map((trazo) => {
      const puntos = trazo.map((punto) => `${Math.round(punto.x * 10) / 10} ${Math.round(punto.y * 10) / 10}`);
      return `<path d="M ${puntos[0]}${puntos.length > 1 ? ` L ${puntos.slice(1).join(" L ")}` : ` l 0.1 0.1`}" />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(ancho)} ${Math.round(alto)}" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${caminos}</svg>`;
}

/** Hay firma si se dibujó un trazo de verdad (más de 40 px en total), no un toque. */
export function hayFirma(trazos: Trazo[]): boolean {
  let largo = 0;
  for (const trazo of trazos) {
    for (let indice = 1; indice < trazo.length; indice += 1) {
      largo += Math.hypot(trazo[indice].x - trazo[indice - 1].x, trazo[indice].y - trazo[indice - 1].y);
    }
  }
  return largo >= 40;
}
