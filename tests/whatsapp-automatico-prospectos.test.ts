// WhatsApp automático a prospectos: las reglas que no puede romper.
//
// Este agente le escribe por WhatsApp, a nombre de Hugo, a gente que solo
// abrió un correo. Si se afloja, el daño no es un error en pantalla: es un
// número bloqueado por Meta o alguien que pidió no recibir más y recibió igual.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BOTON_DE_BAJA,
  PLANTILLAS_DE_PROSPECCION,
  REGLAS,
  definicionParaMeta,
  elegirEnvios,
  enHorario,
  esBaja,
  numeroSinWhatsapp,
  pideFrenar,
  textoDePlantilla,
  type FilaDeBandeja,
} from "../src/lib/prospeccion-whatsapp.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

// Martes 14-10-2026, 15:00 en Chile (UTC-3).
const AHORA = new Date("2026-10-14T18:00:00Z");
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 60 * 60 * 1000).toISOString();

function fila(parcial: Partial<FilaDeBandeja> = {}): FilaDeBandeja {
  return {
    lead_id: crypto.randomUUID(),
    empresa: "Ferretería Los Andes Limitada",
    telefono: "+56 9 1234 5678",
    respondio: false,
    ultima_senal_at: hace(3),
    ultimo_resultado: null,
    ultimo_toque_at: null,
    toques: 0,
    estado: "nuevo",
    prioridad: 4,
    no_contactar: null,
    ...parcial,
  };
}

test("a quien abrió y no le hemos escrito le llega la pregunta, con su nombre como se dice", () => {
  const [envio] = elegirEnvios([fila()], { ahora: AHORA, cupo: 5 });
  assert.equal(envio.clave, "pregunta");
  assert.equal(envio.celular, "56912345678");
  // Sin «Limitada» y con las palabras menores en minúscula, como lo diría una persona (nombreComoSeDice).
  assert.deepEqual(envio.parametros, ["Ferretería los Andes", "una cotización", "cotice con otra empresa"]);
  assert.match(envio.texto, /^Hola, soy Hugo, de Altius/);
  assert.doesNotMatch(envio.texto, /abri|abrió|leíste|viste/i, "nunca dice que abrió el correo");
  assert.doesNotMatch(envio.texto, /\{\{\d\}\}/, "no quedan variables sin poner");
});

test("sin nombre usable, habla de «tu empresa»", () => {
  const [envio] = elegirEnvios([fila({ empresa: null })], { ahora: AHORA, cupo: 5 });
  assert.match(envio.texto, /Una pregunta corta sobre tu empresa:/);
});

test("no le escribe a quien no corresponde", () => {
  const nadie = elegirEnvios(
    [
      fila({ respondio: true }), // ya conversa con una persona
      fila({ no_contactar: "Pidió no ser contactado" }),
      fila({ telefono: "+56 2 2345 6789" }), // fijo: se llama
      fila({ telefono: null }),
      fila({ ultima_senal_at: hace(0.2) }), // abrió hace 12 minutos: se siente vigilancia
      fila({ toques: 1, ultimo_resultado: "llamada", ultimo_toque_at: hace(24 * 5), estado: "seguimiento" }), // lo trabaja una persona
      fila({ toques: 2, ultimo_resultado: "whatsapp", ultimo_toque_at: hace(24 * 5), estado: "seguimiento" }), // ya van dos
    ],
    { ahora: AHORA, cupo: 10 },
  );
  assert.equal(nadie.length, 0);
});

test("un solo seguimiento, y solo pasados tres días sin respuesta", () => {
  const pronto = fila({ toques: 1, ultimo_resultado: "whatsapp", ultimo_toque_at: hace(24 * 2), estado: "volvio" });
  const aTiempo = fila({ toques: 1, ultimo_resultado: "whatsapp", ultimo_toque_at: hace(24 * 3 + 1), estado: "seguimiento" });
  const envios = elegirEnvios([pronto, aTiempo], { ahora: AHORA, cupo: 5 });
  assert.equal(envios.length, 1);
  assert.equal(envios[0].leadId, aTiempo.lead_id);
  assert.equal(envios[0].clave, "seguimiento");
  assert.equal(envios[0].seguirEnDias, REGLAS.diasDespuesDelSeguimiento);
});

