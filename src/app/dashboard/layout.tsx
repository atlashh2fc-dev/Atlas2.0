import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { DialerListener } from "@/components/dialer-listener";
import { AgendaBanner, AgendaProvider } from "@/components/agenda-reminder";
import { CtiBar } from "@/components/cti-bar";
import { AgentDayBar } from "@/components/agent-day-bar";
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

  // Las lecturas del armazón salen juntas, no una tras otra: los contadores
  // del menú (cuentas, no traen filas) y las cuentas de demostración (solo
  // consultan algo para esas cuentas).
  const [{ count: overdueCount }, demoAccounts, salesToValidate] = await Promise.all([
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
    // Ventas esperando que supervisión las apruebe o rechace (ya acotadas a
    // sus equipos por la RPC). Un fallo no debe tumbar el armazón.
    profile.role === "agente"
      ? Promise.resolve(0)
      : supabase.rpc("count_sale_validations").then(({ data }) =>
          ((data ?? []) as { status: string; total: number }[]).find((row) => row.status === "pendiente")?.total ?? 0,
        ),
  ]);

  // Edición, aplicaciones contratadas y empresas a las que llega la persona.
  // Llegó junto con el perfil en la misma RPC, así que no cuesta otro viaje.
  // El menú se arma con los módulos (una empresa sin call center no ve
  // campañas ni grabaciones) y el color con la edición.
  const { edicion, modulos: modules, empresas, duenio } = await contextoDeMiEmpresa();

  const badges = { "overdue-agenda": overdueCount ?? 0, "sales-to-validate": salesToValidate };

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
          {/* Totales de la jornada del ejecutivo, arriba y fuera del teléfono. */}
          {profile.role === "agente" && <AgentDayBar />}
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
            <Header profile={profile} badges={badges} demoAccounts={demoAccounts} empresas={empresas} modules={modules} edicion={edicion} duenio={duenio} />
          )}
          <main className="flex-1 overflow-y-auto p-5">{children}</main>
        </div>
        {canAttendCustomers && <CtiBar profile={profile} />}
      </div>
    </ToastProvider>
    </div>
  );
}
