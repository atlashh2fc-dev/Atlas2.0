import type { Address, Email } from "postal-mime";

import { llamarAtlasLead } from "@/lib/marketing-correo.server";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Las respuestas a campañas de correo que llegan a una casilla del CRM.
 *
 * Geimser y Equifax envían por AWS SES, pero sus clientes responden a casillas
 * en cPanel o Google Workspace que lee el CRM (Administración → Correo). Cada
 * correo nuevo se le pasa a Atlas Lead, que lo asocia a su campaña igual que
 * los de su propio buzón: detiene la secuencia, detecta bajas y guarda lo que
 * no calza. Nunca frena la lectura del buzón: si Atlas Lead no responde, el
 * correo igual queda en el CRM.
 */

export type CorreoParaAtlasLead = {
  message_id: string;
  remitente: string;
  nombre: string | null;
  destinatarios: string[];
  asunto: string | null;
  texto: string | null;
  recibido_at: string | null;
  in_reply_to: string | null;
  references: string[];
};

const LOTE = 25;
const MAX_TEXTO = 20_000;

function direcciones(lista: Address[] | undefined): string[] {
  return (lista ?? []).flatMap((item) => ("group" in item && item.group ? item.group.map((m) => m.address) : [item.address]))
    .filter((value): value is string => typeof value === "string" && value.includes("@"))
    .map((value) => value.trim().toLowerCase());
}

/** Lo que Atlas Lead necesita de un correo ya leído por el CRM. */
export function correoParaAtlasLead(parsed: Email, messageId: string | null, recibidoAt: string): CorreoParaAtlasLead | null {
  const remitente = parsed.from && "address" in parsed.from ? parsed.from.address?.trim().toLowerCase() : undefined;
  if (!remitente || !messageId) return null;
  const destinatarios = [
    ...direcciones(parsed.to),
    ...direcciones(parsed.cc),
    ...(parsed.deliveredTo ? [parsed.deliveredTo.trim().toLowerCase()] : []),
    // Un reenvío del servidor suele dejar la casilla original en estas cabeceras.
    ...parsed.headers
      .filter((header) => ["x-original-to", "x-forwarded-to", "envelope-to"].includes(header.key.toLowerCase()))
      .flatMap((header) => header.value.split(","))
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.includes("@")),
  ];
  return {
    message_id: messageId.slice(0, 500),
    remitente,
    nombre: parsed.from?.name?.trim() || null,
    destinatarios: [...new Set(destinatarios)].slice(0, 50),
    asunto: parsed.subject?.trim().slice(0, 1000) || null,
    texto: (parsed.text ?? "").slice(0, MAX_TEXTO) || null,
    recibido_at: new Date(recibidoAt).toISOString(),
    in_reply_to: parsed.inReplyTo?.trim().slice(0, 1000) || null,
    references: (parsed.references ?? "").split(/\s+/).filter(Boolean).slice(0, 50),
  };
}

/** Slug de la empresa si tiene Campañas de correo; si no, no hay nada que entregar. */
async function empresaConCorreo(organizationId: string): Promise<string | null> {
  const admin = createAdminClient();
  const [{ data: organizacion }, { data: modulo }] = await Promise.all([
    admin.from("organizations").select("slug").eq("id", organizationId).maybeSingle(),
    admin.from("organization_modules").select("enabled").eq("organization_id", organizationId).eq("module", "correo").maybeSingle(),
  ]);
  return modulo?.enabled && organizacion?.slug ? (organizacion.slug as string) : null;
}

export async function entregarCorreosAAtlasLead(organizationId: string | null, casilla: string, correos: CorreoParaAtlasLead[]): Promise<void> {
  if (!organizationId || correos.length === 0) return;
  try {
    const slug = await empresaConCorreo(organizationId);
    if (!slug) return;
    for (let inicio = 0; inicio < correos.length; inicio += LOTE) {
      const resultado = await llamarAtlasLead(
        "/api/integrations/v2/crm/correo_entrante",
        { empresa: slug, casilla: casilla.trim().toLowerCase(), mensajes: correos.slice(inicio, inicio + LOTE) },
        30_000,
      );
      if (!resultado.ok) {
        // La empresa sin conectar a Atlas Lead no es una falla del buzón.
        if (resultado.status !== 404) console.error(`[correo→atlas-lead] ${casilla}: ${resultado.error}`);
        return;
      }
    }
  } catch (error) {
    console.error(`[correo→atlas-lead] ${casilla}:`, error instanceof Error ? error.message : error);
  }
}
