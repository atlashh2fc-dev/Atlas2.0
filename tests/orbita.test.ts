// Órbita · el monitor de los agentes de marketing con IA.
//
// La ruta de ingreso es una puerta sin sesión: si la firma, la ventana de
// tiempo o el amarre a una empresa se relajan, cualquiera escribe en la red de
// otro. Y el estado de cada agente sale de sus eventos: si la regla se
// equivoca, la pantalla dice "sano" a un agente caído.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CODIGO_CEO,
  aristasDeLaRed,
  cambiosTrasEventos,
  conexionesValidas,
  efectosDelEvento,
  haceCuanto,
  posicionesDeLaRed,
  pulsosRecientes,
  resumenDeOrbita,
  type AgenteOrbita,
  type EventoParaEstado,
} from "../src/lib/orbita.ts";
import { MAX_POR_ENVIO, envioDeOrbitaSchema, validarEnvioOrbita } from "../src/lib/orbita-ingreso.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

const MIGRACION = soloCodigo(leer("supabase/migrations/20261003210000_orbita_agentes.sql"));
const RUTA = leer("src/app/api/orbita/eventos/route.ts");
const MIDDLEWARE = leer("src/lib/supabase/middleware.ts");
const SEMILLA = JSON.parse(leer("scripts/orbita-altius-agentes.json")) as { agentes: Record<string, unknown>[] };
const ORG = "00000000-0000-0000-0000-000000000001";
const AHORA = new Date("2026-10-03T20:00:00.000Z");

// ---------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------

test("Órbita entra al catálogo de la suite y se activa para Altius", () => {
  assert.match(MIGRACION, /organization_modules_module_check check \(module in \([\s\S]*'marketing',\s*'orbita'\s*\)\)/);
  for (const modulo of ["leads", "ventas_b2b", "ventas_b2c", "contact_center", "correo", "whatsapp", "bigdata", "analytics", "itsm", "finanzas", "aprende", "marketing"]) {
    assert.match(MIGRACION, new RegExp(`'${modulo}'`), `la migración deja fuera ${modulo}`);
  }
  assert.match(MIGRACION, /select public\.organization_id_by_slug\('altius'\), 'orbita'/);
});

test("agentes y eventos quedan aislados por empresa; solo el servicio borra; anon no ve nada", () => {
  for (const tabla of ["orbita_agentes", "orbita_eventos"]) {
    assert.match(MIGRACION, new RegExp(`create table if not exists public\\.${tabla}`));
    assert.match(MIGRACION, new RegExp(`alter table public\\.${tabla} enable row level security`));
    assert.match(
      MIGRACION,
      new RegExp(
        `create policy ${tabla}_organization_isolation on public\\.${tabla}\\s+as restrictive\\s+for all to authenticated\\s+using \\(organization_id = any \\(public\\.current_org_ids\\(\\)\\)\\)\\s+with check \\(organization_id = any \\(public\\.current_org_ids\\(\\)\\)\\)`,
      ),
    );
    assert.match(MIGRACION, new RegExp(`${tabla}_insert[\\s\\S]*?'admin'::public\\.app_role, 'supervisor'::public\\.app_role[\\s\\S]*?is_platform_owner\\(\\)`));
    assert.match(MIGRACION, new RegExp(`revoke all on public\\.${tabla} from anon`));
    assert.match(MIGRACION, new RegExp(`grant all on public\\.${tabla} to service_role`));
  }
  assert.doesNotMatch(MIGRACION, /for delete to authenticated/);
  assert.doesNotMatch(MIGRACION, /grant [^;]*delete[^;]* to authenticated/);
});

