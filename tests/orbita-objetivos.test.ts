// Órbita · objetivos con evidencia.
//
// Este tablero existe para que quien dirige sepa si se cumplió lo pedido sin
// tener que creerle al agente. Si una cuenta se relaja (un turno del plan que
// suma como publicación, una "en espera de aprobación" que cuenta como
// visible, un día sin datos que se lee como cero), el tablero vuelve a ser
// humo. Estas pruebas fijan esas reglas.

import assert from "node:assert/strict";
import test from "node:test";

import {
  claseDePublicacion,
  codigoDesdeAgente,
  diaDeChile,
  diasDelPeriodo,
  esDiaHabil,
  inicioDelDiaChile,
  periodoValido,
  tableroDeObjetivos,
  type PiezaLeida,
} from "../src/lib/orbita-objetivos.ts";
import { validarEnvioOrbita } from "../src/lib/orbita-ingreso.ts";

const AHORA = new Date("2026-10-04T20:00:00Z"); // 17:00 en Chile (UTC-3)

const pieza = (extra: Partial<PiezaLeida>): PiezaLeida => ({
  channel: "facebook_grupo",
  status: "publicado",
  agent: "Agente 1 · Educador",
  title: "Tip",
  target: "Grupo X",
  body: null,
  external_id: "grupo-2026-10-04-123",
  external_url: null,
  scheduled_at: "2026-10-04T13:00:00Z",
  published_at: "2026-10-04T13:00:00Z",
  ...extra,
});

const base = {
  ahora: AHORA,
  agentes: [
    { codigo: "1", nombre: "Educador", persona: "Tomás", ultimo_resumen: null },
    { codigo: "4", nombre: "Comunidad", persona: null, ultimo_resumen: null },
    { codigo: "G", nombre: "Guardián", persona: null, ultimo_resumen: null },
  ],
  piezas: [] as PiezaLeida[],
  metricas: [],
  eventos: [],
  correo: null,
  correoError: "no configurado",
};

