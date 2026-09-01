import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260901213000_retrain_secretaria_virtual_whatsapp_assistant.sql", import.meta.url),
  "utf8",
);
const mercury = readFileSync(new URL("../src/lib/mercury-whatsapp.ts", import.meta.url), "utf8");

test("la nueva guía reemplaza el foco exclusivo en condominios por público general", () => {
  assert.match(migration, /independientes, profesionales, emprendedores, PyMEs, empresas y administradores de condominios/);
  assert.match(migration, /el servicio contratado de atención es realizado por personas capacitadas/i);
  assert.match(migration, /Atención telefónica y WhatsApp combinados/);
  assert.match(migration, /GUÍA DE ENTRENAMIENTO, SV\.docx/);
  assert.match(migration, /knowledge_version,[\s\S]*?2,/);
});

test("precios y objeciones siguen los límites comerciales aprobados", () => {
  assert.match(migration, /Los planes parten desde 1 UF al mes/);
  assert.match(migration, /Nunca entregues un precio final o cerrado/);
  assert.match(migration, /Una objeción comercial[\s\S]*?no es por sí sola un reclamo/);
  assert.match(migration, /No discutas, presiones ni prometas descuentos/);
});

test("el entrenamiento exige respuestas breves, trato adaptado y una sola pregunta", () => {
  assert.match(migration, /usa "tú"[\s\S]*?"usted"/i);
  assert.match(migration, /entre una y tres frases cortas/);
  assert.match(migration, /como máximo una pregunta por mensaje/);
  assert.match(migration, /como máximo un emoji ocasional/);
});

test("agendamientos y cotizaciones quedan protegidos por derivación determinista", () => {
  assert.match(migration, /automatic_appointment_booking[\s\S]*?false/);
  assert.match(migration, /appointment_at=null/);
  assert.match(mercury, /const quoteRequest/);
  assert.match(mercury, /forcedKind === "quote"/);
  assert.match(mercury, /handoffKind === "appointment" && !automaticAppointmentBooking/);
});
