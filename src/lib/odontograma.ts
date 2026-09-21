/**
 * Odontograma: catálogo de piezas (numeración FDI), estados y avance.
 *
 * Puro y sin dependencias: lo usan el visor 3D, el panel de la pieza, la
 * acción que guarda y las pruebas. Los colores siguen la convención clínica:
 * rojo para lo que hay que tratar, azul para lo ya tratado.
 */

export type TipoDiente = "incisivo_central" | "incisivo_lateral" | "canino" | "premolar" | "molar";
export type Denticion = "permanente" | "temporal";

export type Pieza = {
  numero: number;
  cuadrante: 1 | 2 | 3 | 4;
  /** Posición desde la línea media: 1 es el incisivo central. */
  posicion: number;
  tipo: TipoDiente;
  superior: boolean;
  temporal: boolean;
  nombre: string;
};

const TIPO_PERMANENTE: TipoDiente[] = [
  "incisivo_central", "incisivo_lateral", "canino", "premolar", "premolar", "molar", "molar", "molar",
];
const TIPO_TEMPORAL: TipoDiente[] = ["incisivo_central", "incisivo_lateral", "canino", "molar", "molar"];

const NOMBRE_PERMANENTE = [
  "Incisivo central", "Incisivo lateral", "Canino", "Primer premolar", "Segundo premolar",
  "Primer molar", "Segundo molar", "Tercer molar",
];
const NOMBRE_TEMPORAL = ["Incisivo central temporal", "Incisivo lateral temporal", "Canino temporal", "Primer molar temporal", "Segundo molar temporal"];
const LADO: Record<1 | 2 | 3 | 4, string> = {
  1: "superior derecho",
  2: "superior izquierdo",
  3: "inferior izquierdo",
  4: "inferior derecho",
};

export function piezasDe(denticion: Denticion): Pieza[] {
  const temporal = denticion === "temporal";
  const tipos = temporal ? TIPO_TEMPORAL : TIPO_PERMANENTE;
  const nombres = temporal ? NOMBRE_TEMPORAL : NOMBRE_PERMANENTE;
  const piezas: Pieza[] = [];
  for (const cuadrante of [1, 2, 3, 4] as const) {
    tipos.forEach((tipo, indice) => {
      const posicion = indice + 1;
      piezas.push({
        numero: (temporal ? cuadrante + 4 : cuadrante) * 10 + posicion,
        cuadrante,
        posicion,
        tipo,
        superior: cuadrante <= 2,
        temporal,
        nombre: `${nombres[indice]} ${LADO[cuadrante]}`,
      });
    });
  }
  return piezas;
}

export function piezaPorNumero(numero: number): Pieza | null {
  const temporal = numero >= 50;
  return piezasDe(temporal ? "temporal" : "permanente").find((pieza) => pieza.numero === numero) ?? null;
}

/**
 * Qué dentición mostrar según la edad: temporal hasta los 6, mixta hasta los 12
 * (se muestra la temporal, que es la que se trata en la infancia) y permanente
 * desde ahí. Sin fecha de nacimiento, permanente.
 */
