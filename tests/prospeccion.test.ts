// La bandeja de prospección: lo que no puede aflojarse.
//
// El correo de Atlas Lead avisa a quién escribirle; la gestión vive en el CRM.
// Si estas reglas se rompen, o las señales vuelven a inundar el pipeline, o un
// prospecto trabajado reaparece como nuevo, o la bandeja queda al alcance de
// cualquiera con sesión.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { celularChileno, enlaceWhatsapp, esResultado, mensajeDeWhatsapp, nombreComoSeDice, senalDe } from "../src/lib/prospeccion.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const MIGRACION = leer("supabase/migrations/20260928120000_bandeja_de_prospeccion.sql");
const PIPELINE = leer("src/app/dashboard/pipeline/page.tsx");
const CRONS = JSON.parse(leer("vercel.json")) as { crons: { path: string }[] };

const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

test("una señal no es un negocio: el pipeline ya no muestra prospectos ni el calificador los crea", () => {
  assert.doesNotMatch(PIPELINE, /Prospectos de Atlas Lead/);
  assert.doesNotMatch(PIPELINE, /convertirLeadEnNegocio/);
  assert.ok(!CRONS.crons.some((c) => c.path === "/api/agentes/calificador"), "el calificador sigue programado");
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /'retirado', true/);
  // Lo que se saca del pipeline queda respaldado antes de borrarse.
  assert.match(codigo, /create table if not exists public\.respaldo_negocios_de_senal_20260928/);
  assert.match(codigo, /create table if not exists public\.respaldo_actividades_de_senal_20260928/);
});

test("solo interesado lleva al pipeline, y entra en Contactado con responsable y fecha", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /if p_resultado = 'interesado' then/);
  assert.match(codigo, /key = 'contactado'/);
  assert.match(codigo, /'atlas_lead', v_lead\.campaign_id, v_lead\.id, v_yo, v_yo,\s*now\(\) \+ interval '1 day'/);
});

test("lo gestionado no reaparece como nuevo, salvo que vuelva a mostrar interés", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /when i\.ultima > u\.created_at then 'volvio'/);
  assert.match(codigo, /when u\.seguir_at <= now\(\) then 'seguimiento'/);
  assert.match(codigo, /where c\.estado <> 'esperando'/);
  assert.match(codigo, /not in \('interesado', 'no_interesa', 'numero_malo'\)/);
  // Quien pidió la baja o marcó spam no se contacta por otro canal.
  assert.match(codigo, /lms\.unsubscribed or lms\.complained/);
  // Un escáner de correo no es una persona.
  assert.match(codigo, /interval '60 seconds'/);
});

test("la bandeja es del equipo comercial de la empresa activa", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /revoke execute on function public\.prospeccion_de_empresa\(uuid, integer\) from anon, authenticated/);
  assert.match(codigo, /public\.prospeccion_de_empresa\(public\.current_org_id\(\), p_dias\)/);
  assert.match(codigo, /Solo el equipo comercial ve la bandeja/);
  assert.match(codigo, /Solo el equipo comercial gestiona prospectos/);
  assert.match(codigo, /where l\.id = p_lead_id and l\.organization_id = v_org/);
  // Deshacer: solo lo propio, reciente y que no creó un negocio.
  assert.match(codigo, /hecho_por = auth\.uid\(\)[\s\S]*interval '1 day'[\s\S]*resultado <> 'interesado'/);
});

test("el vigilante avisa el interés que nadie gestiona", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /'Interés sin gestionar'/);
  assert.match(codigo, /from public\.prospeccion_de_empresa\(v_org, 14\) b/);
});

test("WhatsApp solo para celulares; un fijo se llama", () => {
  assert.equal(celularChileno("56994459945"), "56994459945");
  assert.equal(celularChileno("+56 9 9445 9945"), "56994459945");
  assert.equal(celularChileno("994459945"), "56994459945");
  assert.equal(celularChileno("+56227975500"), null);
  assert.equal(celularChileno("+222292149"), null);
  assert.equal(celularChileno(null), null);
});

test("el mensaje lo firma quien escribe, pregunta por el cliente y va listo en el enlace", () => {
  const mensaje = mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Sociedad de Transportes Hermosilla y Hermosilla Limitada" });
  assert.equal(
    mensaje,
    "Hola, soy Hugo, de Altius, en Santiago. Una pregunta breve para Transportes Hermosilla y Hermosilla: si un cliente les pide una cotización a las 10 de la noche, ¿alguien alcanza a responderle antes de que cotice con otra empresa?",
  );
  assert.doesNotMatch(mensaje, /correo|10 minutos/);
  const enlace = enlaceWhatsapp("56994459945", mensaje);
  assert.ok(enlace.startsWith("https://wa.me/56994459945?text="));
  assert.equal(decodeURIComponent(enlace.split("?text=")[1]), mensaje);
});

test("el nombre queda como lo diría una persona, y sin nombre el mensaje no queda cojo", () => {
  assert.equal(nombreComoSeDice("Universo Toys Spa"), "Universo Toys");
  assert.equal(nombreComoSeDice("Proquimsa S A"), "Proquimsa");
  assert.equal(nombreComoSeDice("Sociedad de Mantenimiento de Equipos Medicos e Industriales Medex Spa"), null);
  assert.match(mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: null }), /Una pregunta breve: si un cliente/);
  assert.match(mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Clínica Dental Sonrisa SpA" }), /les pide una hora .* la reserve en otro lugar\?$/);
});

test("a quien ya le escribimos va el seguimiento, y a quien respondió se le retoma la conversación", () => {
  assert.match(mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Securitek Spa", toques: 1 }), /^Le dejo el dato .* no vuelvo a escribirle\.$/);
  assert.equal(
    mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Menard Muebles Spa", respondio: true, toques: 2 }),
    "Hola, soy Hugo, de Altius. Recibí su respuesta de Menard Muebles a nuestro correo y preferí escribirle directamente. ¿Le acomoda que sigamos la conversación por aquí?",
  );
});

test("la señal se describe de la más caliente a la más tibia", () => {
  assert.equal(senalDe({ respondio: true, clic: true, aperturas: 3 }), "Respondió el correo");
  assert.equal(senalDe({ respondio: false, clic: true, aperturas: 3 }), "Hizo clic en el correo");
  assert.equal(senalDe({ respondio: false, clic: false, aperturas: 3 }), "Abrió 3 veces");
  assert.equal(senalDe({ respondio: false, clic: false, aperturas: 1 }), "Abrió el correo");
  assert.ok(esResultado("whatsapp"));
  assert.ok(!esResultado("borrar"));
});
