import Link from "next/link";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export type PasoId = "correos" | "audiencia" | "programacion" | "lanzar";

const PASOS: { id: PasoId; label: string }[] = [
  { id: "correos", label: "Correos" },
  { id: "audiencia", label: "Audiencia" },
  { id: "programacion", label: "Cuándo envía" },
  { id: "lanzar", label: "Revisar y lanzar" },
];

/**
 * El camino de una campaña nueva: lo hecho queda marcado y se ve cuánto falta.
 * Con `base`, cada paso lleva a su pestaña.
 */
export function Pasos({ actual, hechos = [], base }: { actual: PasoId; hechos?: PasoId[]; base?: string }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Pasos de la campaña">
      {PASOS.map((paso, indice) => {
        const hecho = hechos.includes(paso.id);
        const activo = paso.id === actual;
        const contenido = (
          <>
            <span
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                hecho ? "bg-success text-primary-foreground" : activo ? "bg-primary text-primary-foreground" : "bg-surface-muted text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {hecho ? <Check size={13} /> : indice + 1}
            </span>
            <span className={cn("text-sm", activo ? "font-semibold text-foreground" : "text-muted-foreground")}>{paso.label}</span>
            <span className="sr-only">{hecho ? " (listo)" : activo ? " (paso actual)" : ""}</span>
          </>
        );
        return (
          <li key={paso.id} className="flex items-center gap-2">
            {base ? (
              <Link href={`${base}?tab=${paso.id === "lanzar" ? "resumen" : paso.id}`} aria-current={activo ? "step" : undefined} className="flex min-h-9 items-center gap-2 rounded-lg px-1.5 hover:bg-surface-muted/60">
                {contenido}
              </Link>
            ) : (
              <span aria-current={activo ? "step" : undefined} className="flex min-h-9 items-center gap-2 px-1.5">
                {contenido}
              </span>
            )}
            {indice < PASOS.length - 1 && <span className={cn("h-px w-6 sm:w-10", hecho ? "bg-success" : "bg-border")} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
