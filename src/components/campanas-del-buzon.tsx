"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui";

/**
 * Las campañas que envían y reciben por un buzón. Se filtran por nombre y se
 * marcan las visibles de una vez: escribir «Equifax» y marcar deja lista la
 * cuenta completa. Una campaña que ya usa otro buzón aparece bloqueada.
 */

export type OpcionCampana = { id: string; nombre: string; otroBuzon: string | null };

export function CampanasDelBuzon({ opciones, marcadas }: { opciones: OpcionCampana[]; marcadas: string[] }) {
  const [seleccion, setSeleccion] = useState(() => new Set(marcadas));
  const [filtro, setFiltro] = useState("");
  const visibles = useMemo(() => {
    const texto = filtro.trim().toLocaleLowerCase("es-CL");
    return texto ? opciones.filter((opcion) => opcion.nombre.toLocaleLowerCase("es-CL").includes(texto)) : opciones;
  }, [filtro, opciones]);
  const libresVisibles = visibles.filter((opcion) => !opcion.otroBuzon);
  const todasMarcadas = libresVisibles.length > 0 && libresVisibles.every((opcion) => seleccion.has(opcion.id));

  function alternar(id: string) {
    setSeleccion((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  function marcarVisibles() {
    setSeleccion((actual) => {
      const siguiente = new Set(actual);
      for (const opcion of libresVisibles) {
        if (todasMarcadas) siguiente.delete(opcion.id);
        else siguiente.add(opcion.id);
      }
      return siguiente;
    });
  }

  return (
    <fieldset className="space-y-3 sm:col-span-2">
      <legend className="text-sm font-medium text-foreground">Campañas que usan este buzón</legend>
      <p className="text-xs text-muted-foreground">
        {seleccion.size === 0
          ? "Sin campañas marcadas, este buzón es el de respaldo: lo usan las campañas que no tienen uno propio."
          : `${seleccion.size} ${seleccion.size === 1 ? "campaña envía" : "campañas envían"} y ${seleccion.size === 1 ? "recibe" : "reciben"} por este buzón.`}
      </p>
      {[...seleccion].map((id) => (
        <input key={id} type="hidden" name="campanas" value={id} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Buscar campaña</span>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={filtro}
            onChange={(event) => setFiltro(event.target.value)}
            placeholder="Buscar campaña, p. ej. Equifax"
            className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <Button type="button" variant="secondary" className="h-9" onClick={marcarVisibles} disabled={libresVisibles.length === 0}>
          {todasMarcadas ? "Desmarcar" : "Marcar"} {filtro.trim() ? `las ${libresVisibles.length} visibles` : "todas"}
        </Button>
      </div>
      <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
        {visibles.map((opcion) => (
          <label
            key={opcion.id}
            className={`flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm ${opcion.otroBuzon ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer text-foreground hover:bg-surface-muted"}`}
          >
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={seleccion.has(opcion.id)}
              disabled={Boolean(opcion.otroBuzon)}
              onChange={() => alternar(opcion.id)}
            />
            <span className="min-w-0">
              <span className="block truncate">{opcion.nombre}</span>
              {opcion.otroBuzon && <span className="block truncate text-xs">Usa {opcion.otroBuzon}</span>}
            </span>
          </label>
        ))}
        {visibles.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Ninguna campaña coincide.</p>}
      </div>
    </fieldset>
  );
}
