"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { buzonDeEmpresa } from "@/lib/correo/buzon";
import { enviarCorreo } from "@/lib/correo/smtp";
import { cotizarLinea, normalizarConfig, totales, type ConfigLinea } from "@/lib/equifax-cotizador/catalogo";
import { LOGO_EQUIFAX_CID, LOGO_EQUIFAX_PNG_BASE64 } from "@/lib/equifax-cotizador/logo";
import { asuntoPropuesta, correoHtml, correoTexto, firmaDesdePerfil, type DatosPropuesta } from "@/lib/equifax-cotizador/propuesta";
import { leadContactPerson } from "@/lib/lead-extra";
import { celularChileno } from "@/lib/prospeccion";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { valorUfDeHoy } from "@/lib/valor-uf";

/**
 * Cotizador Equifax de la ficha. La propuesta sale por el buzón de la empresa
 * (correo) o por WhatsApp desde el teléfono del ejecutivo, y queda en
 * equifax_cotizaciones. Toda propuesta por correo lleva copia oculta a la
 * jefatura comercial, como en el cotizador que se usaba antes.
 */

const COPIA_OCULTA_FIJA = ["eduranb@geoinfobusiness.cl"];

export type Resultado<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export type FirmaComercial = {
  nombre: string;
  cargo: string | null;
  whatsapp: string | null;
  correo: string | null;
  correoAcceso: string;
  firma: string | null;
};

export type CotizacionEnviada = {
  id: string;
  canal: "correo" | "whatsapp";
  destinatario: string;
  productos: string[];
  uf_mensual: number;
  uf_unico: number;
  uf_anual: number;
  clp_total: number;
  estado: "enviando" | "enviada" | "fallida" | "whatsapp_abierto";
  error: string | null;
  created_at: string;
  agente: string | null;
};

export type ContextoCotizador = {
  uf: { valor: number; fecha: string } | null;
  firma: FirmaComercial;
  /** Dirección desde la que sale el correo, o null si la empresa no tiene buzón. */
  buzon: string | null;
  historial: CotizacionEnviada[];
};

function mensajeDeError(error: unknown, porDefecto: string): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message) return error.message;
  return porDefecto;
}

async function leerFirma(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<FirmaComercial> {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, email, cargo_comercial, whatsapp_comercial, correo_comercial, firma_comercial")
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error("No se pudo leer tu perfil.");
  return {
    nombre: data.full_name,
    cargo: data.cargo_comercial,
    whatsapp: data.whatsapp_comercial,
    correo: data.correo_comercial,
    correoAcceso: data.email,
    firma: data.firma_comercial,
  };
}

async function leerHistorial(supabase: Awaited<ReturnType<typeof createClient>>, leadId: string): Promise<CotizacionEnviada[]> {
  const { data } = await supabase
    .from("equifax_cotizaciones")
    .select("id, canal, destinatario, productos, uf_mensual, uf_unico, uf_anual, clp_total, estado, error, created_at, profiles!equifax_cotizaciones_agent_id_fkey(full_name)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []).map((fila) => {
    const perfil = Array.isArray(fila.profiles) ? fila.profiles[0] : fila.profiles;
    return {
      id: fila.id,
      canal: fila.canal,
      destinatario: fila.destinatario,
      productos: fila.productos ?? [],
      uf_mensual: Number(fila.uf_mensual),
      uf_unico: Number(fila.uf_unico),
      uf_anual: Number(fila.uf_anual),
      clp_total: Number(fila.clp_total),
      estado: fila.estado,
      error: fila.error,
      created_at: fila.created_at,
      agente: (perfil as { full_name?: string } | null)?.full_name ?? null,
    } as CotizacionEnviada;
  });
}

/** Lo que el cotizador necesita al abrirse: UF del día, firma, buzón e historial. */
export async function cargarCotizador(leadId: string): Promise<Resultado<ContextoCotizador>> {
  try {
    const profile = await requireProfile();
    const supabase = await createClient();
    const { data: lead } = await supabase.from("leads").select("organization_id").eq("id", leadId).maybeSingle();
    if (!lead) return { ok: false, error: "No encontramos el registro." };
    const [uf, firma, historial, buzon] = await Promise.all([
      valorUfDeHoy(),
      leerFirma(supabase, profile.id),
      leerHistorial(supabase, leadId),
      lead.organization_id ? buzonDeEmpresa(lead.organization_id).catch(() => null) : Promise.resolve(null),
    ]);
    return { ok: true, data: { uf, firma, buzon: buzon?.address ?? null, historial } };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error, "No se pudo abrir el cotizador.") };
  }
}

