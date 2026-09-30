// Estudio de Look (Atlas Barber): del sillón a la ficha.
//
// Si esto se rompe, un mapa de corte con largos imposibles llega a la cabeza
// del barbero, la IA propone un corte que el cliente no puede mantener, una
// foto de cara se guarda sin autorización o queda viva más de 90 días, o el
// enlace que recibe el cliente abre sin un token largo.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  CATALOGO_CORTES,
  MAPA_NEUTRO,
  ZONAS,
  aplicarBarba,
  colorDeLargo,
  etiquetaLargo,
  normalizarMapa,
  recomendarPorReglas,
  resumenMapa,
} from "../src/lib/look.ts";
import { EsquemaAnalisis, extraerImagen, instruccionDeImagen, instruccionDeRetrato, normalizarRespuesta, ordenDeReferencias } from "../src/lib/look-ia.ts";
import { ajustarSimilitud, alinear, aplicar, type Punto } from "../src/lib/alinear-rostro.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const migracion = (sufijo: string) =>
  leer(`supabase/migrations/${readdirSync(new URL("../supabase/migrations", import.meta.url)).find((nombre) => nombre.endsWith(sufijo))}`);

test("el mapa de corte siempre llega completo y dentro de rango", () => {
  const mapa = normalizarMapa({ superior: { mm: 9999, tecnica: "tijera" }, lateral_bajo: { mm: -4, tecnica: "láser" }, flequillo: { mm: 12.3 } });
  assert.equal(Object.keys(mapa).length, ZONAS.length);
  assert.equal(mapa.superior.mm, 150);
  assert.equal(mapa.lateral_bajo.mm, 0);
  assert.equal(mapa.lateral_bajo.tecnica, MAPA_NEUTRO.lateral_bajo.tecnica);
  assert.equal(mapa.flequillo.mm, 12.5);
  assert.equal(mapa.coronilla.mm, MAPA_NEUTRO.coronilla.mm);
});

test("cada corte del catálogo es un degradado coherente: abajo más corto que arriba", () => {
  for (const corte of CATALOGO_CORTES) {
    assert.equal(Object.keys(corte.mapa).length, ZONAS.length, corte.id);
    if (corte.mapa.lateral_bajo.tecnica === "degradado") {
      assert.ok(corte.mapa.lateral_bajo.mm <= corte.mapa.lateral_alto.mm, `${corte.id}: el lateral bajo no puede ser más largo que el alto`);
    }
    assert.ok(corte.visual.length > 20 && /[a-z]/.test(corte.visual), `${corte.id}: falta la descripción para la simulación`);
  }
});

