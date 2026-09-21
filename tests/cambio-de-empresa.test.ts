// Cambiar de empresa nunca puede terminar en un 404.
//
// Pasó en producción: desde /dashboard/ventas mirando Altius, se eligió Geimser
// en el selector y la pantalla quedó en "This page could not be found", porque
// Geimser no tiene Ventas contratado y ese layout responde 404 a propósito.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/lib/nav.config.ts", import.meta.url);
const requireFromNav = createRequire(sourceUrl);
const compiled = ts.transpileModule(readFileSync(sourceUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports: Record<string, unknown> = {};
new Function("require", "exports", compiled)((specifier: string) =>
  requireFromNav(specifier === "./workspace-permissions" ? "./workspace-permissions.ts" : specifier), moduleExports);

const { destinoTrasCambiarEmpresa } = moduleExports as {
  destinoTrasCambiarEmpresa: (pathname: string, modules: string[]) => string;
};

const GEIMSER = ["leads", "contact_center", "correo", "whatsapp"];
const ALTIUS = ["leads", "ventas_b2b", "correo"];
const ID = "0b6f1c2e-6a3d-4f1b-9c2a-7d8e9f0a1b2c";

test("desde Ventas, una empresa sin Ventas vuelve al inicio", () => {
  assert.equal(destinoTrasCambiarEmpresa("/dashboard/ventas", GEIMSER), "/dashboard");
  assert.equal(destinoTrasCambiarEmpresa("/dashboard/ventas/respuestas", GEIMSER), "/dashboard");
  assert.equal(destinoTrasCambiarEmpresa(`/dashboard/ventas/${ID}`, GEIMSER), "/dashboard");
});

test("si la aplicación también existe en la otra empresa, se queda en ella", () => {
  assert.equal(destinoTrasCambiarEmpresa("/dashboard/ventas", ALTIUS), "/dashboard/ventas");
  assert.equal(destinoTrasCambiarEmpresa("/dashboard/leads", GEIMSER), "/dashboard/leads");
  assert.equal(destinoTrasCambiarEmpresa("/dashboard", GEIMSER), "/dashboard");
  assert.equal(destinoTrasCambiarEmpresa("/dashboard/ayuda", []), "/dashboard/ayuda");
});

test("la ficha de un registro es de la empresa anterior: se vuelve al listado", () => {
  assert.equal(destinoTrasCambiarEmpresa(`/dashboard/leads/${ID}`, GEIMSER), "/dashboard/leads");
  assert.equal(destinoTrasCambiarEmpresa(`/dashboard/ventas/${ID}`, ALTIUS), "/dashboard/ventas");
});

test("hacia una empresa sin contact center, sus pantallas quedan cerradas", () => {
  for (const ruta of ["/dashboard/operacion", "/dashboard/reportes/discador", "/dashboard/calidad", "/dashboard/admin/colas"]) {
    assert.equal(destinoTrasCambiarEmpresa(ruta, ALTIUS), "/dashboard", ruta);
  }
});

// El destino se calcula con el menú; la puerta real son los layouts. Si alguien
// cierra una ruta nueva con requireModule y no la declara en el menú, el
// selector volvería a dejar a la persona en un 404.
test("cada ruta cerrada por módulo está declarada en el menú", () => {
  const raiz = fileURLToPath(new URL("../src/app/dashboard", import.meta.url));
  const layouts: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (nombre === "layout.tsx") layouts.push(ruta);
    }
  };
  recorrer(raiz);

  let revisadas = 0;
  for (const layout of layouts) {
    const llamada = readFileSync(layout, "utf8").match(/requireModule\(([^)]*)\)/);
    if (!llamada) continue;
    revisadas += 1;
    const requeridos = [...llamada[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
    const ruta = "/dashboard" + layout.slice(raiz.length).replace(/\/layout\.tsx$/, "");
    const sinNinguno = ["leads", "ventas_b2b", "ventas_b2c", "contact_center", "correo", "whatsapp"]
      .filter((modulo) => !requeridos.includes(modulo));
    assert.equal(destinoTrasCambiarEmpresa(ruta, sinNinguno), "/dashboard", `${ruta} exige ${requeridos.join("/")} pero el menú no lo sabe`);
    assert.equal(destinoTrasCambiarEmpresa(ruta, requeridos), ruta, `${ruta} debería seguir abierta con ${requeridos.join("/")}`);
  }
  assert.ok(revisadas >= 10, "no se encontraron los layouts con requireModule");
});
