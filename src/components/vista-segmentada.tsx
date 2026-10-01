import Link from "next/link";

import { cn } from "@/lib/utils";

export type OpcionSegmentada = { clave: string; texto: string; href: string; cuenta?: number };

/**
 * Dos o tres formas de ver lo mismo, pegadas en un solo control. Son enlaces:
 * la vista queda en la URL, se puede compartir y el botón atrás funciona.
 */
export function VistaSegmentada({ opciones, activa, etiqueta }: { opciones: OpcionSegmentada[]; activa: string; etiqueta: string }) {
  return (
    <nav aria-label={etiqueta} className="inline-flex max-w-full gap-1 overflow-x-auto">
      {opciones.map((opcion) => {
        const esta = opcion.clave === activa;
        return (
          <Link
            key={opcion.clave}
            href={opcion.href}
            aria-current={esta ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium transition-colors",
              esta
                ? "bg-surface text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
            )}
          >
            {opcion.texto}
            {opcion.cuenta !== undefined && (
              <span
                className={cn(
                  "text-xs font-semibold tabular-nums",
                  opcion.cuenta > 0 ? "text-primary" : "text-muted-foreground",
                )}
              >
                {opcion.cuenta}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
