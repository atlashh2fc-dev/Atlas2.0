import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260825225942_restrict_atlas_lead_legacy_ingest_rpc.sql",
  "utf8",
);

test("hardening limita la revocación a los dos RPC legacy de Atlas Lead", () => {
  const revokedFunctions = [...migration.matchAll(/revoke execute on function public\.([a-z0-9_]+)/g)]
    .map((match) => match[1]);

  assert.deepEqual(revokedFunctions, [
    "sync_atlas_lead_mail_campaign",
    "apply_atlas_lead_mail_result_batch",
  ]);
  assert.doesNotMatch(migration, /revoke execute on all functions/i);
  assert.doesNotMatch(migration, /alter default privileges/i);
});

test("RPC legacy quedan cerrados a clientes y conservan service_role", () => {
  assert.match(
    migration,
    /sync_atlas_lead_mail_campaign[\s\S]*from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /apply_atlas_lead_mail_result_batch[\s\S]*from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.sync_atlas_lead_mail_campaign[\s\S]*to service_role;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.apply_atlas_lead_mail_result_batch[\s\S]*to service_role;/,
  );
  assert.match(migration, /has_function_privilege[\s\S]*raise exception/);
});
