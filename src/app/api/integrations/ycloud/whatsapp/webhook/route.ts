import { NextRequest, NextResponse } from "next/server";

import { parseYCloudWebhook, verifyYCloudWebhookSignature } from "@/lib/whatsapp";
import { processWhatsAppEvents } from "@/lib/whatsapp-webhook-processing";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload demasiado grande." }, { status: 413 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length < 1 || rawBody.length > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload inválido." }, { status: rawBody.length ? 413 : 400 });
  }

  const signingSecret = process.env.WHATSAPP_YCLOUD_WEBHOOK_SECRET?.trim();
  if (!signingSecret) {
    return NextResponse.json({ error: "Integración no configurada." }, { status: 503 });
  }
  if (!verifyYCloudWebhookSignature(signingSecret, rawBody, request.headers.get("ycloud-signature"))) {
    return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const result = await processWhatsAppEvents(parseYCloudWebhook(decoded), "ycloud");
  return NextResponse.json({ acknowledged: true, ...result });
}
