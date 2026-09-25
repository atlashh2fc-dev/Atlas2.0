import { unstable_noStore as noStore } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { getTabs } from "@/lib/nav.config";
import { getAgentQuotations, type QuotationCampaign, type QuotationRow } from "@/app/actions/cotizaciones";
import { AgentQuotationsTable } from "@/components/agent-quotations-table";
import { Callout, MetricCard, NavTabs, PageHeader } from "@/components/ui";

/**
 * Mis registros › Cotizaciones. Las cotizaciones enviadas del ejecutivo, con
 * su estado: pendiente, vendida o no vendida. Solo existe para el ejecutivo:
 * supervisión ve el resultado en Validación de ventas y en Reportes.
 */
export default async function CotizacionesPage() {
  noStore();
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
        description={`Hola, ${profile.full_name.split(" ")[0]}. Tus cotizaciones enviadas: marca las que se vendieron y las que no.`}
        className="border-b-0 pb-0"
      />
      <NavTabs tabs={getTabs("registros", profile.role)} />

      {loadError && <Callout tone="danger">{loadError}</Callout>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Pendientes"
          value={pending.length.toLocaleString("es-CL")}
          hint="Esperan respuesta del cliente"
        />
        <MetricCard
          label="Sin respuesta hace más de 7 días"
          value={stale.toLocaleString("es-CL")}
          hint={stale > 0 ? "Vale la pena volver a contactarlos" : "Nada atrasado"}
          tone={stale > 0 ? "warn" : "good"}
        />
        <MetricCard label="Vendidas" value={sold.toLocaleString("es-CL")} hint="Van a Validación de ventas" />
        <MetricCard
          label="Tasa de cierre"
          value={closeRate === null ? "—" : `${closeRate} %`}
          hint={`${sold} vendidas de ${sold + lost} resueltas`}
        />
      </section>

      <AgentQuotationsTable rows={rows} campaigns={campaigns} />
    </div>
  );
}
