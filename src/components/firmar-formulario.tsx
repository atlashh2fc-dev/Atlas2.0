"use client";

import { useState } from "react";

import { FirmaPad } from "@/components/firma-pad";

/**
 * Nombre, RUT y firma. El botón de enviar se habilita cuando hay firma y
 * nombre: así nadie manda el documento en blanco.
 */
export function CamposDeFirma({ nombreInicial, rutInicial, children }: { nombreInicial?: string; rutInicial?: string | null; children: (listo: boolean) => React.ReactNode }) {
  const [hayFirma, setHayFirma] = useState(false);
  const [nombre, setNombre] = useState(nombreInicial ?? "");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Nombre de quien firma</span>
          <input name="nombre" required minLength={3} value={nombre} onChange={(evento) => setNombre(evento.target.value)} autoComplete="name" className="h-11 rounded-lg border border-border-strong/70 bg-surface px-3 text-base" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">RUT <span className="font-normal text-muted-foreground">(opcional)</span></span>
          <input name="rut" defaultValue={rutInicial ?? ""} maxLength={20} className="h-11 rounded-lg border border-border-strong/70 bg-surface px-3 text-base" />
        </label>
      </div>
      <FirmaPad onCambio={setHayFirma} />
      {children(hayFirma && nombre.trim().length >= 3)}
    </div>
  );
}
