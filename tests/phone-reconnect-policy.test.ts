import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/cti-bar.tsx", "utf8");

test("el softphone corta el backoff automático antes de programar otro REGISTER", () => {
  const stop = source.indexOf("if (failing) return;");
  const timer = source.indexOf("reconnectTimer = setTimeout", stop);

  assert.ok(stop >= 0, "falta detener la reconexión persistente");
  assert.ok(timer > stop, "el corte debe ocurrir antes de programar otro intento");
  assert.match(source, /MAX_SILENT_RECONNECT_ATTEMPTS = 3/);
  assert.match(source, /Reintentar teléfono/);
});
