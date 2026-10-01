"use client";

import { useEffect, useRef } from "react";

/**
 * Cifra que sube desde cero al aparecer (Number Ticker de 21st.dev). Recibe el
 * texto ya formateado ("19.321", "67,9%", "94,5 UF", "UF 12,50") y anima solo
 * la parte numérica, conservando prefijo, sufijo y decimales. Con movimiento
 * reducido, o si el texto no trae número (—, 07:24), lo muestra tal cual.
 */
export function CountUp({ value, duration = 900 }: { value: string; duration?: number }) {
  const parsed = parse(value);
  // El número se escribe directo en el DOM cuadro a cuadro: pasar por el
  // estado de React re-renderizaría la tarjeta 60 veces por segundo.
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const target = parse(value);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!target || reduce || target.number === 0) {
      element.textContent = value;
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // Desaceleración al final: la cifra "aterriza" en su valor.
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = progress >= 1 ? value : format(target.number * eased, target);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <>
      <span ref={ref} aria-hidden="true">
        {parsed ? format(0, parsed) : value}
      </span>
      <span className="sr-only">{value}</span>
    </>
  );
}

type Parsed = { prefix: string; suffix: string; number: number; decimals: number };

/** Primer número con formato chileno (puntos de miles, coma decimal). */
function parse(text: string): Parsed | null {
  // Horas y duraciones (07:24, 1h 20m) no se animan: no son una cantidad.
  if (/\d:\d/.test(text) || /\d+\s*[hm]\b/.test(text)) return null;
  const match = text.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/);
  if (!match || match.index === undefined) return null;
  const token = match[0];
  const hasThousands = /\d\.\d{3}(?:\.|,|$)/.test(token);
  const normalized = hasThousands ? token.replace(/\./g, "").replace(",", ".") : token.replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  const decimalPart = normalized.split(".")[1];
  return {
    prefix: text.slice(0, match.index),
    suffix: text.slice(match.index + token.length),
    number,
    decimals: decimalPart ? decimalPart.length : 0,
  };
}

function format(number: number, parsed: Parsed): string {
  const body = number.toLocaleString("es-CL", {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
  });
  return `${parsed.prefix}${body}${parsed.suffix}`;
}
