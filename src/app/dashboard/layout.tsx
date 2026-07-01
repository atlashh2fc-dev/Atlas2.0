import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { DialerListener } from "@/components/dialer-listener";
import { AgendaBanner, AgendaProvider } from "@/components/agenda-reminder";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const showAgendaReminder = profile.role === "agente" || profile.role === "admin";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <DialerListener userId={profile.id} />
      <Sidebar profile={profile} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {showAgendaReminder ? (
          <AgendaProvider userId={profile.id}>
            <Header profile={profile} />
            <AgendaBanner />
          </AgendaProvider>
        ) : (
          <Header profile={profile} />
        )}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
