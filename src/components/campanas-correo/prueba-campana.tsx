"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, Plus, Send, X, XCircle } from "lucide-react";

import { enviarPruebaCorreo } from "@/app/actions/campanas-correo";
import { Button, Input, useToast } from "@/components/ui";

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envío de prueba: la secuencia completa, tal como sale, a hasta cinco
 * correos. No cuenta en las métricas ni en el cupo de la campaña.
 */
export function PruebaCampana({ campanaId, correoInicial, maximo, pasos }: { campanaId: string; correoInicial: string; maximo: number; pasos: number }) {
  const { toast } = useToast();
  const [correos, setCorreos] = useState<string[]>([correoInicial]);
  const [enviando, startEnvio] = useTransition();
  const [resultados, setResultados] = useState<{ email: string; paso: number; ok: boolean; error: string | null }[] | null>(null);

  const validos = correos.map((correo) => correo.trim().toLowerCase()).filter((correo) => CORREO.test(correo));
  const invalidos = correos.filter((correo) => correo.trim() && !CORREO.test(correo.trim()));

  function enviar() {
    if (!validos.length) {
      toast({ tone: "danger", message: "Escribe al menos un correo válido." });
      return;
    }
    startEnvio(async () => {
      const resultado = await enviarPruebaCorreo({ campanaId, destinatarios: [...new Set(validos)].map((email) => ({ nombre: email.split("@")[0], email })) });
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      setResultados(resultado.resultados);
      toast({ tone: resultado.fallidos ? "danger" : "success", message: resultado.fallidos ? `${resultado.fallidos} correos de prueba fallaron` : `Prueba enviada: ${resultado.enviados} correos` });
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        Llegan {pasos > 1 ? `los ${pasos} correos de la secuencia` : "el correo"} a cada dirección, con datos de un contacto de ejemplo. No cuenta en las métricas.
      </p>
      <ul className="space-y-2">
        {correos.map((correo, indice) => (
          <li key={indice} className="flex items-center gap-2">
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-label={`Correo de prueba ${indice + 1}`}
              value={correo}
              onChange={(evento) => setCorreos((actuales) => actuales.map((item, i) => (i === indice ? evento.target.value : item)))}
              placeholder="nombre@empresa.cl"
              aria-invalid={Boolean(correo.trim() && !CORREO.test(correo.trim()))}
            />
            {correos.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setCorreos((actuales) => actuales.filter((_, i) => i !== indice))} aria-label={`Quitar correo ${indice + 1}`}>
                <X size={14} aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {invalidos.length > 0 && <p className="text-xs text-danger">Revisa: {invalidos.join(", ")}</p>}
      <div className="flex flex-wrap gap-2">
        {correos.length < maximo && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setCorreos((actuales) => [...actuales, ""])}>
            <Plus size={14} aria-hidden="true" /> Otro correo
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={enviar} disabled={enviando || !validos.length} className="ml-auto">
          {enviando ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          {enviando ? "Enviando…" : "Enviar prueba"}
        </Button>
      </div>
      {resultados && (
        <ul className="space-y-1 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs" aria-live="polite">
          {resultados.map((item, indice) => (
            <li key={indice} className="flex items-start gap-1.5">
              {item.ok ? <CheckCircle2 size={13} className="mt-px shrink-0 text-success" aria-hidden="true" /> : <XCircle size={13} className="mt-px shrink-0 text-danger" aria-hidden="true" />}
              <span>
                {item.email} · correo {item.paso}
                {item.error ? ` · ${item.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
