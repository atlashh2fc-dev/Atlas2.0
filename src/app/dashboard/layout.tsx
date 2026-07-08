import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { DialerListener } from "@/components/dialer-listener";
import { AgendaBanner, AgendaProvider } from "@/components/agenda-reminder";
import { CtiBar } from "@/components/cti-bar";
import { ToastProvider } from "@/components/ui";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const showAgendaReminder = profile.role === "agente";

  return (
    <ToastProvider>
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
          <main className="flex-1 overflow-y-auto p-5">{children}</main>
        </div>
        <CtiBar profile={profile} />
      </div>
    </ToastProvider>
  );
}
