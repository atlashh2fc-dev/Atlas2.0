/**
 * La ruta que la persona pidió, tal como la ve el proxy. Viaja en una cabecera
 * porque un layout de servidor no conoce la ruta de la página que envuelve.
 */
export const CABECERA_RUTA = "x-atlas-ruta";

/** Áreas con sesión: el CRM de cada empresa y la consola de plataforma. */
const AREAS_PROPIAS = ["/dashboard", "/plataforma"];

/**
 * Solo rutas propias del panel: un `?next=https://otro-sitio` convertiría el
 * login en un redirector abierto.
 */
export function rutaSegura(ruta: string | null | undefined, porDefecto = "/dashboard"): string {
  if (!ruta || !AREAS_PROPIAS.some((area) => ruta.startsWith(area)) || ruta.startsWith("//") || ruta.includes("\\")) {
    return porDefecto;
  }
  return ruta;
}

/** La petición es una precarga (de Next o del navegador), no una visita. */
export function esPrecarga(cabeceras: Headers): boolean {
  return (
    cabeceras.has("next-router-prefetch") ||
    cabeceras.get("purpose") === "prefetch" ||
    (cabeceras.get("sec-purpose") ?? "").includes("prefetch")
  );
}
