// Marketing · calendario (etapa 1): lo que no puede aflojarse.
//
// La ruta de ingreso es una puerta sin sesión: si la firma, la ventana de
// tiempo o el amarre a una empresa se relajan, cualquiera escribe en el
// calendario de otro. Y el calendario tiene que poner cada pieza en el día de
// Chile que corresponde, no en el de UTC.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  agruparPorDia,
  diasDeLaPieza,
  enlaceDelCalendario,
  filtrosDesdeParams,
  limitesDelRango,
  rangoDelCalendario,
  resumenDelRango,
  tipoDeArchivo,
  type PiezaMarketing,
} from "../src/lib/marketing.ts";
import { envioDeMarketingSchema, instanteDesdeTexto, validarPiezas } from "../src/lib/marketing-ingreso.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

const MIGRACION = soloCodigo(leer("supabase/migrations/20261003120000_calendario_de_marketing.sql"));
const RUTA = leer("src/app/api/marketing/items/route.ts");
const MIDDLEWARE = leer("src/lib/supabase/middleware.ts");
const PLAN = JSON.parse(leer("scripts/marketing-altius-semana-41.json")) as { items: Record<string, unknown>[] };
const ORG = "00000000-0000-0000-0000-000000000001";

const pieza = (extra: Partial<PiezaMarketing> = {}): PiezaMarketing => ({
  id: "p1",
  campaign: null,
  channel: "instagram",
  format: "reel",
  title: "Reel",
  body: null,
  target: null,
  product: null,
  agent: null,
  asset_url: null,
  external_url: null,
  status: "programado",
  scheduled_at: "2026-10-05T16:00:00.000Z",
  ends_at: null,
  published_at: null,
  metrics: {},
  source: "claude",
  updated_at: "2026-10-03T12:00:00.000Z",
  ...extra,
});

test("la tabla queda aislada por empresa y solo el servicio borra", () => {
  assert.match(MIGRACION, /create table if not exists public\.marketing_items/);
  assert.match(MIGRACION, /alter table public\.marketing_items enable row level security/);
  assert.match(MIGRACION, /as restrictive\s+for all to authenticated\s+using \(organization_id = any \(public\.current_org_ids\(\)\)\)\s+with check \(organization_id = any \(public\.current_org_ids\(\)\)\)/);
  // Escriben admin, supervisor o el dueño; el agente solo mira.
  assert.match(MIGRACION, /marketing_items_insert[\s\S]*?'admin'::public\.app_role, 'supervisor'::public\.app_role[\s\S]*?is_platform_owner\(\)/);
  assert.match(MIGRACION, /marketing_items_update[\s\S]*?'admin'::public\.app_role, 'supervisor'::public\.app_role/);
  assert.doesNotMatch(MIGRACION, /for delete to authenticated/);
  assert.doesNotMatch(MIGRACION, /grant [^;]*delete[^;]* to authenticated/);
  assert.match(MIGRACION, /revoke all on public\.marketing_items from anon/);
});

test("el upsert de los alimentadores tiene su índice único sin condición", () => {
  assert.match(MIGRACION, /create unique index if not exists marketing_items_external_uidx\s+on public\.marketing_items \(organization_id, source, external_id\);/);
  assert.match(RUTA, /onConflict: "organization_id,source,external_id"/);
});

test("el catálogo de la base y el de la aplicación son el mismo", () => {
  for (const canal of ["instagram", "facebook", "facebook_grupo", "email", "meta_ads", "whatsapp", "web", "tiktok", "linkedin", "otro"]) {
    assert.match(MIGRACION, new RegExp(`'${canal}'`), `falta el canal ${canal}`);
  }
  for (const estado of ["idea", "borrador", "programado", "publicado", "pausado", "fallido"]) {
    assert.match(MIGRACION, new RegExp(`'${estado}'`));
  }
  assert.match(MIGRACION, /'aprende',\s+'marketing'\s*\)\);/);
  assert.match(MIGRACION, /organization_id_by_slug\('altius'\), 'marketing'/);
});

test("la ruta exige firma fresca y sin clave no acepta nada", () => {
  assert.match(RUTA, /process\.env\.MARKETING_INGEST_SECRET/);
  assert.match(RUTA, /if \(!secreto\)[\s\S]{0,120}status: 503/);
  assert.match(RUTA, /createHmac\("sha256", secreto\)\.update\(`\$\{timestamp\}\.\$\{cuerpo\}`\)/);
  assert.match(RUTA, /timingSafeEqual/);
  assert.match(RUTA, /VENTANA_SEGUNDOS = 300/);
  // El cuerpo se firma crudo: parsear antes de comprobar rompería la firma.
  assert.ok(RUTA.indexOf("await request.text()") < RUTA.indexOf("JSON.parse"));
  assert.ok(RUTA.indexOf("firmaValida(") < RUTA.indexOf("createAdminClient()"), "usa la clave de servicio antes de validar la firma");
});

