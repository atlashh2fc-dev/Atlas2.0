import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCallAgendaPayload,
  buildCallReasonCatalogFromWorkflow,
  getCascadeStateOptionsFrom,
  validateCallClosure,
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
    field_type: "single_choice",
    options: [],
    pos_x: 0,
    pos_y: 0,
    is_start: false,
    created_at: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function branch(input: Pick<WorkflowStepBranch, "id" | "from_step_id" | "from_option" | "to_step_id">): WorkflowStepBranch {
  return {
    workflow_id: "workflow",
    created_at: "2026-08-03T00:00:00.000Z",
    ...input,
  };
}

test("Secretaria Virtual builds its own catalog from explicit workflow branches", () => {
  const steps = [
    step({ id: "start", name: "Llamada", is_start: true, options: ["Conecta", "No Conecta"] }),
    step({
      id: "connected",
      name: "Conecta",
      step_order: 2,
      field_type: "combobox",
      options: [
        "Enviar Información",
        "Volver a Llamar",
        "Cotización Enviada",
        "Contrata Servicio",
        "Número Erróneo",
        "No Interesa",
        "Corta Llamada",
      ],
    }),
    step({
      id: "not-connected",
      name: "No Conecta",
      step_order: 3,
      field_type: "combobox",
      options: ["No Contesta", "Buzón de Voz", "Teléfono Fuera de Servicio"],
    }),
  ];
  const branches = [
    branch({ id: "connected-edge", from_step_id: "start", from_option: "Conecta", to_step_id: "connected" }),
    branch({ id: "not-connected-edge", from_step_id: "start", from_option: "No Conecta", to_step_id: "not-connected" }),
  ];

  const catalog = buildCallReasonCatalogFromWorkflow(steps, branches);
  assert.deepEqual(
    catalog.map((reason) => reason.value),
    [
      "ENVIAR INFORMACION",
      "VOLVER A LLAMAR",
      "COTIZACION ENVIADA",
      "CONTRATA SERVICIO",
      "NUMERO ERRONEO",
      "NO INTERESA",
      "CORTA LLAMADA",
      "NO CONTESTA",
      "BUZON DE VOZ",
      "TELEFONO FUERA DE SERVICIO",
    ]
  );
  assert.equal(catalog.find((reason) => reason.value === "NO CONTESTA")?.status, "no_answer");
  assert.equal(catalog.find((reason) => reason.value === "VOLVER A LLAMAR")?.agenda, "required");
  assert.equal(catalog.find((reason) => reason.value === "COTIZACION ENVIADA")?.requiresEquifaxData, false);
  assert.equal(catalog.find((reason) => reason.value === "COTIZACION ENVIADA")?.agenda, "none");
  assert.deepEqual(
    getCascadeStateOptionsFrom(catalog).map((state) => state.label),
    ["CONTACTO", "NO CONTACTO"]
  );
  assert.equal(catalog.find((reason) => reason.value === "NO CONTESTA")?.stateLabel, "NO CONTACTO");

  assert.deepEqual(
    validateCallClosure(
      {
        status: "connected",
        outcome: "other",
        reason: "COTIZACION ENVIADA",
        notes: null,
        next_action_at: null,
        equifax_products: [],
        equifax_uf_amount: null,
        equifax_recipient_email: null,
        lead_email: null,
        contact_email: null,
      },
      catalog
    ),
    [],
    "Secretaria Virtual must not inherit Equifax product, UF or email requirements"
  );
});

