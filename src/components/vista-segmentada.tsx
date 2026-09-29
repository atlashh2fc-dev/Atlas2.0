import Link from "next/link";

import { cn } from "@/lib/utils";

export type OpcionSegmentada = { clave: string; texto: string; href: string; cuenta?: number };

/**
 * Dos o tres formas de ver lo mismo, pegadas en un solo control. Son enlaces:
 * la vista queda en la URL, se puede compartir y el botón atrás funciona.
 */
export function VistaSegmentada({ opciones, activa, etiqueta }: { opciones: OpcionSegmentada[]; activa: string; etiqueta: string }) {
  return (
    <nav aria-label={etiqueta} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-0.5 text-sm shadow-sm">
      {opciones.map((opcion) => {
        const esta = opcion.clave === activa;
        return (
          <Link
            key={opcion.clave}
            href={opcion.href}
            aria-current={esta ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 font-medium transition-colors",
              esta ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opcion.texto}
            {opcion.cuenta !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  esta ? "bg-primary-foreground/20" : opcion.cuenta > 0 ? "bg-primary/12 text-primary" : "bg-surface-muted",
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
