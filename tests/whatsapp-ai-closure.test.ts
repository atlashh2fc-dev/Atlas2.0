import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260826211500_whatsapp_ai_and_closure.sql", import.meta.url),
  "utf8",
);
const composer = readFileSync(
  new URL("../src/components/whatsapp-composer.tsx", import.meta.url),
  "utf8",
);

test("Enter envía y Shift+Enter conserva el salto de línea", () => {
  assert.match(composer, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(composer, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
});

test("cada cierre requiere tipificación válida de la campaña", () => {
  assert.match(migration, /status <> 'closed' or \(close_reason_id is not null and closed_at is not null\)/);
  assert.match(migration, /and campaign_id = v_conversation\.campaign_id/);
  assert.match(migration, /whatsapp_closure_note_required/);
});

test("el timeout ocurre solo después de una respuesta saliente sin nueva respuesta del contacto", () => {
  assert.match(migration, /conversation\.last_outbound_at is not null/);
  assert.match(migration, /conversation\.last_outbound_at >= coalesce\(conversation\.last_inbound_at/);
  assert.match(migration, /conversation\.last_outbound_at <= now\(\) - make_interval/);
});

test("un mensaje inbound solo puede originar una ejecución de IA", () => {
  assert.match(migration, /inbound_message_id uuid not null unique/);
  assert.match(migration, /status in \('processing', 'completed', 'skipped', 'failed'\)/);
});
