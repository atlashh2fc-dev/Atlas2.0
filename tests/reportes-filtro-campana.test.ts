import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/dashboard/reportes/page.tsx", import.meta.url), "utf8");

test("el supervisor filtra Reportes por campaña dentro de la página", () => {
  // El supervisor dependía de un selector del encabezado que se borró el
  // 10-09-2026 y se quedó sin forma de elegir campaña. Las dos ramas de la
  // página (supervisor y admin) tienen que dibujar su propio filtro.
  const supervisorBranch = page.slice(page.indexOf('if (profile.role === "supervisor")'), page.indexOf('const { data: campaignList }'));
  assert.match(supervisorBranch, /<CampaignFilter[\s\S]*allLabel="Todas mis campañas"/);
  // Una opción por iniciativa: las campañas hijas se suman a su madre.
  assert.match(supervisorBranch, /get_report_scope_campaign_groups/);
  assert.match(supervisorBranch, /p_campaign_id: campaignScope \|\| null/);
  const adminBranch = page.slice(page.indexOf('const { data: campaignList }'));
  assert.match(adminBranch, /<CampaignFilter campaigns=\{campaigns\}/);
  // El filtro conserva el período elegido al cambiar de campaña.
  assert.match(page, /name="preset" value=\{range\.preset\}/);
});

test("las dos ramas de Reportes abren la campaña madre por canal", () => {
  // Lo que se agrega al tablero del admin no llegaba al supervisor (25-09).
  // El desglose por canal tiene que estar en las dos ramas.
  const supervisorBranch = page.slice(page.indexOf('if (profile.role === "supervisor")'), page.indexOf('const { data: campaignList }'));
  const adminBranch = page.slice(page.indexOf('const { data: campaignList }'));
  for (const branch of [supervisorBranch, adminBranch]) {
    assert.match(branch, /get_campaign_channel_funnel/);
  }
  assert.match(supervisorBranch, /<CampaignChannelTable/);
  assert.match(adminBranch, /channelFunnel=\{/);
  // El selector del admin no lista las hijas como campañas aparte.
  assert.match(adminBranch, /parent_campaign_id === null/);
});
