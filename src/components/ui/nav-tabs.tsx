"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavTabItem = {
  label: string;
  href: string;
  /** Otras rutas exactas que también son esta pestaña (otra vista del mismo destino). */
  match?: string[];
  /** Trabajo pendiente en esa vista; no se muestra si es cero. */
  badge?: number;
};

/**
 * Tercer nivel de la arquitectura de navegación: el sidebar llega hasta el
 * destino y las pestañas resuelven las vistas de ese destino
 * (docs/arquitectura-navegacion.md §4.5). Gana la coincidencia más específica.
 */
export function NavTabs({ tabs, className }: { tabs: NavTabItem[]; className?: string }) {
  const pathname = usePathname();

  if (tabs.length < 2) return null;

  const exacta = tabs.find((tab) => tab.match?.includes(pathname));
  const matches = tabs.filter((tab) => pathname === tab.href || pathname.startsWith(tab.href + "/"));
  const activeHref = exacta?.href ?? matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className={cn("-mt-1 flex items-center gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {tabs.map((tab) => {
        const active = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap px-2.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.badge ? (
              <span className="rounded-md bg-primary/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-primary">
                <span className="sr-only">, pendientes: </span>
                {tab.badge.toLocaleString("es-CL")}
              </span>
            ) : null}
            <span aria-hidden="true" className={cn("absolute inset-x-2 bottom-0 h-0.5 rounded-full", active ? "bg-primary" : "bg-transparent")} />
          </Link>
        );
      })}
    </div>
  );
}
