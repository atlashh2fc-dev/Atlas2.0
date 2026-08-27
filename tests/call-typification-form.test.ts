import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import ts from "typescript";
import * as typification from "../src/lib/call-typification.ts";

const require = createRequire(import.meta.url);
const catalog = [
  ...typification.CALL_REASONS.filter((r) => ["NO CONTESTA", "BUZON DE VOZ", "VOLVER A LLAMAR", "NO CALIFICA"].includes(r.value)),
  { ...typification.CALL_REASONS.find((r) => r.value === "REUNION AGENDADA")!, value: "AGENDA REUNION", label: "Agenda reunión" },
];
type Element = React.ReactElement<Record<string, unknown>>;

// Execute the production component's handlers and state transitions. Only the
// browser/router and server actions are replaced; no database or phone is used.
function fixture(options: { revision?: boolean; legal?: boolean; breakActive?: boolean; empty?: boolean } = {}) {
  const slots: unknown[] = [];
  let cursor = 0;
  const submissions: Record<string, unknown>[] = [];
  const navigations: string[] = [];
  let release: ((result: { ok: boolean; error?: string }) => void) | undefined;
  let revisionCount = 0;
  let closedEvents = 0;
  const slot = (initial: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next: unknown) => {
      slots[index] = typeof next === "function" ? next(slots[index]) : next;
    }];
  };
  const dependencies: Record<string, unknown> = {
    react: { ...React, useState: slot, useRef: (initial: unknown) => slot({ current: initial })[0], useMemo: (fn: () => unknown) => fn(), useEffect: () => {}, useId: () => "fixture" },
    "next/navigation": { useRouter: () => ({ push: (url: string) => navigations.push(url), refresh: () => {} }) },
    "@/lib/call-typification": typification,
    "@/lib/agent-control": { notifyAgentManagementClosed: () => { closedEvents++; } },
    "@/lib/intercall-break": { readLegalIntercallBreakUntil: () => options.breakActive ? Date.now() + 10000 : 0 },
    "@/components/appointment-schedule-embed": { AppointmentScheduleEmbed: "calendar-fixture" },
    "@/app/actions/calls": {
      closeCall: (payload: Record<string, unknown>) => {
        submissions.push(payload);
        return new Promise((resolve) => { release = resolve; });
      },
      reviseCallManagement: async (payload: Record<string, unknown>) => { revisionCount++; submissions.push(payload); return { ok: true }; },
      discardCallTechnicalError: () => { throw new Error("Unexpected discard"); },
    },
  };
  const source = readFileSync(new URL("../src/components/call-typification-form.tsx", import.meta.url), "utf8");
  const componentModule = { exports: {} as { CallTypificationForm: (props: unknown) => Element } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: componentModule.exports, module: componentModule,
    require: (name: string) => dependencies[name] ?? require(name),
    window: { location: { assign: (url: string) => navigations.push(url) } },
    console, Date,
  });
  const props = {
    lead: { id: "lead-test", email: null, observacion_actual: null },
    call: { id: "call-test", reason: null, status: null, outcome: null, notes: null, next_action_at: null },
    reasonCatalog: options.empty ? [] : catalog,
    appointmentScheduleUrl: options.legal === false ? null : "https://calendar.example.test",
    revision: options.revision ?? false,
  };
  let tree: Element;
  function render() { cursor = 0; tree = componentModule.exports.CallTypificationForm(props); }
  function all(predicate: (element: Element) => boolean) {
    const result: Element[] = [];
    function visit(value: unknown) {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!React.isValidElement(value)) return;
      const element = value as Element;
      if (predicate(element)) result.push(element);
      visit(element.props.children);
    }
    visit(tree);
    return result;
  }
  function one(predicate: (element: Element) => boolean) { const matches = all(predicate); assert.equal(matches.length, 1); return matches[0]; }
  const button = (label: string) => one((e) => e.type === "button" && (e.props["aria-label"] === label || e.props.children === label));
  const click = (label: string) => { (button(label).props.onClick as () => void)(); render(); };
  const change = (type: string, value: string) => { (one((e) => e.type === type || e.props.type === type).props.onChange as (event: unknown) => void)({ target: { value } }); render(); };
  const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); render(); };
  render();
  return { all, one, button, click, change, flush, submissions, navigations, render,
    get root() { return tree; },
    get closedEvents() { return closedEvents; }, get revisionCount() { return revisionCount; },
    finish(ok = true) { assert.ok(release); release({ ok, error: ok ? undefined : "Finaliza la llamada antes de cerrar la gestión." }); },
  };
}

