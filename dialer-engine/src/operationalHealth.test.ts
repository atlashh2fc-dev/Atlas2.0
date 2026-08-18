import assert from "node:assert/strict";
import test from "node:test";
import { OperationalHealthTracker } from "./operationalHealth";

const base = {
  amiConnected: true,
  campaignCount: 3,
  recordingEnabled: true,
  release: "abc1234",
  tickMs: 3_000,
};

test("durante el arranque no declara degradado un loop que todavía no ejecuta", () => {
  const tracker = new OperationalHealthTracker(1_000);
  const snapshot = tracker.snapshot({ ...base, now: 20_000 });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.checks.campaignLoop.status, "starting");
});

test("marca degradado un check crítico fallido sin exponer el error original", () => {
  const tracker = new OperationalHealthTracker(1_000);
  tracker.success("agentDirectory", 2_000);
  tracker.failure("agentConfigSync", "ami_update_rejected", 3_000);
  tracker.success("campaignLoop", 3_000);
  const snapshot = tracker.snapshot({ ...base, now: 4_000 });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.checks.agentConfigSync.status, "failed");
  assert.equal(snapshot.checks.agentConfigSync.failure_code, "ami_update_rejected");
});

test("marca degradado un loop crítico que dejó de avanzar", () => {
  const tracker = new OperationalHealthTracker(1_000);
  tracker.success("agentDirectory", 2_000);
  tracker.success("agentConfigSync", 2_000);
  tracker.success("campaignLoop", 2_000);
  const snapshot = tracker.snapshot({ ...base, now: 50_000 });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.checks.campaignLoop.status, "stale");
});

test("AMI desconectado siempre deja el servicio degradado", () => {
  const tracker = new OperationalHealthTracker(1_000);
  const snapshot = tracker.snapshot({ ...base, amiConnected: false, now: 2_000 });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.ami, "disconnected");
});
