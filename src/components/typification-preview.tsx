import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import {
  CALL_STATUSES,
  groupReasonsByState,
  nestReasonOptions,
  type CallOutcome,
  type CallReasonConfig,
  type ReasonOptionNode,
} from "@/lib/call-typification";
import { Badge, SectionCard } from "@/components/ui";

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  sale: "Venta",
  callback: "Volver a llamar",
  interested: "Interesado",
  not_interested: "No interesado",
  other: "Sin resultado comercial",
};

function PreviewOption({ option }: { option: CallReasonConfig }) {
  const status = CALL_STATUSES.find((item) => item.value === option.status)?.label ?? option.status;
  const agenda =
    option.agenda === "required" ? "agenda obligatoria" : option.agenda === "optional" ? "agenda opcional" : null;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background px-3 py-2">
      <p className="truncate text-xs font-semibold uppercase text-foreground">{option.label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {[status, OUTCOME_LABEL[option.outcome], agenda].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

function PreviewNodes({ nodes }: { nodes: ReasonOptionNode[] }) {
  const blocks: ReactNode[] = [];
  let run: CallReasonConfig[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    blocks.push(
      <div key={`options-${blocks.length}`} className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {run.map((option) => (
          <PreviewOption key={`${(option.groupPath ?? []).join(">")}-${option.value}`} option={option} />
        ))}
      </div>
    );
    run = [];
  };
  for (const node of nodes) {
    if (node.kind === "reason") {
      run.push(node.option);
      continue;
    }
    flushRun();
    blocks.push(
      <div key={`group-${node.label}`} className="rounded-xl border border-border/70 bg-surface-muted/40 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{node.label}</p>
        <PreviewNodes nodes={node.children} />
      </div>
    );
  }
  flushRun();
  return <div className="space-y-2">{blocks}</div>;
}

/**
 * Lo que el ejecutivo verá al tipificar con este flujo. Se arma con el mismo
 * catálogo y el mismo anidado que la ficha, sobre el estado vivo del lienzo:
 * cualquier diferencia entre lo configurado y lo que se opera se ve aquí antes
 * de que llegue a una llamada.
 */
export function TypificationPreview({ catalog }: { catalog: CallReasonConfig[] }) {
  const states = groupReasonsByState(catalog);

  return (
    <section aria-label="Vista previa de tipificación">
      <SectionCard
        title="Así lo verá el ejecutivo"
        description="Se calcula con el mismo código que la ficha y cambia con cada edición del lienzo. Bajo cada opción, cómo queda grabado el cierre."
        icon={Eye}
        tone="rose"
        actions={
          <Badge tone="neutral" className="shrink-0">
            {catalog.length} {catalog.length === 1 ? "opción" : "opciones"}
          </Badge>
        }
      >
        <div className="space-y-4 p-4">
          {states.length === 0 ? (
            <p className="text-sm font-medium text-danger">
              El formulario quedaría vacío: con este flujo el ejecutivo no podría tipificar ninguna llamada.
            </p>
          ) : (
            states.map((state) => (
              <div key={state.label}>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">{state.label}</h3>
                <PreviewNodes nodes={nestReasonOptions(state.reasons)} />
              </div>
            ))
          )}
        </div>
      </SectionCard>
    </section>
  );
}
