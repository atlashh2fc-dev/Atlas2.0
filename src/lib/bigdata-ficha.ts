/**
 * Ficha por RUT que devuelve Bigdata por el puente firmado
 * (POST /api/commercial-intelligence/atlas-bridge/ficha-rut, contrato
 * bigdata.ficha_rut.v1) y su traducción a los campos del ingreso fuera de base.
 *
 * Bigdata escribe en mayúsculas y con la región como "XIII REGION
 * METROPOLITANA"; el formulario usa los nombres oficiales. Nada de esto se
 * guarda sin que el supervisor lo vea: solo rellena lo que está vacío.
 */

export const FICHA_RUT_CONTRACT = "bigdata.ficha_rut.v1";

export const REGIONES = [
  "Arica y Parinacota",
  "Tarapacá",
  "Antofagasta",
  "Atacama",
  "Coquimbo",
  "Valparaíso",
  "Metropolitana de Santiago",
  "Libertador General Bernardo O'Higgins",
  "Maule",
  "Ñuble",
  "Biobío",
  "La Araucanía",
  "Los Ríos",
  "Los Lagos",
  "Aysén del General Carlos Ibáñez del Campo",
  "Magallanes y de la Antártica Chilena",
] as const;

export type BigdataTelefono = {
  telefono: string;
  nombre: string | null;
  cargo: string | null;
  esEmpresa: boolean;
};

export type BigdataFicha = {
  tipo: "empresa" | "persona";
  nombre: string | null;
  region: string | null;
  comuna: string | null;
  direccion: string | null;
  rubro: string | null;
  email: string | null;
  contacto: { nombre: string; cargo: string | null } | null;
  telefonos: BigdataTelefono[];
  clienteEquifax: boolean;
  activaSii: boolean | null;
  noContactar: boolean;
};

const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "van", "von"]);
const SIGLAS = new Set(["spa", "ltda", "eirl", "sa", "s.a.", "s.p.a.", "e.i.r.l."]);

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plain(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** "FUNERARIA ALMENDRAS Y COMPANIA LIMITADA" → "Funeraria Almendras y Compania Limitada". */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      if (SIGLAS.has(word)) return word.toUpperCase();
      if (index > 0 && PARTICLES.has(word)) return word;
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
}

const REGION_PISTAS: [RegExp, (typeof REGIONES)[number]][] = [
  [/arica|parinacota/, "Arica y Parinacota"],
  [/tarapaca/, "Tarapacá"],
  [/antofagasta/, "Antofagasta"],
  [/atacama/, "Atacama"],
  [/coquimbo/, "Coquimbo"],
  [/valparaiso/, "Valparaíso"],
  [/metropolitana|santiago/, "Metropolitana de Santiago"],
  [/higgins|libertador/, "Libertador General Bernardo O'Higgins"],
  [/maule/, "Maule"],
  [/nuble/, "Ñuble"],
  [/bio ?bio/, "Biobío"],
  [/araucania/, "La Araucanía"],
  [/rios/, "Los Ríos"],
  [/lagos/, "Los Lagos"],
  [/aysen|aisen|ibanez/, "Aysén del General Carlos Ibáñez del Campo"],
  [/magallanes|antartica/, "Magallanes y de la Antártica Chilena"],
];

const REGION_ROMANOS: Record<string, (typeof REGIONES)[number]> = {
  xv: "Arica y Parinacota",
  i: "Tarapacá",
  ii: "Antofagasta",
  iii: "Atacama",
  iv: "Coquimbo",
  v: "Valparaíso",
  xiii: "Metropolitana de Santiago",
  rm: "Metropolitana de Santiago",
  vi: "Libertador General Bernardo O'Higgins",
  vii: "Maule",
  xvi: "Ñuble",
  viii: "Biobío",
  ix: "La Araucanía",
  xiv: "Los Ríos",
  x: "Los Lagos",
  xi: "Aysén del General Carlos Ibáñez del Campo",
  xii: "Magallanes y de la Antártica Chilena",
};

/** Nombre oficial de la región, o null si Bigdata trae algo irreconocible. */
export function officialRegion(value: string | null | undefined): (typeof REGIONES)[number] | null {
  if (!value) return null;
  const clean = plain(value);
  for (const [pattern, region] of REGION_PISTAS) if (pattern.test(clean)) return region;
  for (const token of clean.split(/[^a-z]+/)) if (REGION_ROMANOS[token]) return REGION_ROMANOS[token];
  return null;
}