test("legal: one-click close uses clicked reason, preserves notes, clears stale agenda", async () => {
  const f = fixture();
  f.click("Volver a llamar");
  f.change("datetime-local", "2026-09-03T11:00");
  f.change("textarea", "Observación de esta llamada");
  f.click("Cerrar: No contesta");
  assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0].reason, "NO CONTESTA");
  assert.equal(f.submissions[0].status, "no_answer");
  assert.equal(f.submissions[0].outcome, "other");
  assert.equal(f.submissions[0].notes, "Observación de esta llamada");
  assert.equal(f.submissions[0].next_action_at, null);
  assert.equal(f.one((e) => e.type === "fieldset").props.disabled, true);
  f.click("Cerrar: Buzon de voz");
  assert.equal(f.submissions.length, 1);
  f.finish(); await f.flush();
  assert.deepEqual(f.navigations, ["/dashboard/leads"]);
  assert.equal(f.closedEvents, 1);
  assert.equal(f.one((e) => e.type === "fieldset").props.disabled, true);
});

test("legal: simplification preserves calendar opening, closing and reopening for every agenda reason", () => {
  for (const label of ["Volver a llamar", "Agenda reunión"]) {
    const f = fixture();
    f.click(label);
    let calendar = f.one((e) => e.type === "calendar-fixture");
    assert.equal(calendar.props.open, true);
    assert.equal(calendar.props.url, "https://calendar.example.test");
    (calendar.props.onOpenChange as (open: boolean) => void)(false); f.render();
    calendar = f.one((e) => e.type === "calendar-fixture");
    assert.equal(calendar.props.open, false);
    f.click(label);
    calendar = f.one((e) => e.type === "calendar-fixture");
    assert.equal(calendar.props.open, true);
    assert.equal(f.submissions.length, 0, "Opening a calendar must never close the call");
  }
});

test("agenda cannot close without date and has no quick-close bypass", async () => {
  const f = fixture();
  assert.equal(f.all((e) => e.props["aria-label"] === "Cerrar: Volver a llamar").length, 0);
  f.click("Volver a llamar"); f.click("Guardar y cerrar");
  assert.equal(f.submissions.length, 0);
  assert.ok(f.all((e) => e.type === "li" && String(e.props.children).includes("fecha y hora")).length);
  f.change("datetime-local", "2026-09-03T11:00"); f.click("Guardar y cerrar");
  assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0].next_action_at, new Date("2026-09-03T11:00").toISOString());
  f.finish(); await f.flush();
});

test("server refusal unlocks without navigating or losing the selected reason", async () => {
  const f = fixture(); f.change("textarea", "Conservar"); f.click("Cerrar: No contesta");
  f.finish(false); await f.flush();
  assert.deepEqual(f.navigations, []);
  assert.equal(f.closedEvents, 0);
  assert.equal(f.button("No contesta").props["aria-pressed"], true);
  assert.equal(f.one((e) => e.type === "textarea").props.value, "Conservar");
  assert.equal(f.one((e) => e.type === "fieldset").props.disabled, false);
  f.click("Guardar y cerrar"); assert.equal(f.submissions.length, 2);
  f.finish(); await f.flush();
});

test("pause, empty workflow, other campaigns and revision cannot use legal quick close", async () => {
  for (const options of [{ breakActive: true }, { empty: true }]) {
    const f = fixture(options); f.click("Guardar y cerrar"); assert.equal(f.submissions.length, 0);
    assert.equal(f.one((e) => e.type === "fieldset").props.disabled, true);
  }
  for (const options of [{ legal: false }, { revision: true }]) {
    const f = fixture(options);
    assert.equal(f.all((e) => String(e.props["aria-label"]).startsWith("Cerrar:")).length, 0);
  }
  const f = fixture({ revision: true }); f.click("No contesta"); f.click("Guardar corrección"); await f.flush();
  assert.equal(f.revisionCount, 1); assert.equal(f.closedEvents, 0);
  assert.deepEqual(f.navigations, ["/dashboard/leads/lead-test"]);
});

test("Ctrl/Command + Enter closes once; repeated keys and an open reservation do not submit", () => {
  const f = fixture(); f.click("No contesta");
  const key = (repeat = false) => (f.root.props.onKeyDown as (event: unknown) => void)({ ctrlKey: true, key: "Enter", repeat, preventDefault() {} });
  key(true); assert.equal(f.submissions.length, 0);
  key(); key(); assert.equal(f.submissions.length, 1);
  const meeting = fixture(); meeting.click("Agenda reunión");
  (meeting.root.props.onKeyDown as (event: unknown) => void)({ metaKey: true, key: "Enter", preventDefault() {} });
  assert.equal(meeting.submissions.length, 0);
});

test("active management is rendered before imported campaign fields and is keyed by call", () => {
  const page = readFileSync(new URL("../src/app/dashboard/leads/[id]/page.tsx", import.meta.url), "utf8");
  assert.ok(page.indexOf("<CallTypificationForm") < page.indexOf("{campaignData.length > 0"));
  assert.match(page, /key=\{call.id\}/);
});
