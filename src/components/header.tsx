import { Suspense } from "react";
import type { Profile } from "@/lib/types";
import { MobileNav, WorkspaceContext } from "@/components/mobile-nav";
import type { NavBadgeCounts } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { QuickSearch } from "@/components/quick-search";
import { AgendaBell } from "@/components/agenda-reminder";
import { CampaignScopeSwitcher } from "@/components/campaign-scope-switcher";
import { signOut } from "@/app/actions/auth";
import { LogOut } from "lucide-react";

export function Header({
  profile,
  campaigns,
  badges,
}: {
  profile: Profile;
  campaigns: { id: string; name: string }[];
  badges?: NavBadgeCounts;
}) {
  return (
    <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex min-w-0 items-center gap-3">
        <MobileNav profile={profile} badges={badges} />
        <WorkspaceContext role={profile.role} />
      </div>

      <div className="flex items-center gap-3">
        {/* Lee la campaña de la URL, así que necesita su propio límite de
            Suspense igual que el selector de período de los reportes. */}
        <Suspense fallback={null}>
          <CampaignScopeSwitcher campaigns={campaigns} role={profile.role} />
        </Suspense>
        <QuickSearch role={profile.role} userId={profile.id} />
        {profile.role === "agente" && <AgendaBell />}
        <ThemeToggle />
        <form action={signOut}>
          <button
            type="submit"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut size={18} />
          </button>
        </form>
      </div>
    </header>
  );
}