test("un agente por código y empresa; los eventos se leen por empresa y fecha", () => {
  assert.match(MIGRACION, /constraint orbita_agentes_codigo_uniq unique \(organization_id, codigo\)/);
  assert.match(MIGRACION, /on public\.orbita_eventos \(organization_id, ocurrido_at desc\)/);
  assert.match(MIGRACION, /ultimo_estado text not null default 'inactivo'/);
  assert.match(MIGRACION, /ultimo_estado in \('ok', 'corriendo', 'error', 'atrasado', 'inactivo'\)/);
  assert.match(MIGRACION, /tipo in \('inicio', 'fin', 'error', 'decision', 'alerta', 'recuperacion', 'pulso', 'tarea'\)/);
  assert.match(MIGRACION, /detalle jsonb not null default '\{\}'::jsonb/);
  assert.match(MIGRACION, /ocurrido_at timestamptz not null default now\(\)/);
  assert.match(RUTA, /onConflict: "organization_id,codigo"/);
});

// ---------------------------------------------------------------------------
// La puerta
// ---------------------------------------------------------------------------

test("la ruta exige la firma de Marketing, ventana de 5 min y la empresa de la clave", () => {
  assert.match(RUTA, /process\.env\.MARKETING_INGEST_SECRET/);
  assert.match(RUTA, /status: 503/);
  assert.match(RUTA, /x-atlas-timestamp/);
  assert.match(RUTA, /x-atlas-signature/);
  assert.match(RUTA, /createHmac\("sha256", secreto\)\.update\(`\$\{timestamp\}\.\$\{cuerpo\}`\)/);
  assert.match(RUTA, /timingSafeEqual/);
  assert.match(RUTA, /VENTANA_SEGUNDOS = 300/);
  assert.match(RUTA, /process\.env\.MARKETING_INGEST_ORG/);
  // La empresa sale de la clave, nunca del cuerpo.
  assert.doesNotMatch(RUTA, /organization_id:\s*envio/);
  assert.match(MIDDLEWARE, /"\/api\/orbita\/eventos"/);
});

test("el cuerpo trae agentes, eventos o ambos, hasta 200 de cada uno", () => {
  assert.equal(envioDeOrbitaSchema.safeParse({}).success, false);
  assert.equal(envioDeOrbitaSchema.safeParse({ agentes: [], eventos: [] }).success, false);
  assert.equal(envioDeOrbitaSchema.safeParse({ eventos: [{}] }).success, true);
  assert.equal(envioDeOrbitaSchema.safeParse({ agentes: [{}] }).success, true);
  const demasiados = Array.from({ length: MAX_POR_ENVIO + 1 }, () => ({}));
  assert.equal(envioDeOrbitaSchema.safeParse({ eventos: demasiados }).success, false);
  assert.equal(envioDeOrbitaSchema.safeParse({ agentes: demasiados }).success, false);
});

test("la semilla de Altius es válida: 11 agentes, conexiones a agentes que existen", () => {
  const { agentes, eventos, errores } = validarEnvioOrbita(SEMILLA, ORG, [], AHORA);
  assert.deepEqual(errores, []);
  assert.equal(eventos.length, 0);
  assert.deepEqual(agentes.map((agente) => agente.codigo), ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "G"]);
  const codigos = new Set(agentes.map((agente) => agente.codigo));
  for (const agente of agentes) {
    assert.equal(agente.organization_id, ORG);
    assert.match(agente.color ?? "", /^#[0-9a-f]{6}$/i, `${agente.codigo} sin color`);
    assert.ok(agente.horario, `${agente.codigo} sin horario`);
    for (const conexion of agente.conexiones) assert.ok(conexion.a === "*" || codigos.has(conexion.a), `${agente.codigo} → ${conexion.a}`);
  }
  const porCodigo = new Map(agentes.map((agente) => [agente.codigo, agente]));
  assert.deepEqual(
    porCodigo.get("0")!.conexiones.filter((c) => c.tipo === "ordena").map((c) => c.a).sort(),
    ["1", "2", "3", "4", "5", "9"],
  );
  assert.deepEqual(porCodigo.get("7")!.conexiones.map((c) => `${c.tipo}:${c.a}`), ["reporta:0"]);
  assert.deepEqual(porCodigo.get("8")!.conexiones.map((c) => `${c.tipo}:${c.a}`).sort(), ["reporta:0", "reporta:7"]);
  assert.deepEqual(porCodigo.get("6")!.conexiones.map((c) => `${c.tipo}:${c.a}`), ["reporta:7"]);
  assert.deepEqual(porCodigo.get("G")!.conexiones.map((c) => `${c.tipo}:${c.a}`), ["vigila:*"]);
  for (const publica of ["1", "2", "3", "4", "5"]) {
    assert.deepEqual(porCodigo.get(publica)!.conexiones.map((c) => `${c.tipo}:${c.a}`).sort(), ["datos:6", "datos:7"]);
  }
});

