"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesColumn, Plus, Store } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Barra inferior del vendedor: tres destinos, al alcance del pulgar. "Nuevo"
 * es la acción principal y la única que destaca.
 */
export function TerrenoNav() {
  const pathname = usePathname();
  const clientesActivo = pathname === "/terreno" || pathname.startsWith("/terreno/clientes");
  const avanceActivo = pathname.startsWith("/terreno/avance");
  const nuevoActivo = pathname.startsWith("/terreno/nuevo");

  return (
    <nav
      aria-label="Terreno"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-xl grid-cols-3 items-center px-2">
        <Link
          href="/terreno"
          aria-current={clientesActivo ? "page" : undefined}
          className={cn(
            "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium",
            clientesActivo ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Store size={22} aria-hidden="true" />
          Clientes
        </Link>
        <Link
          href="/terreno/nuevo"
          aria-current={nuevoActivo ? "page" : undefined}
          className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium text-foreground"
        >
          <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-4 ring-background">
            <Plus size={24} aria-hidden="true" />
          </span>
          Nuevo
        </Link>
        <Link
          href="/terreno/avance"
          aria-current={avanceActivo ? "page" : undefined}
          className={cn(
            "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium",
            avanceActivo ? "text-primary" : "text-muted-foreground",
          )}
        >
          <ChartNoAxesColumn size={22} aria-hidden="true" />
          Mi avance
        </Link>
      </div>
    </nav>
  );
}
