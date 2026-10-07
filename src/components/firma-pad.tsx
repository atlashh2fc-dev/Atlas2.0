"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

import { firmaComoSvg, hayFirma, type Trazo } from "@/lib/consentimientos";

/**
 * Un recuadro para firmar con el dedo, el lápiz o el mouse. Entrega la
 * firma como SVG en un campo oculto (`firma`) del formulario que lo contiene.
 */
export function FirmaPad({ nombre = "firma", onCambio }: { nombre?: string; onCambio?: (lista: boolean) => void }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [trazos, setTrazos] = useState<Trazo[]>([]);
  const dibujando = useRef(false);
  const [tamano, setTamano] = useState({ ancho: 600, alto: 200 });

  useEffect(() => {
    const elemento = lienzo.current;
    if (!elemento) return;
    const medir = () => {
      const caja = elemento.getBoundingClientRect();
      const escala = window.devicePixelRatio || 1;
      elemento.width = caja.width * escala;
      elemento.height = caja.height * escala;
      elemento.getContext("2d")?.scale(escala, escala);
      setTamano({ ancho: caja.width, alto: caja.height });
    };
    const cuadro = requestAnimationFrame(medir);
    window.addEventListener("resize", medir);
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener("resize", medir);
    };
  }, []);

  useEffect(() => {
    const contexto = lienzo.current?.getContext("2d");
    if (!contexto) return;
    contexto.clearRect(0, 0, tamano.ancho, tamano.alto);
    contexto.strokeStyle = "#111";
    contexto.lineWidth = 2.2;
    contexto.lineCap = "round";
    contexto.lineJoin = "round";
    for (const trazo of trazos) {
      contexto.beginPath();
      trazo.forEach((punto, indice) => (indice === 0 ? contexto.moveTo(punto.x, punto.y) : contexto.lineTo(punto.x, punto.y)));
      contexto.stroke();
    }
  }, [trazos, tamano]);

  useEffect(() => {
    onCambio?.(hayFirma(trazos));
  }, [trazos, onCambio]);

  function punto(evento: React.PointerEvent<HTMLCanvasElement>) {
    const caja = evento.currentTarget.getBoundingClientRect();
    return { x: evento.clientX - caja.left, y: evento.clientY - caja.top };
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={lienzo}
          className="h-48 w-full touch-none rounded-lg border-2 border-dashed border-border-strong bg-white"
          aria-label="Recuadro para firmar"
          onPointerDown={(evento) => {
            evento.currentTarget.setPointerCapture(evento.pointerId);
            dibujando.current = true;
            // El punto se calcula acá: dentro del actualizador el evento ya no tiene su elemento.
            const inicio = punto(evento);
            setTrazos((actual) => [...actual, [inicio]]);
          }}
          onPointerMove={(evento) => {
            if (!dibujando.current) return;
            const nuevo = punto(evento);
            setTrazos((actual) => [...actual.slice(0, -1), [...(actual[actual.length - 1] ?? []), nuevo]]);
          }}
          onPointerUp={() => {
            dibujando.current = false;
          }}
          onPointerLeave={() => {
            dibujando.current = false;
          }}
        />
        {trazos.length === 0 && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#888]">Firma aquí</span>}
      </div>
      <input type="hidden" name={nombre} value={hayFirma(trazos) ? firmaComoSvg(trazos, tamano.ancho, tamano.alto) : ""} />
      <button type="button" onClick={() => setTrazos([])} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground">
        <Eraser size={14} aria-hidden="true" /> Borrar y firmar de nuevo
      </button>
    </div>
  );
}
