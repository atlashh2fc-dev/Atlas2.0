// Cotizador Equifax de la ficha. Los precios son los del cotizador que el
// equipo usaba por fuera (CotizadorGo!); si una tabla cambia, estas pruebas
// dicen qué propuesta cambió de precio.

import assert from "node:assert/strict";
import test from "node:test";

import { cotizarLinea, desglosePorProducto, montoAtlas, normalizarConfig, totales } from "../src/lib/equifax-cotizador/catalogo.ts";
import { asuntoDeRespuesta, respuestaHtml } from "../src/lib/equifax-cotizador/correo-cuenta.ts";
import { asuntoPropuesta, correoHtml, mensajeWhatsapp, remitenteDeEjecutivo, vocativo, type DatosPropuesta } from "../src/lib/equifax-cotizador/propuesta.ts";

test("Mora Control 4100 con DOA 15 % queda en 2,25 UF mensual: el precio va a 2 decimales", () => {
  const linea = cotizarLinea({ producto: "mc", plan: "4100", doa: 15 });
  assert.equal(linea.ufLista, 2.65);
  assert.equal(linea.ufVenta, 2.25);
  assert.equal(linea.descuento, 15);
  assert.equal(linea.cobro, "mensual");
  assert.equal(linea.atlas, "Mora Control");
  assert.equal(linea.descuentoFueraDeDoa, false);
});

test("Portfolio Monitor toma la tarifa del mayor tramo que no supera los RUTs", () => {
  // 45 RUTs mensual → tramo 40 (0,039 UF por RUT).
  const linea = cotizarLinea({ producto: "pfm", frecuencia: "m", ruts: 45, doa: 0 });
  assert.equal(linea.ufVenta, 1.76);
  assert.equal(linea.q, 45);
});

test("Partner Check es anual y RI Bolsa pago único: no se presentan como mensuales", () => {
  assert.equal(cotizarLinea({ producto: "pc", tamano: "pequena" }).cobro, "anual");
  assert.equal(cotizarLinea({ producto: "bolsa", tramo: 100 }).cobro, "unico");
  const total = totales([
    cotizarLinea({ producto: "ri", tramo: 30, doa: 0 }),
    cotizarLinea({ producto: "bolsa", tramo: 100 }),
    cotizarLinea({ producto: "pc", tamano: "pequena" }),
  ]);
  assert.equal(total.mensual, 2.42);
  assert.equal(total.unico, 14);
  assert.equal(total.anual, 9);
  // A la tipificación va lo mensual.
  assert.equal(total.ufTipificacion, 2.42);
});

test("un precio a mano bajo el DOA permitido se marca para autorización", () => {
  const linea = cotizarLinea({ producto: "mc", plan: "4100", doa: 0, precioManual: 1.5 });
  assert.equal(linea.ufVenta, 1.5);
  assert.equal(linea.descuento, 43);
  assert.equal(linea.descuentoFueraDeDoa, true);
});

test("Publicación Única cobra 15 % neto sobre lo que falta pagar, más IVA", () => {
  const linea = cotizarLinea({ producto: "pub", pct: 15, documentos: [{ monto: 1_000_000, abonos: 200_000 }] });
  assert.equal(linea.publicacion?.publicar, 800_000);
  assert.equal(linea.publicacion?.neto, 120_000);
  assert.equal(linea.publicacion?.iva, 22_800);
  assert.equal(linea.publicacion?.total, 142_800);
  assert.equal(linea.atlas, "Documento Unico");
});

test("el servidor rechaza tramos y descuentos que no están en la tabla", () => {
  assert.equal(normalizarConfig({ producto: "ri", tramo: 33, doa: 0 }), null);
  assert.equal(normalizarConfig({ producto: "inventado" }), null);
  // Un DOA no permitido para el producto cae a cero, no se aplica.
  assert.deepEqual(normalizarConfig({ producto: "mc", plan: "4100", doa: 50 }), { producto: "mc", plan: "4100", doa: 0, precioManual: null });
  assert.equal(normalizarConfig({ producto: "pub", pct: 15, documentos: [{ monto: 0 }] }), null);
});