/** Bigdata guarda "227721528" o "+56227721528"; Atlas marca "+56…". */
export function bigdataPhone(value: unknown): string | null {
  const digits = typeof value === "string" || typeof value === "number" ? String(value).replace(/\D/g, "") : "";
  const national = digits.startsWith("56") && digits.length === 11 ? digits.slice(2) : digits;
  return /^[2-9][0-9]{8}$/.test(national) ? `+56${national}` : null;
}

/** Lee la respuesta del puente. Null si no es el contrato o no hay ficha. */
export function parseBigdataFicha(value: unknown): BigdataFicha | null {
  if (!isRecord(value) || value.found !== true) return null;
  if (value.contract !== undefined && value.contract !== FICHA_RUT_CONTRACT) return null;

  const seen = new Set<string>();
  const telefonos: BigdataTelefono[] = [];
  for (const item of Array.isArray(value.telefonos) ? value.telefonos : []) {
    if (!isRecord(item)) continue;
    const telefono = bigdataPhone(item.telefono);
    if (!telefono || seen.has(telefono)) continue;
    seen.add(telefono);
    telefonos.push({
      telefono,
      nombre: text(item.nombre),
      cargo: text(item.cargo),
      esEmpresa: item.es_empresa === true,
    });
  }

  const contacto = isRecord(value.contacto) && text(value.contacto.nombre)
    ? { nombre: text(value.contacto.nombre) as string, cargo: text(value.contacto.cargo) }
    : null;
  const senales = isRecord(value.senales) ? value.senales : {};

  return {
    tipo: value.tipo === "persona" ? "persona" : "empresa",
    nombre: text(value.nombre),
    region: text(value.region),
    comuna: text(value.comuna),
    direccion: text(value.direccion),
    rubro: text(value.rubro),
    email: text(value.email)?.toLowerCase() ?? null,
    contacto,
    telefonos,
    clienteEquifax: senales.cliente_equifax === true,
    activaSii: typeof senales.activa_sii === "boolean" ? senales.activa_sii : null,
    noContactar: senales.no_contactar === true,
  };
}

export type FichaFormFields = {
  full_name: string;
  contact_name: string;
  phone: string;
  phone_alt: string;
  email: string;
  region: string;
  comuna: string;
  direccion: string;
  rubro: string;
};

export const EMPTY_FICHA_FIELDS: FichaFormFields = {
  full_name: "",
  contact_name: "",
  phone: "",
  phone_alt: "",
  email: "",
  region: "",
  comuna: "",
  direccion: "",
  rubro: "",
};

/** Lo que Bigdata propone para cada campo, ya en el formato del formulario. */
export function fichaToFields(ficha: BigdataFicha): FichaFormFields {
  // La persona del número manda: si el mejor número es de alguien, esa es la
  // persona por quien preguntar. Si no, la que Bigdata señala como contacto.
  const [first, second] = ficha.telefonos;
  const persona = ficha.contacto ?? (first && !first.esEmpresa && first.nombre ? { nombre: first.nombre, cargo: first.cargo } : null);
  const nombre = ficha.nombre ? titleCase(ficha.nombre) : "";
  const contactName = persona && plain(persona.nombre) !== plain(ficha.nombre ?? "") ? titleCase(persona.nombre) : "";
  return {
    full_name: nombre,
    contact_name: ficha.tipo === "persona" ? "" : contactName,
    phone: first?.telefono ?? "",
    phone_alt: second?.telefono ?? "",
    email: ficha.email ?? "",
    region: officialRegion(ficha.region) ?? "",
    comuna: ficha.comuna ? titleCase(ficha.comuna) : "",
    direccion: ficha.direccion ? titleCase(ficha.direccion) : "",
    rubro: ficha.rubro ? ficha.rubro[0] + ficha.rubro.slice(1).toLowerCase() : "",
  };
}

/**
 * Rellena solo lo vacío: lo que el supervisor ya escribió o corrigió no se
 * pisa. Devuelve también qué campos vinieron de Bigdata, para marcarlos.
 */
export function mergeFichaFields(
  current: FichaFormFields,
  proposed: FichaFormFields
): { fields: FichaFormFields; filled: (keyof FichaFormFields)[] } {
  const fields = { ...current };
  const filled: (keyof FichaFormFields)[] = [];
  for (const key of Object.keys(proposed) as (keyof FichaFormFields)[]) {
    if (!current[key].trim() && proposed[key]) {
      fields[key] = proposed[key];
      filled.push(key);
    }
  }
  return { fields, filled };
}
