import { Suspense } from "react";
import { requireProfile } from "@/lib/auth";
import { NavTabs, PageHeader } from "@/components/ui";
import { ReportRangePicker } from "@/components/report-range-picker";
import { getTabs } from "@/lib/nav.config";

/**
 * Un solo destino "Reportes" con pestañas, en vez de dos ítems hermanos que
 * competían por el mismo nombre (docs/arquitectura-navegacion.md §4.3).
 */
export default async function ReportesLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile(["supervisor", "admin"]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reportes"
        description="Indicadores de gestión del equipo y métricas del discador."
        className="border-b-0 pb-0"
      />
      {/* El período es transversal a las pestañas: vive en la URL para que el
          rango elegido sobreviva al salto entre Gestión y Discador. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NavTabs tabs={getTabs("reportes", profile.role)} />
        <Suspense fallback={null}>
          <ReportRangePicker />
        </Suspense>
      </div>
      {children}
    </div>
  );
}
