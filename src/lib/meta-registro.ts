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

export async function graph(ruta: string, opciones: { token?: string; metodo?: "GET" | "POST"; cuerpo?: Json; query?: Record<string, string> } = {}): Promise<Json> {
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

/**
 * El código del registro vale unos segundos y una sola vez. Meta a veces lo ata
 * al redirect_uri interno con que el SDK abrió la ventana y exige el mismo al
 * canjearlo; por eso, si reclama por el redirect_uri, se prueba con los que
 * mandó el navegador (el del SDK primero) antes de rendirse.
 */
export async function canjearCodigo(codigo: string, redirectUris: string[] = []): Promise<string> {
  const { appId } = registroDeMeta();
  const appSecret = process.env.ATLAS_META_APP_SECRET?.trim();
  if (!appSecret) throw new Error("Falta ATLAS_META_APP_SECRET en el servidor.");
  const intentos: (string | null)[] = [null, ...new Set(redirectUris.filter((uri) => /^https:\/\//.test(uri)).slice(0, 3)), ""];
  let ultimoError: unknown = null;
  for (const redirectUri of intentos) {
    try {
      const query: Record<string, string> = { client_id: appId, client_secret: appSecret, code: codigo };
      if (redirectUri !== null) query.redirect_uri = redirectUri;
      const datos = await graph("oauth/access_token", { query });
      const token = typeof datos.access_token === "string" ? datos.access_token : null;
      if (!token) throw new Error("Meta no entregó el acceso de la empresa.");
      if (redirectUri !== null) console.info("meta_codigo_canjeado_con_redirect", { redirectUri: redirectUri.slice(0, 120) });
      return token;
    } catch (error) {
      ultimoError = error;
      if (!(error instanceof Error && /redirect_uri/i.test(error.message))) throw error;
    }
  }
  throw ultimoError instanceof Error ? ultimoError : new Error("Meta no aceptó el código.");
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

/**
 * La cuenta y el número a los que la empresa dio acceso, sacados del token. Es
 * el respaldo para cuando el aviso de la ventana de Meta (que trae los mismos
 * datos) no llega a Atlas.
 */
export async function cuentaDelToken(token: string): Promise<{ wabaId: string; phoneNumberId: string; enLaApp: boolean | null }> {
  const { appId } = registroDeMeta();
  const appSecret = process.env.ATLAS_META_APP_SECRET?.trim();
  if (!appSecret) throw new Error("Falta ATLAS_META_APP_SECRET en el servidor.");
  const datos = await graph("debug_token", { query: { input_token: token, access_token: `${appId}|${appSecret}` } });
  const info = (datos.data ?? {}) as Json;
  const permisos = (info.granular_scopes ?? []) as { scope?: string; target_ids?: string[] }[];
  const cuentas = new Set(
    permisos
      .filter((permiso) => permiso.scope === "whatsapp_business_management" || permiso.scope === "whatsapp_business_messaging")
      .flatMap((permiso) => permiso.target_ids ?? []),
  );
  if (cuentas.size !== 1) {
    const dados = permisos.map((permiso) => `${permiso.scope}${permiso.target_ids?.length ? ` (${permiso.target_ids.length})` : ""}`).join(", ") || "ninguno";
    // «Continuar como…» en la ventana de Meta reusa el permiso anterior: token de usuario y sin número.
    if (cuentas.size === 0 && info.type === "USER") {
      throw new Error("Meta reusó tu permiso anterior y no pasó por tu número. Vuelve a intentarlo y, cuando Meta pregunte si quieres continuar con tu configuración anterior, elige «Editar configuración» (no «Continuar como…») y sigue los pasos hasta aprobar en la app WhatsApp Business del teléfono.");
    }
    throw new Error(cuentas.size === 0
      ? `Meta no dio acceso a ninguna cuenta de WhatsApp. Vuelve a intentarlo y elige tu número. Permisos que llegaron: ${dados}; token ${typeof info.type === "string" ? info.type : "sin tipo"}.`
      : "Elegiste más de una cuenta de WhatsApp en Meta; conecta una a la vez.");
  }
  const [wabaId] = cuentas;
  const numeros = await graph(`${encodeURIComponent(wabaId)}/phone_numbers`, { token, query: { fields: "id" } });
  const lista = (numeros.data ?? []) as { id?: string }[];
  if (lista.length !== 1 || !lista[0].id) {
    throw new Error(lista.length === 0 ? "La cuenta de WhatsApp que elegiste no tiene números." : "La cuenta de WhatsApp tiene varios números; vuelve a intentarlo sin cerrar la ventana de Meta.");
  }
  let enLaApp: boolean | null = null;
  try {
    const numero = await graph(encodeURIComponent(lista[0].id), { token, query: { fields: "is_on_biz_app" } });
    if (typeof numero.is_on_biz_app === "boolean") enLaApp = numero.is_on_biz_app;
  } catch {
    // Campo que Meta no siempre expone; se resuelve con el tipo de registro.
  }
  return { wabaId, phoneNumberId: lista[0].id, enLaApp };
}

/**
 * El camino del dueño de la app. El registro insertado comparte el WhatsApp
 * de la empresa con el portfolio dueño de «Atlas CRM»; para Altius, que es ese
 * mismo portfolio, Meta rechaza compartírselo a sí mismo («no es un
 * identificador del negocio válido», 14-10-2026). Como la app y el número son
 * de Altius, no hace falta compartir: basta el token de un usuario del sistema
 * de su portfolio con la app y la cuenta asignadas.
 *
 * Antes de guardar nada se comprueba que el token sea de esta app y tenga los
 * dos permisos de WhatsApp, y que Meta tenga el número habilitado para la API
 * (platform_type CLOUD_API). Un número que solo vive en la app del teléfono
 * se ve «Conectado» en Meta, pero no envía ni recibe desde Atlas.
 */
export async function cuentaDelTokenDelSistema(
  token: string,
  wabaIdIndicado?: string | null,
): Promise<{ wabaId: string; phoneNumberId: string; enLaApp: boolean | null; numero: string | null; nombre: string | null }> {
  const { appId } = registroDeMeta();
  const appSecret = process.env.ATLAS_META_APP_SECRET?.trim();
  if (!appSecret) throw new Error("Falta ATLAS_META_APP_SECRET en el servidor.");

  const depurado = await graph("debug_token", { query: { input_token: token, access_token: `${appId}|${appSecret}` } });
  const info = (depurado.data ?? {}) as Json;
  if (info.is_valid !== true) throw new Error("Meta dice que ese token no es válido. Genera uno nuevo y pégalo completo.");
  if (String(info.app_id ?? "") !== appId) throw new Error("Ese token es de otra app. Genéralo para la app «Atlas CRM».");
  const permisos = new Set(((info.scopes ?? []) as string[]).map(String));
  const faltan = ["whatsapp_business_messaging", "whatsapp_business_management"].filter((permiso) => !permisos.has(permiso));
  if (faltan.length) throw new Error(`Al token le falta el permiso ${faltan.join(" y ")}. Vuelve a generarlo marcándolo.`);

  let wabaId = wabaIdIndicado?.trim() || null;
  if (wabaId && !/^\d+$/.test(wabaId)) throw new Error("El identificador de la cuenta son solo números.");
  if (!wabaId) {
    const cuentas = new Set(
      ((info.granular_scopes ?? []) as { scope?: string; target_ids?: string[] }[])
        .filter((permiso) => permiso.scope === "whatsapp_business_management" || permiso.scope === "whatsapp_business_messaging")
        .flatMap((permiso) => permiso.target_ids ?? []),
    );
    if (cuentas.size !== 1) {
      throw new Error(
        cuentas.size === 0
          ? "El token no dice a qué cuenta de WhatsApp tiene acceso. Pega también el identificador de la cuenta de mensajes."
          : "El token tiene acceso a varias cuentas de WhatsApp. Pega también el identificador de la que quieres conectar.",
      );
    }
    [wabaId] = cuentas;
  }

  const numeros = await graph(`${encodeURIComponent(wabaId)}/phone_numbers`, {
    token,
    query: { fields: "id,display_phone_number,verified_name,platform_type" },
  });
  const lista = (numeros.data ?? []) as { id?: string; display_phone_number?: string; verified_name?: string; platform_type?: string }[];
  if (lista.length !== 1 || !lista[0].id) {
    throw new Error(lista.length === 0 ? "Esa cuenta de WhatsApp no tiene números." : "Esa cuenta de WhatsApp tiene varios números; Atlas conecta uno por empresa.");
  }
  const [numero] = lista;
  if (numero.platform_type !== "CLOUD_API") {
    throw new Error(
      `Meta todavía no habilita ${numero.display_phone_number ?? "el número"} para enviar desde Atlas (plataforma: ${numero.platform_type ?? "sin dato"}). ` +
        "No se conectó nada: hay que terminar la habilitación con Meta.",
    );
  }

  let enLaApp: boolean | null = null;
  try {
    const detalle = await graph(encodeURIComponent(numero.id!), { token, query: { fields: "is_on_biz_app" } });
    if (typeof detalle.is_on_biz_app === "boolean") enLaApp = detalle.is_on_biz_app;
  } catch {
    // Campo que Meta no siempre expone: se asume que sigue en la app del teléfono.
  }
  return { wabaId, phoneNumberId: numero.id!, enLaApp, numero: numero.display_phone_number ?? null, nombre: numero.verified_name ?? null };
}

/** Cuándo vence el token (null: no vence o Meta no lo dijo). */
export async function vencimientoDelToken(token: string): Promise<string | null> {
  const { appId } = registroDeMeta();
  const appSecret = process.env.ATLAS_META_APP_SECRET?.trim();
  if (!appSecret) return null;
  try {
    const datos = await graph("debug_token", { query: { input_token: token, access_token: `${appId}|${appSecret}` } });
    const expira = Number(((datos.data ?? {}) as Json).expires_at ?? 0);
    return Number.isFinite(expira) && expira > 0 ? new Date(expira * 1000).toISOString() : null;
  } catch {
    return null;
  }
}
