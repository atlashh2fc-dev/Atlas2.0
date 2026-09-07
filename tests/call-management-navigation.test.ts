import assert from "node:assert/strict";
import test from "node:test";

import { resolveCallManagementNavigation } from "../src/lib/call-management-navigation.ts";

test("an assigned mail lead already open refreshes instead of pushing the same route", () => {
  assert.deepEqual(
    resolveCallManagementNavigation("/dashboard/leads/lead-mail", "lead-mail"),
    { kind: "refresh" }
  );
});

test("an assigned mail lead opened elsewhere navigates once to its typification", () => {
  assert.deepEqual(
    resolveCallManagementNavigation("/dashboard/mail", "lead-mail"),
    {
      kind: "push",
      href: "/dashboard/leads/lead-mail?tipificar=1",
    }
  );
});

test("lead ids are encoded before building the management route", () => {
  assert.deepEqual(
    resolveCallManagementNavigation("/dashboard/mail", "lead/id"),
    {
      kind: "push",
      href: "/dashboard/leads/lead%2Fid?tipificar=1",
    }
  );
});
