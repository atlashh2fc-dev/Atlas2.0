import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { buildCallReasonCatalogFromWorkflow } from "../src/lib/call-typification.ts";
import type { WorkflowStep, WorkflowStepBranch } from "../src/lib/types.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const migrationNames = readdirSync(MIGRATIONS_DIR).sort();
const migrations = migrationNames.map((name) => ({
  name,
  sql: readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8"),
}));

/** Última definición aplicada de una función, en orden de migración. */
function latestDefinition(functionName: string) {
  const marker = new RegExp(`create or replace function [a-z_]+\\.${functionName}\\(`);
  const owner = [...migrations].reverse().find((migration) => marker.test(migration.sql));
  assert.ok(owner, `Ninguna migración define ${functionName}`);
  const start = owner.sql.search(marker);
  return owner.sql.slice(start);
}

test("el trigger de consistencia de agenda no vuelve a hardcodear tipificaciones", () => {
  const trigger = latestDefinition("enforce_closed_call_agenda_consistency");
  const body = trigger.slice(0, trigger.indexOf("$function$;") + 11);

  // La causa raíz del bloqueo en Secretaria Virtual: el trigger exigía agenda
  // para COTIZACION ENVIADA en toda campaña, mientras las RPC ya la habían
  // acotado al contrato Equifax. La regla ahora vive en un solo lugar.
  assert.doesNotMatch(body, /COTIZACION/);
  assert.match(body, /lead_agenda_requirement/);
  assert.match(body, /management_agenda_requirement/);
});

test("las RPC de cierre y corrección consumen la misma fuente de verdad", () => {
  const unification = migrations.find((migration) =>
    migration.name.endsWith("unify_agenda_requirement_source_of_truth.sql")
  );
  assert.ok(unification);
  assert.match(unification.sql, /save_call_management/);
  assert.match(unification.sql, /revise_call_management/);
  // Si la definición viva no es la esperada, la migración aborta en vez de
  // dejar la mitad de las capas con la regla vieja.
  assert.match(unification.sql, /raise exception[\s\S]*no coincide con la versión esperada/);
});

test("la regla SQL de agenda es espejo del catálogo TypeScript", () => {
  const requirement = latestDefinition("management_agenda_requirement");
  for (const fragment of [
    "VOLVER A LLAMAR",
    "REUNION",
    "NO ES EL MOMENTO",
    "COMPROMISO DE PAGO",
    "NEGOCIACION EN CURSO",
  ]) {
    assert.match(requirement, new RegExp(`${fragment}[\\s\\S]*?'required'`));
  }
  assert.match(requirement, /COTIZACION[\s\S]*?'required'[\s\S]*?'optional'/);

  const step = (input: Partial<WorkflowStep> & { id: string; name: string }): WorkflowStep =>
    ({
      description: null,
      field_type: "combobox",
      options: [],
      allowed_results: [],
      is_start: false,
      step_order: 1,
      ...input,
    }) as unknown as WorkflowStep;
  const branch = (input: {
    from_step_id: string;
    from_option: string | null;
    to_step_id: string;
  }): WorkflowStepBranch => input as unknown as WorkflowStepBranch;

  const secretariaVirtual = buildCallReasonCatalogFromWorkflow(
    [
      step({ id: "start", name: "Estado", is_start: true, options: ["Conecta"] }),
      step({ id: "result", name: "Resultado", options: ["Cotización Enviada", "Volver a Llamar"] }),
    ],
    [branch({ from_step_id: "start", from_option: "Conecta", to_step_id: "result" })]
  );

  assert.equal(
    secretariaVirtual.find((reason) => reason.value === "COTIZACION ENVIADA")?.agenda,
    "optional"
  );
  assert.equal(
    secretariaVirtual.find((reason) => reason.value === "VOLVER A LLAMAR")?.agenda,
    "required"
  );
});
