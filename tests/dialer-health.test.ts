import assert from "node:assert/strict";
import test from "node:test";
import { interpretDialerHeartbeat } from "../src/lib/dialer-health-state.ts";

test("heartbeat reciente y ready informa dialer operativo", () => {
  const now = Date.parse("2026-08-18T16:00:30.000Z");
  assert.equal(
    interpretDialerHeartbeat({ status: "ready", reported_at: "2026-08-18T16:00:00.000Z" }, now),
    "ok"
  );
});

test("heartbeat vencido informa dialer caído", () => {
  const now = Date.parse("2026-08-18T16:01:00.000Z");
  assert.equal(
    interpretDialerHeartbeat({ status: "ready", reported_at: "2026-08-18T16:00:00.000Z" }, now),
    "down"
  );
});

test("estado degradado informa dialer caído aunque sea reciente", () => {
  const now = Date.parse("2026-08-18T16:00:10.000Z");
  assert.equal(
    interpretDialerHeartbeat({ status: "degraded", reported_at: "2026-08-18T16:00:00.000Z" }, now),
    "down"
  );
});

test("sin heartbeat todavía conserva unknown para despliegue compatible", () => {
  assert.equal(interpretDialerHeartbeat(null), "unknown");
});