test("la entrada es tolerante: códigos en minúscula, tildes, alias y hora de Chile", () => {
  const { eventos, errores } = validarEnvioOrbita(
    {
      eventos: [
        { agente: "g", tipo: "Recuperación", relacionado_con: 5, ocurrido_at: "2026-10-05 13:00" },
        { agente: 0, tipo: "DECISION", resumen: "  Aprueba 4 piezas  ", relacionado_con: "" },
        { agente: "7", tipo: "heartbeat", ocurrido_at: "2026-10-05T13:00:00Z" },
        { agente: "3", tipo: "fin", estado: "Sano" },
      ],
    },
    ORG,
    ["0", "3", "5", "7", "G"],
    AHORA,
  );
  assert.deepEqual(errores, []);
  // Octubre en Chile es UTC-3: las 13:00 locales son las 16:00 UTC.
  assert.equal(eventos[0].ocurrido_at, "2026-10-05T16:00:00.000Z");
  assert.equal(eventos[0].agente_codigo, "G");
  assert.equal(eventos[0].tipo, "recuperacion");
  assert.equal(eventos[0].relacionado_con, "5");
  assert.equal(eventos[1].agente_codigo, "0");
  assert.equal(eventos[1].tipo, "decision");
  assert.equal(eventos[1].resumen, "Aprueba 4 piezas");
  assert.equal(eventos[1].relacionado_con, null);
  assert.equal(eventos[1].ocurrido_at, AHORA.toISOString(), "sin fecha, es ahora");
  assert.deepEqual(eventos[1].detalle, {});
  assert.equal(eventos[2].tipo, "pulso");
  assert.equal(eventos[2].ocurrido_at, "2026-10-05T13:00:00.000Z");
  assert.equal(eventos[3].estado, "ok");
});

test("un evento de un agente que no existe se rechaza, salvo que venga declarado en el mismo envío", () => {
  const rechazado = validarEnvioOrbita({ eventos: [{ agente: "4", tipo: "inicio" }, { agente: "1", tipo: "fin", relacionado_con: "9" }] }, ORG, ["1"], AHORA);
  assert.equal(rechazado.eventos.length, 0);
  assert.deepEqual(rechazado.errores.map((error) => [error.lista, error.indice, error.codigo]), [
    ["eventos", 0, "4"],
    ["eventos", 1, "1"],
  ]);
  assert.match(rechazado.errores[1].errores[0], /relacionado_con/);

  const aceptado = validarEnvioOrbita(
    { agentes: [{ codigo: "4", nombre: "Comunidad" }], eventos: [{ agente: "4", tipo: "inicio" }] },
    ORG,
    [],
    AHORA,
  );
  assert.deepEqual(aceptado.errores, []);
  assert.equal(aceptado.agentes.length, 1);
  assert.equal(aceptado.eventos.length, 1);
});

