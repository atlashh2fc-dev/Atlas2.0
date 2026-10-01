import { requireProfile } from "@/lib/auth";
import { getManagementIntegrityReport } from "@/app/actions/management-integrity";
import { ManagementIntegrityTables } from "@/components/management-integrity-tables";
import { ClipboardList, Flag, PhoneOff, ShieldCheck, Timer, Zap } from "lucide-react";
import { Callout } from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import { formatReportRangeLabel, resolveReportRange } from "@/lib/report-range";

export default async function ReportesIntegridadPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; preset?: string; from?: string; to?: string }>;
}) {
  await requireProfile(["admin", "supervisor"]);
  const { campaign, preset, from, to } = await searchParams;
  const campaignScope = resolveCampaignScope(campaign);
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
      <Callout tone="info" className="flex gap-3">
        <span className="icon-chip size-7 rounded-lg" data-tone="primary" aria-hidden="true">
          <ShieldCheck size={14} />
        </span>
        <p className="leading-relaxed">
        <span className="font-medium">Señales de tipificación automatizada.</span>{" "}
        Estas señales las produce el servidor —duración real de la gestión, eventos de conexión del
        discador y cadencia entre cierres—, así que una extensión del navegador no puede falsearlas.
        Son indicios para investigar, no una acusación: una llamada que no contestan se tipifica
        rápido y con razón. El indicio más fuerte es &quot;contacto sin llamada&quot;: una gestión
        cerrada como contactada sin que la central registre conexión. Solo se evalúan gestiones
        hechas en Atlas 2.0: el historial migrado de Atlas 1 y las llamadas anuladas no tienen
        esas señales y quedan fuera (siguen completos en la ficha del cliente).
        </p>
      </Callout>

      <KpiStrip title="Señales del período" meta={formatReportRangeLabel(range)}>
        <KpiStripItem
          label="Gestiones del período"
          value={totals.gestiones.toLocaleString("es-CL")}
          icon={ClipboardList}
        />
        <KpiStripItem
          label="Marcadas"
          value={totals.sospechosas.toLocaleString("es-CL")}
          icon={Flag}
          detail={`${suspiciousRate.toFixed(1)}% del total`}
          tone={suspiciousRate > 20 ? "danger" : totals.sospechosas > 0 ? "warn" : "default"}
          progress={suspiciousRate}
        />
        <KpiStripItem
          label={`Cierres bajo ${thresholds.fast_close_seconds}s`}
          value={totals.cierres_instantaneos.toLocaleString("es-CL")}
          icon={Timer}
          tone={totals.cierres_instantaneos > 0 ? "warn" : "default"}
        />
        <KpiStripItem
          label="Contacto sin llamada"
          value={totals.contactos_sin_respaldo.toLocaleString("es-CL")}
          icon={PhoneOff}
          detail="El indicio más fuerte"
          tone={totals.contactos_sin_respaldo > 0 ? "danger" : "default"}
        />
        <KpiStripItem
          label={`Cierres a menos de ${thresholds.burst_seconds}s`}
          value={totals.rafagas.toLocaleString("es-CL")}
          icon={Zap}
          tone={totals.rafagas > 0 ? "warn" : "default"}
        />
      </KpiStrip>

      <ManagementIntegrityTables agents={report.agents} detail={report.detail} />
    </div>
  );
}
