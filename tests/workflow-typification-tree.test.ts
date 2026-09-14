import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCallReasonCatalogFromWorkflow,
  groupReasonsByState,
  nestReasonOptions,
  type ReasonOptionNode,
} from "../src/lib/call-typification.ts";
import { validateWorkflow } from "../src/lib/workflow-validation.ts";
import type { WorkflowStep, WorkflowStepBranch } from "../src/lib/types.ts";

function step(input: Partial<WorkflowStep> & Pick<WorkflowStep, "id" | "name">): WorkflowStep {
  const { id, name, ...overrides } = input;
  return {
    id,
    workflow_id: "workflow",
    step_order: 1,
    name,
    description: null,
    is_mandatory: true,
    allowed_results: overrides.options ?? [],
    field_type: "combobox",
    options: [],
    pos_x: 0,
    pos_y: 0,
    is_start: false,
    created_at: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

function branch(id: string, from: string, option: string | null, to: string): WorkflowStepBranch {
  return {
    id,
    workflow_id: "workflow",
    from_step_id: from,
    from_option: option,
    to_step_id: to,
    created_at: "2026-09-14T00:00:00.000Z",
  };
}

function shape(nodes: ReasonOptionNode[]): unknown[] {
  return nodes.map((node) => (node.kind === "reason" ? node.option.label : { [node.label]: shape(node.children) }));
}

test("an option with its own step becomes a group at any depth instead of vanishing", () => {
  // Secretaria Virtual, 2026-09-11: «No Interesa» recibió su propio paso y
  // desapareció del formulario. Aquí además «Por precio» abre un cuarto nivel,
  // que antes se descartaba sin aviso.
  const steps = [
    step({ id: "call", name: "Llamada", is_start: true, field_type: "single_choice", options: ["Conecta", "No Conecta"] }),
    step({ id: "connected", name: "Conecta", step_order: 2, options: ["Volver a Llamar", "No Interesa", "Corta Llamada"] }),
    step({ id: "not-connected", name: "No Conecta", step_order: 3, options: ["No Contesta"] }),
    step({ id: "not-interested", name: "No Interesa", step_order: 4, options: ["No lo Necesita", "Por precio"] }),
    step({ id: "price", name: "Por precio", step_order: 5, options: ["Competencia más barata", "Sin presupuesto"] }),
  ];
  const branches = [
    branch("e1", "call", "Conecta", "connected"),
    branch("e2", "call", "No Conecta", "not-connected"),
    branch("e3", "connected", "No Interesa", "not-interested"),
    branch("e4", "not-interested", "Por precio", "price"),
  ];

  const catalog = buildCallReasonCatalogFromWorkflow(steps, branches);
  assert.deepEqual(
    catalog
      .filter((reason) => reason.stateLabel === "CONTACTO")
      .map((reason) => [reason.value, (reason.groupPath ?? []).join(" > "), reason.status, reason.outcome]),
    [
      ["VOLVER A LLAMAR", "", "connected", "callback"],
      ["NO LO NECESITA", "No Interesa", "connected", "not_interested"],
      ["COMPETENCIA MAS BARATA", "No Interesa > Por precio", "connected", "not_interested"],
      ["SIN PRESUPUESTO", "No Interesa > Por precio", "connected", "not_interested"],
      ["CORTA LLAMADA", "", "connected", "other"],
    ]
  );

  const contact = groupReasonsByState(catalog).find((state) => state.label === "CONTACTO");
  assert.ok(contact);
  assert.deepEqual(shape(nestReasonOptions(contact.reasons)), [
    "Volver a Llamar",
    { "No Interesa": ["No lo Necesita", { "Por precio": ["Competencia más barata", "Sin presupuesto"] }] },
    "Corta Llamada",
  ]);
});

test("a connection that loops back ends the path in the form and is flagged in the editor", () => {
  const steps = [
    step({ id: "call", name: "Llamada", is_start: true, field_type: "single_choice", options: ["Conecta"] }),
    step({ id: "connected", name: "Conecta", step_order: 2, options: ["Volver a Llamar", "Profundizar"] }),
    step({ id: "detail", name: "Detalle", step_order: 3, options: ["Repreguntar", "Listo"] }),
  ];
  const branches = [
    branch("e1", "call", "Conecta", "connected"),
    branch("e2", "connected", "Profundizar", "detail"),
    branch("e3", "detail", "Repreguntar", "connected"),
  ];

  const catalog = buildCallReasonCatalogFromWorkflow(steps, branches);
  assert.deepEqual(
    catalog.map((reason) => [reason.value, (reason.groupPath ?? []).join(" > ")]),
    [
      ["VOLVER A LLAMAR", ""],
      ["REPREGUNTAR", "Profundizar"],
      ["LISTO", "Profundizar"],
    ]
  );

  const warnings = validateWorkflow(steps, branches).filter((issue) => issue.level === "warning");
  assert.ok(warnings.some((issue) => issue.stepId === "detail" && issue.message.includes("vuelve a un paso anterior")));
});
