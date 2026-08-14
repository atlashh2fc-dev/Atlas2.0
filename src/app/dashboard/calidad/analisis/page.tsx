import { BarChart3, BrainCircuit } from "lucide-react";
import { ReportRangePicker } from "@/components/report-range-picker";
import { requireProfile } from "@/lib/auth";
import { fetchQualityAnalysis } from "@/lib/quality-analysis";
import { resolveReportRange } from "@/lib/report-range";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Badge, Callout, MetricCard, SectionCard, Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui";

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

const STATUS = {
  pending: { label: "Pendiente", tone: "neutral" as const },
  processing: { label: "Procesando", tone: "info" as const },
  completed: { label: "Completada", tone: "success" as const },
  failed: { label: "Con error", tone: "danger" as const },
};

export default async function CalidadAnalisisPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireProfile(["admin", "supervisor"]);
  const params = await searchParams;
  const range = resolveReportRange(params);
  const supabase = await createClient();
  const analysis = await fetchQualityAnalysis(supabase, createAdminClient(), range.from, range.to);
  const completionRate =
    analysis.summary.eligibleRecordings > 0
      ? (analysis.summary.completed / analysis.summary.eligibleRecordings) * 100
      : 0;
  const groqConfigured = Boolean(process.env.GROQ_API_KEY?.trim());
  const mercuryConfigured = Boolean(process.env.INCEPTION_API_KEY?.trim());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 size={16} className="text-primary" />
            Reportes y análisis
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cobertura de transcripción y preparación de evaluaciones automáticas.
          </p>
        </div>
        <ReportRangePicker />
      </div>

      {range.notice && <Callout tone="warning">{range.notice}</Callout>}
      {analysis.error && <Callout tone="danger">{analysis.error}</Callout>}
      {!groqConfigured && (
        <Callout tone="warning">
          Falta configurar <code>GROQ_API_KEY</code>. La interfaz está lista, pero no enviará audios hasta cargar el secreto.
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Llamadas seleccionadas"
          value={analysis.summary.eligibleRecordings.toLocaleString("es-CL")}
          hint="Venta o rechazo · más de 2 min"
        />
        <MetricCard
          label="Transcritas"
          value={analysis.summary.completed.toLocaleString("es-CL")}
          hint={`${completionRate.toLocaleString("es-CL", { maximumFractionDigits: 1 })}% de cobertura`}
          tone="good"
        />
        <MetricCard label="Pendientes" value={analysis.summary.pending.toLocaleString("es-CL")} tone="warn" />
        <MetricCard label="Con error" value={analysis.summary.failed.toLocaleString("es-CL")} tone={analysis.summary.failed ? "danger" : "default"} />
        <MetricCard label="Audio transcrito" value={formatDuration(analysis.summary.transcribedSeconds)} />
      </div>

      <Callout tone={mercuryConfigured ? "info" : "warning"}>
        <span className="flex items-start gap-2">
          <BrainCircuit size={17} className="mt-0.5 flex-shrink-0" />
          <span>
            {mercuryConfigured
              ? "Mercury 2 está configurado. Las evaluaciones comenzarán cuando exista una pauta activa y versionada."
              : "La evaluación con Mercury 2 queda pendiente de una clave nueva y de la pauta; no se asignarán puntajes sin esos dos requisitos."}
          </span>
        </span>
      </Callout>

      <SectionCard
        title="Actividad reciente"
        description="Últimas transcripciones dentro del período seleccionado."
      >
        {analysis.recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Todavía no hay transcripciones en este período.
          </p>
        ) : (
          <Table>
            <Thead>
              <Th>Fecha de llamada</Th>
              <Th>Campaña</Th>
              <Th>Ejecutivo</Th>
              <Th>Estado</Th>
              <Th>Idioma</Th>
              <Th align="right">Caracteres</Th>
            </Thead>
            <Tbody>
              {analysis.recent.map((row) => {
                const status = STATUS[row.status];
                return (
                  <Tr key={row.recordingId}>
                    <Td>{formatDateTime(row.recordingStartedAt)}</Td>
                    <Td>{row.campaignName}</Td>
                    <Td>{row.agentName}</Td>
                    <Td><Badge tone={status.tone}>{status.label}</Badge></Td>
                    <Td muted>{row.languageCode ?? "—"}</Td>
                    <Td align="right">{row.transcriptCharacters.toLocaleString("es-CL")}</Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
