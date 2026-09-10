import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { DialerListener } from "@/components/dialer-listener";
import { AgendaBanner, AgendaProvider } from "@/components/agenda-reminder";
import { CtiBar } from "@/components/cti-bar";
import { ToastProvider } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ForceLogoutGuard } from "@/components/force-logout-guard";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";
import { listDemoViewAccounts } from "@/lib/demo-accounts";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const { canAttendCustomers } = getWorkspacePermissions(profile.role);
  const showAgendaReminder = canAttendCustomers;
  const supabase = await createClient();

  // Contador del menú: las agendas vencidas del ejecutivo. Es una cuenta con
  // `head: true`, no trae filas.
  const { count: overdueCount } =
    profile.role === "agente"
      ? await supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("managed_by", profile.id)
          .not("next_action_at", "is", null)
          .lte("next_action_at", new Date().toISOString())
      : { count: null };

  const badges = { "overdue-agenda": overdueCount ?? 0 };
  // Solo las cuentas de demostración alternan de vista; para el resto esto no
  // consulta nada.
  const demoAccounts = await listDemoViewAccounts(profile);

  return (
    <ToastProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        {profile.role === "agente" && <ForceLogoutGuard userId={profile.id} />}
        {canAttendCustomers && <DialerListener userId={profile.id} />}
        <Sidebar profile={profile} badges={badges} />
        <div className="flex flex-1 flex-col overflow-hidden">
          {showAgendaReminder ? (
            <AgendaProvider userId={profile.id}>
              <Header profile={profile} badges={badges} demoAccounts={demoAccounts} />
              <AgendaBanner />
            </AgendaProvider>
          ) : (
            <Header profile={profile} demoAccounts={demoAccounts} />
          )}
          <main className="flex-1 overflow-y-auto p-5">{children}</main>
        </div>
        {canAttendCustomers && <CtiBar profile={profile} />}
      </div>
    </ToastProvider>
  );
}
