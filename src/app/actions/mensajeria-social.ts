"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { esCanalSocial, NOMBRE_DEL_CANAL, type CanalSocial } from "@/lib/mensajeria-social";
import { asegurarWebhookDeLaApp, paginaConToken, paginasDeMeta, suscribirPagina, type PaginaDeMeta } from "@/lib/meta-mensajeria";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { olvidarTokenDelCanal } from "@/lib/whatsapp-credenciales";

function rutasDelCanal(canal: CanalSocial) {
  revalidatePath(`/dashboard/admin/integraciones/${canal}`);
  revalidatePath("/dashboard/admin/integraciones");
  revalidatePath("/dashboard/conversaciones/whatsapp");
}

async function empresaActual(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_org_id");
  if (typeof data !== "string") throw new Error("No se pudo saber en qué empresa estás.");
  return data;
}

export type ResultadoPaginas = { ok: true; paginas: PaginaDeMeta[] } | { ok: false; error: string };

/** Las páginas que la persona autorizó en Meta, para que elija cuál conectar. */
export async function paginasParaConectar(tokenDeUsuario: string): Promise<ResultadoPaginas> {
  await requireProfile(["admin"]);
  if (!tokenDeUsuario?.trim()) return { ok: false, error: "Meta no devolvió el acceso. Vuelve a intentarlo." };
  try {
    const paginas = await paginasDeMeta(tokenDeUsuario.trim());
    if (paginas.length === 0) return { ok: false, error: "No autorizaste ninguna página de Facebook. Vuelve a entrar y marca la página de la empresa." };
    return { ok: true, paginas };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Meta no respondió." };
  }
}

export type ResultadoConexionSocial = { ok: true; cuenta: string; avisos: string[] } | { ok: false; error: string };

/**
 * Conecta la página (Messenger) o su Instagram profesional (Instagram): suscribe
 * la app a la página, se asegura de que el webhook de la app apunte a Atlas y
 * guarda el canal en la empresa que se está mirando, con el token en la bóveda.
 */
export async function conectarCanalSocial(entrada: { tokenDeUsuario: string; pageId: string; canal: CanalSocial }): Promise<ResultadoConexionSocial> {
  const profile = await requireProfile(["admin"]);
  if (!esCanalSocial(entrada.canal)) return { ok: false, error: "Canal no válido." };
  const canal = entrada.canal;

  try {
    const organizationId = await empresaActual();
    const pagina = await paginaConToken(entrada.tokenDeUsuario.trim(), entrada.pageId);
    if (canal === "instagram" && !pagina.instagram) {
      return { ok: false, error: `La página «${pagina.nombre}» no tiene una cuenta profesional de Instagram vinculada. Vincúlala en la configuración de la página y vuelve a intentarlo.` };
    }

    const admin = createAdminClient();
    const cuentaId = canal === "instagram" ? pagina.instagram!.id : pagina.id;
    const { data: existente } = await admin
      .from("whatsapp_channels")
      .select("id, organization_id")
      .eq("canal", canal)
      .eq(canal === "instagram" ? "ig_user_id" : "page_id", cuentaId)
      .maybeSingle();
    if (existente && existente.organization_id !== organizationId) {
      return { ok: false, error: `Esa cuenta de ${NOMBRE_DEL_CANAL[canal]} ya está conectada a otra empresa.` };
    }

    await suscribirPagina(pagina.id, pagina.token);
    const avisos = await asegurarWebhookDeLaApp(canal === "instagram" ? "instagram" : "page");

    const cuenta = canal === "instagram"
      ? (pagina.instagram!.usuario ? `@${pagina.instagram!.usuario}` : pagina.instagram!.nombre ?? pagina.nombre)
      : pagina.nombre;
    const fila = {
      organization_id: organizationId,
      canal,
      provider: "meta",
      page_id: pagina.id,
      ig_user_id: canal === "instagram" ? pagina.instagram!.id : null,
      business_name: canal === "instagram" ? pagina.instagram!.nombre ?? pagina.nombre : pagina.nombre,
      cuenta,
      status: "active",
      conectado_at: new Date().toISOString(),
      token_vence_at: null,
      last_error: null,
      updated_by: profile.id,
    };
    const guardado = existente
      ? await admin.from("whatsapp_channels").update(fila).eq("id", existente.id).select("id").single()
      : await admin.from("whatsapp_channels").insert({ ...fila, created_by: profile.id }).select("id").single();
    if (guardado.error || !guardado.data) throw new Error(guardado.error?.message ?? "No se pudo guardar el canal.");

    const { error: tokenError } = await admin.rpc("guardar_token_de_canal_whatsapp", { p_channel_id: guardado.data.id, p_token: pagina.token });
    if (tokenError) throw new Error("No se pudo guardar la credencial de la página.");
    olvidarTokenDelCanal(guardado.data.id);

    rutasDelCanal(canal);
    return { ok: true, cuenta, avisos };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Meta no respondió.";
    console.error("mensajeria_social_conexion_fallida", { canal, message: mensaje.slice(0, 300) });
    return { ok: false, error: mensaje };
  }
}