test("el Bundle admite descuento DOA de 10 % y 15 %, y nada más", () => {
  // Bundle 4100 con 20 descargas: lista 3 UF.
  assert.equal(cotizarLinea({ producto: "bundle", mc: "4100", descargas: 20, doa: 10 }).ufVenta, 2.7);
  const quince = cotizarLinea({ producto: "bundle", mc: "4100", descargas: 20, doa: 15 });
  assert.equal(quince.ufVenta, 2.55);
  assert.equal(quince.descuento, 15);
  assert.equal(quince.descuentoFueraDeDoa, false);
  // Más de 15 % solo a mano, y queda marcado para autorización.
  assert.equal(cotizarLinea({ producto: "bundle", mc: "4100", descargas: 20, doa: 0, precioManual: 2.4 }).descuentoFueraDeDoa, true);
  // El servidor no acepta otro porcentaje: cae a cero.
  assert.equal((normalizarConfig({ producto: "bundle", mc: "4100", descargas: 20, doa: 25 }) as { doa?: number }).doa, 0);
  assert.equal((normalizarConfig({ producto: "bundle", mc: "4100", descargas: 20, doa: 15 }) as { doa?: number }).doa, 15);
  // Una cotización guardada antes, sin DOA, sigue a precio lista.
  assert.equal(cotizarLinea({ producto: "bundle", mc: "4100", descargas: 20 }).ufVenta, 3);
});

test("saludo según el nombre del contacto", () => {
  assert.equal(vocativo("CAROLINA PÉREZ"), "Estimada Carolina:");
  assert.equal(vocativo("pedro soto"), "Estimado Pedro:");
  assert.equal(vocativo(null), "Estimados:");
});

const datos: DatosPropuesta = {
  cliente: { empresa: "Transportes <Sur> SpA", rut: "76.123.456-7", contacto: "Carolina" },
  ejecutivo: { nombre: "Ana Rojas", cargo: "Ejecutiva Comercial", correo: "ana@ejemplo.cl", whatsapp: "+56912345678", firma: null },
  lineas: [cotizarLinea({ producto: "ri", tramo: 10, doa: 0 })],
  valorUf: 39_500,
  fecha: new Date("2026-09-29T14:00:00Z"),
};

test("la propuesta lleva asunto, precio, firma y escapa lo que viene de la base", () => {
  assert.match(asuntoPropuesta(datos), /^Propuesta Comercial Equifax — Reporte Comercial .* \| TRANSPORTES <SUR> SPA$/);
  const html = correoHtml(datos, "cid:logo");
  assert.ok(html.includes("TRANSPORTES &lt;SUR&gt; SPA"));
  assert.ok(!html.includes("<SUR>"));
  assert.ok(html.includes("1,10 UF"));
  assert.ok(html.includes("Ana Rojas"));
  const whatsapp = mensajeWhatsapp(datos);
  assert.ok(whatsapp.startsWith("Estimada Carolina:"));
  assert.ok(whatsapp.includes("*Precio ofrecido: 1,10 UF*"));
  assert.ok(whatsapp.includes("Aprox. $43.450 mensual + IVA"));
});

test("con buzón de la cuenta, la firma y el botón de aceptar apuntan al buzón y no al correo personal", () => {
  const html = correoHtml({ ...datos, correoRespuesta: "propuestas@geimser.cl", folio: "7F3A91C2" }, "cid:logo");
  assert.ok(html.includes("mailto:propuestas@geimser.cl?subject="));
  assert.ok(!html.includes("ana@ejemplo.cl"));
  assert.ok(html.includes("Aceptar la propuesta"));
  assert.ok(html.includes("N.º 7F3A91C2"));
  assert.ok(mensajeWhatsapp({ ...datos, correoRespuesta: "propuestas@geimser.cl" }).includes("✉ propuestas@geimser.cl"));
  assert.equal(remitenteDeEjecutivo(" Ana Rojas "), "Ana Rojas · Equifax");
});

