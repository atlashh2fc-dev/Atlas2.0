import { Suspense } from "react";
import { requireProfile } from "@/lib/auth";
import { DialerReports } from "@/components/dialer-reports";
import { LoadingState } from "@/components/ui";

export default async function ReportesDiscadorPage() {
  await requireProfile(["admin", "supervisor"]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Histórico de métricas de llamadas (AHT, nivel de servicio, abandono) y actividad por ejecutivo
        (ocupación, adherencia). El período se elige arriba y es el mismo de la pestaña Gestión.
      </p>
      {/* Lee el período desde la URL, así que necesita su límite de Suspense. */}
      <Suspense fallback={<LoadingState label="Cargando el reporte del discador" />}>
        <DialerReports />
      </Suspense>
    </div>
  );
}
