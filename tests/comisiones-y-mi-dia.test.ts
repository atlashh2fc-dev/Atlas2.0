// Comisiones, propinas, productos y el día del profesional.
//
// Si esto se rompe, un barbero ve la agenda o la plata de otro, puede
// confirmar o cancelar citas que le tocan a la recepción, o la liquidación
// suma propinas de otro período.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migraciones = readdirSync(new URL("../supabase/migrations", import.meta.url));
const sql = readFileSync(new URL(`../supabase/migrations/${migraciones.find((nombre) => nombre.endsWith("_comisiones_propinas_y_mi_dia.sql"))}`, import.meta.url), "utf8");
const nav = readFileSync(new URL("../src/lib/nav.config.ts", import.meta.url), "utf8");
const inicio = readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");

test("el profesional solo ve y mueve lo suyo", () => {
  assert.match(sql, /where pr\.perfil_id = auth\.uid\(\)/);
  assert.match(sql, /cita\.profesional_id = v_pro\.id/);
  // Solo puede marcar en sala, atendida o no vino; confirmar y cancelar es de la recepción.
  assert.match(sql, /p_estado not in \('en_sala', 'atendida', 'no_vino'\)/);
  assert.match(sql, /where id = p_cita and profesional_id = v_pro\.id/);
  // Rangos acotados para que nadie descargue la agenda entera.
  assert.match(sql, /interval '8 days'/);
  assert.match(sql, /p_hasta - p_desde > 62/);
});

test("ventas y propinas son de administración y supervisión, nunca anónimas", () => {
  for (const tabla of ["ventas_productos", "propinas"]) {
    assert.match(sql, new RegExp(`create policy ${tabla}_organization_isolation on public\\.${tabla}\\s+as restrictive`));
    assert.match(sql, new RegExp(`create policy ${tabla}_rw on public\\.${tabla}[\\s\\S]{0,120}'admin'::public\\.app_role, 'supervisor'::public\\.app_role`));
  }
  assert.doesNotMatch(sql, /to anon/);
});

test("la liquidación usa el período en hora de Chile y la comisión de cada uno", () => {
  assert.match(sql, /\(v\.vendido_at at time zone 'America\/Santiago'\)::date between p_desde and p_hasta/);
  assert.match(sql, /\(p\.recibida_at at time zone 'America\/Santiago'\)::date between p_desde and p_hasta/);
  assert.match(sql, /s\.monto \* pr\.comision_servicios \/ 100/);
  assert.match(sql, /check \(comision_servicios between 0 and 100 and comision_productos between 0 and 100\)/);
});

test("quien atiende entra directo a Mi día en una clínica", () => {
  assert.match(nav, /id: "mi-dia"[\s\S]{0,200}roles: \["agente"\]/);
  assert.match(nav, /itemIds: \["mi-dia", "inicio"/);
  assert.match(inicio, /if \(profile\.role === "agente"\) redirect\("\/dashboard\/mi-dia"\)/);
});
