"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { buttonClasses } from "@/components/ui";

/**
 * Una ficha de llamada nunca debe terminar en el mensaje técnico genérico de
 * Server Components. Deja una recuperación explícita y no oculta la acción
 * que el ejecutivo necesita para completar la gestión.
 */
export default function LeadDetailError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
      <AlertTriangle size={24} className="text-danger" aria-hidden="true" />
      <h1 className="mt-4 text-lg font-semibold text-foreground">No pudimos abrir la ficha de esta llamada</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        La gestión sigue pendiente y no se perderá. Reintenta abrirla para terminar la tipificación.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className={buttonClasses()}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Reintentar ficha
        </button>
        <Link
          href="/dashboard/leads"
          className={buttonClasses({ variant: "secondary" })}
        >
          Volver a registros
        </Link>
      </div>
    </div>
  );
}
