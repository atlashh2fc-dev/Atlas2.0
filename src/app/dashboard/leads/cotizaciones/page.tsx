import { connection } from "next/server";
import { Clock, Contact, Hourglass, Percent, Trophy } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getTabs } from "@/lib/nav.config";
import { getAgentQuotations, type QuotationCampaign, type QuotationRow } from "@/app/actions/cotizaciones";
import { AgentQuotationsTable } from "@/components/agent-quotations-table";
import { Callout, NavTabs, PageHeader } from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";

/**
 * Mis registros › Cotizaciones. Las cotizaciones enviadas del ejecutivo, con
 * su estado: pendiente, vendida o no vendida. Solo existe para el ejecutivo:
 * supervisión ve el resultado en Validación de ventas y en Reportes.
 */
export default async function CotizacionesPage() {
  await connection();
  const profile = await requireProfile(["agente"]);

  let rows: QuotationRow[] = [];
  let campaigns: QuotationCampaign[] = [];
  let loadError: string | null = null;
  try {
    ({ rows, campaigns } = await getAgentQuotations());
  } catch (error) {
    loadError = error instanceof Error ? error.message : "No se pudieron leer tus cotizaciones.";
  }

  const pending = rows.filter((row) => row.state === "pendiente");
  const sold = rows.filter((row) => row.state === "vendida").length;
  const lost = rows.filter((row) => row.state === "no_vendida").length;
  const closeRate = sold + lost > 0 ? Math.round((sold / (sold + lost)) * 100) : null;
  const nowMs = new Date().getTime();
  const stale = pending.filter((row) => nowMs - new Date(row.quotedAt).getTime() > 7 * 86_400_000).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mis registros"
        icon={Contact}
        description={`Hola, ${profile.full_name.split(" ")[0]}. Tus cotizaciones enviadas: marca las que se vendieron y las que no.`}
        className="border-b-0 pb-0"
      />
      <NavTabs tabs={getTabs("registros", profile.role)} />

      {loadError && <Callout tone="danger">{loadError}</Callout>}

      {/* Una franja en vez de cuatro tarjetas sueltas: se lee de corrido. Lo
          atrasado solo toma color cuando hay algo que atender. */}
      <KpiStrip columns={4}>
        <KpiStripItem
          label="Pendientes"
          value={pending.length.toLocaleString("es-CL")}
          icon={Clock}
          detail="Esperan respuesta del cliente"
        />
        <KpiStripItem
          label="Sin respuesta hace más de 7 días"
          value={stale.toLocaleString("es-CL")}
          icon={Hourglass}
          tone={stale > 0 ? "warn" : "default"}
          detail={stale > 0 ? "Vale la pena volver a contactarlos" : "Nada atrasado"}
        />
        <KpiStripItem
          label="Vendidas"
          value={sold.toLocaleString("es-CL")}
          icon={Trophy}
          detail="Van a Validación de ventas"
        />
        <KpiStripItem
          label="Tasa de cierre"
          value={closeRate === null ? "—" : `${closeRate} %`}
          icon={Percent}
          progress={closeRate ?? undefined}
          tone={closeRate !== null && closeRate > 0 ? "good" : "default"}
          detail={`${sold} vendidas de ${sold + lost} resueltas`}
        />
      </KpiStrip>

      <AgentQuotationsTable rows={rows} campaigns={campaigns} />
    </div>
  );
}
