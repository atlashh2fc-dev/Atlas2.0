import { after, NextRequest, NextResponse } from "next/server";

import {
  parseWhatsAppWebhook,
  verifyMetaWebhookSignature,
} from "@/lib/whatsapp";
import { parseMensajeriaSocial } from "@/lib/mensajeria-social";
import { processMensajesSociales, processWhatsAppEvents } from "@/lib/whatsapp-webhook-processing";
import { respondToWhatsAppInbound } from "@/lib/mercury-whatsapp";
import { captureWhatsAppMessageMedia } from "@/lib/whatsapp-media";
import { despacharMensajes } from "@/lib/mensajes/despachar";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 1024 * 1024;

/**
 * Dos apps de Meta escriben a esta misma URL: la antigua de Geimser, con la que
 * se conectó su número a mano, y «Atlas CRM» de Altius, el proveedor de
 * tecnología con que cada empresa conecta su WhatsApp, Instagram y Messenger
 * desde Atlas. Cada una firma con su secreto y se verifica con su propio token.
 */
function secretosDeApps(): string[] {
  return [process.env.WHATSAPP_META_APP_SECRET, process.env.ATLAS_META_APP_SECRET]
    .map((valor) => valor?.trim() ?? "")
    .filter(Boolean);
}

function tokensDeVerificacion(): string[] {
  return [process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, process.env.ATLAS_META_WEBHOOK_VERIFY_TOKEN]
    .map((valor) => valor?.trim() ?? "")
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const suppliedToken = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && suppliedToken && tokensDeVerificacion().includes(suppliedToken) && challenge) {
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

  const secretos = secretosDeApps();
  if (secretos.length === 0) {
    return NextResponse.json({ error: "Integración no configurada." }, { status: 503 });
  }
  const firma = request.headers.get("x-hub-signature-256");
  if (!secretos.some((secreto) => verifyMetaWebhookSignature(secreto, rawBody, firma))) {
    return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  // Instagram y Messenger llegan a esta misma URL con otro sobre (object
  // «instagram» o «page»); WhatsApp trae «whatsapp_business_account».
  const sociales = parseMensajeriaSocial(decoded);
  const { aiCandidates, mediaCandidates, despacharSalientes, ...result } = sociales.length > 0
    ? await processMensajesSociales(sociales)
    : await processWhatsAppEvents(parseWhatsAppWebhook(decoded), "meta");

  // Meta receives its acknowledgement without waiting for model inference.
  // Each inbound message is idempotently claimed by whatsapp_ai_runs.
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

  // Meta only needs an acknowledgement. Per-event diagnostics remain private
  // in whatsapp_webhook_events and never expose customer data in the response.
  return NextResponse.json({ acknowledged: true, ...result });
}