test("las guardas se leen como las dice un barbero", () => {
  assert.equal(etiquetaLargo(6, "maquina"), "N.º 2 · 6 mm");
  assert.equal(etiquetaLargo(1.5, "degradado"), "N.º 0,5 · 1,5 mm");
  assert.equal(etiquetaLargo(45, "tijera"), "Tijera · 45 mm");
  assert.equal(etiquetaLargo(0), "Sin pelo");
  assert.match(resumenMapa(aplicarBarba(MAPA_NEUTRO, "corta")).join("\n"), /Barba en mejillas: /);
  assert.doesNotMatch(resumenMapa(MAPA_NEUTRO).join("\n"), /Bigote/);
  assert.match(colorDeLargo(6), /^#[0-9a-f]{6}$/);
});

test("sin IA, el catálogo recomienda por facciones y respeta lo que pide el cliente", () => {
  const redondo = recomendarPorReglas({ forma: "redondo", pelo: "liso", densidad: "media", entradas: "no" });
  assert.equal(redondo.length, 4);
  assert.ok(!redondo.slice(0, 2).some(({ corte }) => corte.evita.includes("redondo")), "a un rostro redondo no se le propone primero lo que lo redondea");
  const rizado = recomendarPorReglas({ forma: "ovalado", pelo: "afro", densidad: "alta", entradas: "no" });
  assert.ok(rizado[0].corte.pelos.includes("afro"));
  const entradas = recomendarPorReglas({ forma: "ovalado", pelo: "liso", densidad: "baja", entradas: "marcadas", pedido: "algo para disimular las entradas" });
  assert.ok(entradas[0].corte.disimulaEntradas);
});

test("la respuesta de la IA se normaliza antes de guardarse", () => {
  const mapa = Object.fromEntries(ZONAS.map((zona) => [zona, { mm: 500, tecnica: "tijera" }]));
  const cruda = EsquemaAnalisis.parse({
    foto_util: true,
    problema_foto: "",
    rostro: { forma: "cuadrado", confianza: "alta", frente: "", mandibula: "", pomulos: "", notas: "" },
    pelo: { tipo: "ondulado", grosor: "medio", densidad: "alta", color: "castaño", largo_actual_mm: -3, entradas: "leves", remolinos: "", linea_nacimiento: "" },
    barba: { tiene: false, densidad: "nula", estilo_actual: "" },
    estilo_actual: "",
    propuestas: Array.from({ length: 6 }, (_, indice) => ({
      nombre: indice === 0 ? "  " : `Corte ${indice}`,
      corte_base: indice === 1 ? "mid_fade_crop" : "inventado",
      por_que: "x",
      que_decirle: "",
      mantencion_semanas: 40,
      dificultad: "media",
      barba: "",
      descripcion_visual: "short textured crop",
      mapa,
    })),
    evitar: [],
    notas_para_barbero: "",
  });
  const { analisis, propuestas } = normalizarRespuesta(cruda);
  assert.equal(analisis.pelo.largo_actual_mm, 0);
  assert.equal(propuestas.length, 4, "como mucho cuatro propuestas");
  assert.equal(propuestas[0].nombre, "Propuesta 1");
  assert.equal(propuestas[1].corte_base, "mid_fade_crop");
  assert.equal(propuestas[2].corte_base, null);
  assert.equal(propuestas[0].mantencion_semanas, 12);
  assert.equal(propuestas[0].mapa.superior.mm, 150);

  const inutil = normalizarRespuesta({ ...cruda, foto_util: false });
  assert.equal(inutil.propuestas.length, 0, "si la foto no sirve, no se proponen cortes");
});

test("la simulación conserva a la persona y solo cambia el pelo", () => {
  const texto = instruccionDeImagen({ descripcion_visual: "a mid skin fade", mapa: MAPA_NEUTRO, barba: null }, "perfil", { retrato: true, perfil: true });
  assert.match(texto, /SAME PERSON/);
  assert.match(texto, /Change ONLY the hair and beard/);
  assert.match(texto, /side profile/);
  assert.match(texto, /No text, no logos/);
});

test("las respuestas de los proveedores se leen en todas sus formas conocidas", () => {
  assert.deepEqual(extraerImagen({ images: [{ url: "https://fal.media/x.jpg", content_type: "image/jpeg" }] }), { url: "https://fal.media/x.jpg", mime: "image/jpeg" });
  assert.equal(extraerImagen({ output_image: { data: "QUJD", mime_type: "image/png" } })?.data, "QUJD");
  assert.equal(extraerImagen({ candidates: [{ content: { parts: [{ inlineData: { data: "QUJD", mimeType: "image/png" } }] } }] })?.data, "QUJD");
  assert.equal(extraerImagen({ nada: true }), null);

});

test("una foto de cara no se guarda sin autorización, vive 90 días y el bucket es privado", () => {
  const sql = migracion("_estudio_de_look.sql");
  assert.match(sql, /create trigger looks_exige_consentimiento\s+before insert on public\.looks/);
  assert.match(sql, /values \('looks', 'looks', false/);
  for (const tabla of ["consentimientos_de_imagen", "looks", "look_propuestas", "mapas_de_corte", "uso_ia_looks"]) {
    assert.ok(sql.includes(`'${tabla}'`), `${tabla} sin políticas`);
  }
  assert.match(sql, /as restrictive for all to authenticated using \(organization_id = any \(public\.current_org_ids\(\)\)\)/);
  assert.match(sql, /grant execute on function public\.look_compartido\(text\) to service_role/);
  assert.match(sql, /length\(p_token\) >= 32/);

  const limpieza = leer("src/app/api/looks/limpiar/route.ts");
  assert.match(limpieza, /DIAS_DE_RETENCION = 90/);
  assert.match(limpieza, /retrato_path: null/);
  assert.match(leer("vercel.json"), /"\/api\/looks\/limpiar"/);
  assert.match(leer("src/lib/supabase/middleware.ts"), /"\/api\/looks\/limpiar"/);

  const acciones = leer("src/app/actions/looks.ts");
  assert.match(acciones, /export async function revocarConsentimiento/);
  assert.match(acciones, /storage\.from\(BUCKET_LOOKS\)\.remove\(rutas\)/);
});

test("las rutas de IA leen el look con la sesión de quien pide y tienen tope diario", () => {
  for (const ruta of ["src/app/api/looks/[id]/analizar/route.ts", "src/app/api/looks/[id]/vistas/route.ts", "src/app/api/looks/[id]/retrato/route.ts"]) {
    const codigo = leer(ruta);
    assert.match(codigo, /getCurrentProfile\(\)/, ruta);
    assert.match(codigo, /leerLook\(supabase, /, ruta);
    assert.match(codigo, /usoDeHoy\(admin, look\.organization_id/, ruta);
  }
});

test("looks y propuestas se cruzan diciendo la relación: hay dos y la base rechaza la consulta ambigua", () => {
  // looks.propuesta_aprobada apunta a look_propuestas y look_propuestas.look_id a looks.
  // Sin la pista, PostgREST responde PGRST201 y la ficha recibe los looks vacíos.
  for (const ruta of ["src/app/dashboard/pacientes/[id]/page.tsx", "src/app/actions/looks.ts", "src/app/api/looks/limpiar/route.ts"]) {
    const codigo = leer(ruta);
    assert.doesNotMatch(codigo, /[ ,"(]look_propuestas\(/, `${ruta}: falta !look_propuestas_look_id_fkey`);
    assert.doesNotMatch(codigo, /[ ,"(]looks\(/, `${ruta}: falta !look_propuestas_look_id_fkey`);
  }
});

test("el antes es un retrato de estudio con el mismo pelo, y la simulación no espera la descarga", () => {
  const retrato = instruccionDeRetrato(false);
  assert.match(retrato, /SAME PERSON exactly as they look now/);
  assert.match(retrato, /Keep the hair and beard EXACTLY as they are now/);
  const vistas = leer("src/app/api/looks/[id]/vistas/route.ts");
  assert.match(vistas, /after\(async/, "vistas: guardar en el bucket va después de responder");
  assert.match(vistas, /NextResponse\.json\(\{ ok: true,[^}]*url: imagen\.url/, "vistas: responde con la imagen de inmediato");
  // El retrato sí se guarda antes de responder: el frente de cada simulación lo edita.
  const retratoRuta = leer("src/app/api/looks/[id]/retrato/route.ts");
  assert.ok(retratoRuta.indexOf("retrato_path: ruta") < retratoRuta.indexOf("NextResponse.json({ ok: true, url: imagen.url })"), "retrato: queda guardado antes de responder");
});

test("el frente se simula sobre el retrato del antes, sin mover el encuadre", () => {
  const propuesta = { descripcion_visual: "a textured crop", mapa: MAPA_NEUTRO, barba: null };
  assert.deepEqual(ordenDeReferencias("frontal", { foto: "F", retrato: "R", perfil: "P" }), ["R", "F"], "el retrato va primero: es la imagen que se edita");
  assert.deepEqual(ordenDeReferencias("frontal", { foto: "F", retrato: null, perfil: "P" }), ["F"]);
  assert.deepEqual(ordenDeReferencias("perfil", { foto: "F", retrato: "R", perfil: "P" }), ["F", "R", "P"]);
  assert.deepEqual(ordenDeReferencias("tres_cuartos", { foto: "F", retrato: "R", perfil: "P" }), ["F", "R"]);
  const frente = instruccionDeImagen(propuesta, "frontal", { retrato: true, perfil: false });
  assert.match(frente, /edit THAT image/);
  assert.match(frente, /exact framing/);
  assert.match(frente, /Do not zoom, reframe/);
  assert.doesNotMatch(frente, /from the side/, "no dice que una imagen es de perfil si no la manda");
  const perfil = instruccionDeImagen(propuesta, "perfil", { retrato: true, perfil: true });
  assert.match(perfil, /third image is the client from the side/);
});

test("el antes y la simulación se alinean por la cara o no se comparan", () => {
  // La cara de la simulación salió 20 % más chica, corrida y apenas girada.
  const antes: Punto[] = [
    { x: 400, y: 500 }, { x: 460, y: 505 }, { x: 560, y: 505 }, { x: 620, y: 500 },
    { x: 510, y: 510 }, { x: 510, y: 560 }, { x: 510, y: 640 }, { x: 450, y: 720 }, { x: 570, y: 720 },
  ];
  const verdad = { a: 0.8 * Math.cos(0.05), b: 0.8 * Math.sin(0.05), tx: 60, ty: 90 };
  const despues = antes.map((p) => aplicar(verdad, p));
  const t = ajustarSimilitud(despues, antes);
  assert.ok(t);
  for (let i = 0; i < antes.length; i++) {
    const p = aplicar(t, despues[i]);
    assert.ok(Math.hypot(p.x - antes[i].x, p.y - antes[i].y) < 0.01, "cada punto de la simulación cae sobre el del antes");
  }
  const tam = { ancho: 1024, alto: 1280 };
  const alineado = alinear(despues, antes, tam, tam, 220);
  assert.ok(alineado, "una cara corrida y a otra escala se alinea");
  const { recorte } = alineado;
  assert.ok(recorte.x >= 0 && recorte.y >= 0 && recorte.x + recorte.ancho <= tam.ancho && recorte.y + recorte.alto <= tam.alto, "el recorte cae dentro del antes");

  // Si la cara detectada no es la misma forma (ajuste malo), no se compara.
  const otraCara = despues.map((p, i) => ({ x: p.x + (i % 2 ? 40 : -40), y: p.y + (i % 3 ? 30 : -30) }));
  assert.equal(alinear(otraCara, antes, tam, tam, 220), null);
  assert.equal(alinear(despues.slice(0, 1), antes.slice(0, 1), tam, tam, 220), null);
});