/** La campaña a la que entran los mensajes nuevos del canal. */
export async function guardarCampanaDelCanalSocial(formData: FormData) {
  const profile = await requireProfile(["admin"]);
  const channelId = String(formData.get("channel_id") ?? "").trim();
  const campaignId = String(formData.get("campaign_id") ?? "").trim();
  if (!channelId || !campaignId) throw new Error("Elige la campaña a la que entran los mensajes.");

  const supabase = await createClient();
  const organizationId = await empresaActual();
  const { data: campaign } = await supabase.from("campaigns").select("id, is_active").eq("id", campaignId).maybeSingle();
  if (!campaign?.is_active) throw new Error("Selecciona una campaña activa de esta empresa.");

  const admin = createAdminClient();
  const { data: channel } = await admin
    .from("whatsapp_channels")
    .select("id, canal, organization_id")
    .eq("id", channelId)
    .maybeSingle();
  if (!channel || channel.organization_id !== organizationId || !esCanalSocial(channel.canal)) {
    throw new Error("El canal no es de esta empresa.");
  }

  const { data: actual, error: leerError } = await admin
    .from("whatsapp_campaign_routes")
    .select("id")
    .eq("channel_id", channelId)
    .eq("is_default", true)
    .maybeSingle();
  if (leerError) throw new Error(leerError.message);
  const ruta = { channel_id: channelId, campaign_id: campaignId, is_default: true, is_active: true, created_by: profile.id };
  const guardado = actual
    ? await admin.from("whatsapp_campaign_routes").update(ruta).eq("id", actual.id)
    : await admin.from("whatsapp_campaign_routes").insert(ruta);
  if (guardado.error) throw new Error(guardado.error.message);

  rutasDelCanal(channel.canal);
}

/** Pausar deja de recibir mensajes en Atlas; reanudar los vuelve a tomar. */
export async function pausarCanalSocial(formData: FormData) {
  const profile = await requireProfile(["admin"]);
  const channelId = String(formData.get("channel_id") ?? "").trim();
  const pausar = formData.get("pausar") === "true";
  const organizationId = await empresaActual();
  const admin = createAdminClient();
  const { data: channel } = await admin.from("whatsapp_channels").select("id, canal, organization_id").eq("id", channelId).maybeSingle();
  if (!channel || channel.organization_id !== organizationId || !esCanalSocial(channel.canal)) {
    throw new Error("El canal no es de esta empresa.");
  }
  const { error } = await admin
    .from("whatsapp_channels")
    .update({ status: pausar ? "paused" : "active", updated_by: profile.id })
    .eq("id", channelId);
  if (error) throw new Error(error.message);
  rutasDelCanal(channel.canal);
}