test("lo inválido se informa por posición y no se guarda nada a medias", () => {
  const { errores } = validarEnvioOrbita(
    {
      agentes: [
        { codigo: "1", nombre: "Educador", color: "verde" },
        { codigo: "2", nombre: "" },
        { codigo: "3", nombre: "Producto", conexiones: [{ a: "3", tipo: "datos" }] },
        { codigo: "4", nombre: "Comunidad", conexiones: [{ a: "6", tipo: "manda" }] },
        { codigo: "5", nombre: "Oferta" },
        { codigo: "5", nombre: "Oferta otra vez" },
        { codigo: "a b", nombre: "Espacios" },
      ],
      eventos: [
        { agente: "5", tipo: "explota" },
        { agente: "5", tipo: "fin", estado: "feliz" },
        { agente: "5", tipo: "fin", ocurrido_at: "ayer en la tarde" },
        { agente: "5", tipo: "tarea", detalle: "texto" },
      ],
    },
    ORG,
    [],
    AHORA,
  );
  assert.deepEqual(
    errores.map((error) => `${error.lista}#${error.indice}`),
    ["agentes#0", "agentes#1", "agentes#2", "agentes#3", "agentes#5", "agentes#6", "eventos#0", "eventos#1", "eventos#2", "eventos#3"],
  );
  assert.match(errores[4].errores[0], /repetido/);
  assert.match(errores[8].errores.join(" "), /Fecha no reconocida/);
});

test("el estado fijado a mano viaja aparte de las columnas del agente", () => {
  const { agentes, estados } = validarEnvioOrbita({ agentes: [{ codigo: "5", nombre: "Oferta", estado: "late" }, { codigo: "6", nombre: "Monitor" }] }, ORG, [], AHORA);
  assert.equal(estados.get("5"), "atrasado");
  assert.equal(estados.has("6"), false);
  // El upsert no toca ultimo_estado: un reenvío de la ficha no "sana" a nadie.
  for (const agente of agentes) assert.equal("ultimo_estado" in agente, false);
});

// ---------------------------------------------------------------------------
// Del evento al estado
// ---------------------------------------------------------------------------

test("cada tipo de evento mueve el estado como dice la regla", () => {
  const efecto = (evento: Partial<EventoParaEstado> & Pick<EventoParaEstado, "tipo">) => efectosDelEvento({ agente: "3", ...evento });
  assert.deepEqual(efecto({ tipo: "inicio" }), [{ codigo: "3", estado: "corriendo", esDelAgente: true }]);
  assert.deepEqual(efecto({ tipo: "fin" }), [{ codigo: "3", estado: "ok", esDelAgente: true }]);
  assert.deepEqual(efecto({ tipo: "fin", estado: "atrasado" }), [{ codigo: "3", estado: "atrasado", esDelAgente: true }]);
  assert.deepEqual(efecto({ tipo: "error", estado: "ok" }), [{ codigo: "3", estado: "error", esDelAgente: true }]);
  assert.deepEqual(efecto({ tipo: "recuperacion" }), [{ codigo: "3", estado: "corriendo", esDelAgente: true }]);
  for (const tipo of ["decision", "pulso", "tarea", "alerta"] as const) {
    assert.deepEqual(efecto({ tipo }), [{ codigo: "3", estado: null, esDelAgente: true }], `${tipo} sin estado no cambia nada`);
  }
  assert.deepEqual(efecto({ tipo: "pulso", estado: "ok" }), [{ codigo: "3", estado: "ok", esDelAgente: true }]);
});

test("el Guardián recupera a otro agente o lo marca atrasado sin cambiar su propio estado", () => {
  assert.deepEqual(efectosDelEvento({ agente: "G", tipo: "recuperacion", relacionado_con: "5" }), [
    { codigo: "G", estado: null, esDelAgente: true },
    { codigo: "5", estado: "corriendo", esDelAgente: false },
  ]);
  assert.deepEqual(efectosDelEvento({ agente: "G", tipo: "alerta", estado: "atrasado", relacionado_con: "5" }), [
    { codigo: "G", estado: null, esDelAgente: true },
    { codigo: "5", estado: "atrasado", esDelAgente: false },
  ]);
  // Una orden del CEO no cambia el estado de quien la recibe.
  assert.deepEqual(efectosDelEvento({ agente: CODIGO_CEO, tipo: "decision", relacionado_con: "3" }), [{ codigo: "0", estado: null, esDelAgente: true }]);
});

