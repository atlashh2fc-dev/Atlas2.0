import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { GraduationCap, LayoutDashboard, LogOut, MapPinned } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { AsistenteCurso } from "@/components/asistente-curso";
import { TerrenoNav } from "@/components/terreno/terreno-nav";
import { ToastProvider } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { modulosActivos, requireModule } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";
import { campanaTerrenoActual } from "@/lib/terreno.server";

export const metadata: Metadata = { title: "Terreno | Atlas" };

// En la calle se usa con una mano: sin zoom accidental al tocar un campo.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

/**
 * Atlas para vendedores en terreno. Vive fuera de /dashboard a propósito: el
 * panel carga discador, teléfono y barras de jornada que en la calle no
 * sirven y pesan en un celular con poca señal.
 */
export default async function TerrenoLayout({ children }: { children: React.ReactNode }) {
  await requireModule("leads");
  const profile = await requireProfile(["agente", "supervisor", "admin"]);
  const [campana, modulos] = await Promise.all([campanaTerrenoActual(), modulosActivos()]);
  // El asistente aparece solo si la campaña tiene curso en Aprende.
  const { data: conCurso } = campana
    ? await (await createClient()).from("campaigns").select("curso_aprende").eq("id", campana.id).maybeSingle()
    : { data: null };

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col bg-background">
        <header
          className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4">
            <span className="icon-chip size-9 shrink-0 rounded-lg" data-tone="primary" aria-hidden="true">
              <MapPinned size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight">{campana?.name ?? "Terreno"}</p>
              <p className="truncate text-xs text-muted-foreground">{profile.full_name}</p>
            </div>
            {modulos.includes("aprende") && (
              <a
                href="/capacitacion"
                target="_blank"
                rel="noopener"
                aria-label="Capacitación en Atlas Aprende"
                className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted"
              >
                <GraduationCap size={20} aria-hidden="true" />
              </a>
            )}
            {profile.role !== "agente" && (
              <Link
                href="/dashboard"
                aria-label="Volver al panel"
                className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted"
              >
                <LayoutDashboard size={20} aria-hidden="true" />
              </Link>
            )}
            <form action={signOut}>
              <button
                type="submit"
                aria-label="Cerrar sesión"
                className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted"
              >
                <LogOut size={20} aria-hidden="true" />
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-28 pt-4">
          {campana ? (
            children
          ) : (
            <div className="mt-10 rounded-xl border border-border bg-surface p-6 text-center">
              <p className="text-base font-semibold">No tienes una campaña de terreno</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Pide a tu supervisor que te agregue a la campaña. Cuando lo haga, tus clientes aparecen aquí.
              </p>
            </div>
          )}
        </main>

        {campana && <TerrenoNav />}
        {campana && conCurso?.curso_aprende && <AsistenteCurso campaignId={campana.id} nombre={campana.name} />}
      </div>
    </ToastProvider>
  );
}
