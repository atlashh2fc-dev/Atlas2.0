"use client";

import { useState } from "react";
import { Package, X } from "lucide-react";

import { guardarReceta } from "@/app/actions/insumos";
import { useInsumos } from "@/components/insumos-context";
import { ActionForm, ActionSubmit } from "@/components/ui";
import { pesos, totalesMateriales } from "@/lib/arancel";

/**
 * La receta de un procedimiento: qué materiales usa normalmente. Cerrada
 * muestra solo el costo; se edita al abrirla, para no cargar decenas de
 * formularios en una página con todo el arancel.
 */
export function RecetaEditor({
  productoId,
  receta,
  precio,
}: {
  productoId: string;
  receta: { insumo_id: string; cantidad: number }[];
  precio: number | null;
}) {
  const { lista, porId } = useInsumos();
  const [abierta, setAbierta] = useState(false);
  const [lineas, setLineas] = useState(receta.map((linea) => ({ ...linea, cantidad: Number(linea.cantidad) })));

  const { costo, cobro } = totalesMateriales(
    lineas.map((linea) => ({ ...linea, cobrar: true })),
    porId,
  );
  const total = Number(precio ?? 0) + cobro;
  const margen = total - costo;
  const disponibles = lista.filter((insumo) => insumo.activo && !lineas.some((linea) => linea.insumo_id === insumo.id));

  return (
    <div className="px-4 pb-2.5">
      <button
        type="button"
        onClick={() => setAbierta((valor) => !valor)}
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={abierta}
      >
        <Package size={12} aria-hidden="true" />
        {lineas.length === 0 ? (
          <span>Sin receta de materiales · agregar</span>
        ) : (
          <>
            <span>
              {lineas.length} {lineas.length === 1 ? "material" : "materiales"} · costo {pesos.format(costo)}
            </span>
            {cobro > 0 && <span>· se cobran {pesos.format(cobro)}</span>}
            {total > 0 && (
              <span className={margen < 0 ? "text-danger" : "text-success"}>
                · margen {Math.round((margen / total) * 100)}%
              </span>
            )}
          </>
        )}
      </button>

      {abierta && (
        <ActionForm action={guardarReceta} success="Receta guardada" className="mt-2 rounded-lg border border-border bg-surface-muted/40 p-3">
          <input type="hidden" name="producto_id" value={productoId} />
          {lineas.length > 0 && (
            <ul className="mb-2 space-y-1">
              {lineas.map((linea) => {
                const insumo = porId.get(linea.insumo_id);
                if (!insumo) return null;
                return (
                  <li key={linea.insumo_id} className="flex items-center gap-2 text-sm">
                    <input type="hidden" name="insumo_id" value={linea.insumo_id} />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {insumo.nombre}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {pesos.format(Number(insumo.costo))} / {insumo.unidad}
                        {insumo.cobrable ? " · se cobra" : ""}
                      </span>
                    </span>
                    <input
                      name="cantidad"
                      type="number"
                      min={0}
                      step="0.5"
                      value={linea.cantidad}
                      onChange={(event) =>
                        setLineas((actuales) =>
                          actuales.map((item) => (item.insumo_id === linea.insumo_id ? { ...item, cantidad: Number(event.target.value) } : item)),
                        )
                      }
                      aria-label={`Cantidad de ${insumo.nombre}`}
                      className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm tabular-nums text-foreground"
                    />
                    <button
                      type="button"
                      aria-label={`Quitar ${insumo.nombre}`}
                      onClick={() => setLineas((actuales) => actuales.filter((item) => item.insumo_id !== linea.insumo_id))}
                      className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              aria-label="Agregar material a la receta"
              value=""
              onChange={(event) => {
                const id = event.target.value;
                if (id) setLineas((actuales) => [...actuales, { insumo_id: id, cantidad: 1 }]);
              }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground"
            >
              <option value="">+ Agregar material</option>
              {[...new Set(disponibles.map((insumo) => insumo.categoria ?? "Otros"))].map((categoria) => (
                <optgroup key={categoria} label={categoria}>
                  {disponibles
                    .filter((insumo) => (insumo.categoria ?? "Otros") === categoria)
                    .map((insumo) => (
                      <option key={insumo.id} value={insumo.id}>
                        {insumo.nombre}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <ActionSubmit size="sm" variant="secondary" pendingLabel="…">
              Guardar receta
            </ActionSubmit>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
