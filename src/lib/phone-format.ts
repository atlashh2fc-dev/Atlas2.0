/** +56 2 2787 6000 / +56 9 8140 6609 para leer el número de un vistazo. */
export function formatDialDigits(digits: string): string {
  if (/^569\d{8}$/.test(digits)) return `+56 9 ${digits.slice(3, 7)} ${digits.slice(7)}`;
  if (/^562\d{8}$/.test(digits)) return `+56 2 ${digits.slice(3, 7)} ${digits.slice(7)}`;
  if (/^56\d{9}$/.test(digits)) return `+56 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}
