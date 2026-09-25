import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Execute the real navigation module with Next.js extensionless imports.
const sourceUrl = new URL("../src/lib/nav.config.ts", import.meta.url);
const requireFromNav = createRequire(sourceUrl);
const compiled = ts.transpileModule(readFileSync(sourceUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports: Record<string, unknown> = {};
new Function("require", "exports", compiled)((specifier: string) =>
  requireFromNav(specifier === "./workspace-permissions" ? "./workspace-permissions.ts" : specifier), moduleExports);

type Role = "admin" | "supervisor" | "agente";
type Item = { id: string; href: string; roles: Role[]; match?: string[] };
type Section = { id: string; label?: string; items: Item[] };
type Space = "console" | "admin";
const nav = moduleExports as {
  visibleSections: (space: Space, role: Role, modules?: string[], duenio?: boolean) => Section[];
  allItemsForRole: (role: Role) => Item[];
  navLabel: (item: Item, role: Role) => string;
  workspaceLabel: (role: Role, space?: Space) => string;
  spaceForPath: (path: string, role?: Role) => Space;
  setupEntryHref: (role: Role) => string | null;
  isItemActive: (item: Item, path: string) => boolean;
};
const items = (space: Space, role: Role) => nav.visibleSections(space, role).flatMap((section) => section.items);
const consoleItems = (role: Role) => items("console", role);
const labels = (space: Space, role: Role) => items(space, role).map((item) => nav.navLabel(item, role));
const sectionLabels = (space: Space, role: Role) => nav.visibleSections(space, role).map((section) => section.label ?? "");

test("Control opera por tarea y deja la configuración en su propio espacio", () => {
  assert.deepEqual(sectionLabels("console", "admin"), ["", "Operación en vivo", "Gestión", "Análisis y calidad"]);
  assert.deepEqual(labels("console", "admin"), [
    "Resumen",
    "Operación",
    "Correo",
    "Pacientes",
    "Ventas",
    "Registros",
    "Validación de ventas",
    "Reportes",
    "Grabaciones y calidad",
  ]);
  assert.deepEqual(sectionLabels("admin", "admin"), ["Contact center", "Clínica", "Plataforma"]);
  assert.deepEqual(labels("admin", "admin"), [
    "Campañas",
    "Colas y enrutamiento",
    "Flujos de gestión",
    "Estados de agente",
    "Cargas y listas",
    "Procedimientos y precios",
    "Materiales e insumos",
    "Empresas",
    "Usuarios y equipos",
    "Telefonía · diagnóstico",
    "Integraciones",
  ]);
  // Ninguna configuración se cuela en la operación diaria.
  assert.equal(consoleItems("admin").some((item) => item.href.startsWith("/dashboard/admin")), false);
  assert.ok(nav.allItemsForRole("admin").every((item) => !item.href.startsWith("/dashboard/conversaciones")));
  // El dueño de la plataforma, aunque sea admin, sí ve Conversaciones (solo lectura).
  assert.ok(
    nav.visibleSections("console", "admin", undefined, true)
      .flatMap((section) => section.items)
      .some((item) => item.href === "/dashboard/conversaciones"),
  );
  assert.equal(nav.workspaceLabel("admin"), "Control");
  assert.equal(nav.workspaceLabel("admin", "admin"), "Configuración");
  assert.equal(nav.setupEntryHref("admin"), "/dashboard/admin/campanas");
});

test("Supervisión opera su equipo y configura aparte a sus ejecutivos", () => {
  assert.deepEqual(labels("console", "supervisor"), ["Resumen", "Operación", "Mi equipo", "Correo", "Pacientes", "Campañas", "Ventas", "Registros", "Validación de ventas", "Historial", "Reportes", "Grabaciones y calidad"]);
  assert.deepEqual(labels("admin", "supervisor"), ["Usuarios y skills"]);
  assert.equal(nav.workspaceLabel("supervisor"), "Supervisión");
  assert.equal(nav.setupEntryHref("supervisor"), "/dashboard/team/usuarios");
  assert.equal(nav.spaceForPath("/dashboard/team/usuarios", "supervisor"), "admin");
  assert.equal(nav.spaceForPath("/dashboard/team", "supervisor"), "console");
  assert.equal(nav.allItemsForRole("supervisor").some((item) => item.href.startsWith("/dashboard/admin")), false);
});

test("Atención ordena el trabajo personal y no tiene configuración", () => {
  assert.deepEqual(labels("console", "agente"), ["Mi jornada", "Mi atención", "Mis registros", "Mi agenda"]);
  assert.equal(nav.workspaceLabel("agente"), "Atención");
  assert.deepEqual(nav.visibleSections("admin", "agente"), []);
  assert.equal(nav.setupEntryHref("agente"), null);
  assert.equal(nav.allItemsForRole("agente").some((item) => item.href.startsWith("/dashboard/operacion")), false);
});

test("command palette shares visible navigation and every destination exists", () => {
  for (const role of ["admin", "supervisor", "agente"] as const) {
    const all = nav.allItemsForRole(role);
    const visible = [...items("console", role), ...items("admin", role)];
    assert.deepEqual(all.slice(0, -1).map((item) => item.id), visible.map((item) => item.id));
    assert.equal(new Set(all.map((item) => item.id)).size, all.length);
    for (const item of all) {
      assert.ok(item.roles.includes(role));
      assert.ok(existsSync(new URL(`../src/app${item.href}/page.tsx`, import.meta.url)), `${role} links to missing ${item.href}`);
    }
  }
});

test("la configuración está a un clic y el menú se personaliza por cuenta", () => {
  const desktop = readFileSync(new URL("../src/components/sidebar.tsx", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../src/components/mobile-nav.tsx", import.meta.url), "utf8");
  // El engranaje vive en el pie, siempre visible: la configuración no se esconde.
  assert.match(desktop, /label="Configuración"/);
  assert.match(desktop, /Volver a la operación/);
  assert.match(desktop, /useViewPreference<NavPreference>\(\s*"sidebar"/);
  assert.match(desktop, /Personalizar menú/);
  assert.match(mobile, /useNavPersonalization\(profile\)/);
  assert.equal(nav.spaceForPath("/dashboard/admin/colas", "admin"), "admin");
  assert.equal(nav.spaceForPath("/dashboard/operacion", "admin"), "console");
});

test("Operations includes Voice monitor context; summary matches only home", () => {
  const items = consoleItems("admin");
  const operation = items.find((item) => item.id === "operacion")!;
  const summary = items.find((item) => item.id === "inicio")!;
  assert.equal(nav.isItemActive(operation, "/dashboard/supervision/monitor"), true);
  assert.equal(nav.isItemActive(operation, "/dashboard/operacion"), true);
  assert.equal(nav.isItemActive(operation, "/dashboard/admin/colas"), false);
  assert.equal(nav.isItemActive(summary, "/dashboard/leads"), false);
  assert.equal(nav.isItemActive(summary, "/dashboard"), true);
});

test("search requires deliberate navigation and scopes persisted history by identity", () => {
  const source = readFileSync(new URL("../src/components/quick-search.tsx", import.meta.url), "utf8");
  assert.match(source, /RECENT_LEADS_KEY}:\$\{userId}:\$\{role}/);
  assert.doesNotMatch(source, /rows\.length === 1.*goToLead/);
  assert.match(source, /if \(cancelled\) return/);
  assert.match(source, /setSearchError\(true\)/);
});

test("home distinguishes unavailable data and uses the operational timezone", () => {
  const source = readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
  assert.match(source, /result\.error \|\| result\.count === null \? "Sin datos"/);
  assert.match(source, /from "@\/lib\/report-range"/);
  assert.match(source, /Alcance global/);
  assert.match(source, /title="Mi jornada"/);
});
