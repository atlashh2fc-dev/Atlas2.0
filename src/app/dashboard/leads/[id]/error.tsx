"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Una ficha de llamada nunca debe terminar en el mensaje técnico genérico de
 * Server Components. Deja una recuperación explícita y no oculta la acción
 * que el ejecutivo necesita para completar la gestión.
 */
export default function LeadDetailError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-danger/30 bg-surface p-8 text-center shadow-sm">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-danger">
        <AlertTriangle size={22} />
      </span>
      <h1 className="mt-4 text-lg font-bold text-foreground">No pudimos abrir la ficha de esta llamada</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        La gestión sigue pendiente y no se perderá. Reintenta abrirla para terminar la tipificación.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          <RefreshCw size={16} />
          Reintentar ficha
        </button>
        <Link
          href="/dashboard/leads"
          className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-muted"
        >
          Volver a registros
        </Link>
      </div>
    </div>
  );
}
