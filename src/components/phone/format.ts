/** Formatos del teléfono Atlas: números móviles chilenos, tiempos y nombres. */

export const MOBILE_SUBSCRIBER_DIGITS = 8;

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * El usuario solo escribe los ocho dígitos posteriores a +56 9. También
 * acepta pegar 981406609, 56981406609 o +56 9 8140 6609.
 */
export function subscriberFromPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0056")) digits = digits.slice(4);
  if (digits.startsWith("56") && digits.length >= 10) digits = digits.slice(2);
  if (digits.startsWith("9") && digits.length === 9) digits = digits.slice(1);
  if (digits.length > MOBILE_SUBSCRIBER_DIGITS) {
    digits = digits.slice(-MOBILE_SUBSCRIBER_DIGITS);
  }
  return digits.slice(0, MOBILE_SUBSCRIBER_DIGITS);
}

export function fullChileMobile(subscriber: string): string | null {
  return subscriber.length === MOBILE_SUBSCRIBER_DIGITS ? `569${subscriber}` : null;
}

export function formatSubscriber(subscriber: string): string {
  return [subscriber.slice(0, 4), subscriber.slice(4, 8)].filter(Boolean).join(" ");
}

export function formatChileMobile(phone: string): string {
  const subscriber = subscriberFromPhone(phone);
  return subscriber.length === MOBILE_SUBSCRIBER_DIGITS
    ? `+56 9 ${formatSubscriber(subscriber)}`
    : phone;
}

export function contactInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function formatRecentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  }).format(date);
}

/** Atajos del teléfono: la etiqueta cambia según el sistema del ejecutivo. */
export function shortcutLabel(key: string): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? `⌥ ${key}` : `Alt ${key}`;
}
