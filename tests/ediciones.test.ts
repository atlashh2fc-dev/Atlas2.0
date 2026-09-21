// Ediciones de Atlas: Center, Dental y Vet son el mismo CRM con otra plantilla.
//
// Si estas reglas se aflojan, una clínica dental vuelve a nacer sin etapas
// (el error "Tu empresa no tiene etapas configuradas"), una pantalla empieza a
// preguntar "¿es dental?" en vez de leer el color del tema, o cualquier sesión
// puede crear empresas.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { EDICIONES, EDICION_INFO, VENTAS_POR_EDICION, parseEdicion } from "../src/lib/ediciones.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const MIGRACION = leer(
  `supabase/migrations/${readdirSync(new URL("../supabase/migrations", import.meta.url)).find((nombre) =>
    nombre.endsWith("_ediciones_de_atlas.sql"),
  )}`,
);
const CSS = leer("src/app/globals.css");
const LAYOUT = leer("src/app/dashboard/layout.tsx");
const ACCION = leer("src/app/actions/organizaciones.ts");

test("son tres ediciones y lo desconocido cae en Center", () => {
  assert.deepEqual([...EDICIONES], ["center", "dental", "vet"]);
  assert.equal(parseEdicion("dental"), "dental");
  assert.equal(parseEdicion("colegio"), "center");
  assert.equal(parseEdicion(null), "center");
  assert.deepEqual(
    EDICIONES.map((edicion) => EDICION_INFO[edicion].sufijo),
    ["Center", "Dental", "Vet"],
  );
});

test("la base acepta exactamente las mismas ediciones que la aplicación", () => {
  assert.match(MIGRACION, /check \(edicion in \('center', 'dental', 'vet'\)\)/);
});

test("cada edición nace con etapas, incluida una ganada y una perdida", () => {
  for (const edicion of EDICIONES) {
    const etapas = [...MIGRACION.matchAll(new RegExp(`\\('${edicion}', '[a-z_]+', '[^']+', \\d+, \\d+, (true|false), (true|false)\\)`, "g"))];
    assert.ok(etapas.length >= 4, `${edicion} tiene pocas etapas`);
    assert.ok(etapas.some((etapa) => etapa[1] === "true"), `${edicion} no tiene etapa ganada`);
    assert.ok(etapas.some((etapa) => etapa[2] === "true"), `${edicion} no tiene etapa perdida`);
  }
});

test("la plantilla se aplica al crear la empresa, no a mano después", () => {
  assert.match(MIGRACION, /perform public\.aplicar_plantilla_de_edicion\(new\.id, new\.edicion\)/);
  assert.match(MIGRACION, /revoke execute on function public\.aplicar_plantilla_de_edicion\(uuid, text\) from anon, authenticated/);
});

test("crear empresas sigue siendo exclusivo del dueño de la plataforma", () => {
  const crear = MIGRACION.slice(MIGRACION.indexOf("function public.crear_organizacion"));
  assert.match(crear.slice(0, 600), /if not public\.is_platform_owner\(\) then/);
  assert.match(ACCION, /p_edicion: edicion/);
  assert.match(ACCION, /esEdicion\(edicion\)/);
});

test("el color sale del tema, no de preguntar la edición en cada pantalla", () => {
  assert.match(LAYOUT, /data-edicion=\{edicion\}/);
  for (const edicion of EDICIONES) {
    assert.match(CSS, new RegExp(`\\[data-edicion="${edicion}"\\] \\{[^}]*--primary:`));
    assert.match(CSS, new RegExp(`\\.dark \\[data-edicion="${edicion}"\\] \\{[^}]*--primary:`));
  }
});

test("el panel pide el contexto de la empresa en una sola consulta", () => {
  assert.match(LAYOUT, /contextoDeMiEmpresa\(\)/);
  assert.doesNotMatch(LAYOUT, /from\("organizations"\)/);
});

