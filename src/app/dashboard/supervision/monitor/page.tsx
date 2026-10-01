import { Activity } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { LiveMonitor } from "@/components/live-monitor";
import { NavTabs, PageHeader } from "@/components/ui";

export default async function MonitorEnVivoPage() {
  await requireProfile(["admin", "supervisor"]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Activity}
        title="Monitor en vivo"
        description="Estado del equipo al segundo y el embudo COPC outbound del día: recorrido, aló, titular y venta; además TMO, abandono, producción y pausas."
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
