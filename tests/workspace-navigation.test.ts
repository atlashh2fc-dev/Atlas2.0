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
type Section = { id: string; items: Item[] };
const nav = moduleExports as {
  visibleSections: (space: "console" | "admin", role: Role) => Section[];
  allItemsForRole: (role: Role) => Item[];
  navLabel: (item: Item, role: Role) => string;
  workspaceLabel: (role: Role) => string;
  isItemActive: (item: Item, path: string) => boolean;
};
const consoleItems = (role: Role) => nav.visibleSections("console", role).flatMap((section) => section.items);
const labels = (role: Role) => consoleItems(role).map((item) => nav.navLabel(item, role));

test("Control is an overview, not a response inbox", () => {
  assert.deepEqual(labels("admin"), [
    "Resumen",
    "Operación",
    "Registros",
    "Reportes",
    "Grabaciones y calidad",
    "Campañas",
    "Colas y enrutamiento",
    "Flujos de gestión",
    "Estados de agente",
    "Cargas y listas",
    "Usuarios y equipos",
    "Telefonía · diagnóstico",
    "Integraciones",
  ]);
  assert.ok(nav.allItemsForRole("admin").every((item) => !item.href.startsWith("/dashboard/conversaciones")));
  assert.ok(consoleItems("admin").some((item) => item.href.startsWith("/dashboard/calidad")));
  assert.equal(nav.workspaceLabel("admin"), "Administración");
  assert.deepEqual(
    nav.visibleSections("admin", "admin").flatMap((section) => section.items.map((item) => item.id)),
    consoleItems("admin").map((item) => item.id),
  );
});

test("Supervisión groups control and review without assuming an agent role", () => {
  assert.deepEqual(labels("supervisor"), ["Resumen", "Operación", "Mi equipo", "Campañas", "Registros", "Historial", "Grabaciones y calidad", "Reportes"]);
  assert.equal(nav.workspaceLabel("supervisor"), "Supervisión");
  assert.deepEqual(nav.visibleSections("admin", "supervisor"), []);
  assert.equal(nav.allItemsForRole("supervisor").some((item) => item.href.startsWith("/dashboard/admin")), false);
});

test("Atención orders personal work without control modules", () => {
  assert.deepEqual(labels("agente"), ["Mi jornada", "Mi atención", "Mis registros", "Mi agenda"]);
  assert.equal(nav.workspaceLabel("agente"), "Atención");
  assert.deepEqual(nav.visibleSections("admin", "agente"), []);
  assert.equal(nav.allItemsForRole("agente").some((item) => item.href.startsWith("/dashboard/operacion")), false);
});

test("command palette shares visible navigation and every destination exists", () => {
  for (const role of ["admin", "supervisor", "agente"] as const) {
    const items = nav.allItemsForRole(role);
    const visible = role === "admin"
      ? consoleItems(role)
      : [...consoleItems(role), ...nav.visibleSections("admin", role).flatMap((section) => section.items)];
    assert.deepEqual(items.slice(0, -1).map((item) => item.id), visible.map((item) => item.id));
    assert.equal(new Set(items.map((item) => item.id)).size, items.length);
    for (const item of items) {
      assert.ok(item.roles.includes(role));
      assert.ok(existsSync(new URL(`../src/app${item.href}/page.tsx`, import.meta.url)), `${role} links to missing ${item.href}`);
    }
  }
});

test("administración no queda oculta detrás de un cambio de espacio", () => {
  const desktop = readFileSync(new URL("../src/components/sidebar.tsx", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../src/components/mobile-nav.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(desktop, /Volver a Control/);
  assert.doesNotMatch(mobile, /Volver a Control/);
  assert.doesNotMatch(desktop, /profile\.role === "admin" && !inAdmin/);
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