test("días en hora de Chile", () => {
  assert.equal(diaDeChile("2026-10-05T02:00:00Z"), "2026-10-04", "las 23:00 del 04 en Chile siguen siendo el 04");
  assert.equal(inicioDelDiaChile("2026-10-04").toISOString(), "2026-10-04T03:00:00.000Z");
  assert.deepEqual(diasDelPeriodo("semana", AHORA), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(diasDelPeriodo("mes", AHORA).length, 30);
  assert.equal(esDiaHabil("2026-10-04"), false, "domingo");
  assert.equal(esDiaHabil("2026-10-05"), true, "lunes");
  assert.equal(periodoValido("semana"), "semana");
  assert.equal(periodoValido("cualquier-cosa"), "hoy");
});

test("solo cuenta la publicación visible; los turnos del plan no son publicaciones", () => {
  assert.equal(claseDePublicacion({ status: "programado", scheduled_at: "2026-10-04T13:00:00Z" }, AHORA), "espera");
  assert.equal(claseDePublicacion({ status: "programado", scheduled_at: "2026-10-05T13:00:00Z" }, AHORA), "futura");
  assert.equal(codigoDesdeAgente("Agente 10 · Explorador"), "10");

  const tablero = tableroDeObjetivos({
    ...base,
    periodo: "hoy",
    piezas: [
      pieza({}),
      pieza({ external_id: "plan-2026-10-04-agente-1", title: "Agente 1 · 1 grupo" }),
      pieza({ status: "programado", external_id: "grupo-2026-10-04-espera" }),
      pieza({ status: "fallido", external_id: "grupo-2026-10-04-eliminada", body: "Eliminada por el admin" }),
    ],
  });
  const grupos = tablero.objetivos.find((o) => o.id === "grupos")!;
  assert.equal(grupos.hecho, 1, "una sola visible");
  assert.equal(grupos.meta, 20);
  assert.equal(grupos.estado, "en_curso", "hoy todavía no termina");
  assert.deepEqual(
    grupos.desglose.map((d) => d.valor),
    [3, 1, 1],
    "intentadas (sin el plan), en espera, fallidas",
  );
  assert.equal(grupos.evidencia.length, 3);

  const tomas = tablero.agentes.find((a) => a.codigo === "1")!;
  assert.equal(tomas.hecho, 1);
  assert.equal(tomas.meta, 5);
  assert.equal(tomas.puntos, 20);
});

test("la meta corre desde el día en que se pidió", () => {
  const tablero = tableroDeObjetivos({ ...base, periodo: "semana" });
  const grupos = tablero.objetivos.find((o) => o.id === "grupos")!;
  // Pedido desde el 03-10: solo el 03 y el 04 tienen meta.
  assert.equal(grupos.meta, 40);
  assert.equal(grupos.estado, "bajo_meta");
});

test("sin datos no es cero", () => {
  const tablero = tableroDeObjetivos({ ...base, periodo: "hoy" });
  const correo = tablero.objetivos.find((o) => o.id === "correo")!;
  assert.equal(correo.hecho, null);
  assert.equal(correo.estado, "sin_datos");
  assert.match(correo.nota ?? "", /no configurado/);
  const seguidos = tablero.objetivos.find((o) => o.id === "seguidos")!;
  assert.equal(seguidos.hecho, null);
  assert.equal(seguidos.estado, "sin_datos");
  assert.equal(tablero.conDatos, 1, "solo grupos tiene datos");
});

test("correo: el cupo vale de lunes a viernes", () => {
  const dias = diasDelPeriodo("semana", AHORA);
  const porDia = dias.map((dia) => ({ dia, enviados: dia === "2026-10-01" ? 90 : dia === "2026-10-02" ? 45 : 0, fallidos: 0, abrieron: 3, clics: 0, rebotes: 0, respuestas: 0, bajas: 0 }));
  const tablero = tableroDeObjetivos({ ...base, periodo: "semana", correo: { cupo: 90, porDia, respuestas: [] }, correoError: null });
  const correo = tablero.objetivos.find((o) => o.id === "correo")!;
  assert.equal(correo.hecho, 135);
  assert.equal(correo.meta, 5 * 90, "lun 28 a vie 02");
  assert.equal(correo.estado, "bajo_meta");

  const domingo = tableroDeObjetivos({ ...base, periodo: "hoy", correo: { cupo: 90, porDia, respuestas: [] }, correoError: null });
  assert.equal(domingo.objetivos.find((o) => o.id === "correo")!.estado, "no_aplica", "domingo: no hay cupo que cumplir");
});

test("seguidos y grupos activos salen de las métricas que envían los agentes, con su evidencia", () => {
  const tablero = tableroDeObjetivos({
    ...base,
    periodo: "hoy",
    metricas: [
      { dia: "2026-10-04", metrica: "empresas_seguidas", agente_codigo: "4", valor: 2, evidencia: [{ texto: "Clínica A", url: "https://facebook.com/a" }, { texto: "Clínica B" }] },
      { dia: "2026-10-04", metrica: "seguir_revisadas", agente_codigo: "4", valor: 17, evidencia: [] },
      { dia: "2026-10-03", metrica: "grupos_activos", agente_codigo: "10", valor: 18, evidencia: [] },
      { dia: "2026-10-04", metrica: "grupos_solicitados", agente_codigo: "10", valor: 2, evidencia: [{ texto: "Grupo 1", estado: "activo" }, { texto: "Grupo 2", estado: "descartado" }] },
    ],
  });
  const seguidos = tablero.objetivos.find((o) => o.id === "seguidos")!;
  assert.equal(seguidos.hecho, 2);
  assert.equal(seguidos.meta, 15);
  assert.equal(seguidos.evidencia.length, 2);
  assert.equal(seguidos.evidencia[0].url, "https://facebook.com/a");
  assert.match(seguidos.nota ?? "", /2 de 17/);

  const activos = tablero.objetivos.find((o) => o.id === "grupos_activos")!;
  assert.equal(activos.hecho, 18, "la última foto, aunque sea de ayer");
  assert.equal(activos.meta, 25);
  assert.equal(activos.estado, "bajo_meta");
  assert.deepEqual(activos.desglose.map((d) => d.valor), [2, 1, 1]);

  const comunidad = tablero.agentes.find((a) => a.codigo === "4")!;
  assert.match(comunidad.extra ?? "", /2 de 15/, "seguir no se mezcla con publicar");
  assert.equal(comunidad.hecho, 0);
});

test("el circuito: fallas, reintentos y decisiones del periodo", () => {
  const tablero = tableroDeObjetivos({
    ...base,
    periodo: "hoy",
    piezas: [pieza({ status: "fallido" })],
    eventos: [
      { agente_codigo: "4", tipo: "error", estado: "error", resumen: "Sin navegador", relacionado_con: null, ocurrido_at: "2026-10-04T15:00:00Z" },
      { agente_codigo: "G", tipo: "recuperacion", estado: null, resumen: null, relacionado_con: "4", ocurrido_at: "2026-10-04T15:10:00Z" },
      { agente_codigo: "0", tipo: "decision", estado: null, resumen: "Grupos eliminados pasan a reemplazo", relacionado_con: null, ocurrido_at: "2026-10-04T16:00:00Z" },
      { agente_codigo: "0", tipo: "decision", estado: null, resumen: "Antigua", relacionado_con: null, ocurrido_at: "2026-10-01T16:00:00Z" },
    ],
  });
  assert.equal(tablero.circuito.fallas.total, 2, "un turno con error y una publicación fallida");
  assert.equal(tablero.circuito.reintentos.total, 1);
  assert.equal(tablero.circuito.aprendizajes.total, 1, "la decisión de otro día no cuenta hoy");
  assert.equal(tablero.circuito.linea[0].tipo, "aprendizaje", "lo más reciente primero");
  assert.equal(tablero.circuito.linea[1].agente, "Guardián → Comunidad");
});

test("ingreso de métricas: tolerante al entrar, estricto al guardar", () => {
  const ok = validarEnvioOrbita(
    {
      metricas: [
        { dia: "2026-10-04", metrica: "Empresas_Seguidas", valor: 3, agente: 4, evidencia: [{ texto: "Clínica A", url: "javascript:alert(1)" }] },
      ],
    },
    "org",
    ["4"],
  );
  assert.equal(ok.errores.length, 0);
  assert.equal(ok.metricas[0].metrica, "empresas_seguidas");
  assert.equal(ok.metricas[0].agente_codigo, "4");
  assert.equal(ok.metricas[0].evidencia[0].url, null, "solo enlaces http(s)");

  const malos = validarEnvioOrbita(
    {
      metricas: [
        { dia: "2026-02-31", metrica: "x", valor: 1 },
        { dia: "2026-10-04", metrica: "x", valor: -1 },
        { dia: "2026-10-04", metrica: "x", valor: 1, agente: "99" },
        { dia: "2026-10-04", metrica: "y", valor: 1 },
        { dia: "2026-10-04", metrica: "y", valor: 2 },
      ],
    },
    "org",
    ["4"],
  );
  assert.deepEqual(
    malos.errores.map((e) => e.indice),
    [0, 1, 2, 4],
    "día imposible, negativo, agente inexistente y repetida",
  );
});
