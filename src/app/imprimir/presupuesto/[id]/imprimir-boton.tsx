"use client";

import { Printer } from "lucide-react";

/** Abre el diálogo de impresión: desde ahí se imprime o se guarda como PDF. */
export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 print:hidden"
    >
      <Printer size={16} aria-hidden="true" /> Imprimir o guardar PDF
    </button>
  );
}
