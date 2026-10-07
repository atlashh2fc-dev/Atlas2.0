"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { NOMBRE_DIA } from "@/lib/configuracion-agenda";

/** Copia un texto (el enlace o el código para la web) con aviso visible. */
export function CopiarTexto({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          setCopiado(false);
        }
      }}
      className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      aria-live="polite"
    >
      {copiado ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {copiado ? "Copiado" : etiqueta}
    </button>
  );
}

const ENTRADA =
  "h-9 w-[5.5rem] rounded-lg border border-border-strong/70 bg-surface px-2 text-sm tabular-nums text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-40";

/**
 * El horario de la semana: por día, cerrado o con uno o dos tramos (mañana
 * y tarde). Al cerrar un día sus horas se apagan pero no se pierden.
 */
export function HorarioSemanal({ inicial, puedeEditar }: { inicial: Record<number, { desde: string; hasta: string }[]>; puedeEditar: boolean }) {
  const [abiertos, setAbiertos] = useState<Record<number, boolean>>(() =>
    Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((dia) => [dia, (inicial[dia]?.length ?? 0) > 0])),
  );
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {[1, 2, 3, 4, 5, 6, 7].map((dia) => {
        const tramos = inicial[dia] ?? [];
        const abierto = abiertos[dia];
        return (
          <div key={dia} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
            <label className="flex min-h-9 w-32 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium capitalize">
              <input
                type="checkbox"
                name={`d${dia}_abre`}
                value="si"
                checked={abierto}
                disabled={!puedeEditar}
                onChange={(evento) => setAbiertos((actual) => ({ ...actual, [dia]: evento.target.checked }))}
                className="size-4"
              />
              {NOMBRE_DIA[dia]}
            </label>
            {abierto ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                {[1, 2].map((tramo) => (
                  <span key={tramo} className="flex items-center gap-1.5">
                    {tramo === 2 && <span className="text-xs">y</span>}
                    <input type="time" step={900} name={`d${dia}_desde${tramo}`} defaultValue={tramos[tramo - 1]?.desde ?? (tramo === 1 ? "09:00" : "")} disabled={!puedeEditar} aria-label={`${NOMBRE_DIA[dia]}, tramo ${tramo}, desde`} className={ENTRADA} />
                    <span aria-hidden="true">a</span>
                    <input type="time" step={900} name={`d${dia}_hasta${tramo}`} defaultValue={tramos[tramo - 1]?.hasta ?? (tramo === 1 ? "19:00" : "")} disabled={!puedeEditar} aria-label={`${NOMBRE_DIA[dia]}, tramo ${tramo}, hasta`} className={ENTRADA} />
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Cerrado</span>
            )}
          </div>
        );
      })}
      <p className="px-3 py-2 text-xs text-muted-foreground">El segundo tramo es opcional: úsalo para la colación (por ejemplo 9:00 a 13:30 y 14:30 a 19:00).</p>
    </div>
  );
}
