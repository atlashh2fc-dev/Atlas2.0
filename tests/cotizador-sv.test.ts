// Cotizador de Secretaria Virtual de la ficha. El plan y los textos son los de
// la propuesta comercial «Servicio de Ejecutiva Virtual» de Geimser; si el
// documento cambia, estas pruebas dicen qué cambió en lo que lee el cliente.

import assert from "node:assert/strict";
import test from "node:test";

import { PLAN_BASE, normalizarCondiciones, resumenPropuesta, simular, tieneCondiciones } from "../src/lib/sv-cotizador/plan.ts";
import { asuntoPropuestaSv, correoHtmlSv, correoTextoSv, mensajeWhatsappSv, remitenteSv, type DatosPropuestaSv } from "../src/lib/sv-cotizador/propuesta.ts";

const datos = (extra: Partial<DatosPropuestaSv> = {}): DatosPropuestaSv => ({
  cliente: { empresa: "Clínica Los Robles SpA", rut: "76.123.456-7", contacto: "carolina pérez", correo: "contacto@losrobles.cl", telefono: "+56912345678" },
  ejecutivo: { nombre: "Ana Soto", cargo: "Ejecutiva Comercial", correo: "ana@geimser.cl", whatsapp: "+56987654321", firma: null },
  meses: 3,
  valorUf: 39500,
  condiciones: { llamadas: null, horario: null, excedente: null },
  fecha: new Date("2026-10-16T15:00:00Z"),
  folio: "20261001",
  correoRespuesta: "ventas@geimser.cl",
  ...extra,
});

test("Plan Base del documento: 2 UF + IVA mensual, sin descuentos", () => {
  const sim = simular(3, 39500);
  assert.equal(PLAN_BASE.ufMensual, 2);
  assert.equal(sim.ufNeto, 2);
  assert.equal(sim.ufIva, 0.38);
  assert.equal(sim.ufTotal, 2.38);
  assert.equal(sim.ufNetoPeriodo, 6);
  assert.equal(sim.ufTotalPeriodo, 7.14);
  assert.deepEqual(sim.pesos, { neto: 79000, iva: 15010, total: 94010, netoPeriodo: 237000, totalPeriodo: 282030 });
});

test("El plazo anual multiplica el mismo valor mensual: el documento no fija descuentos", () => {
  const sim = simular(12, null);
  assert.equal(sim.ufNetoPeriodo, 24);
  assert.equal(sim.ufTotalPeriodo, 28.56);
  assert.equal(sim.pesos, null);
});

test("Las condiciones particulares se limpian: llamadas enteras positivas y textos cortos", () => {
  assert.deepEqual(normalizarCondiciones({ llamadas: "300", horario: "  09:00   a 18:00 ", excedente: "" }), { llamadas: 300, horario: "09:00 a 18:00", excedente: null });
  assert.deepEqual(normalizarCondiciones({ llamadas: -4, horario: 12 }), { llamadas: null, horario: null, excedente: null });
  assert.equal(tieneCondiciones(normalizarCondiciones(null)), false);
});

test("El asunto lleva el N.º de propuesta y el cliente; el remitente, la ejecutiva sobre Geimser", () => {
  assert.equal(asuntoPropuestaSv(datos()), "Propuesta Comercial N.º 20261001 — Servicio de Ejecutiva Virtual | CLÍNICA LOS ROBLES SPA");
  assert.equal(asuntoPropuestaSv(datos({ folio: null })), "Propuesta Comercial — Servicio de Ejecutiva Virtual | CLÍNICA LOS ROBLES SPA");
  assert.equal(remitenteSv(" Ana Soto "), "Ana Soto · Geimser");
});

test("El correo respeta las variables del documento: cliente, RUT, correo, teléfono, fecha y N.º", () => {
  const html = correoHtmlSv(datos());
  assert.match(html, /Clínica Los Robles SpA/);
  assert.match(html, /76\.123\.456-7/);
  assert.match(html, /contacto@losrobles\.cl/);
  assert.match(html, /\+56 9 1234 5678/);
  assert.match(html, /16 de octubre de 2026/);
  assert.match(html, /N\.º 20261001/);
  assert.match(html, /Estimada Carolina:/);
  assert.match(html, /2 UF <span[^>]*>\+ IVA mensual/);
  assert.match(html, /\$79\.000 \+ IVA al mes/);
  assert.match(html, /Plazo mínimo de 3 meses/);
  assert.match(html, /15 días corridos/);
  assert.match(html, /quedarán establecidos en las condiciones particulares/);
  assert.match(html, /mailto:ventas@geimser\.cl/);
  assert.doesNotMatch(html, /descuento de|% de descuento/i);
});

test("Con condiciones particulares, el correo y el WhatsApp las muestran en vez de la nota", () => {
  const conCondiciones = datos({ meses: 6, condiciones: { llamadas: 300, horario: "09:00 a 18:00", excedente: "0,02 UF por llamada adicional" } });
  const html = correoHtmlSv(conCondiciones);
  assert.match(html, /300 al mes/);
  assert.match(html, /09:00 a 18:00/);
  assert.doesNotMatch(html, /quedarán establecidos en las condiciones particulares/);
  assert.match(html, /Contrato de 6 meses/);
  const whatsapp = mensajeWhatsappSv(conCondiciones);
  assert.match(whatsapp, /• Llamadas incluidas: 300 al mes/);
  assert.match(whatsapp, /\*Valor mensual: 2 UF \+ IVA\*/);
  assert.match(whatsapp, /Contrato: \*6 meses\* \(12 UF \+ IVA/);
});

test("El texto plano del correo es el WhatsApp sin marcas", () => {
  const texto = correoTextoSv(datos());
  assert.doesNotMatch(texto, /\*Valor/);
  assert.match(texto, /Valor mensual: 2 UF \+ IVA/);
  assert.match(texto, /Ana Soto/);
});

test("El resumen para la tipificación nombra el plan, el valor y el plazo", () => {
  assert.equal(resumenPropuesta(3), "Plan Base – Ejecutiva Virtual 2 UF + IVA mensual · 3 meses");
});
