export const LEGAL_INTERCALL_BREAK_SECONDS = 10;
export const LEGAL_INTERCALL_BREAK_MS = LEGAL_INTERCALL_BREAK_SECONDS * 1000;
export const INTERCALL_BREAK_STORAGE_KEY = "atlas:legal-intercall-break-until";
export const INTERCALL_BREAK_EVENT = "atlas:legal-intercall-break";

export function beginLegalIntercallBreak(): number {
  const until = Date.now() + LEGAL_INTERCALL_BREAK_MS;
  try {
    window.localStorage.setItem(INTERCALL_BREAK_STORAGE_KEY, String(until));
  } catch {
    // El evento mantiene protegida la pestaña actual aunque el navegador
    // tenga almacenamiento local deshabilitado.
  }
  window.dispatchEvent(new CustomEvent<number>(INTERCALL_BREAK_EVENT, { detail: until }));
  return until;
}

export function readLegalIntercallBreakUntil(): number {
  if (typeof window === "undefined") return 0;
  try {
    const stored = Number(window.localStorage.getItem(INTERCALL_BREAK_STORAGE_KEY));
    return Number.isFinite(stored) && stored > Date.now() ? stored : 0;
  } catch {
    return 0;
  }
}
