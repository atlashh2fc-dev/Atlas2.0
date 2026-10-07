// Giftcards, sellos, laboratorio, calendario y app instalable.
//
// Si esto se rompe, una giftcard se gasta dos veces o queda con saldo
// negativo, el calendario del profesional muestra teléfonos o datos
// clínicos, o la app instalable abre en la pantalla de acceso.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { calendarioIcs, enlaceGoogleCalendar } from "../src/lib/calendario.ts";

const migraciones = readdirSync(new URL("../supabase/migrations", import.meta.url));
const sql = readFileSync(new URL(`../supabase/migrations/${migraciones.find((nombre) => nombre.endsWith("_giftcards_sellos_laboratorio_calendario.sql"))}`, import.meta.url), "utf8");
const middleware = readFileSync(new URL("../src/lib/supabase/middleware.ts", import.meta.url), "utf8");

test("el calendario es iCalendar válido, con UID estable y sin datos de contacto", () => {
  const ics = calendarioIcs("Dra. Vidal", "Sonríe", [
    { id: "c1", inicio: "2026-10-08T13:00:00Z", fin: "2026-10-08T13:30:00Z", motivo: "Limpieza, control", estado: "confirmada", persona: "Camila", mascota: null, box: "Sillón 2" },
  ]);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /UID:c1@atlas/);
  assert.match(ics, /DTSTART:20261008T130000Z/);
  assert.match(ics, /SUMMARY:Camila · Limpieza\\, control/);
  assert.match(ics, /LOCATION:Sonríe · Sillón 2/);
  assert.match(ics, /STATUS:CONFIRMED/);
  assert.ok(ics.split("\r\n").every((linea) => linea.length <= 75), "líneas dobladas");
  assert.match(enlaceGoogleCalendar("a".repeat(64)), /calendar\.google\.com\/calendar\/render\?cid=webcal%3A%2F%2F/);
});

test("la base solo entrega primer nombre, hora y motivo al calendario", () => {
  const funcion = sql.slice(sql.indexOf("function public.calendario_de_profesional"));
  assert.match(funcion, /split_part\(cuenta\.name, ' ', 1\)/);
  assert.doesNotMatch(funcion.slice(0, funcion.indexOf("$$;")), /phone|email|rut|nota/);
  assert.match(funcion, /length\(coalesce\(p_token, ''\)\) >= 32/);
  assert.ok(middleware.includes('"/api/calendario/"'));
  assert.ok(middleware.includes('"/manifest.webmanifest"'));
});

test("una giftcard no queda con saldo negativo ni se canjea dos veces a la vez", () => {
  assert.match(sql, /check \(monto_inicial > 0 and saldo >= 0 and saldo <= monto_inicial\)/);
  assert.match(sql, /for update;/);
  assert.match(sql, /if p_monto > v_card\.saldo then/);
  assert.match(sql, /'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'/);
});

test("los sellos cuentan visitas desde el último canje y solo canjea quien completó", () => {
  assert.match(sql, /count\(distinct a\.fecha\)/);
  assert.match(sql, /ultimo\.fecha is null or a\.created_at > ultimo\.fecha/);
  assert.match(sql, /Todavía no completa la tarjeta/);
});
