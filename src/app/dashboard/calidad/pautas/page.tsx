import { ClipboardList } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mapPautaRow, PAUTA_COLUMNS, type QualityPauta } from "@/lib/quality-pauta";
import { loadQualityScope } from "@/lib/quality-scorecard.server";
import { Badge, Callout, EmptyState, SectionCard, Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui";
import { PautaSettingsForm, PautaUploadForm } from "@/components/quality/pauta-forms";

const OUTCOME_LABEL: Record<string, string> = {
  "*": "Resto de las tipificaciones",
  not_interested: "No interesa",
  sale: "Venta",
  interested: "Interesado",
  callback: "Agenda / volver a llamar",
};

const date = (value: string) =>
  new Date(value).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Santiago" });

const weight = (value: number) => value.toLocaleString("es-CL", { maximumFractionDigits: 1 });

export default async function CalidadPautasPage() {
  const profile = await requireProfile(["admin", "supervisor", "calidad"]);
  const supabase = await createClient();
  const admin = createAdminClient();
  const scope = await loadQualityScope(supabase, admin, profile);
  const canEdit = profile.role === "admin" || profile.role === "calidad";

  const { data: versionRows } = await supabase.from("quality_pautas").select(PAUTA_COLUMNS).order("version", { ascending: false });
  const versions = (versionRows ?? []).map((row) => mapPautaRow(row as Record<string, unknown>));
  const campaignNames = new Map(scope.campaigns.map((campaign) => [campaign.id, campaign.name]));
  const vigentes = versions.filter((pauta) => pauta.status === "vigente");

  return (
    <div className="space-y-5">
      {vigentes.length === 0 && (
        <SectionCard>
          <EmptyState
            icon={ClipboardList}
            title="Todavía no hay una pauta vigente"
            description={canEdit ? "Carga la planilla de la pauta para empezar a evaluar llamadas." : "Pide a Calidad o Administración que cargue la pauta."}
          />
        </SectionCard>
      )}

      {vigentes.map((pauta) => (
        <PautaCard key={pauta.id} pauta={pauta} campaignNames={campaignNames} />
      ))}

      {canEdit && (
        <div className="grid gap-5 xl:grid-cols-2">
          {vigentes[0] && (
            <SectionCard title="Configuración" description="A qué campañas aplica, la nota objetivo y cuántas llamadas evalúa Atlas sola cada día.">
              <div className="px-5 pb-5">
                <PautaSettingsForm
                  pautaId={vigentes[0].id}
                  campaigns={scope.campaigns}
                  initial={{
                    campaignIds: vigentes[0].campaignIds,
                    objective: vigentes[0].objective,
                    minSeconds: vigentes[0].minSeconds,
                    dailySamplePerAgent: vigentes[0].dailySamplePerAgent,
                  }}
                />
              </div>
            </SectionCard>
          )}
          <SectionCard
            title={vigentes[0] ? "Actualizar la pauta" : "Cargar pauta"}
            description="La versión nueva reemplaza a la vigente. Las notas ya entregadas conservan la pauta con que se evaluaron."
          >
            <div className="px-5 pb-5">
              <PautaUploadForm pautaKey={vigentes[0]?.key ?? null} pautaName={vigentes[0]?.name ?? null} />
            </div>
          </SectionCard>
        </div>
      )}

      {versions.length > 0 && (
        <SectionCard title="Historial de versiones">
          <Table>
            <Thead>
              <Tr>
                <Th>Pauta</Th>
                <Th>Versión</Th>
                <Th>Archivo</Th>
                <Th>Cargada</Th>
                <Th>Estado</Th>
              </Tr>
            </Thead>
            <Tbody>
              {versions.map((pauta) => (
                <Tr key={pauta.id}>
                  <Td className="font-medium text-foreground">{pauta.name}</Td>
                  <Td className="tabular-nums">v{pauta.version}</Td>
                  <Td className="text-muted-foreground">{pauta.sourceFilename ?? "—"}</Td>
                  <Td className="text-muted-foreground">{date(pauta.createdAt)}</Td>
                  <Td>{pauta.status === "vigente" ? <Badge tone="success">Vigente</Badge> : <Badge>Archivada</Badge>}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </SectionCard>
      )}
    </div>
  );
}

function PautaCard({ pauta, campaignNames }: { pauta: QualityPauta; campaignNames: Map<string, string> }) {
  return (
    <SectionCard
      title={pauta.name}
      description={`Versión ${pauta.version} · cargada el ${date(pauta.createdAt)}${pauta.sourceFilename ? ` desde ${pauta.sourceFilename}` : ""}`}
      actions={<Badge tone="success">Vigente</Badge>}
    >
      <div className="space-y-5 px-5 pb-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Nota objetivo</dt>
            <dd className="font-semibold tabular-nums text-foreground">{weight(pauta.objective)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Muestra automática</dt>
            <dd className="text-foreground">{pauta.dailySamplePerAgent ? `${pauta.dailySamplePerAgent} por ejecutivo al día` : "Solo a pedido"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Llamadas desde</dt>
            <dd className="text-foreground">{pauta.minSeconds} segundos</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Medición</dt>
            <dd className="text-xs leading-5 text-foreground">
              Cumple {weight(pauta.scale.cumple)} · Con obs. {weight(pauta.scale.parcial)} · No cumple {weight(pauta.scale.no_cumple)} · No aplica {weight(pauta.scale.no_aplica)}
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-xs text-muted-foreground">Campañas</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {pauta.campaignIds.length === 0 ? (
              <span className="text-sm text-warning">Sin campañas asignadas: no se evaluará ninguna llamada.</span>
            ) : (
              pauta.campaignIds.map((id) => (
                <span key={id} className="rounded-md bg-surface-muted px-2 py-1 text-xs text-foreground">{campaignNames.get(id) ?? "Campaña inactiva"}</span>
              ))
            )}
          </div>
        </div>

        {pauta.notes && <Callout tone="warning">{pauta.notes}</Callout>}

        <div className="grid gap-5 2xl:grid-cols-2">
          {pauta.rubrics.map((rubric) => (
            <div key={rubric.key} className="overflow-hidden rounded-xl border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted/50 px-4 py-2.5">
                <p className="text-sm font-semibold text-foreground">{rubric.name}</p>
                <p className="text-xs text-muted-foreground">Se usa en: {rubric.outcomes.map((outcome) => OUTCOME_LABEL[outcome] ?? outcome).join(", ")}</p>
              </div>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Atributo</Th>
                    <Th className="text-right">Peso</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rubric.criteria.map((criterion) => (
                    <Tr key={criterion.id}>
                      <Td>
                        <span className="block font-medium text-foreground">{criterion.name}</span>
                        <span className="mt-0.5 block whitespace-normal text-xs leading-5 text-muted-foreground">{criterion.definition}</span>
                      </Td>
                      <Td className="text-right align-top font-semibold tabular-nums text-foreground">{weight(criterion.weight)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
