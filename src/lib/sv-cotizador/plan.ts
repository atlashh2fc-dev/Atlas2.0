/**
 * Cotizador de Secretaria Virtual: el Plan Base de la propuesta comercial de
 * Geimser («Servicio de Ejecutiva Virtual»), tal como está en el documento.
 * No hay descuentos: el documento habla de «descuentos vigentes» al renovar
 * pero no fija ninguno, y operación pidió no salirse de él (16-10-2026).
 *
 * La ejecutiva simula el valor en pesos con la UF del día y el total de los
 * meses del contrato; el volumen de llamadas, el horario y los excedentes son
 * condiciones particulares que completa solo si ya las conversó.
 */

export const IVA = 0.19;

export const PLAN_BASE = {
  clave: "base",
  nombre: "Plan Base – Ejecutiva Virtual",
  servicio: "Servicio de Ejecutiva Virtual",
  ufMensual: 2,
  horasSemanales: 42,
  dias: "Lunes a viernes",
  modalidad: "No exclusiva (compartida)",
} as const;

/** Plazo mínimo y renovaciones del documento: trimestral, semestral o anual. */
export const PLAZOS = [
  { meses: 3, etiqueta: "3 meses · plazo mínimo" },
  { meses: 6, etiqueta: "6 meses · semestral" },
  { meses: 12, etiqueta: "12 meses · anual" },
] as const;

export type PlazoMeses = (typeof PLAZOS)[number]["meses"];

export const PLAZO_MINIMO: PlazoMeses = 3;

/** Lo que el documento deja para las «condiciones particulares del servicio». */
export type CondicionesParticulares = {
  /** Llamadas incluidas al mes. */
  llamadas: number | null;
  /** Distribución horaria, p. ej. «09:00 a 18:00». */
  horario: string | null;
  /** Cómo se cobran las llamadas sobre lo incluido. */
  excedente: string | null;
};

export const SIN_CONDICIONES: CondicionesParticulares = { llamadas: null, horario: null, excedente: null };

export type Simulacion = {
  ufNeto: number;
  ufIva: number;
  ufTotal: number;
  meses: PlazoMeses;
  ufNetoPeriodo: number;
  ufTotalPeriodo: number;
  /** En pesos con la UF del día; null sin UF. */
  pesos: { neto: number; iva: number; total: number; netoPeriodo: number; totalPeriodo: number } | null;
};

const redondear2 = (valor: number) => Math.round(valor * 100) / 100;

export function esPlazo(valor: unknown): valor is PlazoMeses {
  return PLAZOS.some((plazo) => plazo.meses === valor);
}

export function simular(meses: PlazoMeses, valorUf: number | null): Simulacion {
  const ufNeto = PLAN_BASE.ufMensual;
  const ufIva = redondear2(ufNeto * IVA);
  const ufTotal = redondear2(ufNeto + ufIva);
  const conUf = valorUf != null && Number.isFinite(valorUf) && valorUf > 0;
  return {
    ufNeto,
    ufIva,
    ufTotal,
    meses,
    ufNetoPeriodo: redondear2(ufNeto * meses),
    ufTotalPeriodo: redondear2(ufTotal * meses),
    pesos: conUf
      ? {
          neto: Math.round(ufNeto * valorUf),
          iva: Math.round(ufIva * valorUf),
          total: Math.round(ufTotal * valorUf),
          netoPeriodo: Math.round(ufNeto * meses * valorUf),
          totalPeriodo: Math.round(ufTotal * meses * valorUf),
        }
      : null,
  };
}

/** Lo que llega del navegador, limpio: textos cortos y llamadas enteras positivas. */
export function normalizarCondiciones(valor: unknown): CondicionesParticulares {
  const crudo = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
  const texto = (campo: unknown) => {
    const limpio = typeof campo === "string" ? campo.replace(/\s+/g, " ").trim().slice(0, 160) : "";
    return limpio || null;
  };
  const llamadas = Math.round(Number(crudo.llamadas));
  return {
    llamadas: Number.isFinite(llamadas) && llamadas > 0 && llamadas <= 100000 ? llamadas : null,
    horario: texto(crudo.horario),
    excedente: texto(crudo.excedente),
  };
}

export function tieneCondiciones(condiciones: CondicionesParticulares): boolean {
  return condiciones.llamadas != null || condiciones.horario != null || condiciones.excedente != null;
}

/** «Plan Base 2 UF + IVA mensual · 3 meses»: lo que queda en la nota y el historial. */
export function resumenPropuesta(meses: number): string {
  return `${PLAN_BASE.nombre} ${PLAN_BASE.ufMensual} UF + IVA mensual · ${meses} meses`;
}
