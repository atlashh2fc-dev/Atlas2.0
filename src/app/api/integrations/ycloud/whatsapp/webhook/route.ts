import { after, NextRequest, NextResponse } from "next/server";

import { parseYCloudWebhook, verifyYCloudWebhookSignature } from "@/lib/whatsapp";
import { processWhatsAppEvents } from "@/lib/whatsapp-webhook-processing";
import { respondToWhatsAppInbound } from "@/lib/mercury-whatsapp";
import { captureWhatsAppMessageMedia } from "@/lib/whatsapp-media";
import { despacharMensajes } from "@/lib/mensajes/despachar";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const { aiCandidates, mediaCandidates, despacharSalientes, ...result } = await processWhatsAppEvents(parseYCloudWebhook(decoded), "ycloud");
  if (aiCandidates.length > 0 || mediaCandidates.length > 0 || despacharSalientes) {
    after(async () => {
      await Promise.allSettled([
        // La respuesta a «¿confirmas tu hora?» sale al tiro, no en 10 minutos.
        ...(despacharSalientes ? [despacharMensajes({ generar: false, limite: 10 })] : []),
        ...aiCandidates.map(respondToWhatsAppInbound),
        ...mediaCandidates.map(({ messageId }) => captureWhatsAppMessageMedia(messageId)),
      ]);
    });
  }
  return NextResponse.json({ acknowledged: true, ...result });
}
