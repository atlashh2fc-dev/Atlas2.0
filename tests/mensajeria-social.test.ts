import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canalDeMensajeria, esCanalSocial, parseMensajeriaSocial } from "../src/lib/mensajeria-social.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

test("Messenger: mensaje del cliente, eco de la página y botón", () => {
  const eventos = parseMensajeriaSocial({
    object: "page",
    entry: [
      {
        id: "PAGE1",
        time: 1,
        messaging: [
          { sender: { id: "PSID9" }, recipient: { id: "PAGE1" }, timestamp: 1_727_000_000_000, message: { mid: "m_1", text: "Hola" } },
          { sender: { id: "PAGE1" }, recipient: { id: "PSID9" }, timestamp: 1_727_000_001_000, message: { mid: "m_2", text: "Hola, ¿en qué te ayudo?", is_echo: true } },
          { sender: { id: "PSID9" }, recipient: { id: "PAGE1" }, timestamp: 1_727_000_002_000, postback: { mid: "m_3", title: "Quiero una demo", payload: "DEMO" } },
          { sender: { id: "PSID9" }, recipient: { id: "PAGE1" }, timestamp: 1_727_000_003_000, read: { watermark: 1 } },
        ],
      },
    ],
  });
  assert.equal(eventos.length, 3, "las lecturas no mueven la bandeja");
  assert.deepEqual(
    eventos.map((e) => [e.canal, e.cuentaId, e.contactoId, e.direction, e.textBody]),
    [
      ["messenger", "PAGE1", "PSID9", "inbound", "Hola"],
      ["messenger", "PAGE1", "PSID9", "outbound", "Hola, ¿en qué te ayudo?"],
      ["messenger", "PAGE1", "PSID9", "inbound", "Quiero una demo"],
    ],
  );
  assert.equal(eventos[0].eventKey, "messenger:m_1");
  assert.equal(eventos[0].timestamp, new Date(1_727_000_000_000).toISOString());
});

test("Instagram: adjuntos y mensajes borrados", () => {
  const eventos = parseMensajeriaSocial({
    object: "instagram",
    entry: [
      {
        id: "IG1",
        messaging: [
          { sender: { id: "IGSID7" }, recipient: { id: "IG1" }, timestamp: 1, message: { mid: "ig_1", attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }] } },
          { sender: { id: "IGSID7" }, recipient: { id: "IG1" }, timestamp: 2, message: { mid: "ig_2", attachments: [{ type: "story_mention", payload: { url: "https://cdn/s" } }] } },
          { sender: { id: "IGSID7" }, recipient: { id: "IG1" }, timestamp: 3, message: { mid: "ig_3", is_deleted: true } },
        ],
      },
    ],
  });
  assert.deepEqual(eventos.map((e) => [e.canal, e.messageType, e.textBody, e.adjuntoUrl]), [
    ["instagram", "image", "[Imagen]", "https://cdn/x.jpg"],
    ["instagram", "text", "[Te mencionó en una historia]", "https://cdn/s"],
  ]);
});

test("un webhook de WhatsApp no se lee como red social", () => {
  assert.deepEqual(parseMensajeriaSocial({ object: "whatsapp_business_account", entry: [] }), []);
  assert.equal(esCanalSocial("whatsapp"), false);
  assert.equal(canalDeMensajeria(null), "whatsapp");
});

test("el webhook de Meta separa redes sociales de WhatsApp y el envío sale por la página", () => {
  const ruta = leer("src/app/api/integrations/meta/whatsapp/webhook/route.ts");
  assert.match(ruta, /parseMensajeriaSocial\(decoded\)/);
  assert.match(ruta, /processMensajesSociales\(sociales\)/);
  const proveedor = leer("src/lib/whatsapp-provider.ts");
  assert.match(proveedor, /const social = destinoSocial\(input\);/);
  // El canal de WhatsApp de la empresa nunca debe tomar una página de Instagram o Messenger.
  for (const archivo of [
    "src/app/dashboard/admin/integraciones/whatsapp/page.tsx",
    "src/lib/mensajes/despachar.ts",
    "src/app/dashboard/mensajes/page.tsx",
    "src/app/dashboard/recordatorios/page.tsx",
  ]) {
    assert.match(leer(archivo), /from\("whatsapp_channels"\)[^;]*\.eq\("canal", "whatsapp"\)/, archivo);
  }
});

test("la ingesta social reconoce al contacto por su id en la red, no por teléfono", () => {
  const sql = leer("supabase/migrations/20260930180000_instagram_y_messenger.sql");
  assert.match(sql, /create or replace function public\.ingest_mensaje_social/);
  assert.match(sql, /contact\.contact_type = v_canal\s+and contact\.normalized_value = p_contact_id/);
  assert.match(sql, /grant execute on function public\.ingest_mensaje_social\([^)]*\)\s+to service_role/);
  assert.match(sql, /not in \('meta_whatsapp', 'meta_instagram', 'meta_messenger'\)/);
});
