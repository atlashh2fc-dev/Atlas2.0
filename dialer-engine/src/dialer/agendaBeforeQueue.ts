/**
 * La agenda vencida de un ejecutivo va antes que la cola.
 *
 * Asterisk le pasa el cliente del pool que está esperando al primer
 * ejecutivo que despausa, en el mismo segundo. La agenda, en cambio, se
 * pedía en el ciclo siguiente y solo con la sesión ya en 'available', o sea
 * con el ejecutivo ya despausado: el 15-10-2026 la cola le ganó 13 veces a
 * una agenda vencida (Claudia volvió de su pausa a las 16:19:16 y a las
 * 16:19:18 ya hablaba con un cliente del pool) y cada traspaso entre agendas
 * tardaba 6 a 11 s.
 *
 * Por eso, antes de despausar a alguien (fin de tipificación o vuelta de un
 * AUX), se le pide su agenda vencida. Si sale, se queda fuera de la cola
 * mientras le suena; si no tiene, se despausa como siempre.
 */

/** Ejecutivos con una consulta en curso: la otra vía no decide por ellos. */
const checking = new Set<string>();

/**
 * true si el ejecutivo NO debe volver a la cola ahora: le salió su agenda, o
 * la liberación por evento y el sync periódico llegaron a la vez y la otra
 * vía ya está decidiendo. `deliver` entrega la agenda vencida del ejecutivo
 * en una campaña y dice si salió; un error ahí no lo deja fuera de la cola.
 */
export async function deliverAgendaBeforeQueue(
  profileId: string,
  campaignIds: readonly string[],
  deliver: (campaignId: string) => Promise<boolean>,
  onError: (err: unknown, campaignId: string) => void = () => undefined
): Promise<boolean> {
  if (checking.has(profileId)) return true;
  checking.add(profileId);
  try {
    for (const campaignId of campaignIds) {
      try {
        if (await deliver(campaignId)) return true;
      } catch (err) {
        onError(err, campaignId);
      }
    }
    return false;
  } finally {
    checking.delete(profileId);
  }
}
