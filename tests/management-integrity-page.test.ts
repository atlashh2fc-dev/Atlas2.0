import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/dashboard/reportes/integridad/page.tsx", import.meta.url), "utf8");
const tables = readFileSync(new URL("../src/components/management-integrity-tables.tsx", import.meta.url), "utf8");

test("Integridad mantiene las funciones de tabla dentro del componente cliente", () => {
  assert.match(tables, /^"use client";/);
  assert.match(tables, /const AGENT_COLUMNS/);
  assert.match(tables, /const DETAIL_COLUMNS/);
  assert.match(page, /<ManagementIntegrityTables agents=\{report\.agents\} detail=\{report\.detail\}/);
  assert.doesNotMatch(page, /Column<Integrity/);
});
