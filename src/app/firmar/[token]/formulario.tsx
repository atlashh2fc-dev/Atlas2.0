"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { firmarDesdeEnlace } from "@/app/firmar/acciones";
import { CamposDeFirma } from "@/components/firmar-formulario";

export function FormularioDeFirma({ token, nombre }: { token: string; nombre: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  return (
    <form
      action={(datos) =>
        iniciar(async () => {
          setError(null);
          const resultado = await firmarDesdeEnlace(datos);
          if (resultado.ok) router.refresh();
          else setError(resultado.error ?? "No pudimos guardar la firma.");
        })
      }
      className="space-y-4"
    >
      <input type="hidden" name="token" value={token} />
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>}
      <CamposDeFirma nombreInicial={nombre}>
        {(listo) => (
          <button type="submit" disabled={!listo || enviando} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {enviando && <Loader2 size={18} className="animate-spin" aria-hidden="true" />} {enviando ? "Guardando…" : "Firmar"}
          </button>
        )}
      </CamposDeFirma>
    </form>
  );
}
