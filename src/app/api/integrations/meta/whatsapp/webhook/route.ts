import { after, NextRequest, NextResponse } from "next/server";

import {
  parseWhatsAppWebhook,
  verifyMetaWebhookSignature,
} from "@/lib/whatsapp";
import { processWhatsAppEvents } from "@/lib/whatsapp-webhook-processing";
import { respondToWhatsAppInbound } from "@/lib/mercury-whatsapp";
import { captureWhatsAppMessageMedia } from "@/lib/whatsapp-media";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const suppliedToken = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expectedToken && suppliedToken === expectedToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.json({ error: "Verificación rechazada." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload demasiado grande." }, { status: 413 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length < 1 || rawBody.length > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload inválido." }, { status: rawBody.length ? 413 : 400 });
  }

  const appSecret = process.env.WHATSAPP_META_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "Integración no configurada." }, { status: 503 });
  }
  if (!verifyMetaWebhookSignature(appSecret, rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { aiCandidates, mediaCandidates, ...result } = await processWhatsAppEvents(parseWhatsAppWebhook(decoded), "meta");

  // Meta receives its acknowledgement without waiting for model inference.
  // Each inbound message is idempotently claimed by whatsapp_ai_runs.
  if (aiCandidates.length > 0 || mediaCandidates.length > 0) {
    after(async () => {
      await Promise.allSettled([
        ...aiCandidates.map(respondToWhatsAppInbound),
        ...mediaCandidates.map(({ messageId }) => captureWhatsAppMessageMedia(messageId)),
      ]);
    });
  }

  // Meta only needs an acknowledgement. Per-event diagnostics remain private
  // in whatsapp_webhook_events and never expose customer data in the response.
  return NextResponse.json({ acknowledged: true, ...result });
}