test("las clínicas venden a personas un presupuesto de pago único; Center, a empresas por mes", () => {
  assert.equal(VENTAS_POR_EDICION.center.monto, "mensual");
  assert.equal(VENTAS_POR_EDICION.center.personas, false);
  for (const edicion of ["dental", "vet"] as const) {
    assert.equal(VENTAS_POR_EDICION[edicion].monto, "unico");
    assert.equal(VENTAS_POR_EDICION[edicion].personas, true);
  }
  assert.equal(VENTAS_POR_EDICION.dental.cuenta, "Paciente");
  assert.equal(VENTAS_POR_EDICION.vet.cuenta, "Tutor");
});

test("las demos no pueden escribirle a nadie ni dejar entrar a nadie", () => {
  const SEMBRADO = leer("scripts/demo/sembrar-demos.sql");
  // El equipo ficticio no tiene clave y su correo no entrega.
  assert.match(SEMBRADO, /encrypted_password[^;]*''/s);
  assert.doesNotMatch(SEMBRADO, /@(gmail|hotmail|outlook|yahoo)\./);
  // WhatsApp en pausa, conversaciones sin IA y ninguna configuración de IA.
  assert.match(SEMBRADO, /'paused', v_org\)/);
  assert.doesNotMatch(SEMBRADO, /'auto'/);
  assert.doesNotMatch(SEMBRADO, /insert into public\.whatsapp_ai_configs/);
  assert.doesNotMatch(SEMBRADO, /insert into public\.lead_external_refs/);
});

test("el dueño de la plataforma lee conversaciones; un admin cualquiera no", () => {
  const NAV = leer("src/lib/nav.config.ts");
  const SERVIDOR = leer("src/lib/modules.server.ts");
  const POLITICA = leer(
    `supabase/migrations/${readdirSync(new URL("../supabase/migrations", import.meta.url)).find((nombre) =>
      nombre.endsWith("_el_duenio_lee_las_conversaciones.sql"),
    )}`,
  );
  assert.match(NAV, /roles: \["agente", "supervisor"\],\s*\/\/[^\n]*\n\s*duenio: true,/);
  assert.match(SERVIDOR, /canReadConversationContent\) return true;\s*return \(await contextoDeMiEmpresa\(\)\)\.duenio;/);
  // Solo se abre la lectura: la migración no crea políticas de escritura.
  assert.match(POLITICA, /\(select public\.is_platform_owner\(\)\)/);
  assert.doesNotMatch(POLITICA, /for (insert|update|delete|all)/);
});

test("una clínica tiene su propio inicio y no manda a Operación", () => {
  const INICIO = leer("src/app/dashboard/page.tsx");
  const CLINICA = leer("src/components/inicio-clinica.tsx");
  assert.match(INICIO, /if \(contexto\.edicion !== "center"\)/);
  assert.doesNotMatch(CLINICA, /\/dashboard\/operacion/);
});

test("una clínica tiene fichas de pacientes; en Vet, tutores con mascotas y semáforo de vacunas", async () => {
  const { estadoVacuna, edad } = await import("../src/lib/mascotas.ts");
  const hoy = new Date("2026-09-21T15:00:00Z");
  assert.equal(estadoVacuna("2026-09-01", hoy), "vencida");
  assert.equal(estadoVacuna("2026-10-10", hoy), "por_vencer");
  assert.equal(estadoVacuna("2027-03-01", hoy), "al_dia");
  assert.equal(estadoVacuna(null, hoy), "sin_dato");
  assert.equal(edad("2020-09-01", hoy), "6 años");
  assert.equal(edad("2026-01-15", hoy), "8 meses");

  const NAV = leer("src/lib/nav.config.ts");
  assert.match(NAV, /id: "pacientes",[\s\S]*?modules: \["ventas_b2c"\]/);
  const LAYOUT = leer("src/app/dashboard/pacientes/layout.tsx");
  assert.match(LAYOUT, /requireModule\("ventas_b2c"\)/);
  const MIGRACION = leer(
    `supabase/migrations/${readdirSync(new URL("../supabase/migrations", import.meta.url)).find((nombre) =>
      nombre.endsWith("_pacientes_y_mascotas.sql"),
    )}`,
  );
  // Las funciones corren con la sesión de quien llama: la seguridad por fila decide.
  assert.match(MIGRACION, /function public\.crear_paciente[\s\S]*?security invoker/);
  assert.match(MIGRACION, /mascotas_organization_isolation[\s\S]*?as restrictive/);
});
