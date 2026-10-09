"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { BookOpenCheck, Loader2, MessageCircleQuestion, SendHorizontal, X } from "lucide-react";

import { preguntarAsistenteCurso } from "@/app/actions/asistente-curso";
import { cn } from "@/lib/utils";

type Mensaje =
  | { rol: "ejecutivo"; texto: string }
  | { rol: "asistente"; texto: string; encontrada: boolean; lecciones: string[] };

const SUGERENCIAS = [
  "¿Cuánto cobra el Point Smart 2 en débito?",
  "¿Cuándo le conviene el Point Mini a un comercio?",
  "¿Qué hago si un cliente desconoce una compra?",
  "¿Cómo se activa el Point Smart 2?",
];

/** En estas pantallas hay un botón fijo abajo (guardar): el asistente no lo tapa. */
const OCULTAR_EN = [/^\/terreno\/nuevo/, /^\/terreno\/clientes\/[^/]+\/visita/];

/**
 * Asistente de la campaña: el ejecutivo pregunta en sus palabras y la
 * respuesta sale solo del curso de la campaña en Atlas Aprende, con la
 * lección de donde viene. Si no está en el curso, lo dice.
 */
export function AsistenteCurso({ campaignId, nombre }: { campaignId: string; nombre: string }) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [borrador, setBorrador] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const entrada = useRef<HTMLTextAreaElement>(null);
  const final = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const cerrarConEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", cerrarConEscape);
    entrada.current?.focus();
    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener("keydown", cerrarConEscape);
    };
  }, [abierto]);

  useEffect(() => {
    final.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [mensajes, pending]);

  function preguntar(texto: string) {
    const pregunta = texto.trim();
    if (!pregunta || pending) return;
    const historial = mensajes.map((m) => ({ rol: m.rol, texto: m.texto }));
    setMensajes((prev) => [...prev, { rol: "ejecutivo", texto: pregunta }]);
    setBorrador("");
    setError(null);
    startTransition(async () => {
      const respuesta = await preguntarAsistenteCurso(campaignId, historial, pregunta);
      if (respuesta.ok) {
        setMensajes((prev) => [
          ...prev,
          { rol: "asistente", texto: respuesta.respuesta, encontrada: respuesta.encontrada, lecciones: respuesta.lecciones },
        ]);
      } else {
        setError(respuesta.message);
        setBorrador(pregunta);
        setMensajes((prev) => prev.slice(0, -1));
      }
    });
  }

  if (OCULTAR_EN.some((patron) => patron.test(pathname)) && !abierto) return null;

  return (
    <>
      {!abierto && (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="fixed right-4 z-30 inline-flex h-12 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-foreground shadow-lg active:bg-surface-muted"
          style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
        >
          <MessageCircleQuestion size={20} className="text-primary" aria-hidden="true" />
          Preguntar
        </button>
      )}

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setAbierto(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Asistente ${nombre}`}
            onClick={(event) => event.stopPropagation()}
            className="flex h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-xl sm:h-[80vh] sm:rounded-2xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="icon-chip size-9 shrink-0 rounded-lg" data-tone="primary" aria-hidden="true">
                <BookOpenCheck size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold leading-tight">Asistente {nombre}</p>
                <p className="truncate text-xs text-muted-foreground">Responde solo con el curso de Atlas Aprende</p>
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar asistente"
                className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
              {mensajes.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Pregunta lo que necesites saber para tu visita. Si no está en el curso, te lo voy a decir.
                  </p>
                  <div className="flex flex-col gap-2">
                    {SUGERENCIAS.map((sugerencia) => (
                      <button
                        key={sugerencia}
                        type="button"
                        onClick={() => preguntar(sugerencia)}
                        className="min-h-11 rounded-xl border border-border bg-surface px-3.5 py-2 text-left text-sm active:bg-surface-muted"
                      >
                        {sugerencia}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {mensajes.map((mensaje, i) =>
                mensaje.rol === "ejecutivo" ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-[15px] text-primary-foreground">
                      {mensaje.texto}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <div
                      className={cn(
                        "max-w-[90%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[15px]",
                        mensaje.encontrada ? "bg-surface-muted" : "border border-warning/40 bg-warning/5",
                      )}
                    >
                      <p className="whitespace-pre-line leading-relaxed">{mensaje.texto}</p>
                      {mensaje.lecciones.length > 0 && (
                        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                          Fuente: {mensaje.lecciones.join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                ),
              )}

              {pending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  Buscando en el curso…
                </div>
              )}
              <div ref={final} />
            </div>

            {error && (
              <p className="mx-4 mb-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                preguntar(borrador);
              }}
              className="flex items-end gap-2 border-t border-border px-3 py-3"
            >
              <label className="sr-only" htmlFor="pregunta-asistente">
                Tu pregunta
              </label>
              <textarea
                id="pregunta-asistente"
                ref={entrada}
                value={borrador}
                onChange={(event) => setBorrador(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    preguntar(borrador);
                  }
                }}
                rows={1}
                maxLength={600}
                placeholder="Escribe tu pregunta"
                className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-border-strong/70 bg-surface px-3.5 py-3 text-base placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
              <button
                type="submit"
                disabled={!borrador.trim() || pending}
                aria-label="Enviar pregunta"
                className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
              >
                <SendHorizontal size={20} aria-hidden="true" />
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
