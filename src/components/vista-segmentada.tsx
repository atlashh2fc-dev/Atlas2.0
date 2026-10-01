import Link from "next/link";

import { cn } from "@/lib/utils";

export type OpcionSegmentada = { clave: string; texto: string; href: string; cuenta?: number };

/**
 * Dos o tres formas de ver lo mismo, pegadas en un solo control. Son enlaces:
 * la vista queda en la URL, se puede compartir y el botón atrás funciona.
 *
 * Es un riel suave con la opción elegida levantada encima (Linear, Pipedrive):
 * se lee como un solo control y no como botones sueltos. La cifra va en caja
 * suave, igual que en las pestañas con conteo.
 */
export function VistaSegmentada({ opciones, activa, etiqueta }: { opciones: OpcionSegmentada[]; activa: string; etiqueta: string }) {
  return (
    <nav aria-label={etiqueta} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-surface-muted p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {opciones.map((opcion) => {
        const esta = opcion.clave === activa;
        return (
          <Link
            key={opcion.clave}
            href={opcion.href}
            aria-current={esta ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              esta ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opcion.texto}
            {opcion.cuenta !== undefined && (
              <span
                className={cn(
                  "rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums",
                  esta ? "bg-foreground/[0.08] text-foreground" : "bg-surface/70 text-muted-foreground",
                )}
              >
                {opcion.cuenta.toLocaleString("es-CL")}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
