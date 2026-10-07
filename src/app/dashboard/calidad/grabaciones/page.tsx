import { Headphones, Search } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveReportRange, toDateInput } from "@/lib/report-range";
import { fetchQualityRecordings, type RecordingFilters } from "@/lib/quality-recordings";
import { loadQualityScope } from "@/lib/quality-scorecard.server";
import { QualityRecordingsTable } from "@/components/quality-recordings-table";
import { Callout, Field, FilterBar, Input, Select } from "@/components/ui";

export default async function GrabacionesPage({
  searchParams,
}: {
  searchParams: Promise<{
    campaign?: string;
    agent?: string;
    rut?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const profile = await requireProfile(["admin", "supervisor", "calidad"]);
  const mercuryConfigured = Boolean(process.env.INCEPTION_API_KEY?.trim());
  const params = await searchParams;
  const supabase = await createClient();
  const relatedDataClient = createAdminClient();
  const requestedRange =
    params.from && params.to
      ? resolveReportRange({ preset: "custom", from: params.from, to: params.to })
      : resolveReportRange({ preset: "7d" });

  const filters: RecordingFilters = {
    campaign: params.campaign?.trim() ?? "",
    agent: params.agent?.trim() ?? "",
    rut: params.rut?.trim() ?? "",
    from: toDateInput(requestedRange.from),
    to: toDateInput(requestedRange.to),
  };

  const scope = await loadQualityScope(supabase, relatedDataClient, profile);
  const agentOptions = scope.agents;
  const campaignOptions = scope.campaigns;
  const recordings = await fetchQualityRecordings(
    supabase,
    profile,
    filters,
    Number(params.page) || 1,
    relatedDataClient,
    scope.pautaCampaignIds
  );

  return (
    <div className="space-y-5">
      {requestedRange.notice && <Callout tone="warning">{requestedRange.notice}</Callout>}

      <FilterBar storageKey="calidad-grabaciones" applyLabel="Buscar grabaciones">
        <Field label="RUT" hideLabel className="min-w-56 flex-1">
          <span className="relative block">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input name="rut" defaultValue={filters.rut} placeholder="Buscar por RUT (12.345.678-9)" className="pl-8" />
          </span>
        </Field>

        <Field label="Campaña" hideLabel className="w-52">
          <Select name="campaign" defaultValue={filters.campaign}>
            <option value="">Todas las campañas</option>
            {campaignOptions.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Ejecutivo" hideLabel className="w-52">
          <Select name="agent" defaultValue={filters.agent}>
            <option value="">Todos los ejecutivos</option>
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </Select>
        </Field>

        {/* Rango de fechas en un solo control: desde → hasta. */}
        <span className="flex items-center gap-1.5">
          <Field label="Desde" hideLabel className="w-36">
            <Input name="from" type="date" defaultValue={filters.from} max={filters.to} />
          </Field>
          <span aria-hidden="true" className="text-xs text-muted-foreground">→</span>
          <Field label="Hasta" hideLabel className="w-36">
            <Input name="to" type="date" defaultValue={filters.to} min={filters.from} />
          </Field>
        </span>
      </FilterBar>

      {!mercuryConfigured && (
        <Callout tone="warning">
          Las pautas ya están cargadas, pero la evaluación con IA todavía no está activada. Puedes escuchar y transcribir; para evaluar, pídele a soporte que la active.
        </Callout>
      )}

      <section aria-labelledby="quality-recordings-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h2 id="quality-recordings-title" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
              <span className="icon-chip size-7 rounded-lg" data-tone="violet" aria-hidden="true">
                <Headphones size={14} />
              </span>
              Grabaciones post-llamada
              <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {recordings.total.toLocaleString("es-CL")}
              </span>
            </h2>
            <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              «Evaluar» transcribe la llamada y la puntúa con la pauta de su campaña en un solo paso; luego la validas en Evaluaciones. Atlas además evalúa sola la muestra diaria de cada ejecutivo.
            </p>
          </div>
        </div>

        <QualityRecordingsTable {...recordings} />
      </section>
    </div>
  );
}
