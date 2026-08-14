"use client";

import { useEffect, useId, useState } from "react";
import { CalendarDays, ExternalLink, X } from "lucide-react";

export function AppointmentScheduleEmbed({
  title,
  url,
}: {
  title: string;
  url: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
      >
        <CalendarDays size={15} />
        Ver disponibilidad y reservar
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-2 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="flex h-[min(92vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
              <div>
                <h2 id={titleId} className="text-sm font-semibold text-foreground">
                  {title}
                </h2>
                <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
                  Revisa los bloques disponibles sin salir del CRM. Al terminar, guarda aquí la misma fecha y hora.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                  title="Abrir en una pestaña si el calendario no carga"
                >
                  <ExternalLink size={17} />
                  <span className="sr-only">Abrir calendario en una pestaña</span>
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                  aria-label="Cerrar calendario"
                >
                  <X size={19} />
                </button>
              </div>
            </div>

            <iframe
              src={url}
              title={title}
              className="min-h-0 flex-1 bg-white"
              allow="clipboard-write"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </div>
      )}
    </>
  );
}