export async function guardarMiFirma(input: { cargo: string; whatsapp: string; correo: string; firma: string }): Promise<Resultado<FirmaComercial>> {
  try {
    const profile = await requireProfile();
    const supabase = await createClient();
    // "9 1234 5678" o "56912345678" se guardan como +56912345678.
    const celular = celularChileno(input.whatsapp);
    const whatsapp = input.whatsapp.trim() ? (celular ? `+${celular}` : input.whatsapp.trim()) : "";
    const { error } = await supabase.rpc("guardar_mi_firma_comercial", {
      p_cargo: input.cargo,
      p_whatsapp: whatsapp,
      p_correo: input.correo,
      p_firma: input.firma,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: await leerFirma(supabase, profile.id) };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar tu firma.") };
  }
}

type Entrada = {
  leadId: string;
  callId: string | null;
  configs: unknown[];
  valorUf: number;
  /** Nombre del contacto, si el ejecutivo lo corrigió en la ficha. */
  contacto: string | null;
};

/** Arma la propuesta en el servidor, desde el registro y el perfil, no desde lo que diga el navegador. */
async function prepararPropuesta(entrada: Entrada) {
  const profile = await requireProfile();
  const supabase = await createClient();
  if (!Array.isArray(entrada.configs) || entrada.configs.length === 0) throw new Error("Agrega al menos un producto.");
  if (entrada.configs.length > 12) throw new Error("Una propuesta lleva hasta 12 productos.");
  const configs = entrada.configs.map(normalizarConfig);
  if (configs.some((config) => config === null)) throw new Error("Revisa los productos: hay uno incompleto.");
  const valorUf = Number(entrada.valorUf);
  if (!Number.isFinite(valorUf) || valorUf < 30000 || valorUf > 60000) throw new Error("Revisa el valor de la UF.");

  const { data: lead } = await supabase
    .from("leads")
    .select("id, full_name, rut, email, phone, extra, organization_id")
    .eq("id", entrada.leadId)
    .maybeSingle();
  if (!lead) throw new Error("No encontramos el registro.");

  const lineas = (configs as ConfigLinea[]).map(cotizarLinea);
  const firma = await leerFirma(supabase, profile.id);
  const contacto = entrada.contacto?.trim() || leadContactPerson(lead.extra as Record<string, unknown> | null, lead.full_name);
  const datos: DatosPropuesta = {
    cliente: { empresa: lead.full_name, rut: lead.rut, contacto },
    ejecutivo: firmaDesdePerfil(firma),
    lineas,
    valorUf,
    fecha: new Date(),
  };
  return { supabase, lead, lineas, datos, valorUf, contacto };
}

async function registrar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entrada: Entrada,
  preparado: Awaited<ReturnType<typeof prepararPropuesta>>,
  canal: "correo" | "whatsapp",
  destinatario: string,
  asunto: string | null,
): Promise<string> {
  const total = totales(preparado.lineas);
  const { data, error } = await supabase.rpc("registrar_cotizacion_equifax", {
    p_lead_id: entrada.leadId,
    p_call_id: entrada.callId,
    p_canal: canal,
    p_destinatario: destinatario,
    p_asunto: asunto,
    p_lineas: preparado.lineas.map((linea) => ({
      config: linea.config,
      nombre: linea.nombre,
      detalle: linea.detalle,
      atlas: linea.atlas,
      cobro: linea.cobro,
      uf_lista: linea.ufLista,
      uf_venta: linea.ufVenta,
      descuento: linea.descuento,
      q: linea.q,
      publicacion: linea.publicacion,
    })),
    p_productos: [...new Set(preparado.lineas.map((linea) => linea.atlas))],
    p_uf_mensual: total.mensual,
    p_uf_unico: total.unico,
    p_uf_anual: total.anual,
    p_clp_total: total.clp,
    p_valor_uf: preparado.valorUf,
  });
  if (error || typeof data !== "string") throw new Error(error?.message ?? "No se pudo registrar la cotización.");
  return data;
}

export async function enviarCotizacionPorCorreo(entrada: Entrada & { para: string }): Promise<Resultado<{ id: string }>> {
  try {
    const para = entrada.para.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return { ok: false, error: "Revisa el correo del cliente." };
    const preparado = await prepararPropuesta(entrada);
    if (!preparado.lead.organization_id) return { ok: false, error: "El registro no tiene empresa." };
    const buzon = await buzonDeEmpresa(preparado.lead.organization_id);
    if (!buzon) return { ok: false, error: "La empresa todavía no tiene un buzón conectado para enviar correos. Pídele a un administrador que lo conecte en Configuración › Correo." };

    const asunto = asuntoPropuesta(preparado.datos);
    const id = await registrar(preparado.supabase, entrada, preparado, "correo", para, asunto);
    const admin = createAdminClient();
    try {
      const { messageId } = await enviarCorreo(buzon, {
        para,
        nombre: preparado.contacto,
        asunto,
        texto: correoTexto(preparado.datos),
        html: correoHtml(preparado.datos, `cid:${LOGO_EQUIFAX_CID}`),
        copiaOculta: COPIA_OCULTA_FIJA,
        imagenes: [{ cid: LOGO_EQUIFAX_CID, nombre: "equifax.png", base64: LOGO_EQUIFAX_PNG_BASE64, tipo: "image/png" }],
      });
      await admin.from("equifax_cotizaciones").update({ estado: "enviada", proveedor_id: messageId, enviada_at: new Date().toISOString() }).eq("id", id);
    } catch (error) {
      const detalle = mensajeDeError(error, "El servidor de correo no aceptó el mensaje.");
      await admin.from("equifax_cotizaciones").update({ estado: "fallida", error: detalle.slice(0, 800) }).eq("id", id);
      return { ok: false, error: `No salió el correo: ${detalle}` };
    }
    revalidatePath(`/dashboard/leads/${entrada.leadId}`);
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error, "No se pudo enviar la propuesta.") };
  }
}

/**
 * WhatsApp sale del teléfono del ejecutivo: la ficha abre wa.me con el mensaje
 * listo en el mismo clic (si esperara al servidor, el navegador bloquearía la
 * ventana) y acá se deja registrada.
 */
export async function registrarCotizacionWhatsapp(entrada: Entrada & { celular: string }): Promise<Resultado<{ id: string }>> {
  try {
    const celular = celularChileno(entrada.celular);
    if (!celular) return { ok: false, error: "WhatsApp necesita un celular chileno." };
    const preparado = await prepararPropuesta(entrada);
    const id = await registrar(preparado.supabase, entrada, preparado, "whatsapp", `+${celular}`, null);
    revalidatePath(`/dashboard/leads/${entrada.leadId}`);
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error, "No se pudo registrar la propuesta.") };
  }
}

