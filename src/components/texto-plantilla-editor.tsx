"use client";

import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { guardarTextoPropio } from "@/app/actions/configuracion-agenda";
import { ActionForm, ActionSubmit, Badge } from "@/components/ui";
import { renderizarPlantilla, validarTextoPropio, VARIABLES_DE_EJEMPLO, type ClavePlantilla } from "@/lib/mensajes/plantillas";

/**
 * Un mensaje que la clínica puede reescribir. Las variables se insertan con
 * un toque donde está el cursor, y la vista previa muestra lo que recibe la
 * persona con datos de ejemplo mientras se escribe.
 */
export function TextoPlantillaEditor({
  clave,
  nombre,
  original,
  propio,
  variables,
  clinica,
  puedeEditar,
}: {
  clave: ClavePlantilla;
  nombre: string;
  original: string;
  propio: string | null;
  variables: string[];
  clinica: string;
  puedeEditar: boolean;
}) {
  const [texto, setTexto] = useState(propio ?? original);
  const area = useRef<HTMLTextAreaElement>(null);
  const problema = texto.trim() === (propio ?? original).trim() ? null : validarTextoPropio(clave, texto);
  const vista = renderizarPlantilla(clave, { ...VARIABLES_DE_EJEMPLO, clinica }, { [clave]: texto });

  function insertar(variable: string) {
    const control = area.current;
    const marca = `{{${variable}}}`;
    if (!control) {
      setTexto((actual) => `${actual}${marca}`);
      return;
    }
    const inicio = control.selectionStart ?? texto.length;
    const fin = control.selectionEnd ?? texto.length;
    const nuevo = `${texto.slice(0, inicio)}${marca}${texto.slice(fin)}`;
    setTexto(nuevo);
    requestAnimationFrame(() => {
      control.focus();
      control.setSelectionRange(inicio + marca.length, inicio + marca.length);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{nombre}</h3>
        {propio ? <Badge tone="info">Texto propio</Badge> : <Badge tone="neutral">Texto de Atlas</Badge>}
      </div>
      <ActionForm action={guardarTextoPropio} success="Mensaje guardado: lo usan los próximos envíos" className="space-y-2">
        <input type="hidden" name="plantilla" value={clave} />
        <label className="sr-only" htmlFor={`texto-${clave}`}>Texto de «{nombre}»</label>
        <textarea
          id={`texto-${clave}`}
          ref={area}
          name="texto"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          disabled={!puedeEditar}
          rows={3}
          maxLength={900}
          aria-invalid={problema ? true : undefined}
          aria-describedby={`ayuda-${clave}`}
          className="w-full rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
        />
        {puedeEditar && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Insertar un dato">
            <span className="text-xs text-muted-foreground">Insertar:</span>
            {variables.map((variable) => (
              <button
                key={variable}
                type="button"
                onClick={() => insertar(variable)}
                className="min-h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:border-border-strong hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {variable.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}
        <p id={`ayuda-${clave}`} className={problema ? "text-xs text-danger" : "text-xs text-muted-foreground"}>
          {problema ?? `${texto.trim().length} de 900 caracteres`}
        </p>
        <div className="rounded-lg bg-surface-muted/60 px-3 py-2 text-sm text-foreground">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Así le llega</span>
          {vista}
        </div>
        {puedeEditar && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {propio && (
              <ActionSubmit
                variant="ghost"
                size="sm"
                name="restaurar"
                value="si"
                pendingLabel="Restaurando…"
                onClick={() => setTexto(original)}
              >
                <RotateCcw size={14} aria-hidden="true" /> Volver al texto de Atlas
              </ActionSubmit>
            )}
            <ActionSubmit size="sm" variant="secondary" disabled={Boolean(problema) || texto.trim() === (propio ?? original).trim()} pendingLabel="Guardando…">
              Guardar mensaje
            </ActionSubmit>
          </div>
        )}
      </ActionForm>
    </div>
  );
}
