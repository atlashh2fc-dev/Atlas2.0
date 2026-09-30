"use client";

import { useEffect, useRef } from "react";

import { GUARDAS, INFO_TECNICA, INFO_ZONA, TECNICAS, ZONAS, type MapaCorte, type Tecnica, type Zona } from "@/lib/look";

const TIJERA = [30, 35, 40, 45, 50, 60, 70, 80, 100, 120, 150];

/** Opciones de largo: sin pelo, las guardas de la máquina y largos de tijera. */
export const OPCIONES_LARGO: { mm: number; etiqueta: string }[] = [
  { mm: 0, etiqueta: "Sin pelo / afeitado" },
  ...GUARDAS.map((guarda) => ({ mm: guarda.mm, etiqueta: `${guarda.nombre} · ${String(guarda.mm).replace(".", ",")} mm` })),
  ...TIJERA.map((mm) => ({ mm, etiqueta: `Tijera · ${mm / 10 >= 1 ? `${String(mm / 10).replace(".", ",")} cm` : `${mm} mm`}` })),
];

function opcionMasCercana(mm: number) {
  return OPCIONES_LARGO.reduce((mejor, opcion) => (Math.abs(opcion.mm - mm) < Math.abs(mejor.mm - mm) ? opcion : mejor), OPCIONES_LARGO[0]);
}

/**
 * La ficha técnica del corte, zona por zona. Tocar una zona en la cabeza la
 * elige acá y al revés; cambiar un largo repinta la cabeza al instante.
 */
export function EditorMapa({
  mapa,
  seleccionada,
  onSelect,
  onChange,
}: {
  mapa: MapaCorte;
  seleccionada: Zona | null;
  onSelect: (zona: Zona) => void;
  onChange: (mapa: MapaCorte) => void;
}) {
  const filas = useRef<Partial<Record<Zona, HTMLDivElement | null>>>({});
  useEffect(() => {
    if (seleccionada) filas.current[seleccionada]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [seleccionada]);

  const cambiar = (zona: Zona, parcial: Partial<{ mm: number; tecnica: Tecnica }>) => onChange({ ...mapa, [zona]: { ...mapa[zona], ...parcial } });

  return (
    <div className="space-y-4">
      {(["pelo", "barba"] as const).map((grupo) => (
        <fieldset key={grupo} className="space-y-1.5">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{grupo === "pelo" ? "Pelo" : "Barba"}</legend>
          {ZONAS.filter((zona) => INFO_ZONA[zona].grupo === grupo).map((zona) => {
            const activa = seleccionada === zona;
            const opcion = opcionMasCercana(mapa[zona].mm);
            return (
              <div
                key={zona}
                ref={(nodo) => {
                  filas.current[zona] = nodo;
                }}
                onClick={() => onSelect(zona)}
                className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,0.95fr)] items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                  activa ? "border-primary bg-primary/5" : "border-transparent hover:bg-surface-muted/60"
                }`}
              >
                <span className={`truncate text-sm ${activa ? "font-semibold text-foreground" : "text-foreground"}`}>{INFO_ZONA[zona].nombre}</span>
                <select
                  aria-label={`Largo en ${INFO_ZONA[zona].nombre}`}
                  value={opcion.mm}
                  onFocus={() => onSelect(zona)}
                  onChange={(evento) => cambiar(zona, { mm: Number(evento.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {OPCIONES_LARGO.map((largo) => (
                    <option key={largo.mm} value={largo.mm}>
                      {largo.etiqueta}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Técnica en ${INFO_ZONA[zona].nombre}`}
                  value={mapa[zona].tecnica}
                  onFocus={() => onSelect(zona)}
                  onChange={(evento) => cambiar(zona, { tecnica: evento.target.value as Tecnica })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {TECNICAS.map((tecnica) => (
                    <option key={tecnica} value={tecnica}>
                      {INFO_TECNICA[tecnica]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
