"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Menu, X } from "lucide-react";
import type { Profile } from "@/lib/types";
import { ROLE_LABEL, spaceForPath } from "@/lib/nav.config";
import { NavFooter, NavTree, type NavBadgeCounts } from "@/components/sidebar";

/**
 * Menú móvil: mismo modelo de datos que el sidebar (nav.config.ts), presentado
 * como drawer. Bajo `md` el sidebar de escritorio está oculto.
 */
export function MobileNav({ profile, badges }: { profile: Profile; badges?: NavBadgeCounts }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const inAdmin = spaceForPath(pathname) === "admin";

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground md:hidden"
      >
        <Menu size={18} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside
            aria-label="Navegación principal"
            className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-surface"
          >
            <div className="flex h-16 items-center gap-2 border-b border-border px-4">
              <Image
                src="/atlas-logo.png"
                alt="Atlas"
                width={32}
                height={32}
                className="size-8 flex-shrink-0 rounded-full object-contain shadow-sm"
              />
              <div className="leading-none">
                <span className="text-sm font-semibold text-foreground">Atlas</span>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {inAdmin ? "Administración" : `Consola · ${ROLE_LABEL[profile.role]}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar menú"
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <X size={17} />
              </button>
            </div>

            {inAdmin && (
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="mx-2 mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground"
              >
                <ArrowLeft size={16} />
                Volver a la Consola
              </Link>
            )}

            <nav className="flex-1 overflow-y-auto p-2">
              <NavTree
                profile={profile}
                pathname={pathname}
                badges={badges}
                onNavigate={() => setOpen(false)}
              />
            </nav>

            <NavFooter profile={profile} pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
