import { createHash } from "node:crypto";

import schema from "../../contracts/integration-event-v2.schema.json" with { type: "json" };

export const INTEGRATION_CONTRACT_VERSION = "2.0.0";

export function canonicalIntegrationContract() {
  return schema;
}

export function stableContractJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableContractJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${stableContractJson(object[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function integrationContractSha256(): string {
  return createHash("sha256")
    .update(stableContractJson(schema))
    .digest("hex");
}
