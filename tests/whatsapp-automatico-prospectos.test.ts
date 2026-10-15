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
  DESPEDIDAS,
  PLANTILLAS_DE_PROSPECCION,
  definicionParaMeta,
  elegirEnvios,
  enHorario,
  esBaja,
  esNoSuave,
  numeroSinWhatsapp,
  pideFrenar,
  esRespuestaAutomatica,
  quiereVerElVideo,
  temaParaWhatsapp,
  TEMA_VETERINARIAS,
  textoDePlantilla,
  type FilaDeBandeja,
} from "../src/lib/prospeccion-whatsapp.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

// Martes 14-10-2026, 15:00 en Chile (UTC-3).
const AHORA = new Date("2026-10-14T18:00:00Z");
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 60 * 60 * 1000).toISOString();
const correo = (asunto: string, abierto: boolean) => ({ asunto, enviado_at: hace(72), abierto_at: abierto ? hace(3) : null, clic: false });

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
    correos: [correo("Ferretería Los Andes: ¿Quién le contesta a sus clientes a las 11 de la noche?", true)],
    ...parcial,
  };
}

test("a quien abrió y no le hemos escrito le llega el saludo que retoma su correo", () => {
  const [envio] = elegirEnvios([fila()], { ahora: AHORA, cupo: 5 });
  assert.equal(envio.clave, "saludo");
  assert.equal(envio.celular, "56912345678");
  assert.equal(
    envio.texto,
    "Hola, soy Hugo, de Altius 👋 Hace poco te mandé un correo sobre cómo responderle a tus clientes a las 11 de la noche sin estar despierto. Como los correos se pierden entre facturas y promociones, preferí escribirte por acá. ¿Te cuento en dos líneas de qué se trata?",
  );
  assert.doesNotMatch(envio.texto, /abri|abrió|leíste|viste/i, "dice que se le mandó, nunca que lo abrió");
  assert.doesNotMatch(envio.texto, /\{\{\d\}\}/, "no quedan variables sin poner");
});

