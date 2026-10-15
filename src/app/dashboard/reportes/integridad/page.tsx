import { requireProfile } from "@/lib/auth";
import { getManagementIntegrityReport } from "@/app/actions/management-integrity";
import { ManagementIntegrityTables } from "@/components/management-integrity-tables";
import { CalendarClock, ClipboardCheck, SearchCheck } from "lucide-react";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import { formatReportRangeLabel, resolveReportRange } from "@/lib/report-range";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function percent(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("es-CL", { maximumFractionDigits: 1 })} %`;
}

/**
 * Integridad: ¿lo que tipificó cada ejecutivo calza con lo que registró la
 * central?
 *
 * Antes mostraba cinco señales con nombres técnicos y 2.321 gestiones
 * «marcadas», de las que tres cuartos eran reagendamientos sin contacto. Ahora
 * una sola cifra para revisar, el reagendamiento aparte (es un tema del flujo,
 * no de integridad) y cada caso explicado en una frase.
 */
export default async function ReportesIntegridadPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; preset?: string; from?: string; to?: string; ejecutivo?: string }>;
}) {
  await requireProfile(["admin", "supervisor"]);
  const { campaign, preset, from, to, ejecutivo } = await searchParams;
  const campaignScope = resolveCampaignScope(campaign);
  const range = resolveReportRange({ preset, from, to });
  const selectedAgentId = ejecutivo && UUID.test(ejecutivo) ? ejecutivo : null;

  const report = await getManagementIntegrityReport({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    campaignId: campaignScope || null,
    agentId: selectedAgentId,
  });

  const { totals, thresholds } = report;
  const reviewRate = percent(totals.para_revisar, totals.gestiones);
  const rescheduledRate = percent(totals.reagendados_sin_contacto, totals.gestiones);
  // Lo que la página conserva al abrir un ejecutivo.
  const query = Object.fromEntries(
    Object.entries({ campaign, preset, from, to }).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Cruza lo que tipificó cada ejecutivo con lo que registró la central. Si alguien marca un contacto y la
          central no habló con ese cliente, aparece acá para revisarlo.
        </p>
        {range.notice && <p className="text-sm text-warning">{range.notice}</p>}
      </div>

      <KpiStrip title="Resumen" meta={formatReportRangeLabel(range)} columns={3}>
        <KpiStripItem
          label="Gestiones revisadas"
          icon={ClipboardCheck}
          value={totals.gestiones.toLocaleString("es-CL")}
          detail="Llamadas tipificadas en Atlas 2.0"
        />
        <KpiStripItem
          label="Para revisar"
          icon={SearchCheck}
          value={totals.para_revisar.toLocaleString("es-CL")}
          detail={`${formatPercent(reviewRate)} de las gestiones`}
          tone={reviewRate >= 5 ? "danger" : totals.para_revisar > 0 ? "warn" : "good"}
          progress={reviewRate}
          href="#casos"
          definition={{
            text: `Contactos que la central no respalda (no hubo llamada o no contestaron), contactos cerrados en menos de ${thresholds.fast_close_seconds} s y cierres a menos de ${thresholds.burst_seconds} s del anterior. Es un indicio para revisar, no una acusación.`,
          }}
        />
        <KpiStripItem
          label="Reagendadas sin contacto"
          icon={CalendarClock}
          value={totals.reagendados_sin_contacto.toLocaleString("es-CL")}
          detail={`${formatPercent(rescheduledRate)} · tema del flujo, no de integridad`}
          definition={{
            text: "Se cerraron con «Volver a llamar» sin hablar con el cliente. El ejecutivo reprogramó a alguien que no contestó y la única opción con fecha está en Contacto. No se cuenta como falta, pero infla la contactabilidad.",
          }}
        />
      </KpiStrip>

      <ManagementIntegrityTables
        agents={report.agents}
        detail={report.detail}
        totals={totals}
        selectedAgentId={selectedAgentId}
        query={query}
      />

      <details className="group rounded-xl border border-border bg-surface px-5 py-4 text-sm">
        <summary className="cursor-pointer list-none font-medium text-foreground marker:hidden">
          <span className="inline-flex min-h-6 items-center gap-2">
            ¿Cómo se calcula?
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Ver detalle</span>
          </span>
        </summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>
            Las señales salen del servidor: duración real de la gestión, eventos de la central y tiempo entre cierres.
            Una extensión del navegador no puede falsearlas.
          </li>
          <li>
            Un contacto tiene respaldo cuando la central registra que el cliente contestó o que la llamada se conectó
            con el ejecutivo.
          </li>
          <li>
            «Volver a llamar» sin conexión se cuenta aparte: es un reagendamiento, no un contacto inventado.
          </li>
          <li>
            Solo se evalúan llamadas hechas en Atlas 2.0. Quedan fuera las gestiones por WhatsApp o correo, el
            historial migrado de Atlas 1 y las llamadas anuladas (siguen completos en la ficha del cliente).
          </li>
        </ul>
      </details>
    </div>
  );
}
