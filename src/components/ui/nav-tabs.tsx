"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavTabItem = {
  label: string;
  href: string;
  /** Otras rutas exactas que también son esta pestaña (otra vista del mismo destino). */
  match?: string[];
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
    <div className={cn("-mt-1 flex items-center gap-1 border-b border-border", className)}>
      {tabs.map((tab) => {
        const active = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary bg-gradient-to-t from-primary/12 to-transparent text-foreground"
                : "border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
