"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { cancelarMiCita } from "@/app/reservar/acciones";

/** Cancelar pide una segunda confirmación: se libera la hora para otra persona. */
export function CancelarCita({ token }: { token: string }) {
  const router = useRouter();
  const [seguro, setSeguro] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, iniciar] = useTransition();

  if (!seguro) {
    return (
      <button
        type="button"
        onClick={() => setSeguro(true)}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground hover:border-danger/40 hover:text-danger"
      >
        Cancelar mi hora
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-danger/30 bg-danger-bg p-4" role="alertdialog" aria-labelledby="cancelar-titulo">
      <p id="cancelar-titulo" className="text-sm font-medium text-danger">¿Seguro? La hora queda libre para otra persona.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          disabled={cargando}
          onClick={() =>
            iniciar(async () => {
              const ok = await cancelarMiCita(token);
              if (ok) router.refresh();
              else setError("No se pudo cancelar. Puede que falten menos de 2 horas; escríbele a la clínica.");
            })
          }
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-danger px-4 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-70"
        >
          {cargando && <Loader2 size={16} className="animate-spin" aria-hidden="true" />} Sí, cancelar
        </button>
        <button type="button" onClick={() => setSeguro(false)} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground">
          No, mantener mi hora
        </button>
      </div>
    </div>
  );
}
