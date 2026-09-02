/**
 * Alcance de campaña de la consola.
 *
 * Vive **solo en la URL**. Antes se guardaba además en una cookie de 30 días,
 * y eso rompía dos cosas a la vez:
 *
 *  1. El filtro seguía aplicado en Registros, Agenda, Mi equipo y Reportes sin
 *     que se viera en pantalla. Buscar un RUT de otra campaña devolvía "sin
 *     resultados" sin explicar por qué.
 *  2. Elegir "Todas" no lo limpiaba: el valor vacío se leía como "no vino el
 *     parámetro" y volvía a caer en la cookie, así que el filtro era un
 *     callejón sin salida.
 *
 * Con el alcance en la URL el filtro es siempre visible, se puede limpiar y la
 * vista es compartible por enlace.
 */
export function resolveCampaignScope(requestedCampaignId?: string): string | null {
  const requested = requestedCampaignId?.trim();
  return requested ? requested : null;
}
