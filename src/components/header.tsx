import type { Profile } from "@/lib/types";
import { ThemeToggle } from "@/components/theme-toggle";
import { QuickSearch } from "@/components/quick-search";
import { AgendaBell } from "@/components/agenda-reminder";
import { signOut } from "@/app/actions/auth";
import { LogOut } from "lucide-react";

const ROLE_LABEL: Record<Profile["role"], string> = {
  agente: "Agente",
  supervisor: "Supervisor",
  admin: "Administrador",
};

export function Header({ profile }: { profile: Profile }) {
  return (
    <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div>
        <p className="text-sm font-medium text-foreground">{profile.full_name}</p>
        <p className="text-xs text-muted-foreground">{ROLE_LABEL[profile.role]}</p>
      </div>

      <div className="flex items-center gap-3">
        <QuickSearch />
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
