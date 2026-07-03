import { requireProfile } from "@/lib/auth";
import { DialerReports } from "@/components/dialer-reports";

export default async function ReportesDiscadorPage() {
  await requireProfile(["admin", "supervisor"]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reportes de discador</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Histórico de métricas de llamadas (AHT, nivel de servicio, abandono) y actividad por ejecutivo
          (ocupación, adherencia) para un rango de fechas.
        </p>
      </div>
      <DialerReports />
    </div>
  );
}
