/**
 * Sondeo que solo corre mientras la pestaña está en primer plano.
 *
 * Cada pestaña del ejecutivo o del supervisor que quedaba abierta de noche
 * seguía consultando al servidor cada pocos segundos: cada consulta es una
 * función en Vercel y varias lecturas en Supabase. Con esto, el reloj sigue
 * andando pero no dispara nada mientras la pestaña está oculta; al volver a
 * primer plano consulta de inmediato si ya pasó el intervalo, así la pantalla
 * se pone al día sin esperar el próximo tick.
 *
 * El heartbeat del ejecutivo NO usa esto a propósito: el discador necesita
 * saber que sigue conectado aunque tenga otra pestaña delante.
 */
export function sondeoVisible(fn: () => void, ms: number): () => void {
  let ultima = Date.now();
  const correr = () => {
    ultima = Date.now();
    fn();
  };
  const tick = () => {
    if (document.visibilityState === "visible") correr();
  };
  const alVolver = () => {
    if (document.visibilityState === "visible" && Date.now() - ultima >= ms) correr();
  };
  const id = window.setInterval(tick, ms);
  document.addEventListener("visibilitychange", alVolver);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", alVolver);
  };
}
