/**
 * Valor de la UF del día desde mindicador.cl (datos del Banco Central). Se
 * guarda una hora en la caché de Next: la UF cambia una vez al día y la ficha
 * no tiene por qué esperar a un tercero en cada apertura. Si el servicio no
 * responde, devuelve null y el ejecutivo la escribe a mano.
 */
export type ValorUf = { valor: number; fecha: string };

export async function valorUfDeHoy(): Promise<ValorUf | null> {
  try {
    const respuesta = await fetch("https://mindicador.cl/api/uf", {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!respuesta.ok) return null;
    const datos = (await respuesta.json()) as { serie?: Array<{ fecha?: string; valor?: number }> };
    const [hoy] = datos.serie ?? [];
    const valor = Number(hoy?.valor);
    // Un valor fuera de rango es un error del servicio, no una UF.
    if (!Number.isFinite(valor) || valor < 30000 || valor > 60000) return null;
    return { valor, fecha: String(hoy?.fecha ?? new Date().toISOString()) };
  } catch {
    return null;
  }
}
