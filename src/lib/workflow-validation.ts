import { isKnownClosingReason, workflowOptionKey } from "./call-typification.ts";
import type { WorkflowStep, WorkflowStepBranch } from "./types";

/**
 * Validación de un flujo de gestión antes de ponerlo a operar.
 *
 * Hoy un flujo se puede asignar a una campaña con pasos inalcanzables o con
 * opciones que no llevan a ninguna parte, y el problema aparece recién cuando
 * un ejecutivo se queda sin camino en medio de una llamada
 * (docs/auditoria-vistas-workplace.md §4.11).
 */

export type WorkflowIssue = {
  level: "error" | "warning";
  message: string;
  stepId?: string;
  /** Qué hay que arreglar, para que el lienzo lo marque y ofrezca la salida. */
  kind?: "no_options" | "orphan_branch" | "hidden_closure" | "unreachable" | "other";
  /** Opción del paso a la que se refiere el problema. */
  option?: string;
  /** Conexión a la que se refiere el problema. */
  branchId?: string;
};

const CHOICE_TYPES = new Set<WorkflowStep["field_type"]>([
  "single_choice",
  "multi_select",
  "combobox",
]);

export function validateWorkflow(steps: WorkflowStep[], branches: WorkflowStepBranch[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (steps.length === 0) return [{ level: "warning", message: "El flujo no tiene pasos todavía." }];

  const stepIds = new Set(steps.map((step) => step.id));
  const starts = steps.filter((step) => step.is_start);

  if (starts.length === 0) {
    issues.push({
      level: "error",
      message: "Ningún paso está marcado como inicio: el ejecutivo no sabría por dónde empezar.",
    });
  }
  if (starts.length > 1) {
    issues.push({
      level: "error",
      message: `Hay ${starts.length} pasos marcados como inicio; debe haber exactamente uno.`,
    });
  }

  const incoming = new Set(branches.map((branch) => branch.to_step_id).filter((id): id is string => Boolean(id)));

  // Un inicio al que llega una rama deja fuera todo lo que está antes: el
  // 2026-09-11 Secretaria Virtual quedó empezando en «Conecta» y cada contacto
  // se grabó como no contactado, sin «No contesta» ni «Buzón» en pantalla.
  for (const start of starts) {
    if (incoming.has(start.id)) {
      issues.push({
        level: "error",
        message: `«${start.name}» está marcado como inicio, pero otro paso lleva hasta él.`,
        stepId: start.id,
      });
    }
  }
  const outgoing = new Map<string, WorkflowStepBranch[]>();
  for (const branch of branches) {
    outgoing.set(branch.from_step_id, [...(outgoing.get(branch.from_step_id) ?? []), branch]);

    if (branch.to_step_id && !stepIds.has(branch.to_step_id)) {
      issues.push({
        level: "error",
        message: "Hay una conexión que apunta a un paso que ya no existe.",
        stepId: branch.from_step_id,
      });
    }
  }

  for (const step of steps) {
    if (!step.is_start && !incoming.has(step.id)) {
      issues.push({
        level: "error",
        message: `«${step.name}» es inalcanzable: ningún paso lleva hasta él.`,
        stepId: step.id,
        kind: "unreachable",
      });
    }

    const stepBranches = outgoing.get(step.id) ?? [];
    const options = Array.isArray(step.options) ? step.options : [];
    const defaultBranches = stepBranches.filter((branch) => branch.from_option === null);

    if (defaultBranches.length > 1) {
      issues.push({
        level: "error",
        message: `«${step.name}» tiene ${defaultBranches.length} salidas por defecto; debe tener como máximo una.`,
        stepId: step.id,
      });
    }

    if (CHOICE_TYPES.has(step.field_type) && options.length === 0) {
      issues.push({
        level: "error",
        message: `«${step.name}» es un campo de selección sin opciones.`,
        stepId: step.id,
        kind: "no_options",
      });
    }

    if (CHOICE_TYPES.has(step.field_type) && options.length > 0) {
      // Misma comparación que la ficha: sin mayúsculas, tildes ni signos.
      const optionKeys = new Set(options.map(workflowOptionKey));

      for (const branch of stepBranches) {
        if (branch.from_option === null) continue;
        if (!optionKeys.has(workflowOptionKey(branch.from_option))) {
          issues.push({
            level: "error",
            message: `«${step.name}»: la conexión «${branch.from_option}» sale de una opción que ya no existe.`,
            stepId: step.id,
            kind: "orphan_branch",
            option: branch.from_option,
            branchId: branch.id,
          });
          continue;
        }

        // Una opción con paso propio deja de ser un cierre: la ficha la dibuja
        // como grupo y ofrece las opciones del paso al que lleva. Si la opción
        // es un motivo de cierre conocido, casi siempre es un descuido.
        const target = branch.to_step_id ? steps.find((item) => item.id === branch.to_step_id) : null;
        const targetOptions = target && Array.isArray(target.options) ? target.options : [];
        // Las opciones del inicio son estados (Conecta / No Conecta), nunca cierres.
        if (!step.is_start && target && targetOptions.length > 0 && isKnownClosingReason(branch.from_option)) {
          issues.push({
            level: "warning",
            message: `«${branch.from_option}» lleva a «${target.name}»: el ejecutivo no puede elegirla como cierre, solo ve ${
              targetOptions.length === 1 ? `«${targetOptions[0]}»` : `las ${targetOptions.length} opciones de ese paso`
            }.`,
            stepId: step.id,
            kind: "hidden_closure",
            option: branch.from_option,
            branchId: branch.id,
          });
        }
      }
      // Una opción sin conexión no es un problema: es un motivo final, y el
      // lienzo lo muestra en la propia fila.
    }
  }

  // Una conexión que vuelve a un paso ya recorrido no tiene fin: la ficha corta
  // el camino en la opción que cierra el ciclo y la ofrece como motivo final.
  const adjacency = new Map<string, string[]>();
  for (const branch of branches) {
    if (!branch.to_step_id) continue;
    adjacency.set(branch.from_step_id, [...(adjacency.get(branch.from_step_id) ?? []), branch.to_step_id]);
  }
  const visitState = new Map<string, "visiting" | "done">();
  const cyclic = new Set<string>();
  const walk = (stepId: string) => {
    visitState.set(stepId, "visiting");
    for (const next of adjacency.get(stepId) ?? []) {
      const mark = visitState.get(next);
      if (mark === "visiting") cyclic.add(stepId);
      else if (!mark) walk(next);
    }
    visitState.set(stepId, "done");
  };
  for (const step of steps) {
    if (!visitState.has(step.id)) walk(step.id);
  }
  for (const step of steps) {
    if (cyclic.has(step.id)) {
      issues.push({
        level: "warning",
        message: `«${step.name}» tiene una conexión que vuelve a un paso anterior; en la ficha ese camino termina ahí.`,
        stepId: step.id,
      });
    }
  }

  return issues;
}

export function workflowStatus(issues: WorkflowIssue[]): {
  tone: "success" | "warning" | "danger";
  label: string;
} {
  const errors = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.length - errors;
  if (errors > 0) return { tone: "danger", label: `${errors} ${errors === 1 ? "error" : "errores"}` };
  if (warnings > 0) return { tone: "warning", label: `${warnings} ${warnings === 1 ? "aviso" : "avisos"}` };
  return { tone: "success", label: "Sin problemas" };
}
