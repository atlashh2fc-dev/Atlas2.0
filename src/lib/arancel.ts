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
  /** Receta: los materiales que el procedimiento usa normalmente. */
  receta?: { insumo_id: string; cantidad: number }[];
};

/** Un material de la clínica: lo que cuesta y, si se cobra aparte, a cuánto. */
export type Insumo = {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  unidad: string;
  costo: number;
  precio_venta: number | null;
  cobrable: boolean;
  stock: number | null;
  stock_minimo: number | null;
  activo: boolean;
};

/** Lo usado en una atención, con el costo y el precio de ese día. */
export type MaterialUsado = {
  nombre: string;
  unidad: string;
  cantidad: number;
  costo_unitario: number;
  precio_unitario: number | null;
  cobrado: boolean;
};

/** Un material elegido al atender (antes de guardar). */
export type MaterialElegido = { insumo_id: string; cantidad: number; cobrar: boolean };

/** Costo interno y cobro aparte de una lista de materiales. */
export function totalesMateriales(elegidos: MaterialElegido[], catalogo: Map<string, Insumo>) {
  let costo = 0;
  let cobro = 0;
  for (const elegido of elegidos) {
    const insumo = catalogo.get(elegido.insumo_id);
    if (!insumo || !(elegido.cantidad > 0)) continue;
    costo += Number(insumo.costo) * elegido.cantidad;
    if (insumo.cobrable && elegido.cobrar) cobro += Number(insumo.precio_venta ?? 0) * elegido.cantidad;
  }
  return { costo, cobro };
}

/** Costo de materiales de la receta de un procedimiento. */
export function costoDeReceta(procedimiento: Procedimiento, catalogo: Map<string, Insumo>) {
  return totalesMateriales(
    (procedimiento.receta ?? []).map((item) => ({ ...item, cobrar: true })),
    catalogo,
  );
}

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
  costo_materiales?: number;
  precio_materiales?: number;
  atencion_insumos?: MaterialUsado[];
};

/** Lo que se cobra por la atención: el procedimiento más los materiales cobrables. */
export function totalAtencion(atencion: Pick<Atencion, "precio" | "precio_materiales">) {
  return Number(atencion.precio) + Number(atencion.precio_materiales ?? 0);
}

/** "Anestesia ×2 · Resina ×1": para mostrar lo usado en una línea. */
export function resumenMateriales(materiales: MaterialUsado[] | undefined) {
  return (materiales ?? []).map((material) => `${material.nombre} ×${Number(material.cantidad).toLocaleString("es-CL")}`).join(" · ");
}

export const CATEGORIAS: Record<"dental" | "vet", string[]> = {
  dental: ["Diagnóstico", "Urgencias", "Prevención", "Operatoria", "Endodoncia", "Periodoncia", "Cirugía", "Implantología", "Prótesis", "Ortodoncia", "Odontopediatría", "Estética", "ATM"],
  vet: ["Consultas", "Urgencias", "Vacunas", "Laboratorio", "Imagenología", "Anestesia", "Cirugías", "Odontología", "Rehabilitación", "Estética", "Otros"],
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
