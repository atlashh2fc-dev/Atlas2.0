import { requireProfile } from "@/lib/auth";
import { getManagementIntegrityReport } from "@/app/actions/management-integrity";
import { ManagementIntegrityTables } from "@/components/management-integrity-tables";
import { Callout, MetricCard } from "@/components/ui";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import { formatReportRangeLabel, resolveReportRange } from "@/lib/report-range";

export default async function ReportesIntegridadPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; preset?: string; from?: string; to?: string }>;
}) {
  await requireProfile(["admin", "supervisor"]);
  const { campaign, preset, from, to } = await searchParams;
  const campaignScope = await resolveCampaignScope(campaign);
  const range = resolveReportRange({ preset, from, to });

  const report = await getManagementIntegrityReport({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    campaignId: campaignScope || null,
  });

  const { totals, thresholds } = report;
  const suspiciousRate = totals.gestiones > 0 ? (totals.sospechosas / totals.gestiones) * 100 : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {`Señales de tipificación automatizada · ${formatReportRangeLabel(range)}`}
      </p>

      <Callout tone="info">
        Estas señales las produce el servidor —duración real de la gestión, eventos de conexión del
        discador y cadencia entre cierres—, así que una extensión del navegador no puede falsearlas.
        Son indicios para investigar, no una acusación: una llamada que no contestan se tipifica
        rápido y con razón. El indicio más fuerte es &quot;contacto sin llamada&quot;: una gestión
        cerrada como contactada sin que la central registre conexión.
      </Callout>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MetricCard label="Gestiones del período" value={totals.gestiones.toLocaleString("es-CL")} />
        <MetricCard
          label="Marcadas"
          value={totals.sospechosas.toLocaleString("es-CL")}
          hint={`${suspiciousRate.toFixed(1)}% del total`}
          tone={suspiciousRate > 20 ? "danger" : "default"}
        />
        <MetricCard
          label={`Cierres bajo ${thresholds.fast_close_seconds}s`}
          value={totals.cierres_instantaneos.toLocaleString("es-CL")}
        />
        <MetricCard
          label="Contacto sin llamada"
          value={totals.contactos_sin_respaldo.toLocaleString("es-CL")}
          tone={totals.contactos_sin_respaldo > 0 ? "danger" : "default"}
        />
        <MetricCard
          label={`Cierres a menos de ${thresholds.burst_seconds}s`}
          value={totals.rafagas.toLocaleString("es-CL")}
        />
      </section>

      <ManagementIntegrityTables agents={report.agents} detail={report.detail} />
    </div>
  );
}
