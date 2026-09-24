import { requireProfile } from "@/lib/auth";
import { LiveMonitor } from "@/components/live-monitor";
import { NavTabs, PageHeader } from "@/components/ui";

export default async function MonitorEnVivoPage() {
  await requireProfile(["admin", "supervisor"]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitor en vivo"
        description="Estado del equipo al segundo y métricas del día: TMO, contactabilidad, abandono, producción y pausas."
        className="border-b-0 pb-0"
      />
      <NavTabs
        tabs={[
          { label: "Centro de operaciones", href: "/dashboard/operacion" },
          { label: "Monitor en vivo", href: "/dashboard/supervision/monitor" },
        ]}
      />
      <LiveMonitor canForceLogout />
    </div>
  );
}
