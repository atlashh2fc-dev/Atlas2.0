import { colorDelAgente, type AgenteOrbita } from "@/lib/orbita";
import { cn } from "@/lib/utils";

/**
 * El código del agente sobre su color de identidad. Igual en la red, en la
 * actividad en vivo y en el panel: el mismo agente se reconoce en todas partes.
 * Texto oscuro sobre color sólido para que se lea en tema claro y oscuro.
 */
export function ChipDeAgente({ agente, tamano = "md", className }: { agente: Pick<AgenteOrbita, "codigo" | "color">; tamano?: "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-bold tabular-nums text-[#0b1220]",
        tamano === "lg" ? "size-10 rounded-lg text-base" : "size-6 text-[11px]",
        className
      )}
      style={{ background: colorDelAgente(agente), boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)" }}
    >
      {agente.codigo}
    </span>
  );
}
