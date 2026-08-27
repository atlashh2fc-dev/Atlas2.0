import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as labels from "../src/lib/quality-recording-labels.ts";
import type { Column } from "../src/components/ui/data-table.tsx";
import type { QualityRecordingRow } from "../src/lib/quality-recordings.ts";

const require = createRequire(import.meta.url);
const dependencies: Record<string, unknown> = {
  "next/navigation": { useRouter: () => ({ push() {} }), useSearchParams: () => new URLSearchParams("campaign=fixture") },
  "next/link": { __esModule: true, default: "a" },
  "@/lib/quality-recording-labels": labels,
  "@/lib/utils": { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
  "@/lib/persistent-state": { usePersistentState: (_key: string, initial: unknown) => [initial, () => {}] },
  "@/lib/metric-definitions": { metricDefinition: (id: string) => ({ label: id }) },
  "./button": { buttonClasses: () => "button" },
  "./info-tooltip": { InfoTooltip: () => null },
  "./loading-state": { LoadingState: () => null },
  "@/components/ui": { DataTable: "table-fixture", Badge: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children) },
  "@/components/recording-audio-player": { RecordingAudioPlayer: "audio-fixture" },
  "@/components/recording-quality-evaluation-control": { RecordingQualityEvaluationControl: "evaluation-fixture" },
  "@/components/recording-transcription-control": { RecordingTranscriptionControl: "transcription-fixture" },
};
function load(path: string) {
  const loaded = { exports: {} as Record<string, unknown> };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports,
    require: (name: string) => dependencies[name] ?? require(name), URLSearchParams });
  return loaded.exports;
}
const { DataTable, tableExportRecord } = load("../src/components/ui/data-table.tsx") as {
  DataTable: React.ComponentType<Record<string, unknown>>;
  tableExportRecord: (row: unknown, columns: Column<QualityRecordingRow>[]) => Record<string, unknown>;
};
const { QualityRecordingsTable } = load("../src/components/quality-recordings-table.tsx") as {
  QualityRecordingsTable: (props: Record<string, unknown>) => React.ReactElement<{ columns: Column<QualityRecordingRow>[]; fitToWidth: boolean; total: number; page: number }>;
};
const row = {
  id: "recording-fixture", leadName: "Empresa de prueba", rut: "RUT de prueba", campaignName: "Secretaria Virtual",
  agentName: "Agente de prueba", typification: "VOLVER A LLAMAR", status: "ready", startedAt: "2026-08-19T15:00:00Z",
  endedAt: "2026-08-19T15:02:30Z", durationSeconds: 150, queueTalkSeconds: 150, codec: "opus", sizeBytes: 123456,
  transcriptionStatus: "completed", transcriptionEligibility: { eligible: true, label: "Elegible" },
  evaluationStatus: "completed", evaluationScore: 85, evaluationVerdict: "cumple",
} as QualityRecordingRow;
const props = QualityRecordingsTable({ rows: [row], total: 101, page: 2, pageCount: 3, pageSize: 50, error: null }).props;

test("quality keeps nine visual columns, all three controls and server pagination", () => {
  assert.equal(props.columns.length, 9); assert.equal(props.fitToWidth, true);
  assert.equal(props.total, 101); assert.equal(props.page, 2);
  const controls: React.ReactElement<Record<string, unknown>>[] = [];
  function visit(node: unknown) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!React.isValidElement(node)) return;
    const element = node as React.ReactElement<Record<string, unknown>>;
    if (["audio-fixture", "evaluation-fixture", "transcription-fixture"].includes(String(element.type))) controls.push(element);
    visit(element.props.children);
  }
  props.columns.forEach((column) => visit(column.cell?.(row)));
  assert.equal(controls.length, 3);
  for (const control of controls) {
    assert.equal(control.props.recordingId, row.id); assert.equal(control.props.playable, true); assert.equal(control.props.compact, true);
  }
});

test("grouped columns preserve separate numeric export fields and Spanish status labels", () => {
  const record = tableExportRecord(row, props.columns);
  assert.equal(record["Duración"], 150); assert.equal(record.Archivo, 123456);
  assert.equal(record.Estado, "Disponible"); assert.equal(record["Apego al script"], 85);
  assert.equal(record["Transcripción"], "Completada");
  assert.equal(record["Grabación"], undefined); assert.equal(record["Calidad y texto"], undefined);
  assert.equal(record["Tipificación"], "VOLVER A LLAMAR");
  const hidden = tableExportRecord(row, props.columns.filter((c) => c.id !== "qualityActions"));
  assert.equal(hidden["Apego al script"], undefined); assert.equal(hidden["Transcripción"], undefined);
  const missing = tableExportRecord({ ...row, durationSeconds: null, evaluationScore: null, transcriptionStatus: "failed" }, props.columns);
  assert.equal(missing["Duración"], null); assert.equal(missing["Apego al script"], null); assert.equal(missing["Transcripción"], "Con error");
});

test("fit-to-width is opt-in; other tables retain scrolling, columns, density and export controls", () => {
  const base = { rows: [{ id: "one", name: "Prueba" }], columns: [{ id: "name", header: "Nombre", value: (r: { name: string }) => r.name }], getRowId: () => "one", storageKey: "test" };
  const normal = renderToStaticMarkup(React.createElement(DataTable, base));
  assert.match(normal, /overflow-x-auto/); assert.doesNotMatch(normal, /table-fixed/);
  const fitted = renderToStaticMarkup(React.createElement(DataTable, { ...base, fitToWidth: true }));
  assert.match(fitted, /table-fixed/); assert.match(fitted, /break-words/);
  for (const text of ["Columnas", "Compacta", "Exportar", "Prueba"]) assert.ok(fitted.includes(text));
});
