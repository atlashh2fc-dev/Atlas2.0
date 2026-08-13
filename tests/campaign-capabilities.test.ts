import assert from "node:assert/strict";
import test from "node:test";

import { campaignCapabilityKey } from "../src/lib/campaign-capabilities.ts";

test("normaliza nombres de campaña para relacionarlos con una integración paraguas", () => {
  assert.equal(campaignCapabilityKey("Equifax"), "equifax");
  assert.equal(campaignCapabilityKey("  Campaña Jurídica Chile  "), "campana-juridica-chile");
});
