import { NextResponse } from "next/server";

import {
  canonicalIntegrationContract,
  INTEGRATION_CONTRACT_VERSION,
  integrationContractSha256,
} from "@/lib/integration-contract-schema";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
      contract_version: INTEGRATION_CONTRACT_VERSION,
      sha256: integrationContractSha256(),
      schema: canonicalIntegrationContract(),
    },
    {
      headers: {
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}
