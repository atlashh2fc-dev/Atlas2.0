import { Field, FilterBar, Input, Select } from "@/components/ui";
import { resolveReportRange, toDateInput, type ReportRange } from "@/lib/report-range";

export type QualityFilterParams = { campaign?: string; agent?: string; from?: string; to?: string; estado?: string };

export type QualityFilterState = {
  range: ReportRange;
  campaignId: string;
  agentId: string;
  from: string;
  to: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Período (por defecto, últimos 7 días en hora de Chile), campaña y ejecutivo. */
export function parseQualityFilters(params: QualityFilterParams): QualityFilterState {
  const range =
    params.from && params.to
      ? resolveReportRange({ preset: "custom", from: params.from, to: params.to })
      : resolveReportRange({ preset: "7d" });
  return {
    range,
    campaignId: params.campaign && UUID.test(params.campaign) ? params.campaign : "",
    agentId: params.agent && UUID.test(params.agent) ? params.agent : "",
    from: toDateInput(range.from),
    to: toDateInput(range.to),
  };
}

/** Lleva los filtros vigentes a otro destino de Calidad (tablero → lista). */
export function qualityQuery(state: QualityFilterState, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  params.set("from", state.from);
  params.set("to", state.to);
  if (state.campaignId) params.set("campaign", state.campaignId);
  if (state.agentId) params.set("agent", state.agentId);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  return params.toString();
}

export function QualityFilters({
  state,
  campaigns,
  agents,
  storageKey,
  hidden,
}: {
  state: QualityFilterState;
  campaigns: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  storageKey: string;
  /** Parámetros que la barra conserva al filtrar (por ejemplo, la vista activa). */
  hidden?: Record<string, string>;
}) {
  return (
    <FilterBar storageKey={storageKey} applyLabel="Aplicar">
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field label="Campaña" hideLabel className="w-56">
        <Select name="campaign" defaultValue={state.campaignId}>
          <option value="">Todas las campañas</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Ejecutivo" hideLabel className="w-56">
        <Select name="agent" defaultValue={state.agentId}>
          <option value="">Todos los ejecutivos</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </Select>
      </Field>
      <span className="flex items-center gap-1.5">
        <Field label="Desde" hideLabel className="w-36">
          <Input name="from" type="date" defaultValue={state.from} max={state.to} />
        </Field>
        <span aria-hidden="true" className="text-xs text-muted-foreground">→</span>
        <Field label="Hasta" hideLabel className="w-36">
          <Input name="to" type="date" defaultValue={state.to} min={state.from} />
        </Field>
      </span>
    </FilterBar>
  );
}

export function formatScore(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-CL", { maximumFractionDigits: digits });
}

export function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${formatScore(value)}%`;
}

/** Tono de una nota contra el objetivo de la pauta. */
export function scoreTone(value: number | null | undefined, objective: number): "good" | "warn" | "danger" | "default" {
  if (value === null || value === undefined) return "default";
  if (value >= objective) return "good";
  if (value >= objective - 10) return "warn";
  return "danger";
}
