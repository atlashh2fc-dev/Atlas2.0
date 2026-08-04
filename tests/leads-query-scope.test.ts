import assert from "node:assert/strict";
import test from "node:test";

import { leadRelationForRole } from "../src/lib/leads-query.ts";

test("agents read only the effective-contact view", () => {
  assert.equal(leadRelationForRole("agente"), "agent_contacted_leads");
});

test("supervisors and admins retain the regular leads relation", () => {
  assert.equal(leadRelationForRole("supervisor"), "leads");
  assert.equal(leadRelationForRole("admin"), "leads");
});
