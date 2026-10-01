import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UserCreatePanel } from "@/components/user-create-panel";
import { UsersRound } from "lucide-react";
import { NavTabs, PageHeader } from "@/components/ui";

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const [{ data: teams }, { data: empresaId }] = await Promise.all([
    supabase.from("teams").select("id, name").order("name"),
    supabase.rpc("current_org_id"),
  ]);
  const { data: empresa } = typeof empresaId === "string"
    ? await supabase.from("organizations").select("name").eq("id", empresaId).maybeSingle()
    : { data: null };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Usuarios y equipos"
        icon={UsersRound}
        description="Crea la cuenta, define rol y equipo, y asigna campañas. Atlas completa la habilitación operativa."
        actions={<UserCreatePanel teams={teams ?? []} empresa={empresa?.name ?? null} />}
      />

      <NavTabs
        tabs={[
          { label: "Usuarios", href: "/dashboard/admin/usuarios" },
          { label: "Equipos", href: "/dashboard/admin/usuarios/equipos" },
        ]}
      />

      {children}
    </div>
  );
}
