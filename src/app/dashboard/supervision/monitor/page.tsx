import { requireProfile } from "@/lib/auth";
import { LiveMonitor } from "@/components/live-monitor";
import { PageHeader } from "@/components/ui";

export default async function MonitorEnVivoPage() {
  const profile = await requireProfile(["admin", "supervisor"]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitor en vivo"
        description="Una consola configurable para vigilar capacidad, riesgo y carga operacional en tiempo real."
      />
      <LiveMonitor canForceLogout={profile.role === "admin"} />
    </div>
  );
}
