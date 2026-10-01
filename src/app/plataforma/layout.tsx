import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, LogOut } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, ToastProvider } from "@/components/ui";
import { requirePlataforma } from "@/lib/plataforma.server";

export const metadata: Metadata = {
  title: "Plataforma | Atlas",
};

/**
 * Armazón de la consola de plataforma: una barra arriba y el contenido
 * centrado, como el panel de organizaciones de Clerk o el de equipos de Vercel.
 * No comparte nada con el CRM —ni menú por rol, ni selector de empresa, ni
 * teléfono, ni color de edición—, así que se ve que esto no es el CRM de
 * Altius ni de nadie.
 */
export default async function PlataformaLayout({ children }: { children: React.ReactNode }) {
  const profile = await requirePlataforma();

  return (
    <ToastProvider>
      <div data-edicion="center" className="flex h-screen flex-col overflow-hidden bg-background">
        <header className="flex-shrink-0 border-b border-border bg-surface">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-6">
            <Link href="/plataforma" className="flex items-center gap-2.5">
              <Image src="/atlas-logo.png" alt="" width={24} height={24} className="size-6 rounded-full object-contain" priority />
              <span className="text-sm font-semibold text-foreground">Atlas</span>
            </Link>
            <span className="text-border-strong" aria-hidden="true">/</span>
            <span className="text-sm font-medium text-muted-foreground">Plataforma</span>

            <div className="ml-auto flex items-center gap-1">
              <Link
                href="/dashboard"
                className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              >
                Ir al CRM
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
              <ThemeToggle />
              <form action={signOut}>
                <button
                  type="submit"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                  title="Cerrar sesión"
                  aria-label="Cerrar sesión"
                >
                  <LogOut size={17} />
                </button>
              </form>
              <span className="ml-1 inline-flex" title={`${profile.full_name} · dueño de la plataforma`}>
                <Avatar name={profile.full_name} size="sm" />
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-6 py-10">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
