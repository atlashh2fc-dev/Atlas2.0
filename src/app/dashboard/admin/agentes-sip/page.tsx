import { Headset, PhoneCall } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { listAgentSipRows, setAgentExtensionActive } from "@/app/actions/agent-sip";
import { RevealSipCredentialButton } from "@/components/reveal-sip-credential-button";
import { ActionForm, ActionSubmit, Avatar, Badge, Callout, EmptyState, PageHeader, SectionCard, type BadgeTone } from "@/components/ui";
import { getAgentSipSyncHealth } from "@/lib/dialer-health";
import { fechaLegible } from "../_diseno";

function formatHealthDate(value: string | null): string {
  if (!value) return "sin una sincronización exitosa registrada";
  return fechaLegible(value);
}

export default async function AgentesSipPage() {
  await requireProfile(["admin"]);
  const [rows, syncHealth] = await Promise.all([
    listAgentSipRows(),
    getAgentSipSyncHealth(),
  ]);
  const syncHealthy = syncHealth.status === "ok";
  // Lo que hay que atender va primero: errores de aprovisionamiento, luego
  // extensiones activas que Asterisk aún no confirma. El resto en su orden.
  const urgency = (row: (typeof rows)[number]): number => {
    if (!row.extension) return 3;
    if (row.provisioning_status === "error") return 0;
    if (row.is_active && row.provisioning_status !== "synced") return 1;
    return 2;
  };
  const sortedRows = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => urgency(a.row) - urgency(b.row) || a.index - b.index)
    .map(({ row }) => row);

  const stateLabel = (row: Awaited<ReturnType<typeof listAgentSipRows>>[number]): string => {
    if (!row.is_active) return "Inactiva";
    if (row.provisioning_status === "synced") return "Operativa en Asterisk";
    if (row.provisioning_status === "error") return "Error de aprovisionamiento";
    return "Pendiente de Asterisk";
  };

  const stateTone = (row: Awaited<ReturnType<typeof listAgentSipRows>>[number]): BadgeTone => {
    if (!row.is_active) return "neutral";
    if (row.provisioning_status === "error") return "danger";
    if (row.provisioning_status === "synced") return "success";
    return "warning";
  };

  const failureLabel = (code: string | null): string => {
    if (code === "ami_config_read_failed") return "Asterisk no pudo leer la configuración administrada";
    if (code === "ami_template_sync_failed") return "Asterisk rechazó las plantillas de agentes";
    if (code === "ami_config_apply_failed") return "Asterisk rechazó la configuración del agente";
    if (code === "asterisk_endpoint_not_loaded") return "El endpoint no quedó cargado en Asterisk";
    return "Asterisk no confirmó el endpoint";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnóstico de telefonía"
        icon={PhoneCall}
        meta={
          rows.length > 0 ? (
            <>
              <span>
                <span className="font-semibold text-foreground">{rows.filter((row) => row.extension).length}</span> con extensión
              </span>
              <span>
                <span className="font-semibold text-foreground">
                  {rows.filter((row) => row.extension && row.is_active && row.provisioning_status === "synced").length}
                </span>{" "}
                operativas
              </span>
              {rows.some((row) => row.provisioning_status === "error") && (
                <span className="text-danger">
                  <span className="font-semibold">{rows.filter((row) => row.provisioning_status === "error").length}</span> con error
                </span>
              )}
            </>
          ) : undefined
        }
        description="Atlas genera y activa la extensión cuando asignas una campaña automática. Esta pantalla no es parte del alta normal: úsala solo para revisar sincronización o resolver una contingencia."
      />

      {!syncHealthy && (
        <Callout tone="warning">
          <p className="font-medium">La central no está confirmando las extensiones de Atlas.</p>
          <p className="mt-1">
            Las extensiones activas de la lista existen en Atlas, pero no se pueden considerar
            operativas en Asterisk hasta recuperar la sincronización. Evita activar, desactivar o
            revelar credenciales mientras aparezca este aviso: esas acciones quedan bloqueadas hasta que vuelva.
          </p>
          <p className="mt-2 text-xs">
            Estado: {syncHealth.status === "failed" ? "fallando" : syncHealth.status === "stale" ? "sin reporte reciente" : "sin confirmar"}
            {syncHealth.consecutiveFailures > 0 ? ` · ${syncHealth.consecutiveFailures.toLocaleString("es-CL")} intentos consecutivos` : ""}
            {` · Último éxito: ${formatHealthDate(syncHealth.lastSuccessAt)}`}.
          </p>
        </Callout>
      )}

      <SectionCard
        title="Extensiones de los ejecutivos"
        description="Lo que hay que atender va primero: errores de aprovisionamiento y extensiones que la central aún no confirma."
        actions={
          <Badge tone={syncHealthy ? "success" : "warning"}>
            {syncHealthy ? "Central sincronizada" : "Central sin confirmar"}
          </Badge>
        }
      >
        <div className="divide-y divide-border/70 border-t border-border">
          {rows.length === 0 && <EmptyState icon={Headset} title="No hay ejecutivos con rol “agente”." />}
          {sortedRows.map((row) => (
            <div key={row.profile_id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={row.full_name} size="md" className={row.extension && row.is_active ? "" : "opacity-50"} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{row.full_name}</p>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {row.extension ? (
                  <>
                    <span className="text-right">
                      <Badge tone={stateTone(row)}>{stateLabel(row)}</Badge>
                      <span className="block font-mono text-[11px] text-muted-foreground">Ext. {row.extension}</span>
                    </span>
                    {row.provisioning_status === "error" && (
                      <span className="max-w-52 text-xs text-danger">
                        {failureLabel(row.provisioning_failure_code)}
                      </span>
                    )}
                    <details>
                      <summary className="cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Acciones de contingencia
                      </summary>
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-2 rounded-lg bg-surface-raised p-2">
                        <RevealSipCredentialButton profileId={row.profile_id} disabled={!syncHealthy} />
                        <ActionForm
                          action={setAgentExtensionActive}
                          success={row.is_active ? "Extensión desactivada" : "Extensión activada"}
                          confirm={
                            row.is_active
                              ? {
                                  title: `¿Desactivar la extensión de ${row.full_name}?`,
                                  description: `La extensión ${row.extension} deja de recibir y hacer llamadas hasta que la reactives desde aquí.`,
                                  confirmLabel: "Desactivar extensión",
                                  tone: "danger",
                                }
                              : undefined
                          }
                        >
                          <input type="hidden" name="profile_id" value={row.profile_id} />
                          <input type="hidden" name="active" value={String(row.is_active)} />
                          <ActionSubmit
                            variant="secondary"
                            size="sm"
                            pendingLabel="Guardando…"
                            disabled={!syncHealthy}
                            title={syncHealthy ? undefined : "Bloqueado mientras la central no confirme las extensiones"}
                          >
                            {row.is_active ? "Desactivar por contingencia" : "Reactivar extensión"}
                          </ActionSubmit>
                        </ActionForm>
                      </div>
                    </details>
                  </>
                ) : (
                  <span className="max-w-64 text-right text-xs text-muted-foreground">
                    Sin extensión. Se creará automáticamente al asignarle una campaña de discado.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
