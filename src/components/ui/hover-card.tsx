"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const OPEN_DELAY = 380;
const CLOSE_DELAY = 140;
const WIDTH = 304;

/**
 * Tarjeta flotante al pasar el mouse (Hover Card de 21st.dev / Radix): el
 * resumen de una persona o registro sin abrir su ficha. Se dibuja en un portal
 * con posición fija, porque dentro de una tabla con desplazamiento horizontal
 * un panel absoluto quedaba recortado.
 *
 * Se abre con una pausa (pasar de largo no la dispara) y también con el foco
 * del teclado; se cierra al salir o con Escape. En pantallas táctiles no
 * aparece: ahí el toque ya navega.
 */
export function HoverCard({
  children,
  content,
  className,
}: {
  /** El disparador: un nombre, un avatar. */
  children: ReactNode;
  /** Lo que se muestra en la tarjeta. */
  content: ReactNode;
  className?: string;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const above = rect.bottom + 260 > window.innerHeight && rect.top > 280;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - WIDTH - 12);
    setPosition({ top: above ? rect.top - 8 : rect.bottom + 8, left, above });
  }, []);

  const open = () => {
    if (window.matchMedia?.("(hover: none)").matches) return;
    clear();
    timer.current = window.setTimeout(place, OPEN_DELAY);
  };

  const close = () => {
    clear();
    timer.current = window.setTimeout(() => setPosition(null), CLOSE_DELAY);
  };

  useEffect(() => {
    if (!position) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPosition(null);
    };
    // Al desplazar la página la tarjeta quedaría flotando lejos de su nombre.
    const onScroll = () => setPosition(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [position]);

  useEffect(() => clear, []);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className={cn("inline-flex min-w-0", className)}
      >
        {children}
      </span>
      {position &&
        createPortal(
          <div
            role="dialog"
            aria-modal="false"
            onMouseEnter={clear}
            onMouseLeave={close}
            onClick={(event) => event.stopPropagation()}
            style={{
              top: position.top,
              left: position.left,
              width: WIDTH,
              transform: position.above ? "translateY(-100%)" : undefined,
            }}
            className="hover-card-in fixed z-[90] rounded-xl border border-border-strong bg-surface-solid p-4 text-left shadow-2xl"
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