test("Equifax workflow keeps its commercial fields scoped to quote and sale outcomes", () => {
  const steps = [
    step({ id: "start", name: "Estado", is_start: true, options: ["Conectado"] }),
    step({ id: "result", name: "Resultado", step_order: 2, options: ["Cotización Enviada"] }),
    step({ id: "equifax", name: "Validar datos Equifax (productos, UF, email)", step_order: 3, field_type: "text" }),
  ];
  const branches = [
    branch({ id: "connected", from_step_id: "start", from_option: "Conectado", to_step_id: "result" }),
    branch({ id: "quote", from_step_id: "result", from_option: "Cotización Enviada", to_step_id: "equifax" }),
  ];

  const catalog = buildCallReasonCatalogFromWorkflow(steps, branches);
  const quote = catalog.find((reason) => reason.value === "COTIZACION ENVIADA");
  assert.equal(quote?.requiresEquifaxData, true);
  assert.equal(quote?.agenda, "required");

  const errors = validateCallClosure(
    {
      status: "connected",
      outcome: "other",
      reason: "COTIZACION ENVIADA",
      notes: null,
      next_action_at: "2026-09-08T15:00:00.000Z",
      equifax_products: [],
      equifax_uf_amount: null,
      equifax_recipient_email: null,
      lead_email: null,
      contact_email: null,
    },
    catalog
  );
  assert.ok(errors.some((error) => error.includes("producto Equifax")));
  assert.ok(errors.some((error) => error.includes("UF mensual")));
  assert.ok(errors.some((error) => error.includes("email destinatario")));
});

test("database closure and revision scope Equifax validation by workflow or campaign", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260907170518_scope_equifax_call_closure_validation.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(migration, /public\.save_call_management/);
  assert.match(migration, /private\.revise_call_management/);
  assert.equal(migration.match(/\$new\$  if v_requires_equifax_data/g)?.length, 4);
  assert.equal(migration.match(/or \(v_requires_equifax_data and v_reason_norm = 'COTIZACION ENVIADA'\)/g)?.length, 2);
  assert.match(migration, /equifax_step\.workflow_id = v_workflow_id/);
  assert.match(migration, /equifax_campaign\.id = v_lead\.campaign_id/);
});

test("an empty choice workflow never produces a fallback catalog", () => {
  const steps = [step({ id: "start", name: "Llamada", is_start: true, options: [] })];
  assert.deepEqual(buildCallReasonCatalogFromWorkflow(steps, []), []);
});

test("workflow validation rejects empty choices and duplicate default branches", () => {
  const steps = [
    step({ id: "start", name: "Llamada", is_start: true, options: [] }),
    step({ id: "connected", name: "Conecta", step_order: 2 }),
    step({ id: "not-connected", name: "No Conecta", step_order: 3 }),
  ];
  const branches = [
    branch({ id: "one", from_step_id: "start", from_option: null, to_step_id: "connected" }),
    branch({ id: "two", from_step_id: "start", from_option: null, to_step_id: "not-connected" }),
  ];

  const errors = validateWorkflow(steps, branches).filter((issue) => issue.level === "error");
  assert.ok(errors.some((issue) => issue.message.includes("campo de selección sin opciones")));
  assert.ok(errors.some((issue) => issue.message.includes("salidas por defecto")));
});

test("a non-agenda typification rejects a stale hidden schedule", () => {
  const errors = validateCallClosure({
    status: "connected",
    outcome: "not_interested",
    reason: "NO CALIFICA",
    notes: null,
    next_action_at: "2026-08-10T16:00:00.000Z",
    equifax_products: [],
    equifax_uf_amount: null,
    equifax_recipient_email: null,
    lead_email: null,
    contact_email: null,
  });

  assert.ok(errors.some((error) => error.includes("no admite una agenda")));
});

test("agenda persistence includes the executive observation", () => {
  assert.deepEqual(
    buildCallAgendaPayload({
      callId: "call-1",
      leadId: "lead-1",
      nextActionAt: "2026-08-15T15:00:00.000Z",
      notes: "Cliente pidió revisar la propuesta antes de volver a llamar.",
    }),
    {
      callId: "call-1",
      leadId: "lead-1",
      nextActionAt: "2026-08-15T15:00:00.000Z",
      notes: "Cliente pidió revisar la propuesta antes de volver a llamar.",
    }
  );

  assert.equal(
    buildCallAgendaPayload({
      callId: "call-1",
      leadId: "lead-1",
      nextActionAt: "2026-08-15T15:00:00.000Z",
      notes: "   ",
    }).notes,
    null
  );
});
