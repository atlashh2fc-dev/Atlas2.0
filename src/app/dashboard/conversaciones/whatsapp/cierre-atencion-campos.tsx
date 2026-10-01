"use client";

import { useId, useState } from "react";

import { Select } from "@/components/ui";

type MotivoDeCierre = { id: string; label: string; requires_note: boolean };

/**
 * Tipificación y nota del cierre de una atención de WhatsApp.
 *
 * Es cliente solo para una cosa: cuando el motivo elegido exige nota, el
 * campo pasa a obligatorio y lo dice, en vez de enterarse al enviar.
 */
export function CierreAtencionCampos({ motivos }: { motivos: MotivoDeCierre[] }) {
  const [motivoId, setMotivoId] = useState("");
  const notaId = useId();
  const exigeNota = motivos.find((motivo) => motivo.id === motivoId)?.requires_note === true;

  return (
    <>
      <Select
        name="reason_id"
        value={motivoId}
        onChange={(event) => setMotivoId(event.target.value)}
        required
        aria-label="Tipificación de cierre"
        fieldSize="sm"
        className="w-full"
      >
        <option value="" disabled>
          Selecciona tipificación
        </option>
        {motivos.map((motivo) => (
          <option key={motivo.id} value={motivo.id}>
            {motivo.label}
            {motivo.requires_note ? " · requiere nota" : ""}
          </option>
        ))}
      </Select>
      <label htmlFor={notaId} className="block text-xs font-medium text-muted-foreground">
        {exigeNota ? "Nota (obligatoria para este motivo)" : "Nota (opcional)"}
      </label>
      <textarea
        id={notaId}
        name="note"
        rows={3}
        maxLength={2000}
        required={exigeNota}
        aria-required={exigeNota}
        placeholder={exigeNota ? "Qué se resolvió o qué quedó pendiente" : "Resumen u observación de cierre"}
        className="w-full resize-none rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-xs text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </>
  );
}