export function denticionPorEdad(nacimiento: string | null | undefined, ahora = new Date()): Denticion {
  if (!nacimiento) return "permanente";
  const nacio = new Date(`${nacimiento}T12:00:00`);
  if (Number.isNaN(nacio.getTime())) return "permanente";
  const anios = (ahora.getTime() - nacio.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return anios < 12 ? "temporal" : "permanente";
}

export const ESTADOS = [
  "sano", "caries", "fractura", "obturacion", "sellante", "endodoncia",
  "corona", "implante", "protesis", "extraccion_indicada", "ausente",
] as const;
export type EstadoPieza = (typeof ESTADOS)[number];

export type InfoEstado = {
  label: string;
  /** Color en el visor 3D y en la leyenda. */
  color: string;
  /** Lo que requiere tratamiento (rojo) frente a lo ya tratado (azul). */
  grupo: "sano" | "patologia" | "tratado" | "ausente";
  /** Se marca por superficie (oclusal, mesial...) o afecta a la pieza entera. */
  porSuperficie: boolean;
};

export const INFO_ESTADO: Record<EstadoPieza, InfoEstado> = {
  sano: { label: "Sano", color: "#e9e4da", grupo: "sano", porSuperficie: false },
  caries: { label: "Caries", color: "#dc2626", grupo: "patologia", porSuperficie: true },
  fractura: { label: "Fractura", color: "#ea580c", grupo: "patologia", porSuperficie: true },
  obturacion: { label: "Obturación", color: "#2563eb", grupo: "tratado", porSuperficie: true },
  sellante: { label: "Sellante", color: "#38bdf8", grupo: "tratado", porSuperficie: true },
  endodoncia: { label: "Endodoncia", color: "#9333ea", grupo: "tratado", porSuperficie: false },
  corona: { label: "Corona", color: "#d4a017", grupo: "tratado", porSuperficie: false },
  implante: { label: "Implante", color: "#64748b", grupo: "tratado", porSuperficie: false },
  protesis: { label: "Prótesis", color: "#db2777", grupo: "tratado", porSuperficie: false },
  extraccion_indicada: { label: "Extracción indicada", color: "#b91c1c", grupo: "patologia", porSuperficie: false },
  ausente: { label: "Ausente", color: "#94a3b8", grupo: "ausente", porSuperficie: false },
};

export const AVANCES = ["diagnostico", "planificado", "en_curso", "terminado"] as const;
export type Avance = (typeof AVANCES)[number];

export const INFO_AVANCE: Record<Avance, { label: string; tono: "danger" | "warning" | "info" | "success" }> = {
  diagnostico: { label: "Diagnosticado", tono: "danger" },
  planificado: { label: "Planificado", tono: "warning" },
  en_curso: { label: "En tratamiento", tono: "info" },
  terminado: { label: "Terminado", tono: "success" },
};

export const SUPERFICIES = ["O", "M", "D", "V", "L"] as const;
export type Superficie = (typeof SUPERFICIES)[number];

export function nombreSuperficie(superficie: Superficie, pieza: Pieza | null): string {
  const anterior = pieza ? pieza.tipo !== "premolar" && pieza.tipo !== "molar" : false;
  switch (superficie) {
    case "O":
      return anterior ? "Incisal" : "Oclusal";
    case "M":
      return "Mesial";
    case "D":
      return "Distal";
    case "V":
      return "Vestibular";
    case "L":
      return pieza?.superior ? "Palatina" : "Lingual";
  }
}

export type RegistroOdontograma = {
  id: string;
  pieza: number;
  superficies: string[];
  estado: EstadoPieza;
  avance: Avance;
  sintoma: string | null;
  diagnostico: string | null;
  tratamiento: string | null;
  profesional: string | null;
  nota: string | null;
  fecha: string;
  created_at: string;
};

/** Orden de la historia: por fecha clínica y, dentro del día, por hora de registro. */
export function ordenarRegistros(registros: RegistroOdontograma[]): RegistroOdontograma[] {
  return [...registros].sort((a, b) => (b.fecha === a.fecha ? b.created_at.localeCompare(a.created_at) : b.fecha.localeCompare(a.fecha)));
}

/** El estado de cada pieza es su último registro. */
export function estadoActual(registros: RegistroOdontograma[]): Map<number, RegistroOdontograma> {
  const actual = new Map<number, RegistroOdontograma>();
  for (const registro of ordenarRegistros(registros)) {
    if (!actual.has(registro.pieza)) actual.set(registro.pieza, registro);
  }
  return actual;
}

/**
 * Superficies tratadas o afectadas que siguen vigentes: una obturación antigua
 * en oclusal se sigue viendo aunque después se registre una caries en mesial.
 */
export function superficiesVigentes(registros: RegistroOdontograma[], pieza: number): Map<Superficie, EstadoPieza> {
  const vigentes = new Map<Superficie, EstadoPieza>();
  for (const registro of ordenarRegistros(registros).filter((item) => item.pieza === pieza)) {
    if (!INFO_ESTADO[registro.estado]?.porSuperficie) continue;
    for (const superficie of registro.superficies as Superficie[]) {
      if (!vigentes.has(superficie)) vigentes.set(superficie, registro.estado);
    }
  }
  return vigentes;
}
