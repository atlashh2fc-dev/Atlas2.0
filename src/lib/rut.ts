/**
 * RUT chileno: cuerpo + dígito verificador (módulo 11).
 *
 * Las bases llegan como "76.150.794-K"; el que se ingresa a mano, de
 * cualquier forma ("76150794k", "76.150.794 - K"). Se guarda con el mismo
 * formato de las bases para que la búsqueda y el cruce por RUT lo encuentren.
 */

/** Solo dígitos y K mayúscula, sin puntos ni guion. */
export function compactRut(value: string): string {
  return value.replace(/[^0-9kK]/g, "").toUpperCase();
}

/** Dígito verificador del cuerpo numérico. */
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const digit = 11 - (sum % 11);
  if (digit === 11) return "0";
  if (digit === 10) return "K";
  return String(digit);
}

export function isValidRut(value: string): boolean {
  const compact = compactRut(value);
  if (!/^[0-9]{7,8}[0-9K]$/.test(compact)) return false;
  const body = compact.slice(0, -1);
  if (/^0+$/.test(body)) return false;
  return rutCheckDigit(body) === compact.slice(-1);
}

/**
 * "76150794k" → "76.150.794-K". Lanza si el RUT no es válido: un RUT mal
 * digitado crea un registro que nadie vuelve a encontrar.
 */
export function formatRut(value: string): string {
  if (!isValidRut(value)) {
    throw new Error("El RUT no es válido: revisa los números y el dígito verificador.");
  }
  const compact = compactRut(value);
  const body = compact.slice(0, -1).replace(/^0+/, "");
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${compact.slice(-1)}`;
}
