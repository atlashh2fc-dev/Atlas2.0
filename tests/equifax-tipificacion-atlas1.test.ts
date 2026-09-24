import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  agendaSlotError,
  buildCallReasonCatalogFromWorkflow,
  describeAgendaPolicy,
  groupReasonsByState,
  readAgendaPolicy,
  validateCallClosure,
  type AgendaPolicy,
  type CallReasonConfig,
} from "../src/lib/call-typification.ts";
import { validateWorkflow } from "../src/lib/workflow-validation.ts";
import type { WorkflowStep, WorkflowStepBranch } from "../src/lib/types.ts";

const MIGRATION = readFileSync("supabase/migrations/20260924180000_tipificacion_equifax_igual_a_atlas1.sql", "utf8");
const RULES = readFileSync("supabase/migrations/20260924180100_agenda_habil_y_nota_como_atlas1.sql", "utf8");
const LEGACY = readFileSync("supabase/migrations/20260924180200_gestion_migrada_no_se_corrige.sql", "utf8");

// Los 24 motivos de Atlas 1 con su estado y resultado (tipificacion-atlas1-vs-atlas2.md).
const ATLAS1: Array<[string, string, string, string, CallReasonConfig["agenda"], boolean]> = [
  ["NO CONECTA", "NO CONTACTO", "no_answer", "other", "none", false],
  ["NO CONTESTA", "NO CONTACTO", "no_answer", "other", "none", false],
  ["BUZON DE VOZ", "NO CONTACTO", "voicemail", "other", "none", false],
  ["TELEFONO FUERA DE SERVICIO", "NO CONTACTO", "out_of_service", "other", "none", false],
  ["VOLVER A LLAMAR", "INTERESADO", "connected", "callback", "required", false],
  ["SE ENVIA INFORMACION", "INTERESADO", "connected", "interested", "optional", false],
  ["COTIZACION ENVIADA", "INTERESADO", "connected", "interested", "required", true],
  ["REUNION AGENDADA", "INTERESADO", "connected", "callback", "required", false],
  ["CONTACTO CON TERCERO", "INTERESADO", "connected", "interested", "none", false],
  ["VENTA EN VALIDACION", "INTERESADO", "connected", "sale", "none", true],
  ["NUMERO ERRONEO / NO CORRESPONDE", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["NO ENTREGA CREDITO / PAGO CONTADO", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["NO DA MOTIVO", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["TERCERO NO ENTREGA INFORMACION", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["NO CALIFICA", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["CLIENTE MOLESTO", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["CLIENTE CARTERIZADO", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["SE DECLARA EN QUIEBRA O PROCESO DE CIERRE", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["TIENE CONTRATO CON LA COMPETENCIA", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["CLIENTE NO SUJETO A VENTA", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["PRECIO MUY ALTO", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["SIN PRESUPUESTO", "NO INTERESADO", "connected", "not_interested", "none", false],
  ["NO ES EL MOMENTO", "NO INTERESADO", "connected", "callback", "required", false],
  ["DURACION CONTRATO", "NO INTERESADO", "connected", "not_interested", "none", false],
];

function quoted(text: string) {
  return [...text.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/**
 * Reconstruye el workflow tal como lo deja la migración: pasos, textos y ramas
 * salen del SQL, así que la prueba no puede quedar de acuerdo consigo misma
 * mientras la base queda distinta.
 */
function workflowFromMigration() {
  const arrays = new Map<string, string[]>();
  for (const match of MIGRATION.matchAll(/(v_opciones_\w+) text\[\] := array\[([\s\S]*?)\];/g)) {
    arrays.set(match[1], quoted(match[2]));
  }
  const values = MIGRATION.slice(MIGRATION.indexOf(") values"), MIGRATION.indexOf("on conflict (id)"));
  const steps: WorkflowStep[] = values
    .split(/\n {4}\(/)
    .slice(1)
    .map((row) => {
      const header = row.match(/^(v_\w+), v_workflow_id, (\d+), '([^']+)',\s+'([^']+)',\s+(true|false), '(\w+)', ([\s\S]+?),\s+(?:array\[[^\]]*\]|v_opciones_\w+|null), (-?\d+), (-?\d+), (true|false), (null|'\w+')\)/);
      assert.ok(header, `No se pudo leer la fila: ${row.slice(0, 80)}`);
      const [, id, order, name, description, mandatory, fieldType, optionsExpr, x, y, isStart] = header;
      const fromArray = optionsExpr.match(/to_jsonb\((v_opciones_\w+)\)/);
      const options = fromArray ? arrays.get(fromArray[1]) ?? [] : optionsExpr.includes("[]'") ? [] : quoted(optionsExpr.replace(/'(\[.*\])'::jsonb/, "$1").replace(/"/g, "'"));
      return {
        id,
        workflow_id: "equifax",
        step_order: Number(order),
        name,
        description,
        is_mandatory: mandatory === "true",
        allowed_results: options,
        field_type: fieldType as WorkflowStep["field_type"],
        options,
        pos_x: Number(x),
        pos_y: Number(y),
        is_start: isStart === "true",
        created_at: "2026-09-24T00:00:00.000Z",
      };
    });
  const branches: WorkflowStepBranch[] = [
    ...MIGRATION.matchAll(/\(v_workflow_id, (v_\w+), (null|'[^']+'), (v_\w+)\)/g),
  ].map((match, index) => ({
    id: `b${index}`,
    workflow_id: "equifax",
    from_step_id: match[1],
    from_option: match[2] === "null" ? null : match[2].slice(1, -1),
    to_step_id: match[3],
    created_at: "2026-09-24T00:00:00.000Z",
  }));
  return { steps, branches };
}

test("la ficha de Equifax ofrece exactamente los 24 motivos de Atlas 1", () => {
  const { steps, branches } = workflowFromMigration();
  assert.equal(steps.length, 7);
  const catalog = buildCallReasonCatalogFromWorkflow(steps, branches);

  assert.deepEqual(
    catalog.map((reason) => [
      reason.value,
      reason.stateLabel === "NO CONTACTO" ? "NO CONTACTO" : reason.resultLabel,
      reason.status,
      reason.outcome,
      reason.agenda,
      reason.requiresEquifaxData === true,
    ]),
    // El catálogo ordena CONTACTO antes que NO CONTACTO, igual que el paso inicial.
    [...ATLAS1.slice(4), ...ATLAS1.slice(0, 4)]
  );
  assert.equal(new Set(catalog.map((reason) => reason.value)).size, 24);

  // Mismo árbol que Atlas 1: CONTACTO > INTERESADO / NO INTERESADO, y NO CONTACTO plano.
  const groups = groupReasonsByState(catalog).map((state) => [
    state.label,
    [...new Set(state.reasons.map((reason) => (reason.groupPath ?? []).join(" > ")))],
  ]);
  assert.deepEqual(groups, [
    ["CONTACTO", ["INTERESADO", "NO INTERESADO"]],
    ["NO CONTACTO", [""]],
  ]);

  // Sin agenda, SE ENVIA INFORMACION pide nota; con agenda, no.
  const info = catalog.find((reason) => reason.value === "SE ENVIA INFORMACION");
  assert.equal(info?.notesRequiredWithoutAgenda, true);
  assert.equal(catalog.filter((reason) => reason.notesRequiredWithoutAgenda).length, 1);
});

test("el flujo migrado es válido en el editor y declara el contrato Equifax", () => {
  const { steps, branches } = workflowFromMigration();
  assert.deepEqual(validateWorkflow(steps, branches), []);
  assert.equal(steps.filter((step) => step.is_start).length, 1);
  // management_requires_equifax_data busca EQUIFAX en nombre o descripción de un paso.
  assert.ok(steps.some((step) => /EQUIFAX/i.test(step.name)));

  // Ningún texto de paso nombra un motivo: la ficha deduce el motivo del paso
  // hoja y así se perdían «NO ES EL MOMENTO» y «CORTA LLAMADA».
  const normalize = (value: string) =>
    value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
  for (const step of steps) {
    const text = normalize(`${step.name} ${step.description ?? ""}`);
    for (const [reason] of ATLAS1) {
      assert.ok(!text.includes(normalize(reason)), `«${step.name}» nombra ${reason}`);
    }
    for (const word of ["VENTA", "FUERA", "BUZON", "NO CONTESTA", "NO CONECTA"]) {
      assert.ok(!text.includes(word), `«${step.name}» contiene ${word}`);
    }
  }
});

test("la migración conserva los pasos con historial y no borra sin re-enlazar", () => {
  for (const id of [
    "ec99311b-b55b-46db-93c8-58058022a860",
    "47dc1b71-08b4-48d2-94c0-243c3665b169",
    "22146982-235c-4b0f-a13c-8ccd4a2dbe12",
  ]) {
    assert.match(MIGRATION, new RegExp(`v_kept uuid\\[\\] := array\\[[\\s\\S]*'${id}'`));
  }
  const relink = MIGRATION.indexOf("update public.interactions");
  const removal = MIGRATION.indexOf("delete from public.workflow_steps");
  assert.ok(relink > 0 && removal > relink, "las interacciones se re-enlazan antes de borrar pasos");
  assert.match(MIGRATION, /on conflict \(id\) do update/);
  // Sin result_kind: el tablero sigue contando NUMERO ERRONEO como NO CONTACTO.
  assert.doesNotMatch(MIGRATION, /'(no_interesado|interesado|no_contacto)'/);
});

test("una negación nunca se lee como venta", () => {
  const steps = [
    { id: "s", name: "Estado", is_start: true, options: ["Conecta"] },
    { id: "r", name: "Resultado", options: ["Venta", "Cliente no sujeto a venta", "Sin venta", "No interesa la venta", "No es venta aún"] },
  ].map((step) => ({ description: null, field_type: "combobox", allowed_results: step.options, is_start: false, step_order: 1, ...step }) as unknown as WorkflowStep);
  const catalog = buildCallReasonCatalogFromWorkflow(steps, [
    { from_step_id: "s", from_option: "Conecta", to_step_id: "r" } as WorkflowStepBranch,
  ]);
  const outcome = (value: string) => catalog.find((reason) => reason.value === value)?.outcome;
  assert.equal(outcome("VENTA"), "sale");
  assert.equal(outcome("CLIENTE NO SUJETO A VENTA"), "other");
  assert.equal(outcome("SIN VENTA"), "other");
  assert.equal(outcome("NO INTERESA LA VENTA"), "not_interested");
  assert.equal(outcome("NO ES VENTA AUN"), "other");
});

const EQUIFAX_POLICY: AgendaPolicy = { weekdays: [1, 2, 3, 4, 5], from: "09:00", until: "19:00" };
// Jueves 24-09-2026 a las 12:00 en Chile (UTC-3).
const NOW = new Date("2026-09-24T15:00:00.000Z");

test("la agenda de Equifax cae de lunes a viernes, de 09:00 a 19:00 hora Chile, y en el futuro", () => {
  assert.deepEqual(
    readAgendaPolicy({ agenda_dias_habiles: [5, 1, 2, 3, 4], agenda_hora_desde: "09:00:00", agenda_hora_hasta: "19:00:00" }),
    EQUIFAX_POLICY
  );
  assert.equal(readAgendaPolicy({ agenda_dias_habiles: null, agenda_hora_desde: null, agenda_hora_hasta: null }), null);
  assert.equal(
    describeAgendaPolicy(EQUIFAX_POLICY),
    "lunes, martes, miércoles, jueves y viernes, desde las 09:00 y antes de las 19:00 (hora Chile)"
  );

  const slot = (iso: string) => agendaSlotError(iso, EQUIFAX_POLICY, NOW);
  assert.equal(slot("2026-09-24T18:00:00.000Z"), null); // jueves 15:00
  assert.equal(slot("2026-09-25T12:00:00.000Z"), null); // viernes 09:00 en punto
  assert.equal(slot("2026-09-25T21:59:00.000Z"), null); // viernes 18:59
  assert.match(slot("2026-09-25T22:00:00.000Z") ?? "", /antes de las 19:00/); // viernes 19:00
  assert.match(slot("2026-09-25T11:30:00.000Z") ?? "", /desde las 09:00/); // viernes 08:30
  assert.match(slot("2026-09-27T15:00:00.000Z") ?? "", /día hábil/); // domingo
  assert.match(slot("2026-09-26T15:00:00.000Z") ?? "", /día hábil/); // sábado
  assert.match(slot("2026-09-24T14:00:00.000Z") ?? "", /futura/); // jueves 11:00, ya pasó
  // Viernes 23:30 en Chile es sábado en UTC: manda la hora de Chile.
  assert.match(slot("2026-09-26T02:30:00.000Z") ?? "", /antes de las 19:00/);

  // Sin franja declarada no se restringe nada: así siguen las demás campañas.
  assert.equal(agendaSlotError("2026-09-27T03:00:00.000Z", null, NOW), null);
});

test("el cierre valida franja y nota solo donde corresponde", () => {
  const { steps, branches } = workflowFromMigration();
  const catalog = buildCallReasonCatalogFromWorkflow(steps, branches);
  const close = (reason: string, overrides: Record<string, unknown> = {}, options = {}) => {
    const config = catalog.find((item) => item.value === reason)!;
    return validateCallClosure(
      {
        status: config.status,
        outcome: config.outcome,
        reason,
        notes: null,
        next_action_at: null,
        equifax_products: [],
        equifax_uf_amount: null,
        equifax_recipient_email: null,
        ...overrides,
      },
      catalog,
      { agendaPolicy: EQUIFAX_POLICY, now: NOW, ...options }
    );
  };

  assert.deepEqual(close("SE ENVIA INFORMACION"), ["Sin agenda, SE ENVIA INFORMACION exige una nota con lo enviado."]);
  assert.deepEqual(close("SE ENVIA INFORMACION", { notes: "Brochure RI a finanzas@empresa.cl" }), []);
  assert.deepEqual(close("SE ENVIA INFORMACION", { next_action_at: "2026-09-25T13:00:00.000Z" }), []);
  assert.deepEqual(close("VOLVER A LLAMAR", { next_action_at: "2026-09-27T13:00:00.000Z" }), [
    "La agenda debe caer en un día hábil de la campaña (lunes, martes, miércoles, jueves y viernes).",
  ]);
  assert.deepEqual(close("CLIENTE NO SUJETO A VENTA"), []);
  // Al corregir, la agenda que ya tenía la gestión no se vuelve a juzgar.
  assert.deepEqual(
    close("VOLVER A LLAMAR", { next_action_at: "2026-09-20T13:00:00.000Z" }, { previousNextActionAt: "2026-09-20T13:00:00.000Z" }),
    []
  );
});

test("la base aplica las mismas reglas en el cierre y en la corrección", () => {
  // Franja por campaña, nula por defecto: las demás campañas no cambian.
  assert.match(RULES, /add column if not exists agenda_dias_habiles smallint\[\]/);
  assert.match(RULES, /add column if not exists agenda_hora_desde time/);
  assert.match(RULES, /add column if not exists agenda_hora_hasta time/);
  assert.doesNotMatch(RULES, /agenda_hora_desde time (not null|default)/);
  assert.match(RULES, /where id = '318cf37a-da42-4cbd-934d-bdc47753d7bd'/);
  assert.match(RULES, /America\/Santiago/);
  // Las dos RPC se parchean sobre la definición viva y abortan si no coincide.
  assert.match(RULES, /public\.save_call_management\(uuid,uuid,text,text,text,text,timestamp with time zone,text,text\[\],numeric,text\)/);
  assert.match(RULES, /private\.revise_call_management\(uuid,uuid,text,text,text,text,timestamp with time zone,text\[\],numeric,text\)/);
  assert.match(RULES, /raise exception[\s\S]*no coincide con la versión esperada/);
  // La nota se exige con la misma condición que en TypeScript.
  assert.match(RULES, /ENVIA INFORMACION%/);
  assert.match(RULES, /ENVIAR INFORMACION%/);

  // Corregir una gestión traída de Atlas 1 queda bloqueado en la base.
  assert.match(LEGACY, /legacy_call_id is not null/);
  assert.match(LEGACY, /private\.revise_call_management/);
});
