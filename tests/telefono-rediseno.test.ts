import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cti = readFileSync("src/components/cti-bar.tsx", "utf8");
const layout = readFileSync("src/app/dashboard/layout.tsx", "utf8");
const leadPage = readFileSync("src/app/dashboard/leads/[id]/page.tsx", "utf8");
const dayBar = readFileSync("src/components/agent-day-bar.tsx", "utf8");

test("el teléfono no repite los datos del cliente que ya muestra la ficha", () => {
  assert.doesNotMatch(cti, /leadExtraFields/);
  assert.doesNotMatch(cti, /ContextField/);
  assert.match(leadPage, /aria-label="Datos del cliente"/);
  assert.match(leadPage, /\{!call && contactCard\}/);
});

test("el estado vive una sola vez en la barra superior y la llamada sobre el contenido", () => {
  assert.match(layout, /id="cti-status-slot"/);
  assert.match(layout, /id="cti-callbar-slot"/);
  assert.match(cti, /createPortal\(statusControls, slots\.status\)/);
  assert.match(cti, /createPortal\(callBar, slots\.call\)/);
  // La barra de jornada muestra totales, no vuelve a marcar el estado actual.
  assert.doesNotMatch(dayBar, /current=\{current\}/);
});

test("el audio del teléfono sigue montado en todo momento", () => {
  const audioTags = cti.match(/<audio ref=\{audioRef\}/g) ?? [];
  assert.equal(audioTags.length, 1);
  assert.doesNotMatch(cti, /if \(minimized\)/);
});

test("cualquier gestión abierta se ve y se puede abrir desde el teléfono", () => {
  assert.match(cti, /getMyOpenManagement/);
  assert.match(cti, /Gestión pendiente ·/);
  assert.match(cti, /redirectToOpenManagement\(result\.error\)/);
});

test("espera, atajos y micrófono elegido quedan conectados al motor", () => {
  assert.match(cti, /sessionDescriptionHandlerOptionsReInvite/);
  assert.match(cti, /hold: nextHeld/);
  assert.match(cti, /event\.code === "KeyD"/);
  assert.match(cti, /deviceId: \{ ideal: micId \}/);
  assert.match(cti, /constraints: \{ audio: microphoneConstraint\(\), video: false \}/);
});