test("la empresa la fija el servidor, no el cuerpo", () => {
  assert.match(RUTA, /process\.env\.MARKETING_INGEST_ORG\?\.trim\(\) \|\| "altius"/);
  assert.doesNotMatch(RUTA, /datos\.(empresa|organization)/);
  assert.match(MIDDLEWARE, /"\/api\/marketing\/items"/);
  assert.match(MIDDLEWARE, /MACHINE_ONLY_PATHS\.has\(request\.nextUrl\.pathname\)/);
});

test("las horas sin zona son de Chile; con zona se respetan", () => {
  // 5 de octubre de 2026: Chile en horario de verano (UTC-3).
  assert.equal(instanteDesdeTexto("2026-10-05 13:00")?.toISOString(), "2026-10-05T16:00:00.000Z");
  assert.equal(instanteDesdeTexto("2026-10-05T13:00")?.toISOString(), "2026-10-05T16:00:00.000Z");
  assert.equal(instanteDesdeTexto("2026-10-05T13:00:00-03:00")?.toISOString(), "2026-10-05T16:00:00.000Z");
  assert.equal(instanteDesdeTexto("2026-10-05T16:00:00Z")?.toISOString(), "2026-10-05T16:00:00.000Z");
  assert.equal(instanteDesdeTexto("5 de octubre"), null);
  assert.equal(instanteDesdeTexto("2026-10-05 25:00"), null);
});

test("el ingreso tolera mayúsculas, tildes y alias, y guarda solo valores del catálogo", () => {
  const { filas, errores } = validarPiezas(
    [
      { external_id: " r1 ", source: "Claude", channel: "IG", format: "Reel", status: "Programado", title: "  Hola ", product: "pulso", scheduled_at: "2026-10-05 13:00", metrics: { leads: "3" } },
      { external_id: "r2", source: "meta", channel: "Grupo FB", format: "video", title: "Grupo", scheduled_at: "2026-10-05 15:05", product: "" },
    ],
    ORG,
  );
  assert.deepEqual(errores, []);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].external_id, "r1");
  assert.equal(filas[0].channel, "instagram");
  assert.equal(filas[0].status, "programado");
  assert.equal(filas[0].product, "atlas_pulso");
  assert.equal(filas[0].title, "Hola");
  assert.deepEqual(filas[0].metrics, { leads: 3 });
  assert.equal(filas[0].organization_id, ORG);
  assert.equal(filas[1].channel, "facebook_grupo");
  assert.equal(filas[1].status, "borrador", "sin estado nace en borrador");
  assert.equal(filas[1].product, null);
  // Cada fila trae todas las columnas: reenviar reemplaza la pieza completa.
  assert.deepEqual(Object.keys(filas[0]).sort(), Object.keys(filas[1]).sort());
});

test("una pieza mala se informa con su posición y no deja pasar el lote", () => {
  const { filas, errores } = validarPiezas(
    [
      { external_id: "ok", source: "claude", channel: "instagram", format: "reel", title: "Bien", scheduled_at: "2026-10-05 13:00" },
      { external_id: "mal", source: "claude", channel: "myspace", format: "reel", title: "", scheduled_at: "mañana", asset_url: "ftp://x" },
      { external_id: "ok", source: "claude", channel: "instagram", format: "reel", title: "Repetida", scheduled_at: "2026-10-05 13:00" },
      { external_id: "rango", source: "claude", channel: "meta_ads", format: "anuncio", title: "Al revés", scheduled_at: "2026-10-11 09:00", ends_at: "2026-10-05 09:00" },
      { external_id: "sin-fecha", source: "claude", channel: "instagram", format: "reel", title: "Sin fecha" },
    ],
    ORG,
  );
  assert.equal(filas.length, 1);
  assert.deepEqual(errores.map((error) => error.indice), [1, 2, 3, 4]);
  assert.match(errores[3].errores.join(" | "), /scheduled_at: Falta la fecha/);
  const mala = errores[0].errores.join(" | ");
  assert.match(mala, /channel/);
  assert.match(mala, /title/);
  assert.match(mala, /scheduled_at/);
  assert.match(mala, /asset_url/);
  assert.match(errores[1].errores[0], /repetido/);
  assert.match(errores[2].errores[0], /ends_at: Termina antes de empezar/);
});

