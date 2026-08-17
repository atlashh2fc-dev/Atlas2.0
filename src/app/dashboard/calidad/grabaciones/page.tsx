import { Headphones, Search } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveReportRange, toDateInput } from "@/lib/report-range";
import { fetchQualityRecordings, type RecordingFilters } from "@/lib/quality-recordings";
import { QualityRecordingsTable } from "@/components/quality-recordings-table";
import { Callout, Field, FilterBar, Input, Select } from "@/components/ui";

type Option = { id: string; name?: string; full_name?: string };

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
  const profile = await requireProfile(["admin", "supervisor"]);
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

  let agentOptions: Option[] = [];
  if (profile.role === "admin") {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "agente")
      .order("full_name");
    agentOptions = (data ?? []) as Option[];
  } else {
    const { data: teams } = await supabase.from("teams").select("id").eq("supervisor_id", profile.id);
    const teamIds = (teams ?? []).map((team) => team.id);
    if (teamIds.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("role", "agente")
        .in("team_id", teamIds)
        .order("full_name");
      agentOptions = (data ?? []) as Option[];
    }
  }

  const [{ data: campaignRows }, recordings] = await Promise.all([
    supabase.rpc("get_report_scope_campaigns"),
    fetchQualityRecordings(
      supabase,
      profile,
      filters,
      Number(params.page) || 1,
      relatedDataClient
    ),
  ]);
  const campaignOptions = (campaignRows ?? []) as Option[];

  return (
    <div className="space-y-5">
      {requestedRange.notice && <Callout tone="warning">{requestedRange.notice}</Callout>}

      <FilterBar storageKey="calidad-grabaciones" applyLabel="Buscar grabaciones">
        <Field label="RUT" className="min-w-56 flex-1">
          <span className="relative block">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input name="rut" defaultValue={filters.rut} placeholder="12.345.678-9" className="pl-8" />
          </span>
        </Field>

        <Field label="Campaña" className="w-52">
          <Select name="campaign" defaultValue={filters.campaign}>
            <option value="">Todas</option>
            {campaignOptions.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Ejecutivo" className="w-52">
          <Select name="agent" defaultValue={filters.agent}>
            <option value="">Todos</option>
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.full_name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Desde" className="w-40">
          <Input name="from" type="date" defaultValue={filters.from} max={filters.to} />
        </Field>

        <Field label="Hasta" className="w-40">
          <Input name="to" type="date" defaultValue={filters.to} min={filters.from} />
        </Field>
      </FilterBar>

      <Callout tone="info">
        Atlas selecciona automáticamente ventas o rechazos de más de 2 minutos con audio íntegro. En cualquier otra grabación disponible puedes usar “Transcribir igual”; “Evaluar script” prepara el texto y muestra el apego a la pauta en un solo paso.
      </Callout>
      {!mercuryConfigured && (
        <Callout tone="warning">
          La pauta v1 de Secretaría Virtual ya está cargada. Falta configurar una clave nueva como <code>INCEPTION_API_KEY</code> para ejecutar la auditoría con Mercury 2.
        </Callout>
      )}

      <section aria-labelledby="quality-recordings-title">
        <div className="mb-3">
          <h2 id="quality-recordings-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Headphones size={16} className="text-primary" />
            Grabaciones post-llamada
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {recordings.total.toLocaleString("es-CL")} grabación{recordings.total === 1 ? "" : "es"} encontrada{recordings.total === 1 ? "" : "s"}
          </p>
        </div>

        <QualityRecordingsTable {...recordings} />
      </section>
    </div>
  );
}
