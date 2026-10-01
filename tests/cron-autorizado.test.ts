// Los cron de Vercel se autentican con CRON_SECRET, comparado en tiempo
// constante (sin `===`, que delata cuántos caracteres acertó quien prueba).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

test("el helper compara con timingSafeEqual sobre hashes", () => {
  const helper = leer("src/lib/cron-autorizado.ts");
  assert.match(helper, /timingSafeEqual\(hash\(recibido\), hash\(esperado\)\)/);
  assert.match(helper, /if \(!esperado\) return false;/);
});

test("las rutas de cron no comparan el secreto a mano", () => {
  for (const ruta of [
    "src/app/api/integrations/meta/whatsapp/ai-worker/route.ts",
    "src/app/api/mail/inbound/sync/route.ts",
    "src/app/api/looks/limpiar/route.ts",
  ]) {
    const codigo = leer(ruta);
    assert.match(codigo, /cronAutorizado\(request\)/, ruta);
    assert.doesNotMatch(codigo, /!== `Bearer|recibido === esperado/, ruta);
  }
});

test("un admin de empresa no administra cuentas de otra empresa ni del dueño", () => {
  const codigo = leer("src/lib/agent-management.ts");
  const ramaAdmin = codigo.slice(codigo.indexOf('if (actor.role === "admin")'));
  assert.match(ramaAdmin, /from\("profiles"\)\.select\("id"\)\.in\("id", ids\)/);
  assert.match(ramaAdmin, /Solo puedes administrar a personas de tu empresa/);
  assert.match(ramaAdmin, /platform_owners/);
});
