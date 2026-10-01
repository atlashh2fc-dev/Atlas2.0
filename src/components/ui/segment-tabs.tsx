import Link from "next/link";
import { cn } from "@/lib/utils";

export type SegmentTab = {
  id: string;
  label: string;
  href: string;
  count?: number;
  /** Cuenta que pide atención (vencidas, bloqueados): la cifra toma el color. */
  tone?: "danger" | "warning";
};

/**
 * Vistas de una lista con su conteo, como pestañas pegadas a la tabla que
 * filtran (Linear, Attio, HubSpot). La activa se subraya; la cifra va en una
 * caja suave para leerse de un vistazo sin competir con la etiqueta.
 */
export function SegmentTabs({
  tabs,
  activeId,
  label,
  className,
}: {
  tabs: SegmentTab[];
  activeId: string;
  /** Nombre del grupo para lectores de pantalla. */
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("-mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative inline-flex h-11 shrink-0 items-center gap-2 px-2.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {typeof tab.count === "number" && (
              <span
                className={cn(
                  "rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums transition-colors",
                  active ? "bg-foreground/[0.08] text-foreground" : "bg-surface-muted text-muted-foreground group-hover:text-foreground",
                  tab.count > 0 && tab.tone === "danger" && "text-danger",
                  tab.count > 0 && tab.tone === "warning" && "text-warning"
                )}
              >
                {tab.count.toLocaleString("es-CL")}
              </span>
            )}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-colors",
                active ? "bg-primary" : "bg-transparent"
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
