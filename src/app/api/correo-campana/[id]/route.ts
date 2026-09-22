import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { integrationV2Destinations, integrationV2Signature } from "@/lib/integration-v2";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pagina(cuerpo: string, status = 200) {
  return new NextResponse(cuerpo, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, max-age=300",
      // El correo se muestra aislado: sin scripts ni acceso a la sesión del CRM.
      "content-security-policy": "sandbox allow-popups allow-popups-to-escape-sandbox; script-src 'none'",
    },
  });
}

/**
 * El correo de campaña tal como le llegó al cliente.
 *
 * El acceso lo decide la base: se lee el mensaje con la sesión de quien mira
 * y, si la seguridad por fila lo deja ver, se le pide el HTML a Atlas Lead por
 * el puente firmado que ya existe. Atlas Lead lo arma con la misma función
 * con que lo envió, sin rastreo.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return pagina("<p>Inicia sesión para ver el correo.</p>", 401);
  const { id } = await params;
  if (!UUID.test(id)) return pagina("<p>Correo inválido.</p>", 400);

  const supabase = await createClient();
  const { data: mensaje } = await supabase.from("lead_mail_messages").select("id, external_message_id").eq("id", id).maybeSingle();
  if (!mensaje?.external_message_id) return pagina("<p>No hay un correo original para mostrar.</p>", 404);

  const destino = integrationV2Destinations(process.env.INTEGRATION_OUTBOX_DESTINATIONS_JSON).get("atlas_lead");
  if (!destino) return pagina("<p>El puente con Atlas Lead no está configurado.</p>", 503);

  const url = new URL("/api/integrations/v2/messages/html", destino.url);
  const rawBody = JSON.stringify({ external_message_id: mensaje.external_message_id });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  try {
    const respuesta = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-source": "atlas2",
        "x-atlas-timestamp": timestamp,
        "x-atlas-signature": integrationV2Signature(destino.secret, timestamp, Buffer.from(rawBody)),
      },
      body: rawBody,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const datos = (await respuesta.json().catch(() => null)) as { html?: string } | null;
    if (!respuesta.ok || !datos?.html) return pagina(`<p>Atlas Lead no pudo reconstruir el correo (${respuesta.status}).</p>`, 502);
    // Los enlaces del correo se abren fuera del visor.
    const html = datos.html.includes("<head>") ? datos.html.replace("<head>", '<head><base target="_blank">') : `<base target="_blank">${datos.html}`;
    return pagina(html);
  } catch {
    return pagina("<p>No se pudo conectar con Atlas Lead. Vuelve a intentar en un momento.</p>", 504);
  }
}
