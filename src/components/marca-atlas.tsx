import { EDICION_INFO, type Edicion } from "@/lib/ediciones";

/**
 * "Atlas" + el sufijo de la edición. El sufijo va en el color de acento, que ya
 * es el de la edición porque el tema cuelga de `[data-edicion]`.
 */
export function MarcaAtlas({ edicion }: { edicion: Edicion }) {
  return (
    <span className="text-sm font-semibold text-foreground">
      Atlas <span className="font-medium text-primary">{EDICION_INFO[edicion].sufijo}</span>
    </span>
  );
}
