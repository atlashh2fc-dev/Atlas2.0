/** Tope de números a rotar por campaña; el mismo que exige la base. */
export const MAX_CALLER_IDS = 50;

/**
 * Lee la lista de números a rotar como identificador de llamada, uno por línea
 * o separados por coma o punto y coma. Devuelve cada número como lo exige
 * Siptel (56 + número nacional, sin '+'), sin repetidos y en el orden escrito.
 * Es la misma regla que aplica el trigger de dialer_campaign_configs, para que
 * el error se vea al guardar y no como un rechazo de la base.
 */
export function parseCallerIdList(value: string): string[] {
  const numbers: string[] = [];
  for (const raw of value.split(/[\n,;]+/)) {
    if (!raw.trim()) continue;
    let digits = raw.replace(/[^0-9]/g, "");
    if (digits.startsWith("0056")) digits = digits.slice(2);
    if (digits.length === 9) digits = `56${digits}`;
    else if (digits.length === 8) digits = `562${digits}`;
    if (!/^56[2-9][0-9]{8}$/.test(digits)) {
      throw new Error(`«${raw.trim()}» no es un número chileno válido para rotar. Usa el formato 56 9 1234 5678.`);
    }
    if (!numbers.includes(digits)) numbers.push(digits);
  }
  if (numbers.length > MAX_CALLER_IDS) {
    throw new Error(`Se pueden rotar hasta ${MAX_CALLER_IDS} números por campaña.`);
  }
  return numbers;
}
