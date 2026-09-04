import { requireProfile } from "@/lib/auth";
import { listAgentSipRows, provisionAgentExtension, setAgentExtensionActive } from "@/app/actions/agent-sip";
import { RevealSipCredentialButton } from "@/components/reveal-sip-credential-button";
import { ActionForm, ActionSubmit, Callout } from "@/components/ui";
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
    if (!row.is_active || row.provisioning_status === "error") return "bg-danger-bg text-danger";
    if (row.provisioning_status === "synced") return "bg-success-bg text-success";
    return "bg-warning-bg text-warning";
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
      <div>
        <h1 className="text-xl font-semibold text-foreground">Extensiones SIP</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada ejecutivo necesita su propia extensión para usar la barra CTI y para que el motor de
          discado lo agregue a la cola de una campaña. Al generar una extensión, el motor la detecta solo
          (hasta 10 seg.) y crea el endpoint en Asterisk — no hace falta tocar la instancia a mano.
        </p>
      </div>

      {!syncHealthy && (
        <Callout tone="warning">
          <p className="font-medium">La central no está confirmando las extensiones de Atlas.</p>
          <p className="mt-1">
            Las extensiones activas de la lista existen en Atlas, pero no se pueden considerar
            operativas en Asterisk hasta recuperar la sincronización. Evita generar o rotar
            credenciales mientras aparezca este aviso.
          </p>
          <p className="mt-2 text-xs">
            Estado: {syncHealth.status === "failed" ? "fallando" : syncHealth.status === "stale" ? "sin reporte reciente" : "sin confirmar"}
            {syncHealth.consecutiveFailures > 0 ? ` · ${syncHealth.consecutiveFailures.toLocaleString("es-CL")} intentos consecutivos` : ""}
            {` · Último éxito: ${formatHealthDate(syncHealth.lastSuccessAt)}`}.
          </p>
        </Callout>
      )}

      <div className="rounded-xl border border-border bg-surface">
        <div className="divide-y divide-border">
          {rows.length === 0 && <p className="p-5 text-sm text-muted-foreground">No hay ejecutivos con rol &quot;agente&quot;.</p>}
          {rows.map((row) => (
            <div key={row.profile_id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">{row.full_name}</p>
                <p className="text-xs text-muted-foreground">{row.email}</p>
              </div>

              <div className="flex items-center gap-3">
                {row.extension ? (
                  <>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
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
                    <RevealSipCredentialButton profileId={row.profile_id} />
                    <ActionForm
                      action={setAgentExtensionActive}
                      success={row.is_active ? "Extensión desactivada" : "Extensión activada"}
                    >
                      <input type="hidden" name="profile_id" value={row.profile_id} />
                      <input type="hidden" name="active" value={String(row.is_active)} />
                      <ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">
                        {row.is_active ? "Desactivar" : "Activar"}
                      </ActionSubmit>
                    </ActionForm>
                  </>
                ) : (
                  <ActionForm action={provisionAgentExtension} success="Extensión generada">
                    <input type="hidden" name="profile_id" value={row.profile_id} />
                    <ActionSubmit size="sm" pendingLabel="Generando…">
                      Generar extensión
                    </ActionSubmit>
                  </ActionForm>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
