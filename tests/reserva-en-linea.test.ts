// Reserva en línea: cualquiera reserva desde Instagram sin cuenta.
//
// Si esto se rompe, la página pública expone la agenda o datos de otras
// personas, dos personas toman la misma hora, un robot llena la agenda, o el
// enlace para cancelar se puede adivinar.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { agruparHoras, archivoCalendario, celularValido, codigoParaWeb, normalizarSlug, serviciosPorCategoria, SLUG_VALIDO } from "../src/lib/reserva.ts";
import { configuracionDesdeFila, tramosPorDia } from "../src/lib/configuracion-agenda.ts";
import { renderizarPlantilla } from "../src/lib/mensajes/plantillas.ts";

const migraciones = readdirSync(new URL("../supabase/migrations", import.meta.url));
const sql = readFileSync(new URL(`../supabase/migrations/${migraciones.find((nombre) => nombre.endsWith("_reserva_en_linea.sql"))}`, import.meta.url), "utf8");
const middleware = readFileSync(new URL("../src/lib/supabase/middleware.ts", import.meta.url), "utf8");

test("el enlace de la clínica se arma limpio desde cualquier nombre", () => {
  assert.equal(normalizarSlug("Clínica Dental Sonríe"), "clinica-dental-sonrie");
  assert.equal(normalizarSlug("  Barbería  El Rey!! "), "barberia-el-rey");
  assert.ok(SLUG_VALIDO.test(normalizarSlug("Veterinaria Patitas de Ñuñoa")));
  assert.ok(!SLUG_VALIDO.test("a"));
  assert.match(codigoParaWeb("demo-vet"), /\/reservar\/demo-vet\?embebido=1/);
});

test("el celular se acepta como la persona lo escriba", () => {
  for (const valido of ["9 8765 4321", "+56 9 8765-4321", "56987654321", "987654321"]) assert.ok(celularValido(valido), valido);
  for (const invalido of ["2 2345 6789", "12345", "+1 555 1234567"]) assert.ok(!celularValido(invalido), invalido);
});

test("las horas se agrupan en mañana y tarde, y los servicios por categoría", () => {
  const grupos = agruparHoras([
    { inicio: "a", hora: "09:00", profesional_id: "p" },
    { inicio: "b", hora: "12:45", profesional_id: "p" },
    { inicio: "c", hora: "15:00", profesional_id: "p" },
  ]);
  assert.deepEqual(grupos.map((grupo) => [grupo.titulo, grupo.horas.length]), [["Mañana", 2], ["Tarde", 1]]);
  const categorias = serviciosPorCategoria([
    { id: "1", nombre: "Corte", categoria: "Cortes", duracion: 30, precio: 10000, descripcion: null },
    { id: "2", nombre: "Barba", categoria: null, duracion: 20, precio: 6000, descripcion: null },
  ]);
  assert.deepEqual(categorias.map((grupo) => grupo.categoria), ["Cortes", "Servicios"]);
});

test("el archivo de calendario es válido y lleva el enlace para cancelar", () => {
  const ics = archivoCalendario({ inicio: "2026-10-08T13:00:00Z", minutos: 45, titulo: "Limpieza, Sonríe", lugar: "Sonríe", enlace: "https://x/reservar/cita/abc" });
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20261008T130000Z/);
  assert.match(ics, /DTEND:20261008T134500Z/);
  assert.match(ics, /SUMMARY:Limpieza\\, Sonríe/);
  assert.match(ics, /reservar\/cita\/abc/);
});

test("el mensaje de reserva lleva el enlace para ver o cancelar", () => {
  const texto = renderizarPlantilla("reserva_recibida", { nombre: "Ana", clinica: "Sonríe", fecha: "08/10 a las 10:00", profesional: "Dra. Vidal", motivo: "Limpieza", token: "f".repeat(64) });
  assert.match(texto, /\/reservar\/cita\/f{64}$/);
});

test("el horario se ordena por día y la configuración trae la reserva", () => {
  const porDia = tramosPorDia([
    { dia_semana: 1, desde: "14:30:00", hasta: "19:00:00" },
    { dia_semana: 1, desde: "09:00:00", hasta: "13:30:00" },
  ]);
  assert.deepEqual(porDia[1], [{ desde: "09:00", hasta: "13:30" }, { desde: "14:30", hasta: "19:00" }]);
  assert.deepEqual(porDia[7], []);
  const cfg = configuracionDesdeFila({ reserva_activa: true, reserva_slug: "demo-vet", reserva_dias: 14 });
  assert.equal(cfg.reserva_activa, true);
  assert.equal(cfg.reserva_dias, 14);
  assert.equal(cfg.reserva_intervalo_min, 15);
});

test("lo público solo pasa por funciones acotadas y nunca por las tablas", () => {
  assert.ok(middleware.includes('"/reservar/"'));
  for (const funcion of ["reserva_publica", "reserva_horas", "reserva_dias_con_horas", "reservar_en_linea", "cita_publica", "cancelar_cita_publica"]) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${funcion}\\([^)]*\\) to anon, authenticated;`), funcion);
  }
  // Las piezas internas no se exponen a anon.
  assert.match(sql, /revoke all on function public\.horas_libres_profesional\([^)]*\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.reserva_config_por_slug\(text\) from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /policy [a-z_]+ on public\.(citas|horarios_atencion|bloqueos_agenda)[\s\S]{0,80}to anon/);
});

test("reservar vuelve a comprobar la hora con candado y frena el abuso", () => {
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('reserva:'/);
  assert.match(sql, /Esa hora se acaba de ocupar/);
  assert.match(sql, />= 150 then/);
  assert.match(sql, />= 3 then/);
  // El enlace de la cita es largo y aleatorio, y solo se acepta con 32+ caracteres.
  assert.match(sql, /gen_random_uuid\(\)::text \|\| gen_random_uuid\(\)::text/);
  assert.match(sql, /length\(coalesce\(p_token, ''\)\) >= 32/);
  // Cancelar en línea solo hasta 2 horas antes.
  assert.match(sql, /inicio > now\(\) \+ interval '2 hours'/);
});
