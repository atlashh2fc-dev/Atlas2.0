import { requireProfile } from "@/lib/auth";
import { LiveMonitor } from "@/components/live-monitor";

export default async function MonitorEnVivoPage() {
  await requireProfile(["admin", "supervisor"]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Monitor en vivo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Estado en tiempo real de cada ejecutivo (disponible, en llamada, timbrando, o en pausa con
          motivo) y salud de las colas de las campañas activas. Se refresca solo cada 5 segundos.
        </p>
      </div>
      <LiveMonitor />
    </div>
  );
}