test("los eventos se aplican en orden y lo viejo no tapa lo nuevo", () => {
  const agentes = [
    { codigo: "3", ultimo_evento_at: "2026-10-03T16:00:00.000Z" },
    { codigo: "5", ultimo_evento_at: null },
    { codigo: "G", ultimo_evento_at: "2026-10-03T16:30:00.000Z" },
  ];
  const cambios = cambiosTrasEventos(agentes, [
    // Llegan desordenados: el fin es posterior al inicio.
    { agente: "3", tipo: "fin", resumen: "Publicado en 3 grupos", ocurrido_at: "2026-10-03T16:40:00.000Z" },
    { agente: "3", tipo: "inicio", resumen: "Empieza el turno", ocurrido_at: "2026-10-03T16:30:00.000Z" },
    // Un relleno de antes de lo último que se sabía de 3: a la bitácora, no al estado.
    { agente: "3", tipo: "error", ocurrido_at: "2026-10-03T15:00:00.000Z" },
    { agente: "5", tipo: "error", resumen: "El grupo pidió aprobación", ocurrido_at: "2026-10-03T16:10:00.000Z" },
    { agente: "G", tipo: "recuperacion", resumen: "Relanzó al 5", relacionado_con: "5", ocurrido_at: "2026-10-03T16:45:00.000Z" },
  ]);
  assert.deepEqual(cambios.get("3"), { ultimo_estado: "ok", ultimo_evento_at: "2026-10-03T16:40:00.000Z", ultimo_resumen: "Publicado en 3 grupos" });
  assert.deepEqual(cambios.get("5"), { ultimo_estado: "corriendo", ultimo_evento_at: "2026-10-03T16:10:00.000Z", ultimo_resumen: "El grupo pidió aprobación" });
  assert.deepEqual(cambios.get("G"), { ultimo_evento_at: "2026-10-03T16:45:00.000Z", ultimo_resumen: "Relanzó al 5" });
});

test("un evento sin resumen no borra el último resumen del agente", () => {
  const cambios = cambiosTrasEventos([{ codigo: "1", ultimo_evento_at: null }], [{ agente: "1", tipo: "inicio", ocurrido_at: "2026-10-03T12:00:00.000Z" }]);
  assert.deepEqual(cambios.get("1"), { ultimo_estado: "corriendo", ultimo_evento_at: "2026-10-03T12:00:00.000Z" });
});

// ---------------------------------------------------------------------------
// La red y las cifras
// ---------------------------------------------------------------------------

const agente = (codigo: string, extra: Partial<AgenteOrbita> = {}): AgenteOrbita => ({
  id: codigo,
  codigo,
  nombre: `Agente ${codigo}`,
  rol: null,
  descripcion: null,
  horario: null,
  cron: null,
  color: null,
  conexiones: [],
  ultimo_estado: "ok",
  ultimo_evento_at: null,
  ultimo_resumen: null,
  ...extra,
});

