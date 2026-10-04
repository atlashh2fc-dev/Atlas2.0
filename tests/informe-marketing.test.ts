// El informe diario de marketing: si las cuentas se equivocan, quien dirige
// cree que se publicó lo comprometido cuando no salió nada (o al revés).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  alertasDelInforme,
  armarInformeDeMarketing,
  cumplimientoDelDia,
  type CampanaDeCorreo,
  type DatosDelInforme,
  type PiezaDelInforme,
} from "../src/lib/informe-marketing.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const pieza = (extra: Partial<PiezaDelInforme>): PiezaDelInforme => ({
  title: "Pieza", channel: "facebook_grupo", format: "imagen", status: "publicado", agent: "Agente 1", target: "Grupo", body: null,
  scheduled_at: "2026-10-05T13:00:00.000Z", published_at: null, external_id: "grupo-2026-10-05-x", ...extra,
});

const campana = (extra: Partial<CampanaDeCorreo>): CampanaDeCorreo => ({
  id: "c1", nombre: "Altius · Atlas CRM Dental", activa: true, limite_diario: 30, base: 426, contactados: 39, pendientes: 387,
  enviados: 39, enviados_24h: 30, fallidos_24h: 0, abrieron: 8, abrieron_24h: 5, clics: 2, clics_24h: 1, rebotes: 0,
  respuestas: 1, respuestas_24h: 1, bajas: 0, ultimo_envio: "2026-10-05T16:40:00.000Z", ...extra,
});

// Martes 6 de octubre de 2026, 11:05 en Chile: ayer fue lunes (día hábil).
const base = (extra: Partial<DatosDelInforme> = {}): DatosDelInforme => ({
  empresa: "Altius", ahora: "2026-10-06T14:05:00.000Z",
  correo: { marca: "Altius Ignite", enviados_hoy: 0, cupo_diario: 90, campanas: [campana({})], respuestas_7d: [] },
  correoError: null,
  piezas: [], proximas: [], agentes: [], eventos: [], analisis: null, ventas: {}, revisiones: [], metaGrupos: 20, ...extra,
});

test("lo hecho se cuenta sin los turnos del plan y separa visibles, en espera y fallidas", () => {
  const piezas = [
    pieza({}), pieza({ status: "publicado" }), pieza({ status: "programado" }), pieza({ status: "fallido" }), pieza({ status: "pausado" }),
    pieza({ external_id: "plan-2026-10-05-agente-1", status: "publicado" }),
    pieza({ channel: "instagram", format: "reel", status: "publicado", external_id: "reel-1" }),
    pieza({ channel: "facebook", format: "reel", status: "programado", external_id: "reel-1-fb" }),
  ];
  const c = cumplimientoDelDia(base({ piezas }));
  assert.deepEqual(c.grupos, { publicadas: 2, esperando: 1, fallidas: 2, meta: 20 });
  assert.deepEqual(c.reels, { publicados: 1, programados: 1, fallidos: 0 });
  assert.deepEqual(c.correo, { enviados24h: 30, cupo: 90, pendientes: 387, activas: 1 });
  assert.deepEqual(c.volvio, { aperturas: 5, clics: 1, respuestas: 1, bajas: 0 });
});

test("avisa cuando no se cumple la meta de grupos, cuando el correo no sale y cuando el equipo falla", () => {
  const datos = base({
    correo: { marca: "Altius Ignite", enviados_hoy: 0, cupo_diario: 90, campanas: [campana({ enviados_24h: 0 })], respuestas_7d: [] },
    agentes: [{ codigo: "1", nombre: "Educador", persona: "Tomás", motor: null, activo: true, ultimo_estado: "atrasado", ultimo_evento_at: null, ultimo_resumen: null }],
    revisiones: [{ revision: "Interés sin gestionar", estado: "alerta", detalle: "2 personas esperan" }, { revision: "Permisos", estado: "ok", detalle: "Bien" }],
  });
  const alertas = alertasDelInforme(datos, cumplimientoDelDia(datos));
  assert.equal(alertas.length, 4);
  assert.match(alertas[0], /Grupos: 0 publicaciones visibles de 20/);
  assert.match(alertas[1], /no salió ningún correo en 24 horas y hay 387 contactos/);
  assert.match(alertas[2], /Equipo: 1 de 1 no cumplieron su turno \(Tomás\)/);
  assert.match(alertas[3], /Interés sin gestionar/);
});

