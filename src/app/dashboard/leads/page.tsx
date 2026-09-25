import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Plus, Search, Upload } from "lucide-react";
import Link from "next/link";
import { LEAD_STATUSES } from "@/lib/types";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import {
  fetchCampaignVertical,
  leadStatusLabel,
  type CampaignVertical,
} from "@/lib/campaign-vertical";
import {
  PAGE_SIZE_DEFAULT,
  fetchLeadsPage,
  parseLeadView,
  type LeadFilters,
} from "@/lib/leads-query";
import { channelSegmentLabel, parseChannelSegment } from "@/lib/channel-segment";
import { LeadsQueue, type LeadQueueRow } from "@/components/leads-queue";
import { Callout, Field, FilterBar, Input, NavTabs, PageHeader, Select, buttonClasses } from "@/components/ui";
import { getTabs } from "@/lib/nav.config";

type FilterOption = { id: string; full_name?: string; name?: string };

/**
 * El título coincide exactamente con el label del sidebar (nav.config.ts):
 * "Registros" para supervisor y admin, "Mis registros" para el ejecutivo.
 * Lo que cambia por rol es el alcance, y eso va en la descripción.
 */
function roleCopy(role: string, vertical: CampaignVertical) {
  const cobranza = vertical === "cobranza";
  if (role === "supervisor") {
    return {
      title: "Registros",
      description: cobranza
        ? "Cartera visible de tu equipo, ordenada por compromiso, ejecutivo y tramo de mora."
        : "Leads visibles de tu equipo, filtrados por prioridad, ejecutivo y campaña.",
      action: "Revisar",
    };
  }
  if (role === "admin") {
    return {
      title: "Registros",
      description: cobranza
        ? "Vista global de la cartera para auditoría, búsqueda de deudores y control operacional."
        : "Vista global de leads para auditoría, búsqueda y control operacional.",
      action: "Abrir",
    };
  }
  return {
    title: "Mis registros",
    description: cobranza
      ? "Deudores que gestionaste, con su último resultado y los compromisos por cobrar."
      : "Clientes que gestionaste, con su tipificación y próximas agendas.",
    action: "Gestionar",
  };
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    view?: string;
    agent?: string;
    campaign?: string;
    status?: string;
    page?: string;
    canal?: string;
    etapa?: string;
    desde?: string;
    hasta?: string;
  }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const { q, view: viewParam, agent, campaign, status, page: pageParam } = params;
  const campaignScope = resolveCampaignScope(campaign);
  const view = parseLeadView(viewParam);
  const supabase = await createClient();
  // La campaña decide cómo se llama lo que hay en la cola: registros o deudores.
  const vertical = await fetchCampaignVertical(supabase, campaignScope || null);
  const copy = roleCopy(profile.role, vertical);
  const canManage = profile.role === "supervisor" || profile.role === "admin";
  // Llega desde una celda de "Resultado por canal de origen" en Reportes.
  const segment = canManage ? parseChannelSegment(params) : null;

  const filters: LeadFilters = {
    q: q?.trim() || "",
    agent: canManage ? agent || "" : "",
    campaign: campaignScope || "",
    status: canManage ? status || "" : "",
  };

  const [{ data: agentOptions }, { data: campaignOptions }] = canManage
    ? await Promise.all([
        supabase.from("profiles").select("id, full_name").eq("role", "agente").eq("active", true).order("full_name"),
        profile.role === "supervisor"
          ? supabase.rpc("get_report_scope_campaigns")
          : supabase.from("campaigns").select("id, name").order("name"),
      ])
    : [{ data: [] }, { data: [] }];

  const [result, tracksQuotations] = await Promise.all([
    fetchLeadsPage<LeadQueueRow>(supabase, {
      role: profile.role,
      filters,
      view,
      page: Number(pageParam) || 1,
      pageSize: PAGE_SIZE_DEFAULT,
      segment,
    }),
    // La pestaña Cotizaciones solo aparece si el ejecutivo trabaja una campaña
    // que las sigue (Secretaria Virtual); si la consulta falla, no se muestra.
    profile.role === "agente"
      ? supabase.rpc("agent_tracks_quotations").then(({ data }) => data === true)
      : Promise.resolve(false),
  ]);

  // Estados presentes en la base + el que esté filtrado, con etiqueta legible
  // cuando el valor pertenece al catálogo del producto.
  const statusOptions = [...new Set([...result.statuses, filters.status].filter(Boolean))]
    .map((value) => ({
      value,
      label: leadStatusLabel(
        vertical,
        value,
        LEAD_STATUSES.find((status) => status.value === value)?.label ?? value
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));

  // Cuando la búsqueda encuentra el registro pero los filtros lo esconden, hay
  // que decirlo: la pantalla en blanco hacía creer que el RUT no existía.
  const activeFilters = [
    filters.campaign &&
      `campaña ${((campaignOptions ?? []) as FilterOption[]).find((option) => option.id === filters.campaign)?.name ?? "seleccionada"}`,
    filters.agent &&
      `ejecutivo ${((agentOptions ?? []) as FilterOption[]).find((option) => option.id === filters.agent)?.full_name ?? "seleccionado"}`,
    filters.status &&
      `estado ${leadStatusLabel(vertical, filters.status, LEAD_STATUSES.find((status) => status.value === filters.status)?.label ?? filters.status)}`,
  ].filter(Boolean) as string[];
  const hiddenBySearchFilters =
    result.search !== null && result.search.matches > 0 && result.total === 0;

  return (
    <div className="space-y-5">
      {/* Las acciones son botones de la página, no ítems de menú (docs/arquitectura-navegacion.md §4.3). */}
      <PageHeader
        title={copy.title}
        description={`Hola, ${profile.full_name.split(" ")[0]}. ${copy.description}`}
        className={tracksQuotations ? "border-b-0 pb-0" : undefined}
        actions={
          canManage ? (
            <div className="flex items-center gap-2">
              {profile.role === "admin" && (
                <Link href="/dashboard/admin/cargas" className={buttonClasses({ variant: "secondary" })}>
                  <Upload size={16} />
                  Importar
                </Link>
              )}
              <Link href="/dashboard/leads/nuevo" className={buttonClasses()}>
                <Plus size={16} />
                Ingresar fuera de base
              </Link>
            </div>
          ) : undefined
        }
      />
      {tracksQuotations && <NavTabs tabs={getTabs("registros", profile.role)} />}

      <FilterBar storageKey="registros">
        <Field label="Buscar" className="min-w-64 flex-1">
          <span className="relative block">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input name="q" defaultValue={filters.q} placeholder="RUT, teléfono o nombre" className="pl-8" />
          </span>
        </Field>

        {canManage && (
          <>
            <Field label="Ejecutivo" className="w-48">
              <Select name="agent" defaultValue={filters.agent}>
                <option value="">Todos</option>
                {((agentOptions ?? []) as FilterOption[]).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.full_name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Campaña" className="w-48">
              <Select name="campaign" defaultValue={filters.campaign}>
                <option value="">Todas</option>
                {((campaignOptions ?? []) as FilterOption[]).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Los estados salen de lo que existe en la base: el catálogo fijo
                ofrecía seis valores sin resultados y omitía el que tiene el 90 %
                de los registros. */}
            <Field label="Estado" className="w-52">
              <Select name="status" defaultValue={filters.status}>
                <option value="">Todos</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <input type="hidden" name="view" value={view} />
        {segment && (
          <>
            <input type="hidden" name="canal" value={params.canal} />
            <input type="hidden" name="etapa" value={params.etapa} />
            <input type="hidden" name="desde" value={params.desde} />
            <input type="hidden" name="hasta" value={params.hasta} />
          </>
        )}
      </FilterBar>

      {segment && (
        <Callout tone="info">
          <p>
            <span className="font-medium">Desde Reportes:</span> {channelSegmentLabel(segment)}.{" "}
            {`${result.total.toLocaleString("es-CL")} ${result.total === 1 ? "registro" : "registros"}`}
            {activeFilters.length > 0 && `, con ${activeFilters.join(", ")}`}.
          </p>
          <Link href="/dashboard/leads" className="mt-2 inline-block font-medium underline underline-offset-2">
            Ver todos los registros
          </Link>
        </Callout>
      )}

      {hiddenBySearchFilters && (
        <Callout tone="warning">
          <p>
            {`Hay ${result.search?.matches === 1 ? "1 registro que coincide" : `${result.search?.matches} registros que coinciden`} con “${filters.q}”, pero ${activeFilters.length > 0 ? `están fuera de los filtros activos (${activeFilters.join(", ")}).` : "quedan fuera de tu alcance de visibilidad."}`}
          </p>
          {activeFilters.length > 0 && (
            <Link
              href={`/dashboard/leads?q=${encodeURIComponent(filters.q)}`}
              className="mt-2 inline-block font-medium underline underline-offset-2"
            >
              Buscar sin filtros
            </Link>
          )}
        </Callout>
      )}

      <LeadsQueue
        leads={result.rows}
        view={view}
        counts={result.counts}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        action={copy.action}
        vertical={vertical}
        agents={(agentOptions ?? []).map((option) => ({ id: option.id, full_name: option.full_name ?? "Sin nombre" }))}
        canManage={canManage}
        errorMessage={result.error}
      />
    </div>
  );
}
