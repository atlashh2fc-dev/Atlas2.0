export function normalizeChilePhone(value: string): string {
  let digits = value.replace(/[^0-9]/g, "");

  if (digits.startsWith("0056")) digits = digits.slice(2);

  let nationalNumber: string;
  if (digits.startsWith("56") && digits.length === 11) {
    nationalNumber = digits.slice(2);
  } else if (digits.length === 9) {
    nationalNumber = digits;
  } else if (digits.length === 8) {
    nationalNumber = `2${digits}`;
  } else {
    throw new Error("Ingresa un teléfono chileno válido, por ejemplo +56 9 1234 5678.");
  }

  if (!/^[2-9][0-9]{8}$/.test(nationalNumber)) {
    throw new Error("Ingresa un teléfono chileno válido, por ejemplo +56 9 1234 5678.");
  }

  return `+56${nationalNumber}`;
}