test("el fin de semana no se acusa al correo de no enviar", () => {
  // Lunes 5 de octubre: ayer fue domingo.
  const datos = base({ ahora: "2026-10-05T14:05:00.000Z", correo: { marca: "Altius Ignite", enviados_hoy: 0, cupo_diario: 90, campanas: [campana({ enviados_24h: 0 })], respuestas_7d: [] } });
  assert.equal(alertasDelInforme(datos, cumplimientoDelDia(datos)).some((alerta) => alerta.startsWith("Correo")), false);
});

test("sin puente con Atlas Lead el informe igual sale y lo dice", () => {
  const { html, asunto, alertas } = armarInformeDeMarketing(base({ correo: null, correoError: "Atlas Lead respondió 401" }));
  assert.ok(alertas.some((alerta) => alerta.includes("Correo: sin datos (Atlas Lead respondió 401)")));
  assert.match(html, /Sin datos de correo: Atlas Lead respondió 401/);
  assert.match(asunto, /correo sin dato/);
});

test("el informe trae las ocho secciones, escapa lo que viene de fuera y resume en el asunto", () => {
  const piezas = Array.from({ length: 20 }, (_, i) => pieza({ external_id: `grupo-${i}` }));
  const { html, asunto, alertas } = armarInformeDeMarketing(
    base({
      piezas,
      proximas: [pieza({ title: "Reel <b>dental</b>", channel: "instagram", format: "reel", status: "programado", external_id: "reel-2", scheduled_at: "2026-10-06T16:00:00.000Z" })],
      eventos: [{ agente_codigo: "0", tipo: "decision", resumen: "Foco en <script>Reels</script>", relacionado_con: "9", ocurrido_at: "2026-10-06T12:00:00.000Z" }],
      agentes: [
        { codigo: "0", nombre: "CEO de Marketing", persona: "Catalina", motor: "ceo", activo: true, ultimo_estado: "ok", ultimo_evento_at: "2026-10-06T12:00:00.000Z", ultimo_resumen: "3 decisiones" },
        { codigo: "9", nombre: "Productor de Reels", persona: "Benjamín", motor: null, activo: true, ultimo_estado: "ok", ultimo_evento_at: null, ultimo_resumen: null },
      ],
      ventas: { negocios_nuevos: 2, reuniones_agendadas: 1 },
    }),
  );
  assert.equal(alertas.length, 0);
  assert.match(asunto, /^Marketing Altius · 20 de 20 en grupos · 30 correos · 1 respuestas$/);
  for (const seccion of ["1 · Lo comprometido y lo hecho", "2 · Lo que volvió", "3 · Correo por campaña", "4 · Publicaciones por canal", "5 · Análisis y decisiones del equipo", "6 · El equipo", "7 · Hoy toca", "8 · Revisión del circuito"]) {
    assert.ok(html.includes(seccion), seccion);
  }
  assert.ok(html.includes("Catalina → Benjamín: Foco en &lt;script&gt;Reels&lt;/script&gt;"));
  assert.ok(html.includes("Reel &lt;b&gt;dental&lt;/b&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /Se cumplió lo comprometido/);
});

test("el vigilante arma el informe de marketing y el correo se lee por el puente firmado", () => {
  const ruta = leer("src/app/api/agentes/vigilante/route.ts");
  assert.match(ruta, /armarInformeDeMarketing\(await datosDelInforme\(/);
  assert.match(ruta, /verifyIntegrationV2WorkerAuthorization/);
  const correo = leer("src/lib/marketing-correo.server.ts");
  assert.match(correo, /integrationV2Signature\(destino\.secret, timestamp, Buffer\.from\(rawBody\)\)/);
  assert.match(correo, /"x-atlas-source": "atlas2"/);
});
