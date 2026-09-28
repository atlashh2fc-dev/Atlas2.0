// La bandeja de prospección: lo que no puede aflojarse.
//
// El correo de Atlas Lead avisa a quién escribirle; la gestión vive en el CRM.
// Si estas reglas se rompen, o las señales vuelven a inundar el pipeline, o un
// prospecto trabajado reaparece como nuevo, o la bandeja queda al alcance de
// cualquiera con sesión.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { asuntoLegible, celularChileno, enlaceWhatsapp, esResultado, mensajeDeWhatsapp, nombreComoSeDice, senalDe, temaDeLosCorreos } from "../src/lib/prospeccion.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const MIGRACION = leer("supabase/migrations/20260928120000_bandeja_de_prospeccion.sql");
const CORREOS_Y_BLOQUEO = leer("supabase/migrations/20260928220000_bandeja_muestra_los_correos_y_bloquea.sql");
const BANDEJA = leer("src/components/bandeja-prospeccion.tsx");
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
    "Hola, soy Hugo, de Altius, en Santiago. Una pregunta corta sobre Transportes Hermosilla y Hermosilla: si un cliente te pide una cotización a las 10 de la noche, ¿alguien alcanza a responderle antes de que cotice con otra empresa?",
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
  assert.match(mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: null }), /Una pregunta corta: si un cliente te pide/);
  assert.match(mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Clínica Dental Sonrisa SpA" }), /te pide una hora .* la reserve en otro lugar\?$/);
});

test("a quien ya le escribimos va el seguimiento, y a quien respondió se le retoma la conversación", () => {
  assert.match(mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Securitek Spa", toques: 1 }), /^Te dejo el dato .* no te vuelvo a escribir\.$/);
  assert.equal(
    mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Menard Muebles Spa", respondio: true, toques: 2 }),
    "Hola, soy Hugo, de Altius. Vi tu respuesta de Menard Muebles a nuestro correo y preferí escribirte directo. ¿Te acomoda que sigamos por aquí?",
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

test("antes de escribirle se sabe qué correo leyó, y el mensaje retoma ese tema sin decir que lo abrió", () => {
  const correos = [
    { asunto: "Improfor Limitada: alternativa para b", enviado_at: "2026-09-21T12:40:00Z", abierto_at: "2026-09-22T17:27:00Z", clic: false },
    { asunto: "¿Le mostramos cómo quedaría su sitio con Atlas Pulso?", enviado_at: "2026-09-23T16:41:00Z", abierto_at: "2026-09-24T14:08:00Z", clic: false },
    { asunto: "Improfor Limitada: ¿lo dejamos para más adelante?", enviado_at: "2026-09-28T18:40:00Z", abierto_at: "2026-09-28T19:47:00Z", clic: false },
  ];
  // El cierre no dice de qué se habló: manda el último correo con tema.
  assert.match(temaDeLosCorreos(correos) ?? "", /^Atlas Pulso/);
  assert.match(temaDeLosCorreos([{ asunto: "Universo Toys Spa: ¿los recomienda ChatGPT cuando buscan su rubro?", enviado_at: null, abierto_at: null, clic: false }]) ?? "", /Google y ChatGPT/);
  assert.equal(temaDeLosCorreos([]), null);
  const mensaje = mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius Ignite", empresa: "Universo Toys Spa", tema: temaDeLosCorreos(correos) });
  assert.equal(
    mensaje,
    "Hola, soy Hugo, de Altius Ignite. Hace unos días te mandamos un correo sobre Atlas Pulso, un sitio web con una IA que responde a tus clientes a cualquier hora. ¿Te muestro en 10 minutos cómo quedaría el de Universo Toys?",
  );
  assert.doesNotMatch(mensaje, /abri[óo]/i);
  // De tú en todos los casos: el usted aleja.
  for (const variante of [
    mensaje,
    mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Securitek Spa" }),
    mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Securitek Spa", toques: 1 }),
    mensajeDeWhatsapp({ remitente: "Hugo", empresaPropia: "Altius", empresa: "Securitek Spa", respondio: true }),
  ]) assert.doesNotMatch(variante, /\b(usted|le muestro|le envío|le interesa|le acomoda|escribirle|su respuesta|la suya|el suyo)\b/i);
  assert.equal(asuntoLegible("Proquimsa S A: una pregunta rápida"), "Una pregunta rápida");
  assert.equal(asuntoLegible("¿Quién le contesta a sus clientes a las 11 de la noche?"), "¿Quién le contesta a sus clientes a las 11 de la noche?");
  // La apertura de un escáner tampoco cuenta como correo leído.
  assert.match(soloCodigo(CORREOS_Y_BLOQUEO), /coalesce\(d\.enviado_at, '-infinity'::timestamptz\) \+ interval '60 seconds'/);
});

test("a quien se marcó no contactar se le ve, pero no se le escribe ni cuenta como pendiente", () => {
  const codigo = soloCodigo(CORREOS_Y_BLOQUEO);
  assert.match(codigo, /when nullif\(btrim\(l\.extra->>'no_contactar'\), ''\) is not null then 'no_contactar'/);
  // El vigilante cuenta estado 'nuevo': el marcado no le suma.
  assert.match(soloCodigo(MIGRACION), /count\(\*\) filter \(where b\.estado = 'nuevo'/);
  // Sin botón de WhatsApp ni resultados en la fila marcada.
  const fila = BANDEJA.slice(BANDEJA.indexOf("if (p.noContactar)"), BANDEJA.indexOf("if (p.noContactar)") + 900);
  assert.doesNotMatch(fila, /ContactarProspecto|<Resultado/);
  // Los 12 del correo con error del 21-09 se marcan por su id de Atlas Lead.
  assert.equal((codigo.match(/'[0-9a-f-]{36}'/g) ?? []).length, 12);
});
