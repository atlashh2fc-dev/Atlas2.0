/**
 * Lectura de `leads.extra` para la ficha y el teléfono.
 *
 * Las bases no guardan todo en el primer nivel: la migración de Atlas 1 dejó
 * la persona de contacto en `extra.atlas1.nombre_cliente` y la carga de
 * Vocalcom el rubro, la comuna y el último resultado en `extra.base_discado`.
 * La ficha mostraba solo los valores simples del primer nivel, así que el
 * ejecutivo veía la razón social sin saber por quién preguntar.
 */

type Primitive = string | number | boolean;

/** Claves que, en cualquier nivel, nombran a la persona de contacto. */
const CONTACT_KEYS = ["contact_name", "nombre_contacto", "nombre_cliente"];

/** Grupos anidados que se muestran aplanados, en este orden. */
const NESTED_GROUPS = ["base_discado", "atlas1"];

/** Datos internos de la carga que no le sirven al ejecutivo. */
const HIDDEN_TOP_LEVEL = new Set(["origen"]);
const HIDDEN_NESTED = new Set(["base", "campana", "legacy_lead_ids"]);

const LABELS: Record<string, string> = {
  rubro: "Rubro",
  subrubro: "Subrubro",
  actividad: "Actividad",
  comuna: "Comuna",
  region: "Región",
  intentos: "Intentos en Atlas 1",
  vocalcom_resultado: "Último resultado Vocalcom",
  vocalcom_ultimo_intento: "Último intento Vocalcom",
  vocalcom_ejecutivo: "Ejecutivo Vocalcom",
  vocalcom_duracion: "Duración Vocalcom (s)",
  vocalcom_codigo: "Código Vocalcom",
};

function isPrimitive(value: unknown): value is Primitive {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/**
 * Persona con quien hablar. Null si la base no la trae o si repite el nombre
 * del registro (en Equifax el registro es la razón social).
 */
export function leadContactPerson(
  extra: Record<string, unknown> | null | undefined,
  recordName: string | null | undefined
): string | null {
  if (!extra) return null;
  const scopes = [extra, ...NESTED_GROUPS.map((group) => extra[group]).filter(isRecord)];
  for (const scope of scopes) {
    for (const key of CONTACT_KEYS) {
      const value = scope[key];
      if (typeof value !== "string" || !value.trim()) continue;
      if (recordName && normalize(value) === normalize(recordName)) return null;
      return value.trim();
    }
  }
  return null;
}

function formatValue(key: string, value: Primitive): string {
  if (key === "vocalcom_ultimo_intento" && typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString("es-CL", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Santiago",
      });
    }
  }
  return String(value);
}

/**
 * Campos cargados de la base, listos para mostrar: los simples del primer
 * nivel con su nombre original y los grupos conocidos aplanados con etiqueta.
 * La persona de contacto no se repite aquí: va junto al nombre del registro.
 */
export function leadExtraFields(
  extra: Record<string, unknown> | null | undefined,
  options: { exclude?: string[] } = {}
): [string, string][] {
  if (!extra) return [];
  const exclude = new Set(options.exclude ?? []);
  const fields: [string, string][] = [];
  const skip = (key: string) => exclude.has(key) || CONTACT_KEYS.includes(key);

  for (const [key, value] of Object.entries(extra)) {
    if (skip(key) || HIDDEN_TOP_LEVEL.has(key) || !isPrimitive(value)) continue;
    fields.push([key, String(value)]);
  }
  for (const group of NESTED_GROUPS) {
    const nested = extra[group];
    if (!isRecord(nested)) continue;
    for (const [key, value] of Object.entries(nested)) {
      if (skip(key) || HIDDEN_NESTED.has(key) || !isPrimitive(value) || value === "") continue;
      fields.push([LABELS[key] ?? key, formatValue(key, value)]);
    }
  }
  return fields;
}
