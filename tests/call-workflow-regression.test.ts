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
  // Fuera de Equifax la cotización admite seguimiento y no lo exige. Marcarla
  // como "none" dejaba la gestión sin salida: la UI ocultaba la fecha que el
  // trigger de la base exigía para cerrar.
  assert.equal(catalog.find((reason) => reason.value === "COTIZACION ENVIADA")?.agenda, "optional");
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

  assert.deepEqual(
    validateCallClosure(
      {
        status: "connected",
        outcome: "other",
        reason: "COTIZACION ENVIADA",
        notes: null,
        next_action_at: "2026-09-11T13:00:00.000Z",
        equifax_products: [],
        equifax_uf_amount: null,
        equifax_recipient_email: null,
        lead_email: null,
        contact_email: null,
      },
      catalog
    ),
    [],
    "Secretaria Virtual must accept a follow-up date on a sent quote"
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

test("a start mark left on an intermediate step still builds the cascade from its root", () => {
  // Secretaria Virtual, 2026-09-11: «Conecta» quedó marcado como inicio.
  const steps = [
    step({ id: "call", name: "Llamada", options: ["Conecta", "No Conecta"] }),
    step({
      id: "connected",
      name: "Conecta",
      step_order: 3,
      is_start: true,
      field_type: "combobox",
      options: ["Volver a Llamar", "Contrata Servicio", "No Interesa"],
    }),
    step({
      id: "not-connected",
      name: "No Conecta",
      step_order: 4,
      field_type: "combobox",
      options: ["No Contesta", "Buzón de Voz", "Teléfono Fuera de Servicio"],
    }),
    step({
      id: "not-interested",
      name: "No Interesa",
      step_order: 5,
      field_type: "combobox",
      options: ["No lo Necesita", "Ya tiene el servicio"],
    }),
  ];
  const branches = [
    branch({ id: "e1", from_step_id: "call", from_option: "Conecta", to_step_id: "connected" }),
    branch({ id: "e2", from_step_id: "call", from_option: "No Conecta", to_step_id: "not-connected" }),
    branch({ id: "e3", from_step_id: "connected", from_option: "No Interesa", to_step_id: "not-interested" }),
  ];

  const byValue = new Map(buildCallReasonCatalogFromWorkflow(steps, branches).map((reason) => [reason.value, reason]));

  assert.equal(byValue.get("VOLVER A LLAMAR")?.stateLabel, "CONTACTO");
  assert.equal(byValue.get("VOLVER A LLAMAR")?.status, "connected");
  assert.equal(byValue.get("VOLVER A LLAMAR")?.outcome, "callback");
  assert.equal(byValue.get("NO CONTESTA")?.status, "no_answer");
  assert.equal(byValue.get("BUZON DE VOZ")?.status, "voicemail");
  assert.equal(byValue.get("TELEFONO FUERA DE SERVICIO")?.status, "out_of_service");
  assert.equal(byValue.get("CONTRATA SERVICIO")?.status, "connected");
  assert.equal(byValue.get("YA TIENE EL SERVICIO")?.status, "connected");
  assert.equal(byValue.get("YA TIENE EL SERVICIO")?.outcome, "not_interested");

  const errors = validateWorkflow(steps, branches).filter((issue) => issue.level === "error");
  assert.ok(errors.some((issue) => issue.stepId === "connected" && issue.message.includes("marcado como inicio")));
});

test("Secretaria Virtual 2026-10-01: la opción no se pierde por una mayúscula ni por un paso a medio armar", () => {
  const base = [
    step({ id: "call", name: "Llamada", is_start: true, options: ["Conecta", "No Conecta"] }),
    step({
      id: "connected",
      name: "Conecta",
      field_type: "combobox",
      // La opción se corrigió a «No interesa»; la conexión quedó como «No Interesa».
      options: ["Volver a llamar", "Cotización Enviada", "No interesa"],
    }),
    step({ id: "not-connected", name: "No Conecta", field_type: "combobox", options: ["No Contesta"] }),
    step({ id: "not-interested", name: "No Interesa", field_type: "combobox", options: ["Por precio"] }),
  ];
  const branches = [
    branch({ id: "e1", from_step_id: "call", from_option: "Conecta", to_step_id: "connected" }),
    branch({ id: "e2", from_step_id: "call", from_option: "No Conecta", to_step_id: "not-connected" }),
    branch({ id: "e3", from_step_id: "connected", from_option: "No Interesa", to_step_id: "not-interested" }),
    branch({ id: "e4", from_step_id: "connected", from_option: "Cotización Enviada", to_step_id: "sale" }),
  ];

  // Paso de selección sin opciones: la opción sigue siendo el cierre.
  const empty = [...base, step({ id: "sale", name: "Venta en Validación" })];
  const values = buildCallReasonCatalogFromWorkflow(empty, branches).map((reason) => reason.value);
  assert.ok(values.includes("COTIZACION ENVIADA"));
  assert.ok(!values.includes("VENTA EN VALIDACION"));
  assert.ok(values.includes("POR PRECIO"), "la conexión «No Interesa» vale para la opción «No interesa»");
  assert.ok(!values.includes("NO INTERESA"));

  const emptyIssues = validateWorkflow(empty, branches);
  assert.deepEqual(
    emptyIssues.map((issue) => [issue.level, issue.kind, issue.stepId]),
    [["error", "no_options", "sale"]]
  );

  // Con una opción en el paso, «Cotización Enviada» pasa a ser un grupo y deja
  // de poder elegirse: el editor lo avisa sobre la conexión que lo causa.
  const filled = [...base, step({ id: "sale", name: "Venta en Validación", options: ["venta en validación"] })];
  const filledValues = buildCallReasonCatalogFromWorkflow(filled, branches).map((reason) => reason.value);
  assert.ok(!filledValues.includes("COTIZACION ENVIADA"));
  assert.deepEqual(
    validateWorkflow(filled, branches).map((issue) => [issue.level, issue.kind, issue.option, issue.branchId]),
    [["warning", "hidden_closure", "Cotización Enviada", "e4"]]
  );

  // Una conexión cuya opción ya no existe se identifica una a una.
  const orphan = validateWorkflow(filled, [
    ...branches,
    branch({ id: "e5", from_step_id: "connected", from_option: "Contrata", to_step_id: "not-connected" }),
  ]).filter((issue) => issue.kind === "orphan_branch");
  assert.deepEqual(orphan.map((issue) => [issue.level, issue.option, issue.branchId]), [["error", "Contrata", "e5"]]);
});

test("Secretaria Virtual 2026-10-01: un motivo repetido en dos ramas se valida contra la rama elegida", () => {
  const steps = [
    step({ id: "call", name: "Llamada", is_start: true, options: ["Conecta", "No Conecta"] }),
    step({ id: "con", name: "Conecta", field_type: "combobox", options: ["Cotización Enviada", "No interesa"] }),
    step({ id: "nocon", name: "No Conecta", field_type: "combobox", options: ["No Contesta"] }),
    step({ id: "noint", name: "No Interesa", field_type: "combobox", options: ["No lo Necesita", "Ya tiene el servicio"] }),
    step({ id: "acepta", name: "Acepta", options: ["Si", "No"] }),
    step({ id: "venta", name: "Venta en validación", options: ["Venta en Validación"] }),
    step({ id: "rechazo", name: "Rechazo", options: ["Precio", "Ya tiene el servicio"] }),
  ];
  const branches = [
    branch({ id: "e1", from_step_id: "call", from_option: "Conecta", to_step_id: "con" }),
    branch({ id: "e2", from_step_id: "call", from_option: "No Conecta", to_step_id: "nocon" }),
    branch({ id: "e3", from_step_id: "con", from_option: "No Interesa", to_step_id: "noint" }),
    branch({ id: "e4", from_step_id: "con", from_option: "Cotización Enviada", to_step_id: "acepta" }),
    branch({ id: "e5", from_step_id: "acepta", from_option: "Si", to_step_id: "venta" }),
    branch({ id: "e6", from_step_id: "acepta", from_option: "No", to_step_id: "rechazo" }),
  ];
  const catalog = buildCallReasonCatalogFromWorkflow(steps, branches);
  const repeated = catalog.filter((reason) => reason.value === "YA TIENE EL SERVICIO");
  assert.equal(repeated.length, 2);

  for (const option of repeated) {
    const errors = validateCallClosure(
      {
        status: option.status,
        outcome: option.outcome,
        reason: option.value,
        notes: "no lo necesita",
        next_action_at: null,
        equifax_products: [],
        equifax_uf_amount: null,
        equifax_recipient_email: null,
        lead_email: null,
        contact_email: null,
      },
      catalog
    );
    assert.deepEqual(errors, [], `rama ${(option.groupPath ?? []).join(" > ")}`);
  }
});

test("«Contesta IA» es no contacto como el buzón, no una llamada conectada", () => {
  const steps = [
    step({ id: "start", name: "Llamada", is_start: true, options: ["Conecta", "No Conecta"] }),
    step({ id: "connected", name: "Conecta", step_order: 2, options: ["Volver a Llamar"] }),
    step({
      id: "not-connected",
      name: "No Conecta",
      step_order: 3,
      field_type: "combobox",
      options: ["No Contesta", "Buzón de Voz", "Contesta IA", "Teléfono Fuera de Servicio"],
    }),
  ];
  const branches = [
    branch({ id: "e1", from_step_id: "start", from_option: "Conecta", to_step_id: "connected" }),
    branch({ id: "e2", from_step_id: "start", from_option: "No Conecta", to_step_id: "not-connected" }),
  ];

  const ia = buildCallReasonCatalogFromWorkflow(steps, branches).find((reason) => reason.value === "CONTESTA IA");
  assert.ok(ia, "la opción llega a la ficha");
  assert.equal(ia.status, "voicemail");
  assert.equal(ia.stateLabel, "NO CONTACTO");
  assert.equal(ia.agenda, "none");
});
