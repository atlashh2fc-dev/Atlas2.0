import { requireProfile } from "@/lib/auth";
import { listAllStatusReasons, createStatusReason, toggleStatusReasonActive } from "@/app/actions/agent-status";

export default async function EstadosAgentePage() {
  await requireProfile(["admin"]);
  const reasons = await listAllStatusReasons();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Estados de agente</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Motivos que un ejecutivo puede seleccionar en la barra CTI (Disponible, Auxiliar, Baño,
          Capacitación, etc.). Los marcados como &quot;pausa&quot; sacan al agente de las colas de Asterisk
          mientras estén activos — el motor lo sincroniza solo (hasta 10 seg.), sin tocar el servidor.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="divide-y divide-border">
          {reasons.length === 0 && <p className="p-5 text-sm text-muted-foreground">No hay motivos configurados.</p>}
          {reasons.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">{r.label}</p>
                <p className="text-xs text-muted-foreground">
                  código: {r.code} · {r.is_pause ? "pausa (sale de la cola)" : "disponible (en la cola)"}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    r.is_active ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
                  }`}
                >
                  {r.is_active ? "Activo" : "Inactivo"}
                </span>
                <form action={toggleStatusReasonActive}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="active" value={String(r.is_active)} />
                  <button
                    type="submit"
                    className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted"
                  >
                    {r.is_active ? "Desactivar" : "Activar"}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Nuevo motivo</h2>
        <form action={createStatusReason} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Código</label>
            <input
              name="code"
              required
              placeholder="ej. almuerzo"
              className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Etiqueta</label>
            <input
              name="label"
              required
              placeholder="ej. Almuerzo"
              className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Orden</label>
            <input
              name="sort_order"
              type="number"
              defaultValue={reasons.length}
              className="mt-1 w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
            <input type="checkbox" name="is_pause" defaultChecked className="rounded border-border" />
            Es pausa (sale de la cola)
          </label>
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Crear
          </button>
        </form>
      </div>
    </div>
  );
}
