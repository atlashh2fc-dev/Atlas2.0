import "server-only";

import { graph, registroDeMeta } from "@/lib/meta-registro";
import type { CanalSocial } from "@/lib/mensajeria-social";
import { whatsappGraphApiVersion } from "@/lib/whatsapp";
import { tokenDelCanal } from "@/lib/whatsapp-credenciales";

/**
 * Instagram y Messenger con la app «Atlas CRM» de Altius. La empresa entra con
 * su Facebook (inicio de sesión para empresas, configuración propia), elige la
 * página y Atlas guarda el token de esa página en la bóveda: con él lee los
 * perfiles y responde. El token de página que sale de un token de usuario de
 * larga duración no vence.
 */

export function mensajeriaDeMeta() {
  const { appId, version } = registroDeMeta();
  const configId = process.env.ATLAS_META_MENSAJERIA_CONFIG_ID?.trim() || null;
  const appSecret = process.env.ATLAS_META_APP_SECRET?.trim() || null;
  return { appId, version, configId, listo: Boolean(configId && appSecret) };
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type PaginaDeMeta = {
  id: string;
  nombre: string;
  instagram: { id: string; usuario: string | null; nombre: string | null } | null;
};

type PaginaConToken = PaginaDeMeta & { token: string };

async function tokenDeLargaDuracion(tokenDeUsuario: string): Promise<string> {
  const { appId } = registroDeMeta();
  const appSecret = process.env.ATLAS_META_APP_SECRET?.trim();
  if (!appSecret) throw new Error("Falta ATLAS_META_APP_SECRET en el servidor.");
  const datos = await graph("oauth/access_token", {
    query: { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: tokenDeUsuario },
  });
  const token = text(datos.access_token);
  if (!token) throw new Error("Meta no entregó un acceso de larga duración.");
  return token;
}

async function paginasConToken(tokenDeUsuario: string): Promise<PaginaConToken[]> {
  const largo = await tokenDeLargaDuracion(tokenDeUsuario);
  const datos = await graph("me/accounts", {
    token: largo,
    query: { fields: "id,name,access_token,instagram_business_account{id,username,name}", limit: "100" },
  });
  const paginas: PaginaConToken[] = [];
  for (const cruda of Array.isArray(datos.data) ? datos.data : []) {
    const pagina = record(cruda);
    const id = text(pagina?.id);
    const token = text(pagina?.access_token);
    if (!id || !token) continue;
    const ig = record(pagina?.instagram_business_account);
    const igId = text(ig?.id);
    paginas.push({
      id,
      token,
      nombre: text(pagina?.name) ?? id,
      instagram: igId ? { id: igId, usuario: text(ig?.username), nombre: text(ig?.name) } : null,
    });
  }
  return paginas;
}

/** Las páginas que la persona autorizó, sin sus tokens: esto viaja al navegador. */
export async function paginasDeMeta(tokenDeUsuario: string): Promise<PaginaDeMeta[]> {
  return (await paginasConToken(tokenDeUsuario)).map(({ id, nombre, instagram }) => ({ id, nombre, instagram }));
}

export async function paginaConToken(tokenDeUsuario: string, pageId: string): Promise<PaginaConToken> {
  const pagina = (await paginasConToken(tokenDeUsuario)).find((candidata) => candidata.id === pageId);
  if (!pagina) throw new Error("Esa página no está entre las que autorizaste en Meta.");
  return pagina;
}

/** La página recibe en Atlas los mensajes, ecos y botones de Messenger y de su Instagram. */
export async function suscribirPagina(pageId: string, tokenDePagina: string) {
  await graph(`${pageId}/subscribed_apps`, {
    metodo: "POST",
    token: tokenDePagina,
    query: { subscribed_fields: "messages,message_echoes,messaging_postbacks" },
  });
}

const CAMPOS_DEL_WEBHOOK: Record<"page" | "instagram", string> = {
  page: "messages,message_echoes,messaging_postbacks",
  instagram: "messages,messaging_postbacks",
};

/**
 * La app necesita el webhook de páginas y de Instagram apuntando a Atlas. Si
 * falta, se crea; si ya existe hacia otra URL no se toca (puede ser de otro
 * sistema de la suite) y se avisa. Devuelve avisos para la persona.
 */
export async function asegurarWebhookDeLaApp(objeto: "page" | "instagram"): Promise<string[]> {
  const { appId } = registroDeMeta();
  const appSecret = process.env.ATLAS_META_APP_SECRET?.trim();
  const verifyToken = process.env.ATLAS_META_WEBHOOK_VERIFY_TOKEN?.trim() || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!appSecret || !verifyToken) return ["Falta el token de verificación del webhook en el servidor: configúralo en la app de Meta."];
  const tokenDeApp = `${appId}|${appSecret}`;
  const callback = "https://atlascrm.geimser.cl/api/integrations/meta/whatsapp/webhook";
  try {
    const actuales = await graph(`${appId}/subscriptions`, { token: tokenDeApp });
    const existente = (Array.isArray(actuales.data) ? actuales.data : [])
      .map(record)
      .find((suscripcion) => text(suscripcion?.object) === objeto);
    const url = text(existente?.callback_url);
    if (existente && url && url !== callback) {
      return [`El webhook de ${objeto === "page" ? "páginas" : "Instagram"} de la app apunta a otro sistema (${url}); cámbialo a ${callback} en la app de Meta.`];
    }
    await graph(`${appId}/subscriptions`, {
      metodo: "POST",
      token: tokenDeApp,
      query: { object: objeto, callback_url: callback, verify_token: verifyToken, fields: CAMPOS_DEL_WEBHOOK[objeto], include_values: "true" },
    });
    return [];
  } catch (error) {
    return [`No se pudo suscribir el webhook de ${objeto === "page" ? "páginas" : "Instagram"}: ${error instanceof Error ? error.message : "Meta no respondió"}.`];
  }
}

