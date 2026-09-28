import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isPendingManagementError,
  resolveCallManagementNavigation,
  resolveManualCallManagementAction,
} from "../src/lib/call-management-navigation.ts";

test("an assigned mail lead already open refreshes instead of pushing the same route", () => {
  assert.deepEqual(
    resolveCallManagementNavigation("/dashboard/leads/lead-mail", "lead-mail"),
    { kind: "refresh" }
  );
});

test("an assigned mail lead opened elsewhere navigates once to its typification", () => {
  assert.deepEqual(
    resolveCallManagementNavigation("/dashboard/mail", "lead-mail"),
    {
      kind: "push",
      href: "/dashboard/leads/lead-mail?tipificar=1",
    }
  );
});

test("lead ids are encoded before building the management route", () => {
  assert.deepEqual(
    resolveCallManagementNavigation("/dashboard/mail", "lead/id"),
    {
      kind: "push",
      href: "/dashboard/leads/lead%2Fid?tipificar=1",
    }
  );
});

test("an unanswered originated call remains open for a no-contact typification", () => {
  assert.equal(resolveManualCallManagementAction("not_answered"), "open_typification");
});

test("an answered call remains open for its final typification", () => {
  assert.equal(resolveManualCallManagementAction("answered"), "open_typification");
});

test("only an origination failure discards the technical management", () => {
  assert.equal(resolveManualCallManagementAction("origination_failed"), "discard");
});

test("los rechazos por otra gestión abierta se reconocen para llevar al ejecutivo a ella", () => {
  assert.equal(isPendingManagementError("Tienes una gestión pendiente de tipificación. Ciérrala antes de llamar."), true);
  assert.equal(isPendingManagementError("Tienes una gestión pendiente de tipificación. Ciérrala antes de llamar desde tu agenda."), true);
  assert.equal(isPendingManagementError("Completa primero la llamada activa antes de corregir una gestión anterior."), true);
  assert.equal(isPendingManagementError("No puedes corregir una gestión mientras tienes una llamada o tipificación en curso."), true);
  assert.equal(isPendingManagementError("Este número ya tiene una llamada en curso."), false);
  assert.equal(isPendingManagementError(null), false);
});

// 28-09-2026: un compromiso agendado abría la ficha antes de que existiera la
// llamada. Al colgar no se recargaba, «Completar» quedaba oculto por la URL y
// el ejecutivo sólo tenía botones que la base rechaza (loop «gestión
// pendiente» ↔ «completa primero la llamada activa»).
test("the phone follows the open management in the database, not the URL", () => {
  const page = readFileSync(new URL("../src/app/dashboard/leads/[id]/page.tsx", import.meta.url), "utf8");
  const cti = readFileSync(new URL("../src/components/cti-bar.tsx", import.meta.url), "utf8");

  assert.match(page, /id="gestion-en-curso"\s*\{\.\.\.\{ \[OPEN_CALL_FORM_ATTRIBUTE\]: call\.id \}\}/);
  assert.match(page, /!call && !otherOpenManagement && \(canOperateAssigned/);
  assert.match(cti, /isOpenCallFormOnScreen\(openManagement\.callId\)/);
  assert.match(cti, /!activeCall &&\s*!openFormOnScreen;/);
  assert.doesNotMatch(cti, /pathname !== `\/dashboard\/leads\/\$\{openManagement\.leadId\}`;/);
  assert.equal((cti.match(/openAutomaticManagement\([a-zA-Z]+Context, true\)/g) ?? []).length, 2);
});
