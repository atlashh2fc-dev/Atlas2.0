import type { Profile } from "@/lib/types";
import { MobileNav, WorkspaceContext } from "@/components/mobile-nav";
import type { Edicion } from "@/lib/ediciones";
import type { AppModule } from "@/lib/modules";
import type { NavBadgeCounts } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { QuickSearch } from "@/components/quick-search";
import { SelectorEmpresa, type EmpresaDisponible } from "@/components/selector-empresa";
import { AgendaBell } from "@/components/agenda-reminder";
import { DemoRoleSwitcher } from "@/components/demo-role-switcher";
import type { DemoViewAccount } from "@/lib/demo-view";
import { BotonCerrarSesion } from "@/components/boton-cerrar-sesion";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";

export function Header({
  profile,
  badges,
  demoAccounts = [],
  empresas = [],
  modules,
  edicion = "center",
  duenio = false,
}: {
  profile: Profile;
  badges?: NavBadgeCounts;
  /** Módulos contratados por la empresa activa. */
  modules?: AppModule[];
  /** Vistas disponibles cuando la cuenta es de demostración. */
  demoAccounts?: DemoViewAccount[];
  /** Empresas a las que llega la persona. Con una sola, el selector no aparece. */
  empresas?: EmpresaDisponible[];
  edicion?: Edicion;
  duenio?: boolean;
}) {
  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <MobileNav profile={profile} badges={badges} modules={modules} edicion={edicion} duenio={duenio} />
        <WorkspaceContext role={profile.role} />
        {/* El buscador es la puerta de entrada (Linear, Attio): a la vista y
            pegado al contexto, no perdido entre los íconos de la derecha. */}
        <QuickSearch role={profile.role} userId={profile.id} modules={modules} edicion={edicion} />
      </div>

      <div className="flex items-center gap-1.5">
        {/* La administración de Atlas vive fuera del CRM de cada empresa: el
            dueño de la plataforma entra a ella desde acá, no desde el menú. */}
        {duenio && (
          <Link
            href="/plataforma"
            className="hidden h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground sm:flex"
          >
            <LayoutGrid size={16} aria-hidden="true" />
            Plataforma
          </Link>
        )}
        <SelectorEmpresa empresas={empresas} actual={profile.viewing_organization_id ?? null} unaALaVez={duenio} />
        {profile.is_demo && <DemoRoleSwitcher accounts={demoAccounts} currentId={profile.id} />}
        {profile.role === "agente" && <AgendaBell />}
        <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <ThemeToggle />
        <BotonCerrarSesion />
      </div>
    </header>
  );
}