test("respeta el cupo, empieza por los más interesados y no escribe dos veces al mismo celular", () => {
  const clic = fila({ prioridad: 1, empresa: "Clínica Dental Sonríe" });
  const mismoCelular = fila({ prioridad: 1, empresa: "Sonríe sucursal centro" });
  const abrio = fila({ prioridad: 4, telefono: "987654321" });
  const otro = fila({ prioridad: 4, telefono: "998877665" });
  const envios = elegirEnvios([abrio, otro, clic, mismoCelular], { ahora: AHORA, cupo: 2 });
  assert.deepEqual(envios.map((e) => e.leadId), [clic.lead_id, abrio.lead_id]);
  assert.equal(envios[0].parametros[1], "una hora", "a una clínica le piden una hora");
  assert.ok(envios.every((e, i) => envios.findIndex((x) => x.celular === e.celular) === i));
});

test("solo de lunes a viernes, de 10 a 19 en Chile", () => {
  assert.equal(enHorario(AHORA), true);
  assert.equal(enHorario(new Date("2026-10-14T12:30:00Z")), false, "09:30 en Chile");
  assert.equal(enHorario(new Date("2026-10-14T22:10:00Z")), false, "19:10 en Chile");
  assert.equal(enHorario(new Date("2026-10-17T15:00:00Z")), false, "sábado");
});

test("la baja en un clic: el botón y lo mismo escrito, pero un «No» solo no es baja", () => {
  assert.equal(esBaja(BOTON_DE_BAJA), true);
  assert.equal(esBaja("No me interesa"), true);
  assert.equal(esBaja("no, gracias!"), true);
  assert.equal(esBaja("No me escriban más"), true);
  assert.equal(esBaja("no nos interesa por ahora"), true);
  assert.equal(esBaja("No"), false, "responde la pregunta: nadie alcanza a responder, justo el que más interesa");
  assert.equal(esBaja("No, nadie responde a esa hora"), false);
  assert.equal(esBaja("Hola, ¿cuánto cuesta?"), false);
});

test("las plantillas son las que Meta acepta: marketing, sin variables en los bordes, con el botón de baja", () => {
  for (const plantilla of Object.values(PLANTILLAS_DE_PROSPECCION)) {
    assert.match(plantilla.nombre, /^[a-z0-9_]+_v\d+$/);
    assert.equal(plantilla.categoria, "MARKETING");
    assert.doesNotMatch(plantilla.cuerpo, /^\{\{|\}\}$/);
    const variables = plantilla.cuerpo.match(/\{\{\d+\}\}/g) ?? [];
    assert.equal(variables.length, plantilla.ejemplo.length, `${plantilla.nombre}: un ejemplo por variable`);
    assert.ok(plantilla.boton.length <= 25, "Meta corta las respuestas rápidas a 25 caracteres");
    const meta = definicionParaMeta(plantilla);
    assert.deepEqual(meta.components[1], { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: BOTON_DE_BAJA }] });
    assert.ok(textoDePlantilla("pregunta", ["A", "B", "C"]).includes("A"));
  }
});

test("lee bien lo que Meta responde", () => {
  assert.equal(numeroSinWhatsapp("Message undeliverable."), true);
  assert.equal(numeroSinWhatsapp("This message was not delivered to maintain healthy ecosystem engagement."), false);
  assert.equal(pideFrenar("(#131048) Spam rate limit hit"), true);
  assert.equal(pideFrenar("Template name does not exist in the translation"), false);
});

test("el agente tiene correa: apagado por defecto, tope, pausa sola y ensayo que no escribe", () => {
  const migracion = leer("supabase/migrations/20261014180000_whatsapp_automatico_a_prospectos.sql");
  assert.match(migracion, /whatsapp_automatico boolean not null default false/);
  assert.match(migracion, /grant execute on function public\.anotar_whatsapp_automatico\([^)]*\) to service_role/);
  assert.doesNotMatch(migracion, /anotar_whatsapp_automatico\([^)]*\) to authenticated/);

  const corrida = leer("src/lib/prospeccion-whatsapp.server.ts");
  assert.match(corrida, /calidad === "YELLOW" \|\| calidad === "RED"/, "si Meta baja la calidad, se pausa");
  assert.match(corrida, /pideFrenar\(detalle\)/);
  assert.match(corrida, /if \(ensayo\) \{\s*informe\.enviados = envios\.map/, "el ensayo devuelve el plan antes de enviar");
  assert.match(corrida, /Math\.min\(quedan, REGLAS\.porCorrida\)/);

  const crons = JSON.parse(leer("vercel.json")) as { crons: { path: string; schedule: string }[] };
  const cron = crons.crons.find((c) => c.path === "/api/agentes/whatsapp-prospectos");
  assert.ok(cron, "falta el cron");
  assert.match(cron.schedule, /1-5$/, "solo días hábiles");
});
