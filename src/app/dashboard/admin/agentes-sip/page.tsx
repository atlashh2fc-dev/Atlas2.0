import { Headset, PhoneCall } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { listAgentSipRows, setAgentExtensionActive } from "@/app/actions/agent-sip";
import { RevealSipCredentialButton } from "@/components/reveal-sip-credential-button";
import { ActionForm, ActionSubmit, Callout, EmptyState, PageHeader, SectionCard } from "@/components/ui";
import { getAgentSipSyncHealth } from "@/lib/dialer-health";

function formatHealthDate(value: string | null): string {
  if (!value) return "sin una sincronización exitosa registrada";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(new Date(value));
}

export default async function AgentesSipPage() {
  await requireProfile(["admin"]);
  const [rows, syncHealth] = await Promise.all([
    listAgentSipRows(),
    getAgentSipSyncHealth(),
  ]);
  const syncHealthy = syncHealth.status === "ok";

  const stateLabel = (row: Awaited<ReturnType<typeof listAgentSipRows>>[number]): string => {
    if (!row.is_active) return "Inactiva";
    if (row.provisioning_status === "synced") return "Operativa en Asterisk";
    if (row.provisioning_status === "error") return "Error de aprovisionamiento";
    return "Pendiente de Asterisk";
  };

  const stateClassName = (row: Awaited<ReturnType<typeof listAgentSipRows>>[number]): string => {
    if (!row.is_active || row.provisioning_status === "error") return "border-danger/35 bg-danger-bg text-danger";
    if (row.provisioning_status === "synced") return "border-success/35 bg-success-bg text-success";
    return "border-warning/35 bg-warning-bg text-warning";
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
        description="Atlas genera y activa la extensión cuando asignas una campaña automática. Esta pantalla no es parte del alta normal: úsala solo para revisar sincronización o resolver una contingencia."
      />

      {!syncHealthy && (
        <Callout tone="warning">
          <p className="font-medium">La central no está confirmando las extensiones de Atlas.</p>
          <p className="mt-1">
            Las extensiones activas de la lista existen en Atlas, pero no se pueden considerar
            operativas en Asterisk hasta recuperar la sincronización. Evita activar, desactivar o
            revelar credenciales mientras aparezca este aviso.
          </p>
          <p className="mt-2 text-xs">
            Estado: {syncHealth.status === "failed" ? "fallando" : syncHealth.status === "stale" ? "sin reporte reciente" : "sin confirmar"}
            {syncHealth.consecutiveFailures > 0 ? ` · ${syncHealth.consecutiveFailures.toLocaleString("es-CL")} intentos consecutivos` : ""}
            {` · Último éxito: ${formatHealthDate(syncHealth.lastSuccessAt)}`}.
          </p>
        </Callout>
      )}

      <SectionCard
        icon={PhoneCall}
        tone="primary"
        title="Extensiones de los ejecutivos"
        description={syncHealthy ? "La central está confirmando las extensiones." : "La central no está confirmando las extensiones."}
        actions={<span className={`inline-block size-2.5 rounded-full ${syncHealthy ? "bg-success" : "bg-warning"}`} aria-hidden="true" />}
      >
        <div className="divide-y divide-border">
          {rows.length === 0 && <EmptyState icon={Headset} title="No hay ejecutivos con rol “agente”." />}
          {rows.map((row) => (
            <div key={row.profile_id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`icon-chip size-8 rounded-full ${row.extension && row.is_active ? "" : "opacity-50"}`}
                  data-tone="primary"
                  aria-hidden="true"
                >
                  <Headset size={15} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{row.full_name}</p>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {row.extension ? (
                  <>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                        stateClassName(row)
                      }`}
                    >
                      Ext. {row.extension} · {stateLabel(row)}
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
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-background p-2">
                        <RevealSipCredentialButton profileId={row.profile_id} />
                        <ActionForm
                          action={setAgentExtensionActive}
                          success={row.is_active ? "Extensión desactivada" : "Extensión activada"}
                        >
                          <input type="hidden" name="profile_id" value={row.profile_id} />
                          <input type="hidden" name="active" value={String(row.is_active)} />
                          <ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">
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