/** Nombre del contacto según su perfil; si Meta no lo entrega, queda sin nombre. */
export async function perfilDelContacto(canal: CanalSocial, channelId: string, contactoId: string): Promise<string | null> {
  const token = await tokenDelCanal(channelId).catch(() => null);
  if (!token) return null;
  try {
    const datos = await graph(contactoId, {
      token,
      query: { fields: canal === "instagram" ? "name,username" : "first_name,last_name" },
    });
    if (canal === "instagram") {
      const nombre = text(datos.name);
      const usuario = text(datos.username);
      return nombre ?? (usuario ? `@${usuario}` : null);
    }
    return [text(datos.first_name), text(datos.last_name)].filter(Boolean).join(" ") || null;
  } catch {
    return null;
  }
}

type EnvioSocial = { channelId: string; pageId: string; recipientId: string; message: Json };

// Pasadas 24 h desde el último mensaje del cliente, Meta solo acepta respuestas
// de una persona con la etiqueta HUMAN_AGENT (hasta 7 días).
const FUERA_DE_VENTANA = new Set([2018278, 2534022]);

export async function enviarMensajeSocial(envio: EnvioSocial): Promise<{ providerMessageId: string; payload: Json }> {
  const token = await tokenDelCanal(envio.channelId);
  if (!token) throw new Error("El canal no tiene acceso de Meta: vuelve a conectarlo en Integraciones.");
  const url = `https://graph.facebook.com/${whatsappGraphApiVersion()}/${encodeURIComponent(envio.pageId)}/messages`;
  const intentar = async (etiqueta: boolean) => {
    const respuesta = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { id: envio.recipientId },
        ...(etiqueta ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : { messaging_type: "RESPONSE" }),
        message: envio.message,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = record(await respuesta.json().catch(() => ({}))) ?? {};
    return { ok: respuesta.ok, payload, error: record(payload.error) };
  };

  let resultado = await intentar(false);
  if (!resultado.ok && FUERA_DE_VENTANA.has(Number(resultado.error?.error_subcode))) {
    resultado = await intentar(true);
    if (!resultado.ok) {
      throw new Error("Pasaron más de 24 horas desde el último mensaje del cliente y Meta no permite responder fuera de esa ventana.");
    }
  }
  const providerMessageId = text(resultado.payload.message_id);
  if (!resultado.ok || !providerMessageId) {
    throw new Error(text(resultado.error?.error_user_msg) ?? text(resultado.error?.message) ?? "Meta rechazó el mensaje.");
  }
  return { providerMessageId, payload: resultado.payload };
}

export async function escribiendoEnSocial(channelId: string, pageId: string, recipientId: string) {
  const token = await tokenDelCanal(channelId);
  if (!token) return;
  await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion()}/${encodeURIComponent(pageId)}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, sender_action: "typing_on" }),
    signal: AbortSignal.timeout(8_000),
  });
}