test("el cuerpo acepta una pieza suelta o un lote de hasta 200", () => {
  assert.equal(envioDeMarketingSchema.safeParse({ external_id: "x" }).success, true);
  assert.equal(envioDeMarketingSchema.safeParse({ items: [] }).success, false);
  assert.equal(envioDeMarketingSchema.safeParse({ items: Array.from({ length: 201 }, () => ({})) }).success, false);
});

test("el plan de ejemplo de Altius entra completo", () => {
  const { filas, errores } = validarPiezas(PLAN.items, ORG);
  assert.deepEqual(errores, []);
  assert.equal(filas.length, PLAN.items.length);
  const reelDental = filas.find((fila) => fila.external_id === "s41-reel-dental-ig");
  assert.equal(reelDental?.scheduled_at, "2026-10-05T16:00:00.000Z");
  // Un reel por red: Instagram y Facebook.
  assert.equal(filas.filter((fila) => fila.format === "reel").length, 12);
  assert.equal(filas.filter((fila) => fila.channel === "meta_ads").length, 3);
});

test("la semana va de lunes a domingo y el mes completa sus semanas", () => {
  // Sábado 3 de octubre de 2026.
  const semana = rangoDelCalendario("semana", "2026-10-03");
  assert.equal(semana.desde, "2026-09-28");
  assert.equal(semana.hasta, "2026-10-05");
  assert.equal(semana.dias.length, 7);
  assert.equal(semana.titulo, "Semana del 28 de septiembre al 4 de octubre");
  assert.equal(semana.siguiente, "2026-10-10");

  const lunes = rangoDelCalendario("semana", "2026-10-05");
  assert.equal(lunes.desde, "2026-10-05");
  assert.equal(lunes.titulo, "Semana del 5 al 11 de octubre");

  const mes = rangoDelCalendario("mes", "2026-10-17");
  assert.equal(mes.desde, "2026-09-28");
  assert.equal(mes.hasta, "2026-11-02");
  assert.equal(mes.dias.length % 7, 0);
  assert.equal(mes.titulo, "Octubre de 2026");
  assert.equal(mes.anterior, "2026-09-01");
  assert.equal(mes.siguiente, "2026-11-01");

  // Los límites de la consulta son la medianoche de Chile, no la de UTC.
  assert.deepEqual(limitesDelRango(lunes), { desde: "2026-10-05T03:00:00.000Z", hasta: "2026-10-12T03:00:00.000Z" });
});

test("cada pieza cae en su día de Chile; una campaña, en todos sus días", () => {
  const semana = rangoDelCalendario("semana", "2026-10-05");
  // 22:30 del lunes en Chile ya es martes en UTC.
  assert.deepEqual(diasDeLaPieza({ scheduled_at: "2026-10-06T01:30:00.000Z", ends_at: null }, semana.dias), ["2026-10-05"]);
  const anuncio = { scheduled_at: "2026-10-05T12:00:00.000Z", ends_at: "2026-10-12T02:59:00.000Z" };
  assert.deepEqual(diasDeLaPieza(anuncio, semana.dias), semana.dias);
  const porDia = agruparPorDia([pieza({ id: "tarde", scheduled_at: "2026-10-05T22:00:00.000Z" }), pieza({ id: "temprano" })], semana.dias);
  assert.deepEqual(porDia.get("2026-10-05")?.map((p) => p.id), ["temprano", "tarde"]);
});

test("el resumen cuenta por estado y canal y suma los leads", () => {
  const resumen = resumenDelRango([
    pieza({ status: "publicado", metrics: { leads: 2, reach: 900 } }),
    pieza({ status: "publicado", channel: "facebook", metrics: { leads: 1 } }),
    pieza({ status: "programado", channel: "email" }),
  ]);
  assert.equal(resumen.total, 3);
  assert.deepEqual(resumen.porEstado, { publicado: 2, programado: 1 });
  assert.deepEqual(resumen.porCanal, { instagram: 1, facebook: 1, email: 1 });
  assert.equal(resumen.leads, 3);
});

test("los filtros de la URL que no son del catálogo se ignoran", () => {
  assert.deepEqual(filtrosDesdeParams({ canal: "instagram", estado: "hackeado", producto: ["crm_vet", "x"], campana: "  A01  " }), {
    canal: "instagram",
    producto: "crm_vet",
    campana: "A01",
  });
  assert.equal(
    enlaceDelCalendario("mes", "2026-10-01", { canal: "email" }),
    "/dashboard/marketing?vista=mes&fecha=2026-10-01&canal=email",
  );
  assert.equal(tipoDeArchivo("https://cdn.x/reel.MP4?v=2"), "video");
  assert.equal(tipoDeArchivo("https://cdn.x/a.webp"), "imagen");
  assert.equal(tipoDeArchivo("https://drive.google.com/file/d/1"), "otro");
});