test("el tema sale del correo que leyó, y nunca se inventa", () => {
  const chatgpt = correo("Aliwen Spa: ¿los recomienda ChatGPT cuando buscan su rubro?", true);
  const pulso = correo("Aliwen Spa: ¿Le mostramos cómo quedaría su sitio con Atlas Pulso?", false);
  const generico = correo("Último correo sobre su sitio web, Aliwen Spa", true);
  const cierre = correo("Aliwen Spa: ¿lo dejamos para más adelante?", true);
  assert.equal(temaParaWhatsapp([pulso, chatgpt], "Aliwen Spa"), "cómo lograr que Google y ChatGPT recomienden a tu empresa", "gana el que leyó");
  assert.equal(temaParaWhatsapp([pulso, generico], "Aliwen Spa"), "cómo responderle a tus clientes a las 11 de la noche sin estar despierto", "un tema concreto gana al genérico");
  assert.equal(temaParaWhatsapp([generico], "Aliwen Spa"), "tu sitio web");
  assert.equal(temaParaWhatsapp([cierre], "Aliwen Spa"), "una idea para Aliwen");
  assert.equal(temaParaWhatsapp([], null), "una idea para tu negocio");
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

test("un solo último mensaje, pasados tres días sin respuesta, y después sale de la lista", () => {
  const pronto = fila({ toques: 1, ultimo_resultado: "whatsapp", ultimo_toque_at: hace(24 * 2), estado: "volvio" });
  const aTiempo = fila({ toques: 1, ultimo_resultado: "whatsapp", ultimo_toque_at: hace(24 * 3 + 1), estado: "seguimiento" });
  const envios = elegirEnvios([pronto, aTiempo], { ahora: AHORA, cupo: 5 });
  assert.equal(envios.length, 1);
  assert.equal(envios[0].leadId, aTiempo.lead_id);
  assert.equal(envios[0].clave, "ultimo");
  assert.match(envios[0].texto, /^Último mensaje, prometido 🤞 Si algún día quieres que la web y el WhatsApp de Ferretería los Andes respondan solos/);
  // «Prometido» se cumple: vuelve recién pasada la ventana de 14 días de la bandeja, o sea, no vuelve.
  assert.ok(envios[0].seguirEnDias > 14);
});

test("respeta el cupo, empieza por los más interesados y no escribe dos veces al mismo celular", () => {
  const clic = fila({ prioridad: 1, empresa: "Clínica Dental Sonríe" });
  const mismoCelular = fila({ prioridad: 1, empresa: "Sonríe sucursal centro" });
  const abrio = fila({ prioridad: 4, telefono: "987654321" });
  const otro = fila({ prioridad: 4, telefono: "998877665" });
  const envios = elegirEnvios([abrio, otro, clic, mismoCelular], { ahora: AHORA, cupo: 2 });
  assert.deepEqual(envios.map((e) => e.leadId), [clic.lead_id, abrio.lead_id]);
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
    assert.ok(textoDePlantilla("saludo", ["un tema"]).includes("sobre un tema."));
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
  // Sin esto el middleware manda el cron al login y el agente nunca corre.
  assert.match(leer("src/lib/supabase/middleware.ts"), /"\/api\/agentes\/whatsapp-prospectos"/);
});

test("las veterinarias van primero y su saludo retoma la ficha 3D", () => {
  const pyme = fila({ prioridad: 1, telefono: "911111111" });
  const vet = fila({ prioridad: 4, telefono: "922222222", empresa: "Clínica Veterinaria Los Alerces", campana: "Altius · Atlas CRM Vet · Octubre 2026" });
  const [primero, segundo] = elegirEnvios([pyme, vet], { ahora: AHORA, cupo: 5 });
  assert.equal(primero.leadId, vet.lead_id, "aunque la pyme hizo clic, la veterinaria va primero");
  assert.equal(segundo.leadId, pyme.lead_id);
  assert.equal(primero.parametros[0], TEMA_VETERINARIAS);
  assert.match(primero.texto, /te mandé un correo sobre la ficha 3D donde tocas la zona del cuerpo/);
});

test("el video va solo si la respuesta no es un no", () => {
  assert.equal(quiereVerElVideo("Sí, cuéntame"), true);
  assert.equal(quiereVerElVideo("¿Cuánto cuesta?"), true);
  assert.equal(quiereVerElVideo("No, gracias"), false);
  assert.equal(quiereVerElVideo("no por ahora"), false);
  assert.equal(quiereVerElVideo("No me interesa"), false);
  assert.equal(quiereVerElVideo(""), false);
});

test("el video no cuenta en el tope de saludos del día y no se repite", () => {
  const corrida = leer("src/lib/prospeccion-whatsapp.server.ts");
  assert.match(corrida, /\.not\("texto", "like", "🎬%"\)/);
  assert.match(corrida, /yaTieneVideo\.has\(id\)/);
  assert.match(corrida, /23 \* 60 \* 60 \* 1000/, "dentro de las 24 horas que da WhatsApp, con margen");
});

test("el video de veterinarias se puede descargar sin sesión (Meta lo baja desde la URL)", () => {
  assert.match(leer("src/proxy.ts"), /webp\|mp4\)\$/);
});

test("la bienvenida automática de la clínica no cuenta como respuesta para el video", () => {
  // Las dos del 15-10, a los 20 segundos del saludo.
  assert.equal(esRespuestaAutomatica("Bienvenid@ a Veterinaria San Ignacio Arica 🐈🐕 estamos abiertos", 20), true);
  assert.equal(esRespuestaAutomatica("Gracias por comunicarte, soy María Isabel", 600), true);
  assert.equal(esRespuestaAutomatica("Hola, sí, cuéntame", 40), true, "a los 40 segundos casi seguro es automática");
  assert.equal(esRespuestaAutomatica("Hola, sí, cuéntame", 1800), false);
  assert.equal(esRespuestaAutomatica("¿Cuánto cuesta?", null), false);
});

test("las tandas se espacian aunque el cron se dispare varias veces seguidas", () => {
  const corrida = leer("src/lib/prospeccion-whatsapp.server.ts");
  assert.match(corrida, /minutos < REGLAS\.minutosEntreTandas/);
  assert.match(corrida, /esRespuestaAutomatica\(respuesta\.texto, segundos\)/);
});

// --- 15-10-2026: el primer «no» real fue «Por ahora no, gracias» y no partía con «no». ---

test("un «por ahora no» es un no suave: sin video, con despedida", () => {
  for (const texto of ["Por ahora no, gracias", "Ahora no, quizás más adelante", "No por ahora", "Hoy no, gracias", "Todavía no lo necesitamos", "En otra oportunidad"]) {
    assert.equal(esNoSuave(texto), true, texto);
    assert.equal(quiereVerElVideo(texto), false, texto);
  }
  for (const texto of ["Sí, cuéntame", "¿Cuánto cuesta?", "Ya, dale", "Bienvenid@ a Veterinaria San Ignacio Arica, estamos abiertos"]) {
    assert.equal(esNoSuave(texto), false, texto);
  }
  assert.equal(DESPEDIDAS.suave.length < 200, true);
  assert.equal(DESPEDIDAS.baja.length < 200, true);
  assert.doesNotMatch(DESPEDIDAS.suave, /1\.|2\.|opci[oó]n/i);
});

test("el saludo solo sale a quien pasó la verificación, y con el celular corregido si lo hubo", () => {
  const sinVerificar = fila({ empresa: "Sociedad Sin Presencia Limitada" });
  const aprobado = fila({ empresa: "Clinica Veterinaria Real Limitada", telefono: "+56 9 2222 2222" });
  const corregido = fila({ empresa: "Catrico Inversiones Limitada", telefono: "+56 9 3222 0151" });
  const aprobados = new Map([
    [aprobado.lead_id, "56922222222"],
    [corregido.lead_id, "56961254532"],
  ]);
  const envios = elegirEnvios([sinVerificar, aprobado, corregido], { ahora: AHORA, cupo: 5, aprobados });
  assert.deepEqual(
    envios.map((e) => [e.empresa, e.celular]),
    [
      ["Clinica Veterinaria Real Limitada", "56922222222"],
      ["Catrico Inversiones Limitada", "56961254532"],
    ],
  );
  // Sin mapa (el agente viejo, o las pruebas de arriba) nada cambia.
  assert.equal(elegirEnvios([sinVerificar], { ahora: AHORA, cupo: 5 }).length, 1);
  // El último mensaje no pasa por la verificación: ya se le escribió una vez.
  const ultimo = fila({ toques: 1, ultimo_resultado: "whatsapp", estado: "seguimiento", ultimo_toque_at: hace(4 * 24) });
  assert.equal(elegirEnvios([ultimo], { ahora: AHORA, cupo: 5, aprobados: new Map() })[0]?.clave, "ultimo");
});
