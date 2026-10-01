/**
 * Búsqueda tolerante para selectores con listas largas: «José» y «jose» son lo
 * mismo, y un RUT se encuentra con o sin puntos y guion.
 */

/** Minúsculas y sin tildes. */
export function normalizarBusqueda(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Cada palabra de la consulta tiene que estar en la opción; el RUT se compara sin puntos ni guion. */
export function coincide(opcion: { label: string; detalle?: string }, consulta: string): boolean {
  const palabras = normalizarBusqueda(consulta).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return true;
  const texto = normalizarBusqueda(`${opcion.label} ${opcion.detalle ?? ""}`);
  const compacto = texto.replace(/[^a-z0-9]/g, "");
  return palabras.every((palabra) => {
    if (texto.includes(palabra)) return true;
    const sinSignos = palabra.replace(/[^a-z0-9]/g, "");
    return sinSignos.length > 0 && compacto.includes(sinSignos);
  });
}
