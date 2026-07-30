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
};

const CHOICE_TYPES = new Set(["select", "radio", "checkbox", "multiselect"]);

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
      });
    }

    const stepBranches = outgoing.get(step.id) ?? [];
    const options = Array.isArray(step.options) ? step.options : [];

    if (CHOICE_TYPES.has(step.field_type) && options.length > 0) {
      const covered = new Set(stepBranches.map((branch) => branch.from_option).filter(Boolean));
      const uncovered = options.filter((option) => !covered.has(option));

      // Una salida sin opción funciona como camino por defecto para todas.
      const hasDefault = stepBranches.some((branch) => !branch.from_option);

      if (!hasDefault && uncovered.length === options.length && stepBranches.length === 0) {
        issues.push({
          level: "warning",
          message: `«${step.name}» cierra el flujo: ninguna de sus ${options.length} opciones continúa a otro paso.`,
          stepId: step.id,
        });
      } else if (!hasDefault && uncovered.length > 0) {
        issues.push({
          level: "warning",
          message: `«${step.name}»: ${uncovered.length} de ${options.length} opciones no continúan a ningún paso (${uncovered
            .slice(0, 3)
            .join(", ")}${uncovered.length > 3 ? "…" : ""}).`,
          stepId: step.id,
        });
      }
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
