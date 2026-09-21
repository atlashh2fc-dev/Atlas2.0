/**
 * Arancel de la clínica: los procedimientos con su precio y a qué se aplican.
 * Puro, para el servidor y el cliente.
 */

export const APLICA_A = ["boca", "pieza", "superficie", "mascota", "region"] as const;
export type AplicaA = (typeof APLICA_A)[number];

export const ETIQUETA_APLICA_A: Record<AplicaA, string> = {
  boca: "Toda la boca",
  pieza: "Una pieza",
  superficie: "Superficies de una pieza",
  mascota: "La mascota",
  region: "Una zona del cuerpo",
};

export type Procedimiento = {
  id: string;
  code: string;
  name: string;
  one_time_price: number | null;
  categoria: string | null;
  duracion_min: number | null;
  es_urgencia: boolean;
  aplica_a: AplicaA;
  resultado_odontograma: string | null;
  orden: number;
  active: boolean;
};

export type Atencion = {
  id: string;
  descripcion: string;
  pieza: number | null;
  superficies: string[];
  region: string | null;
  mascota_id: string | null;
  precio: number;
  pagado: boolean;
  es_urgencia: boolean;
  profesional: string | null;
  nota: string | null;
  fecha: string;
  created_at: string;
};

export const CATEGORIAS: Record<"dental" | "vet", string[]> = {
  dental: ["Diagnóstico", "Urgencias", "Prevención", "Operatoria", "Endodoncia", "Periodoncia", "Cirugía", "Implantología", "Prótesis", "Ortodoncia", "Estética"],
  vet: ["Consultas", "Urgencias", "Vacunas", "Laboratorio", "Imagenología", "Cirugías", "Odontología", "Estética"],
};

/** Agrupa por categoría respetando el orden del arancel. */
export function porCategoria(procedimientos: Procedimiento[]): [string, Procedimiento[]][] {
  const grupos = new Map<string, Procedimiento[]>();
  for (const procedimiento of [...procedimientos].sort((a, b) => a.orden - b.orden || a.name.localeCompare(b.name))) {
    const categoria = procedimiento.categoria ?? "Otros";
    grupos.set(categoria, [...(grupos.get(categoria) ?? []), procedimiento]);
  }
  return [...grupos.entries()];
}

export const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
