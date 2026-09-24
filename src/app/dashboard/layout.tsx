import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { DialerListener } from "@/components/dialer-listener";
import { AgendaBanner, AgendaProvider } from "@/components/agenda-reminder";
import { CtiBar } from "@/components/cti-bar";
import { ToastProvider } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyAgendaCampaignId } from "@/lib/agenda-scope";
import { ForceLogoutGuard } from "@/components/force-logout-guard";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";
import { listDemoViewAccounts } from "@/lib/demo-accounts";
import { contextoDeMiEmpresa } from "@/lib/modules.server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const { canAttendCustomers } = getWorkspacePermissions(profile.role);
  const showAgendaReminder = canAttendCustomers;
  const supabase = await createClient();

  // Las dos lecturas del armazón salen juntas, no una tras otra: el contador
  // del menú (una cuenta con `head: true`, no trae filas) y las cuentas de
  // demostración (solo consultan algo para esas cuentas).
  const [{ count: overdueCount }, demoAccounts] = await Promise.all([
    profile.role === "agente"
      ? getMyAgendaCampaignId(supabase).then((agendaCampaignId) => {
          // Solo la campaña en la que está trabajando, como "Mi agenda".
          const query = supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("managed_by", profile.id)
            .not("next_action_at", "is", null)
            .lte("next_action_at", new Date().toISOString());
          return agendaCampaignId ? query.eq("campaign_id", agendaCampaignId) : query;
        })
      : Promise.resolve({ count: null }),
    listDemoViewAccounts(profile),
  ]);

  // Edición, aplicaciones contratadas y empresas a las que llega la persona.
  // Llegó junto con el perfil en la misma RPC, así que no cuesta otro viaje.
  // El menú se arma con los módulos (una empresa sin call center no ve
  // campañas ni grabaciones) y el color con la edición.
  const { edicion, modulos: modules, empresas, duenio } = await contextoDeMiEmpresa();

  const badges = { "overdue-agenda": overdueCount ?? 0 };

  return (
    // `data-edicion` cambia las variables de color de todo lo que cuelga de acá:
    // ningún componente sabe en qué edición está, solo pinta `bg-primary`.
    <div data-edicion={edicion} className="contents">
    <ToastProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        {profile.role === "agente" && <ForceLogoutGuard userId={profile.id} />}
        {canAttendCustomers && <DialerListener userId={profile.id} />}
        <Sidebar profile={profile} badges={badges} modules={modules} edicion={edicion} duenio={duenio} />
        <div className="flex flex-1 flex-col overflow-hidden">
          {showAgendaReminder ? (
            <AgendaProvider userId={profile.id}>
              <Header
                profile={profile}
                badges={badges}
                demoAccounts={demoAccounts}
                empresas={empresas}
                modules={modules}
                edicion={edicion}
                duenio={duenio}
              />
              <AgendaBanner />
            </AgendaProvider>
          ) : (
            <Header profile={profile} demoAccounts={demoAccounts} empresas={empresas} modules={modules} edicion={edicion} duenio={duenio} />
          )}
          <main className="flex-1 overflow-y-auto p-5">{children}</main>
        </div>
        {canAttendCustomers && <CtiBar profile={profile} />}
      </div>
    </ToastProvider>
    </div>
  );
}
