import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260826223000_contact_center_queues.sql", import.meta.url),
  "utf8",
);
const navigation = readFileSync(new URL("../src/lib/nav.config.ts", import.meta.url), "utf8");
const scopeMigration = readFileSync(
  new URL("../supabase/migrations/20260826220721_expose_queue_campaigns_to_supervisors.sql", import.meta.url),
  "utf8",
);
const campaignsPage = readFileSync(new URL("../src/app/dashboard/campanas/page.tsx", import.meta.url), "utf8");

test("la cola ACD es independiente de campañas y proveedores", () => {
  assert.match(migration, /create table public\.contact_center_queues/);
  assert.match(migration, /create table public\.contact_center_queue_sources/);
  assert.match(migration, /campaign_id uuid references public\.campaigns/);
  assert.match(migration, /whatsapp_route_id uuid unique references public\.whatsapp_campaign_routes/);
  assert.match(migration, /add column queue_id uuid references public\.contact_center_queues/);
});

test("la cola concentra routing, capacidad, SLA y miembros", () => {
  assert.match(migration, /routing_mode in \('least_loaded', 'manual'\)/);
  assert.match(migration, /service_level_seconds/);
  assert.match(migration, /max_concurrent_per_agent/);
  assert.match(migration, /create table public\.contact_center_queue_members/);
  assert.match(migration, /order by count\(active_conversation\.id\)/);
});

test("colas y enrutamiento vive como módulo estándar de administración", () => {
  assert.match(navigation, /label: "Colas y enrutamiento"/);
  assert.match(navigation, /href: "\/dashboard\/admin\/colas"/);
});

test("una campaña conectada a ACD aparece en el alcance y muestra su canal", () => {
  assert.match(scopeMigration, /contact_center_queue_sources source/);
  assert.match(scopeMigration, /source\.campaign_id = c\.id/);
  assert.match(campaignsPage, /contact_center_queue_sources/);
  assert.match(campaignsPage, /WhatsApp Business/);
});
