import assert from "node:assert/strict";
import test from "node:test";

import { hasAtlasLeadOriginal, parseMailMessageBody } from "../src/lib/mail-message-body.ts";

test("renderiza el marcador IMAGE_ONLY como imagen y no como texto técnico", () => {
  const url = "https://example.supabase.co/storage/v1/object/public/campaign/image.jpeg";

  assert.deepEqual(parseMailMessageBody(`[IMAGE_ONLY:${url}]`), [
    { kind: "image", url },
  ]);
});

test("conserva el texto que acompaña a una pieza gráfica", () => {
  const url = "https://cdn.example.com/campaign/image.png?version=2";

  assert.deepEqual(parseMailMessageBody(`Hola\n[IMAGE_ONLY:${url}]\nGracias`), [
    { kind: "text", value: "Hola\n" },
    { kind: "image", url },
    { kind: "text", value: "\nGracias" },
  ]);
});

test("no convierte esquemas inseguros en imágenes", () => {
  assert.deepEqual(parseMailMessageBody("[IMAGE_ONLY:javascript:alert(1)]"), [
    { kind: "text", value: "[IMAGE_ONLY:javascript:alert(1)]" },
  ]);
});

test("solo pide el original a Atlas Lead cuando el id es suyo", () => {
  assert.equal(hasAtlasLeadOriginal("3f2b8c1e-9d4a-4f6b-8a21-7c5e0d9b1a34"), true);
  assert.equal(hasAtlasLeadOriginal("fec-out-fec10000-0000-4000-8000-000000000505-1"), false);
  assert.equal(hasAtlasLeadOriginal(null), false);
});
