"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";

/** Copia un texto (la URL del webhook) y lo confirma con un toast. */
export function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const { toast } = useToast();
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      toast({ tone: "success", message: `${etiqueta} copiada` });
      window.setTimeout(() => setCopiado(false), 2000);
    } catch (error) {
      console.error("[integraciones/whatsapp] copiar", error);
      toast({ tone: "danger", message: "No se pudo copiar. Selecciona el texto y cópialo a mano." });
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={copiar} aria-label={`Copiar ${etiqueta.toLowerCase()}`}>
      {copiado ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {copiado ? "Copiada" : "Copiar"}
    </Button>
  );
}
