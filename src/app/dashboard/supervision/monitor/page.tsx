import { requireProfile } from "@/lib/auth";
import { LiveMonitor } from "@/components/live-monitor";
import { PageHeader } from "@/components/ui";

export default async function MonitorEnVivoPage() {
  await requireProfile(["admin", "supervisor"]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitor en vivo"
        description="Estado operacional de cada ejecutivo (disponible, en llamada, interrupción legal, ACW o AUX) y salud de las colas activas. Se sincroniza automáticamente cada 2 segundos."
      />
      <LiveMonitor />
    </div>
  );
}
