import { whatsappGraphApiVersion } from "@/lib/whatsapp";

/**
 * El registro insertado de Meta (Embedded Signup) con la app «Atlas CRM» de
 * Altius, que es el proveedor de tecnología. La empresa inicia sesión con su
 * Facebook dentro de Atlas, elige su WhatsApp Business y Meta devuelve un código
 * que acá se canjea por el token de esa empresa.
 *
 * La app y la configuración no son secretos (se ven en el navegador); el
 * secreto de la app sí, y solo vive en el entorno del servidor.
 */
export const ATLAS_META_APP_ID_POR_DEFECTO = "1623651549404343";

export function registroDeMeta() {
  const appId = process.env.ATLAS_META_APP_ID?.trim() || ATLAS_META_APP_ID_POR_DEFECTO;
  const configId = process.env.ATLAS_META_ES_CONFIG_ID?.trim() || null;
  const appSecret = process.env.ATLAS_META_APP_SECRET?.trim() || null;
  return { appId, configId, listo: Boolean(configId && appSecret), version: whatsappGraphApiVersion() };
}

type Json = Record<string, unknown>;

async function graph(ruta: string, opciones: { token?: string; metodo?: "GET" | "POST"; cuerpo?: Json; query?: Record<string, string> } = {}): Promise<Json> {
  const url = new URL(`https://graph.facebook.com/${whatsappGraphApiVersion()}/${ruta}`);
  for (const [clave, valor] of Object.entries(opciones.query ?? {})) url.searchParams.set(clave, valor);
  const respuesta = await fetch(url, {
    method: opciones.metodo ?? "GET",
    headers: {
      ...(opciones.token ? { authorization: `Bearer ${opciones.token}` } : {}),
      ...(opciones.cuerpo ? { "content-type": "application/json" } : {}),
    },
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const datos = ((await respuesta.json().catch(() => ({}))) ?? {}) as Json;
  if (!respuesta.ok) {
    const error = (datos.error ?? {}) as Json;
    const detalle = typeof error.error_user_msg === "string" ? error.error_user_msg : typeof error.message === "string" ? error.message : `error ${respuesta.status}`;
    throw new Error(`Meta: ${detalle}`);
  }
  return datos;
}

/** El código del registro vale unos segundos y una sola vez. */
export async function canjearCodigo(codigo: string): Promise<string> {
  const { appId } = registroDeMeta();
  const appSecret = process.env.ATLAS_META_APP_SECRET?.trim();
  if (!appSecret) throw new Error("Falta ATLAS_META_APP_SECRET en el servidor.");
  const datos = await graph("oauth/access_token", { query: { client_id: appId, client_secret: appSecret, code: codigo } });
  const token = typeof datos.access_token === "string" ? datos.access_token : null;
  if (!token) throw new Error("Meta no entregó el acceso de la empresa.");
  return token;
}

/** Sin esta suscripción, Meta no avisa a Atlas de los mensajes de ese número. */
export async function suscribirApp(wabaId: string, token: string) {
  await graph(`${encodeURIComponent(wabaId)}/subscribed_apps`, { token, metodo: "POST" });
}

export async function datosDelNumero(phoneNumberId: string, token: string) {
  const datos = await graph(encodeURIComponent(phoneNumberId), { token, query: { fields: "display_phone_number,verified_name" } });
  return {
    numero: typeof datos.display_phone_number === "string" ? datos.display_phone_number : null,
    nombre: typeof datos.verified_name === "string" ? datos.verified_name : null,
  };
}

/**
 * Con coexistencia, Meta pide pedir los contactos y el historial de la app del
 * teléfono dentro de las 24 horas siguientes al registro. Llegan por webhook.
 */
export async function sincronizarAppDelTelefono(phoneNumberId: string, token: string): Promise<string[]> {
  const pendientes: string[] = [];
  for (const tipo of ["smb_app_state_sync", "history"] as const) {
    try {
      await graph(`${encodeURIComponent(phoneNumberId)}/smb_app_data`, { token, metodo: "POST", cuerpo: { messaging_product: "whatsapp", sync_type: tipo } });
    } catch (error) {
      pendientes.push(`${tipo === "history" ? "historial" : "contactos"}: ${error instanceof Error ? error.message : "sin respuesta"}`);
    }
  }
  return pendientes;
}