test("el ahorro que se muestra es la diferencia real con el precio lista", () => {
  const conDescuento = correoHtml({ ...datos, lineas: [cotizarLinea({ producto: "mc", plan: "4100", doa: 15 })] }, "cid:logo");
  // 2,65 − 2,25 = 0,40 UF al mes.
  assert.ok(conDescuento.includes("0,40 UF al mes"));
  const sinDescuento = correoHtml(datos, "cid:logo");
  assert.ok(!sinDescuento.includes("Ahorra"));
});

test("el precio se puede subir sobre la lista y la propuesta no inventa ahorro", () => {
  // MC 4100 lista 2,65 UF: se ofrece a 3,10.
  const sobreLista = cotizarLinea({ producto: "mc", plan: "4100", doa: 0, precioManual: 3.1 });
  assert.equal(sobreLista.ufVenta, 3.1);
  assert.equal(sobreLista.descuento, 0);
  assert.equal(sobreLista.descuentoFueraDeDoa, false);
  // El servidor tampoco lo baja a la lista.
  assert.deepEqual(normalizarConfig({ producto: "mc", plan: "4100", doa: 0, precioManual: 3.1 }), { producto: "mc", plan: "4100", doa: 0, precioManual: 3.1 });

  const soloAlza = correoHtml({ ...datos, lineas: [sobreLista] }, "cid:logo");
  assert.ok(soloAlza.includes("3,10"));
  assert.ok(!soloAlza.includes("Ahorra"));
  assert.ok(!soloAlza.includes("line-through"), "al cliente no se le muestra la lista");

  // Una línea sube 0,45 y otra baja 0,40: el total no tiene ahorro que mostrar.
  const mixta = correoHtml({ ...datos, lineas: [sobreLista, cotizarLinea({ producto: "mc", plan: "4100", doa: 15 })] }, "cid:logo");
  assert.ok(!mixta.includes("Ahorra"));
});

test("la respuesta desde la ficha no acumula «Re:» y escapa lo que escribe el ejecutivo", () => {
  assert.equal(asuntoDeRespuesta("Propuesta Comercial Equifax"), "Re: Propuesta Comercial Equifax");
  assert.equal(asuntoDeRespuesta("RE: Propuesta"), "RE: Propuesta");
  const html = respuestaHtml("Hola <b>Carolina</b>", datos.ejecutivo, "propuestas@geimser.cl");
  assert.ok(html.includes("Hola &lt;b&gt;Carolina&lt;/b&gt;"));
  assert.ok(html.includes("propuestas@geimser.cl"));
});

test("con varios productos la propuesta muestra el precio de cada uno y no la suma", () => {
  const portfolio = { ...cotizarLinea({ producto: "pfm", frecuencia: "m", ruts: 45, doa: 0, precioManual: 1.5 }) };
  const mora = cotizarLinea({ producto: "mc", plan: "4100", doa: 0, precioManual: 2.5 });
  const varios = { ...datos, lineas: [portfolio, mora] };

  const html = correoHtml(varios, "cid:logo");
  assert.ok(html.includes("Su inversión por servicio"));
  assert.ok(!html.includes("Su inversión total"));
  assert.ok(html.includes("1,50 UF") && html.includes("2,50 UF"));
  assert.ok(!html.includes(">4 UF"), "no aparece la suma de 4 UF");

  const whatsapp = mensajeWhatsapp(varios);
  assert.ok(!whatsapp.includes("TOTAL DE LA PROPUESTA"));
  assert.ok(whatsapp.includes("*RESUMEN DE LA PROPUESTA*"));
  assert.ok(whatsapp.includes(`• ${portfolio.nombre}: *1,50 UF* + IVA mensual`));
  assert.ok(whatsapp.includes(`• ${mora.nombre}: *2,50 UF* + IVA mensual`));

  assert.equal(desglosePorProducto([portfolio, mora].map(montoAtlas)), "Portfolio Monitor 1,50 UF/mes · Mora Control 2,50 UF/mes");
});
