// Atlas Suite: cada empresa ve solo lo que contrató.
//
// El menú dejó de ser una lista fija. Si estas reglas se aflojan, una empresa
// sin teléfonos vuelve a ver "Campañas", "Colas" y "Grabaciones", y una URL
// escrita a mano vuelve a abrir la operación de otro negocio.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const hay = (ruta: string) => existsSync(new URL(`../${ruta}`, import.meta.url));

const CATALOGO = leer("src/lib/modules.ts");
const SERVIDOR = leer("src/lib/modules.server.ts");
const NAV = leer("src/lib/nav.config.ts");
const LAYOUT = leer("src/app/dashboard/layout.tsx");
const EMPRESAS = leer("src/app/dashboard/admin/empresas/page.tsx");

// Los productos que vende altiusignite.com tienen que existir en la suite.
const PRODUCTOS_DEL_SITIO = ["Atlas Scoring", "Atlas Lead", "Atlas CRM", "Atlas ITSM", "Atlas Financiero", "Atlas Analytics"];

test("el catálogo cubre lo que ofrecemos en el sitio", () => {
  for (const producto of PRODUCTOS_DEL_SITIO) {
    assert.ok(CATALOGO.includes(producto), `falta ${producto} en el catálogo de la suite`);
  }
  for (const modulo of ["leads", "ventas_b2b", "ventas_b2c", "contact_center", "correo", "whatsapp", "bigdata", "analytics", "itsm", "finanzas", "aprende"]) {
    assert.match(CATALOGO, new RegExp(`"${modulo}"`), `falta el módulo ${modulo}`);
  }
});

test("el catálogo es puro: el menú es cliente y no puede arrastrar el servidor", () => {
  assert.doesNotMatch(CATALOGO, /supabase\/server/);
  assert.doesNotMatch(CATALOGO, /next\/navigation/);
  assert.match(SERVIDOR, /supabase\/server/);
  assert.match(SERVIDOR, /contexto_de_mi_empresa/);
});

test("una ruta sin módulo responde 404, no 403", () => {
  // Decir "existe pero no puedes" ya delata que el otro negocio está ahí.
  const codigo = SERVIDOR.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.match(codigo, /notFound\(\)/);
  assert.doesNotMatch(codigo, /403/);
});

test("el menú filtra por los módulos de la empresa activa", () => {
  assert.match(NAV, /function enLosModulos\(item: NavItem, modules\?: AppModule\[\]\)/);
  assert.match(NAV, /visibleSections\(\s*spaceId: NavSpaceId,\s*role: AppRole,\s*modules\?: AppModule\[\],/);
  // Sin respuesta todavía se muestra todo: el servidor igual cierra la página.
  assert.match(NAV, /if \(!modules \|\| !item\.modules\) return true;/);
  assert.match(LAYOUT, /modulos: modules, empresas, duenio \} = await contextoDeMiEmpresa\(\);/);
  assert.match(LAYOUT, /<Sidebar profile=\{profile\} badges=\{badges\} modules=\{modules\} edicion=\{edicion\} duenio=\{duenio\} \/>/);
});

test("lo que es del call center queda marcado como tal", () => {
  for (const item of ["operacion", "campanas-operativas", "reportes", "calidad", "estados-agente", "colas"]) {
    const desde = NAV.indexOf(`id: "${item}",`);
    assert.ok(desde > 0, `no encuentro el ítem ${item}`);
    const siguiente = NAV.indexOf('\n          id: "', desde + 1);
    const bloque = NAV.slice(desde, siguiente === -1 ? NAV.length : siguiente);
    assert.match(bloque, /modules: \[[^\]]*"contact_center"/, `${item} debería ser del contact center`);
  }
});

test("cada ruta de una aplicación tiene su puerta en el servidor", () => {
  const PUERTAS: [string, string][] = [
    ["src/app/dashboard/operacion/layout.tsx", "contact_center"],
    ["src/app/dashboard/campanas/layout.tsx", "contact_center"],
    ["src/app/dashboard/mail/layout.tsx", "correo"],
    ["src/app/dashboard/team/layout.tsx", "contact_center"],
    ["src/app/dashboard/ventas/layout.tsx", "ventas_b2b"],
    ["src/app/dashboard/calidad/layout.tsx", "contact_center"],
    ["src/app/dashboard/reportes/layout.tsx", "contact_center"],
    ["src/app/dashboard/conversaciones/layout.tsx", "contact_center"],
    ["src/app/dashboard/admin/campanas/layout.tsx", "contact_center"],
    ["src/app/dashboard/admin/colas/layout.tsx", "contact_center"],
    ["src/app/dashboard/admin/flujos/layout.tsx", "contact_center"],
    ["src/app/dashboard/admin/estados-agente/layout.tsx", "contact_center"],
    ["src/app/dashboard/admin/cargas/layout.tsx", "leads"],
    ["src/app/dashboard/admin/agentes-sip/layout.tsx", "contact_center"],
    ["src/app/dashboard/admin/integraciones/layout.tsx", "contact_center"],
  ];
  for (const [ruta, modulo] of PUERTAS) {
    assert.ok(hay(ruta), `falta la puerta de ${ruta}`);
    const codigo = leer(ruta);
    assert.match(codigo, new RegExp(`requireModule\\([^)]*"${modulo}"`), `${ruta} no exige ${modulo}`);
  }
});

test("contratar una aplicación es del dueño de la plataforma", () => {
  const MIGRACION = leer("supabase/migrations/20260917220000_modulos_por_empresa.sql");
  assert.match(MIGRACION, /create table if not exists public\.organization_modules/);
  assert.match(MIGRACION, /using \(organization_id = any \(public\.current_org_ids\(\)\)\)/);
  assert.match(MIGRACION, /using \(public\.is_platform_owner\(\)\)/);
  // La pantalla de empresas es la única que contrata, y solo para el dueño.
  assert.match(EMPRESAS, /\{duenioDePlataforma && \(\s*<SectionCard\s*title="Aplicaciones de la suite"/);
  assert.match(EMPRESAS, /cambiarAplicacionDeEmpresa/);
});
