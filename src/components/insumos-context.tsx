"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Insumo } from "@/lib/arancel";

/**
 * El catálogo de materiales de la clínica, para que cualquier formulario de
 * atención dentro de la ficha lo tenga sin pasarlo pieza por pieza.
 */
const InsumosContext = createContext<{ lista: Insumo[]; porId: Map<string, Insumo> }>({ lista: [], porId: new Map() });

export function InsumosProvider({ insumos, children }: { insumos: Insumo[]; children: ReactNode }) {
  const valor = useMemo(() => ({ lista: insumos, porId: new Map(insumos.map((insumo) => [insumo.id, insumo])) }), [insumos]);
  return <InsumosContext.Provider value={valor}>{children}</InsumosContext.Provider>;
}

export function useInsumos() {
  return useContext(InsumosContext);
}
