/**
 * Estudios adjuntos a la ficha: radiografías, ecografías, exámenes, fotos y
 * documentos. Puro, para el servidor y el cliente.
 */

export const TIPOS_ESTUDIO = ["radiografia", "ecografia", "laboratorio", "foto", "documento"] as const;
export type TipoEstudio = (typeof TIPOS_ESTUDIO)[number];

export const ETIQUETA_ESTUDIO: Record<TipoEstudio, string> = {
  radiografia: "Radiografía",
  ecografia: "Ecografía",
  laboratorio: "Examen de laboratorio",
  foto: "Foto clínica",
  documento: "Documento",
};

/** Lo que acepta el bucket; el DICOM se guarda y se descarga, no se previsualiza. */
export const TIPOS_ARCHIVO = ["image/jpeg", "image/png", "image/webp", "application/pdf", "application/dicom"] as const;
export const TAMANO_MAXIMO = 25 * 1024 * 1024;

export type Estudio = {
  id: string;
  tipo: TipoEstudio;
  titulo: string;
  nota: string | null;
  pieza: number | null;
  region: string | null;
  mascota_id: string | null;
  mime: string;
  tamano: number | null;
  fecha: string;
  /** Enlace firmado de corta duración, generado al cargar la ficha. */
  url: string | null;
};

export function esImagen(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Tipo de archivo por extensión cuando el navegador no lo informa (típico en .dcm). */
export function mimeDe(nombre: string, informado: string): string {
  if (informado) return informado;
  return nombre.toLowerCase().endsWith(".dcm") ? "application/dicom" : "application/octet-stream";
}

/** Nombre seguro para la ruta en el bucket. */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-80);
  return limpio || "archivo";
}

export function tamanoLegible(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
