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
import { EsquemaAnalisis, entradaModelo3D, extraerImagen, instruccionDeImagen, normalizarRespuesta } from "../src/lib/look-ia.ts";

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
  const texto = instruccionDeImagen({ descripcion_visual: "a mid skin fade", mapa: MAPA_NEUTRO, barba: null }, "perfil", true);
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

  const rodin = entradaModelo3D("fal-ai/hyper3d/rodin/v2.5", ["a", "b", "c", "d", "e", "f"], "fade");
  assert.equal((rodin as { image_urls: string[] }).image_urls.length, 5, "Rodin acepta hasta cinco vistas");
  assert.equal((rodin as { geometry_file_format: string }).geometry_file_format, "glb");
  assert.deepEqual(Object.keys(entradaModelo3D("fal-ai/trellis-2", ["a"], "fade")).sort(), ["image_url", "resolution", "texture_size"]);
  assert.ok("image_urls" in entradaModelo3D("fal-ai/trellis-2", ["a", "b"], "fade"));
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
  assert.match(limpieza, /modelo_path: null/);
  assert.match(leer("vercel.json"), /"\/api\/looks\/limpiar"/);
  assert.match(leer("src/lib/supabase/middleware.ts"), /"\/api\/looks\/limpiar"/);

  const acciones = leer("src/app/actions/looks.ts");
  assert.match(acciones, /export async function revocarConsentimiento/);
  assert.match(acciones, /storage\.from\(BUCKET_LOOKS\)\.remove\(rutas\)/);
});

test("las rutas de IA leen el look con la sesión de quien pide y tienen tope diario", () => {
  for (const ruta of ["src/app/api/looks/[id]/analizar/route.ts", "src/app/api/looks/[id]/vistas/route.ts", "src/app/api/looks/[id]/modelo/route.ts"]) {
    const codigo = leer(ruta);
    assert.match(codigo, /getCurrentProfile\(\)/, ruta);
    assert.match(codigo, /leerLook\(supabase, /, ruta);
    assert.match(codigo, /usoDeHoy\(admin, look\.organization_id/, ruta);
  }
});
