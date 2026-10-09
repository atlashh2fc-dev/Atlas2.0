"use client";

import { useEffect, useRef } from "react";
import { GraduationCap, Loader2 } from "lucide-react";

/**
 * Entrega el pase a Atlas Aprende por POST apenas carga la página: el pase va
 * en el cuerpo, no en la URL, y no queda en el historial ni en los registros.
 * Si el navegador no envía solo (sin JavaScript), queda el botón.
 */
export function IrAAprende({ accion, pase }: { accion: string; pase: string }) {
  const formulario = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formulario.current?.submit();
  }, []);

  return (
    <form ref={formulario} method="post" action={accion} className="flex flex-col items-center gap-4 text-center">
      <input type="hidden" name="pase" value={pase} />
      <span className="icon-chip size-12 rounded-xl" data-tone="primary" aria-hidden="true">
        <GraduationCap size={22} />
      </span>
      <div>
        <p className="text-base font-semibold">Abriendo Atlas Aprende</p>
        <p className="mt-1 text-sm text-muted-foreground">Entras con tu misma cuenta de Atlas.</p>
      </div>
      <Loader2 size={20} className="animate-spin text-muted-foreground" aria-hidden="true" />
      <button
        type="submit"
        className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-medium text-foreground shadow-sm hover:bg-surface-muted"
      >
        Continuar
      </button>
    </form>
  );
}
