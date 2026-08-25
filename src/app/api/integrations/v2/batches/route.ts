import { after, NextRequest, NextResponse } from "next/server";

import {
  INTEGRATION_V2_MAX_BYTES,
  IntegrationV2ValidationError,
  integrationV2ContentSha256,
  integrationV2SourceSecret,
  normalizeIntegrationV2Request,
  parseIntegrationV2Batch,
  ringIntegrationV2Doorbell,
  verifyIntegrationV2Signature,
} from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

function errorStatus(message: string) {
  if (message.includes("idempotency_conflict") || message.includes("duplicate_event_id") || message.includes("event_id_conflict")) return 409;
  if (message.includes("campaign_mapping_conflict")) return 409;
  if (message.includes("source_not_active") || message.includes("campaign_not_found") || message.includes("campaign_mapping_not_found")) return 422;
  return 500;
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > INTEGRATION_V2_MAX_BYTES) {
    return NextResponse.json({ error: "El lote supera 1 MiB." }, { status: 413 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length < 1 || rawBody.length > INTEGRATION_V2_MAX_BYTES) {
    return NextResponse.json({ error: "El cuerpo debe medir entre 1 byte y 1 MiB." }, { status: rawBody.length ? 413 : 400 });
  }

  const sourceCode = request.headers.get("x-atlas-source")?.trim().toLowerCase() ?? "";
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(sourceCode) || !idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json({ error: "Faltan x-atlas-source o idempotency-key válidos." }, { status: 400 });
  }

  const secret = integrationV2SourceSecret(sourceCode, process.env.INTEGRATION_HMAC_SECRETS_JSON);
  if (!secret) {
    return NextResponse.json({ error: "Fuente de integración no configurada." }, { status: 503 });
  }
  if (!verifyIntegrationV2Signature({
    secret,
    timestamp: request.headers.get("x-atlas-timestamp"),
    signature: request.headers.get("x-atlas-signature"),
    rawBody,
  })) {
    return NextResponse.json({ error: "Firma no válida o expirada." }, { status: 401 });
  }

  try {
    const decoded: unknown = JSON.parse(rawBody.toString("utf8"));
    const batch = parseIntegrationV2Batch(
      normalizeIntegrationV2Request(decoded, sourceCode, idempotencyKey),
      sourceCode,
    );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("accept_integration_batch_v2", {
      p_source_code: sourceCode,
      p_campaign_id: batch.campaign_id,
      p_campaign_key: batch.campaign_key,
      p_idempotency_key: idempotencyKey,
      p_content_sha256: integrationV2ContentSha256(rawBody),
      p_schema_version: batch.schema_version,
      p_items: batch.items,
      p_metadata: batch.metadata,
    });
    if (error) throw error;
    const canaryOnly = batch.items.every((item) => item.event_type === "integration.canary.v1");
    if (!canaryOnly) {
      const fallbackOrigin = request.nextUrl.origin;
      after(async () => {
        const delivered = await ringIntegrationV2Doorbell({
          fallbackOrigin,
          path: "/api/integrations/v2/worker",
          secret: process.env.INTEGRATION_WORKER_SECRET ?? process.env.CRON_SECRET,
          limit: batch.items.length,
        });
        if (!delivered) console.info("integration_v2_doorbell_deferred_to_cron", { sourceCode });
      });
    }
    return NextResponse.json(
      {
        ...(typeof data === "object" && data !== null ? data : {}),
        acknowledged: true,
        accepted_event_ids: batch.items.map((item) => item.event_id),
        processing_doorbell: canaryOnly ? "not_required" : "scheduled",
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof IntegrationV2ValidationError) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "JSON inválido." },
        { status: 400 },
      );
    }
    const message = error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : "No se pudo aceptar el lote.";
    console.error("integration_v2_accept_failed", { sourceCode, message });
    return NextResponse.json({ error: "No se pudo aceptar el lote." }, { status: errorStatus(message) });
  }
}
