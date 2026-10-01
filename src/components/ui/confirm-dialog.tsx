"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";

export type ConfirmOptions = {
  title: string;
  /** Qué pasa exactamente: a quién afecta y si se puede deshacer. */
  description?: ReactNode;
  /** Texto del botón que confirma: el verbo de la acción, no «Aceptar». */
  confirmLabel: string;
  /** `danger` para lo que deja a alguien sin acceso o borra. */
  tone?: "danger" | "primary";
  /**
   * Para lo grave (suspender una empresa): hay que escribir este texto para
   * habilitar el botón, como GitHub al borrar un repositorio.
   */
  typeToConfirm?: string;
};

/**
 * Diálogo de confirmación para acciones irreversibles o de alto impacto.
 *
 * El botón de confirmar repite el verbo («Suspender», «Desactivar 12
 * cuentas») para que nadie confirme sin leer, y Cancelar recibe el foco: un
 * Enter de más no ejecuta nada.
 */
export function ConfirmDialog({
  open,
  options,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    cancelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  const needsText = Boolean(options.typeToConfirm);
  const ready = !needsText || typed.trim() === options.typeToConfirm;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40" onClick={onCancel} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={options.description ? descriptionId : undefined}
        className="relative w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {options.title}
        </h2>
        {options.description && (
          <div id={descriptionId} className="mt-2 text-sm text-muted-foreground">
            {options.description}
          </div>
        )}

        {needsText && (
          <label className="mt-4 block text-[13px] text-foreground">
            Escribe <span className="font-mono font-semibold">{options.typeToConfirm}</span> para confirmar
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 h-9 w-full rounded-lg border border-border-strong/70 bg-surface px-3 text-sm text-foreground shadow-sm focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </label>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={options.tone === "primary" ? "primary" : "danger"}
            disabled={!ready}
            onClick={() => {
              setTyped("");
              onConfirm();
            }}
          >
            {options.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
