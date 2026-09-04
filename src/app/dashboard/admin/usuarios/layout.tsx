import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UserCreatePanel } from "@/components/user-create-panel";
import { NavTabs, PageHeader } from "@/components/ui";

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data: teams } = await supabase.from("teams").select("id, name").order("name");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Usuarios y equipos"
        description="Crea la cuenta, define rol y equipo, y asigna campañas. Atlas completa la habilitación operativa."
        className="border-b-0 pb-0"
        actions={<UserCreatePanel teams={teams ?? []} />}
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
