import assert from "node:assert/strict";
import test from "node:test";

import { parseMailMessageBody } from "../src/lib/mail-message-body.ts";

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
