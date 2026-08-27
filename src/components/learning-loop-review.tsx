"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureLearningLoop, reviewLearningDecision, retractLearningMemory } from "@/app/actions/ai-learning-loop";
import { Button, Callout, Field, Input, Select } from "@/components/ui";

export function LearningLoopReview({ runId, version }: { runId: string; version: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    start(async () => {
      try {
        const result = await reviewLearningDecision({ runId, expectedVersion: version,
          recommendation: values.get("recommendation"), extraction: values.get("extraction"), note: values.get("note") });
        setMessage(result.error ?? "Revisión guardada. No se ejecutó ninguna acción sobre el cliente.");
        if (!result.error) router.refresh();
      } catch { setMessage("No se pudo guardar. Reintenta sin cerrar esta revisión."); }
    });
  }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Utilidad de la recomendación"><Select name="recommendation" defaultValue="" required disabled={pending}>
        <option value="" disabled>Seleccionar</option><option value="accepted">Aceptada para revisión</option><option value="rejected">Rechazada</option>
      </Select></Field>
      <Field label="Exactitud de los hechos extraídos"><Select name="extraction" defaultValue="unreviewed" disabled={pending}>
        <option value="unreviewed">No confirmados</option><option value="confirmed">Confirmo todos los hechos</option><option value="rejected">Rechazo la extracción</option>
      </Select></Field>
    </div>
    <Field label="Motivo de la revisión"><Input name="note" minLength={3} maxLength={1000} required disabled={pending} placeholder="Qué es correcto, qué falta o por qué se rechaza" /></Field>
    <p className="text-xs text-muted-foreground">Confirmar hechos permite reutilizarlos en interacciones posteriores autorizadas. Aceptar la recomendación no agenda ni origina un contacto.</p>
    <Button type="submit" disabled={pending}>{pending ? "Guardando…" : version ? "Guardar nueva revisión" : "Guardar revisión"}</Button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}

export function LearningLoopConfig({ campaignId, mode, dailyLimit }: { campaignId: string; mode: "off" | "shadow"; dailyLimit: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    start(async () => {
      try {
        const result = await configureLearningLoop({ campaignId, mode: values.get("mode"), dailyLimit: Number(values.get("dailyLimit")) });
        setMessage(result.error ?? "Configuración guardada. El procesamiento también requiere habilitación en el servidor.");
        if (!result.error) router.refresh();
      } catch { setMessage("No se pudo guardar la configuración."); }
    });
  }}>
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Modo de la campaña"><Select name="mode" defaultValue={mode} disabled={pending}>
        <option value="off">Apagado</option><option value="shadow">Observación</option>
      </Select></Field>
      <Field label="Máximo de intentos IA por día UTC"><Input name="dailyLimit" type="number" min={1} max={100} defaultValue={dailyLimit} required disabled={pending} /></Field>
      <Button type="submit" disabled={pending}>Guardar configuración</Button>
    </div>
    <p className="text-xs text-muted-foreground">Activar observación autoriza análisis con el proveedor configurado, incluidos reintentos dentro del límite. No autoriza llamadas ni mensajes.</p>
    {message && <Callout>{message}</Callout>}
  </form>;
}

export function LearningMemoryRetraction({ memoryId }: { memoryId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted-foreground">Corregir o retirar este hecho</summary>
    <form className="mt-3 space-y-2" onSubmit={(event) => {
      event.preventDefault();
      const note = new FormData(event.currentTarget).get("note");
      start(async () => {
        try {
          const result = await retractLearningMemory({ memoryId, note });
          setMessage(result.error ?? "Hecho retirado de las próximas decisiones.");
          if (!result.error) router.refresh();
        } catch { setMessage("No se pudo retirar el hecho. Reintenta."); }
      });
    }}>
      <Field label="Motivo de retirar el hecho"><Input name="note" minLength={3} maxLength={1000} required disabled={pending} /></Field>
      <p className="text-xs text-muted-foreground">El retiro queda registrado, incluso si la decisión original venció. Esta memoria no se podrá reactivar.</p>
      <Button type="submit" disabled={pending}>Retirar de la memoria</Button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
