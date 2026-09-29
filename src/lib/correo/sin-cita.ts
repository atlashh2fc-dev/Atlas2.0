/** Corta lo citado del correo anterior («El … escribió:», «> …») para no repetir la propuesta entera. */
export function sinCita(texto: string): string {
  const lineas = texto.split("\n");
  const corte = lineas.findIndex((linea) => /^\s*>/.test(linea) || /^(El|On) .{6,120}(escribió|wrote):\s*$/i.test(linea.trim()) || /^-{2,}\s*(Mensaje original|Original Message)/i.test(linea.trim()));
  const propio = (corte > 0 ? lineas.slice(0, corte) : lineas).join("\n").trim();
  return propio || texto.trim();
}
