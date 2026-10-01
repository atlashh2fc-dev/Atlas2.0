"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { buttonClasses } from "@/components/ui";

/**
 * Lo que se ve cuando una pantalla falla al cargar, en vez de la página
 * genérica de Next en inglés: qué pasó en palabras simples, que nada se
 * perdió, y dos salidas (reintentar o volver). El detalle técnico queda en la
 * consola y en el registro del servidor (`digest`), no frente a quien opera.
 */
export function PantallaDeError({
  error,
  reset,
  volver,
  volverLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  volver: string;
  volverLabel: string;
}) {
  useEffect(() => {
    console.error("[pantalla] falló al cargar", error);
  }, [error]);

  return (
    <div className="mx-auto mt-10 flex max-w-lg flex-col items-center rounded-xl border border-border bg-surface px-8 py-10 text-center shadow-sm">
      <AlertTriangle size={24} className="text-warning" aria-hidden="true" />
      <h1 className="mt-4 text-lg font-semibold text-foreground">Esta pantalla no se pudo cargar</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Puede ser un corte momentáneo de conexión. Lo que ya guardaste no se perdió. Reintenta; si vuelve a pasar,
        avisa a soporte{error.digest ? ` con el código ${error.digest}` : ""}.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className={buttonClasses()}>
          <RefreshCw size={15} aria-hidden="true" />
          Reintentar
        </button>
        <Link href={volver} className={buttonClasses({ variant: "secondary" })}>
          {volverLabel}
        </Link>
      </div>
    </div>
  );
}
