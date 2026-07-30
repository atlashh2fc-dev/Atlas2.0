import { requireProfile } from "@/lib/auth";
import { listAgentSipRows, provisionAgentExtension, setAgentExtensionActive } from "@/app/actions/agent-sip";
import { RevealSipCredentialButton } from "@/components/reveal-sip-credential-button";
import { ActionForm, ActionSubmit } from "@/components/ui";

export default async function AgentesSipPage() {
  await requireProfile(["admin"]);
  const rows = await listAgentSipRows();

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

      <div className="rounded-xl border border-border bg-surface">
        <div className="divide-y divide-border">
          {rows.length === 0 && <p className="p-5 text-sm text-muted-foreground">No hay ejecutivos con rol &quot;agente&quot;.</p>}
          {rows.map((row) => (
            <div key={row.profile_id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">{row.full_name}</p>
                <p className="text-xs text-muted-foreground">{row.email}</p>
              </div>

              <div className="flex items-center gap-3">
                {row.extension ? (
                  <>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        row.is_active ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
                      }`}
                    >
                      Ext. {row.extension} · {row.is_active ? "Activa" : "Inactiva"}
                    </span>
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