test("el CEO va al centro, los que publican al anillo interno y el resto a la órbita", () => {
  const nodos = posicionesDeLaRed(["G", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0"]);
  assert.equal(nodos.size, 11);
  assert.equal(nodos.get("0")!.anillo, 0);
  for (const codigo of ["1", "2", "3", "4", "5"]) assert.equal(nodos.get(codigo)!.anillo, 1);
  for (const codigo of ["6", "7", "8", "9", "G"]) assert.equal(nodos.get(codigo)!.anillo, 2);
  // El 1 arriba del CEO; nadie encima de otro.
  assert.ok(nodos.get("1")!.y < nodos.get("0")!.y);
  const lista = [...nodos.values()];
  for (const a of lista) for (const b of lista) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r + 20, `${a.codigo} choca con ${b.codigo}`);
});

test("las aristas tienen dirección, «*» se abre a todos y lo que apunta a la nada se descarta", () => {
  const aristas = aristasDeLaRed([
    agente("0", { conexiones: [{ a: "1", tipo: "ordena" }, { a: "1", tipo: "ordena" }, { a: "X", tipo: "ordena" }] }),
    agente("1", { conexiones: [{ a: "0", tipo: "reporta" }] }),
    agente("G", { conexiones: [{ a: "*", tipo: "vigila" }] }),
  ]);
  assert.deepEqual(aristas.map((arista) => arista.id), ["0>1:ordena", "1>0:reporta", "G>0:vigila", "G>1:vigila"]);
  assert.deepEqual(conexionesValidas([{ a: "1", tipo: "ordena" }, { a: 2, tipo: "datos" }, { a: "3", tipo: "manda" }, null]), [{ a: "1", tipo: "ordena", etiqueta: null }]);
  assert.deepEqual(conexionesValidas("no es lista"), []);
});

test("los pulsos son los eventos con destino de los últimos 10 minutos", () => {
  const ahora = Date.parse("2026-10-03T20:00:00.000Z");
  const evento = (id: string, minutos: number, relacionado_con: string | null, agente_codigo = "0") => ({
    id,
    agente_codigo,
    relacionado_con,
    ocurrido_at: new Date(ahora - minutos * 60_000).toISOString(),
  });
  const pulsos = pulsosRecientes([evento("a", 1, "3"), evento("b", 9, "9"), evento("c", 11, "3"), evento("d", 2, null), evento("e", 2, "0")], ahora);
  assert.deepEqual(pulsos.map((pulso) => pulso.id), ["a", "b"]);
});

test("las cifras: sanos, ejecuciones, éxito, recuperaciones y decisiones del CEO", () => {
  const resumen = resumenDeOrbita(
    [agente("0"), agente("1", { ultimo_estado: "corriendo" }), agente("2", { ultimo_estado: "error" }), agente("5", { ultimo_estado: "atrasado" }), agente("9", { ultimo_estado: "inactivo" })],
    { fin24: 9, error24: 1, fin7: 60, finConError7: 2, error7: 3, recuperaciones7: 4, decisionesCeo7: 12 },
  );
  assert.equal(resumen.total, 5);
  assert.equal(resumen.sanos, 2);
  assert.deepEqual(resumen.porEstado, { ok: 1, corriendo: 1, error: 1, atrasado: 1, inactivo: 1 });
  assert.equal(resumen.ejecuciones24, 10);
  assert.equal(resumen.fallidas24, 1);
  assert.equal(resumen.ejecuciones7, 63);
  // (60 − 2) ÷ 63 = 92,06 %
  assert.equal(resumen.tasaExito7, 92.1);
  assert.equal(resumen.recuperaciones7, 4);
  assert.equal(resumen.decisionesCeo7, 12);
  assert.equal(resumenDeOrbita([], { fin24: 0, error24: 0, fin7: 0, finConError7: 0, error7: 0, recuperaciones7: 0, decisionesCeo7: 0 }).tasaExito7, null);
});

test("las horas relativas se leen como una persona", () => {
  const ahora = Date.parse("2026-10-03T20:00:00.000Z");
  const hace = (segundos: number) => new Date(ahora - segundos * 1000).toISOString();
  assert.equal(haceCuanto(hace(10), ahora), "hace un momento");
  assert.equal(haceCuanto(hace(180), ahora), "hace 3 min");
  assert.equal(haceCuanto(hace(2 * 3600), ahora), "hace 2 h");
  assert.equal(haceCuanto(hace(30 * 3600), ahora), "ayer");
  assert.equal(haceCuanto(hace(4 * 86400), ahora), "hace 4 d");
  assert.equal(haceCuanto(null, ahora), "sin actividad");
});
