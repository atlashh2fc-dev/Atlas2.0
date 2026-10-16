"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { buzonDeCampana } from "@/lib/correo/buzon";
import { enviarCorreo } from "@/lib/correo/smtp";
import { errorDeAccion, mensajeDeError } from "@/lib/errores-de-accion";
import { firmaDesdePerfil } from "@/lib/equifax-cotizador/propuesta";
import { leadContactPerson } from "@/lib/lead-extra";
import { celularChileno } from "@/lib/prospeccion";
import { PLAN_BASE, esPlazo, normalizarCondiciones, type CondicionesParticulares, type PlazoMeses } from "@/lib/sv-cotizador/plan";
import { asuntoPropuestaSv, correoHtmlSv, correoTextoSv, remitenteSv, type DatosPropuestaSv } from "@/lib/sv-cotizador/propuesta";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { valorUfDeHoy } from "@/lib/valor-uf";

import type { FirmaComercial } from "./cotizador-equifax";

/**
 * Cotizador de Secretaria Virtual de la ficha. Igual que el de Equifax: la
 * propuesta sale por el buzón de la empresa (con el nombre de la ejecutiva) o
 * por WhatsApp desde su teléfono, y queda en cotizaciones_sv con su N.º de
 * propuesta. La firma es la misma del perfil comercial.
 */

export type Resultado<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export type CotizacionSv = {
  id: string;
  folio: string;
  canal: "correo" | "whatsapp";
  destinatario: string;
  uf_mensual: number;
  plazo_meses: number;
  estado: "enviando" | "enviada" | "fallida" | "whatsapp_abierto";
  error: string | null;
  created_at: string;
  respondida_at: string | null;
  agente: string | null;
};

export type ContextoCotizadorSv = {
  uf: { valor: number; fecha: string } | null;
  firma: FirmaComercial;
  buzon: string | null;
  historial: CotizacionSv[];
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function leerFirma(supabase: Supabase, userId: string): Promise<FirmaComercial> {
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

async function leerHistorial(supabase: Supabase, leadId: string): Promise<CotizacionSv[]> {
  const { data } = await supabase
    .from("cotizaciones_sv")
    .select("id, folio, canal, destinatario, uf_mensual, plazo_meses, estado, error, created_at, respondida_at, profiles!cotizaciones_sv_agent_id_fkey(full_name)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []).map((fila) => {
    const perfil = Array.isArray(fila.profiles) ? fila.profiles[0] : fila.profiles;
    return {
      id: fila.id,
      folio: fila.folio,
      canal: fila.canal,
      destinatario: fila.destinatario,
      uf_mensual: Number(fila.uf_mensual),
      plazo_meses: Number(fila.plazo_meses),
      estado: fila.estado,
      error: fila.error,
      created_at: fila.created_at,
      respondida_at: fila.respondida_at,
      agente: (perfil as { full_name?: string } | null)?.full_name ?? null,
    } as CotizacionSv;
  });
}

/** Lo que el cotizador necesita al abrirse: UF del día, firma, buzón e historial. */
export async function cargarCotizadorSv(leadId: string): Promise<Resultado<ContextoCotizadorSv>> {
  try {
    const profile = await requireProfile();
    const supabase = await createClient();
    const { data: lead } = await supabase.from("leads").select("organization_id, campaign_id").eq("id", leadId).maybeSingle();
    if (!lead) return { ok: false, error: "No encontramos el registro." };
    const [uf, firma, historial, buzon] = await Promise.all([
      valorUfDeHoy(),
      leerFirma(supabase, profile.id),
      leerHistorial(supabase, leadId),
      lead.organization_id ? buzonDeCampana(lead.organization_id, lead.campaign_id).catch(() => null) : Promise.resolve(null),
    ]);
    return { ok: true, data: { uf, firma, buzon: buzon?.address ?? null, historial } };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error, "No se pudo abrir el cotizador.") };
  }
}

type Entrada = {
  leadId: string;
  callId: string | null;
  meses: number;
  valorUf: number;
  condiciones: unknown;
  /** Nombre del contacto, si la ejecutiva lo corrigió en la ficha. */
  contacto: string | null;
  /** Correo y teléfono que van en el encabezado de la propuesta. */
  correoCliente: string | null;
  telefonoCliente: string | null;
};

/** Arma la propuesta en el servidor, desde el registro y el perfil; el precio sale del plan, no del navegador. */
async function prepararPropuesta(entrada: Entrada) {
  const profile = await requireProfile();
  const supabase = await createClient();
  if (!esPlazo(entrada.meses)) throw new Error("El plazo es de 3, 6 o 12 meses.");
  const valorUf = Number(entrada.valorUf);
  if (!Number.isFinite(valorUf) || valorUf < 30000 || valorUf > 60000) throw new Error("Revisa el valor de la UF.");
  const condiciones: CondicionesParticulares = normalizarCondiciones(entrada.condiciones);

  const { data: lead } = await supabase
    .from("leads")
    .select("id, full_name, rut, email, phone, extra, organization_id, campaign_id")
    .eq("id", entrada.leadId)
    .maybeSingle();
  if (!lead) throw new Error("No encontramos el registro.");

  const firma = await leerFirma(supabase, profile.id);
  const contacto = entrada.contacto?.trim() || leadContactPerson(lead.extra as Record<string, unknown> | null, lead.full_name);
  const datos: DatosPropuestaSv = {
    cliente: {
      empresa: lead.full_name,
      rut: lead.rut,
      contacto,
      correo: entrada.correoCliente?.trim() || lead.email,
      telefono: entrada.telefonoCliente?.trim() || lead.phone,
    },
    ejecutivo: firmaDesdePerfil(firma),
    meses: entrada.meses as PlazoMeses,
    valorUf,
    condiciones,
    fecha: new Date(),
    folio: null,
  };
  return { supabase, lead, datos, contacto };
}

async function registrar(
  supabase: Supabase,
  entrada: Entrada,
  datos: DatosPropuestaSv,
  canal: "correo" | "whatsapp",
  destinatario: string,
): Promise<{ id: string; folio: string }> {
  const { data, error } = await supabase.rpc("registrar_cotizacion_sv", {
    p_lead_id: entrada.leadId,
    p_call_id: entrada.callId,
    p_canal: canal,
    p_destinatario: destinatario,
    p_uf_mensual: PLAN_BASE.ufMensual,
    p_plazo_meses: datos.meses,
    p_valor_uf: datos.valorUf,
    p_condiciones: datos.condiciones,
  });
  const fila = data as { id?: string; folio?: string } | null;
  if (error || !fila?.id || !fila.folio) throw errorDeAccion(error, "No se pudo registrar la cotización.");
  return { id: fila.id, folio: fila.folio };
}

export async function enviarCotizacionSvPorCorreo(entrada: Entrada & { para: string }): Promise<Resultado<{ id: string; folio: string }>> {
  try {
    const para = entrada.para.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return { ok: false, error: "Revisa el correo del cliente." };
    const preparado = await prepararPropuesta({ ...entrada, correoCliente: entrada.correoCliente || para });
    if (!preparado.lead.organization_id) return { ok: false, error: "El registro no tiene empresa." };
    const buzon = await buzonDeCampana(preparado.lead.organization_id, preparado.lead.campaign_id);
    if (!buzon) return { ok: false, error: "La campaña todavía no tiene un buzón para enviar correos. Pídele a un administrador que lo conecte en Configuración › Correo de envío." };

    const { id, folio } = await registrar(preparado.supabase, entrada, preparado.datos, "correo", para);
    const datos: DatosPropuestaSv = { ...preparado.datos, folio, correoRespuesta: buzon.address };
    const asunto = asuntoPropuestaSv(datos);
    const admin = createAdminClient();
    // El asunto queda antes de enviar: con él se liga la respuesta si vuelve sin In-Reply-To.
    await admin.from("cotizaciones_sv").update({ asunto }).eq("id", id);
    try {
      const { messageId } = await enviarCorreo(buzon, {
        para,
        nombre: preparado.contacto,
        asunto,
        texto: correoTextoSv(datos),
        html: correoHtmlSv(datos),
        remitenteNombre: remitenteSv(datos.ejecutivo.nombre),
      });
      await admin.from("cotizaciones_sv").update({ estado: "enviada", proveedor_id: messageId, enviada_at: new Date().toISOString() }).eq("id", id);
    } catch (error) {
      const detalle = error instanceof Error && error.message ? error.message : "El servidor de correo no aceptó el mensaje.";
      await admin.from("cotizaciones_sv").update({ estado: "fallida", error: detalle.slice(0, 800) }).eq("id", id);
      return { ok: false, error: `No salió el correo: ${detalle}` };
    }
    revalidatePath(`/dashboard/leads/${entrada.leadId}`);
    return { ok: true, data: { id, folio } };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error, "No se pudo enviar la propuesta.") };
  }
}

/**
 * WhatsApp sale del teléfono de la ejecutiva. El N.º de propuesta se asigna al
 * registrarla, así que primero se registra y después se abre wa.me con el
 * mensaje ya numerado (la ficha abre la ventana en el mismo clic y le pone la
 * dirección cuando vuelve la respuesta).
 */
export async function registrarCotizacionSvWhatsapp(entrada: Entrada & { celular: string }): Promise<Resultado<{ id: string; folio: string }>> {
  try {
    const celular = celularChileno(entrada.celular);
    if (!celular) return { ok: false, error: "WhatsApp necesita un celular chileno." };
    const preparado = await prepararPropuesta(entrada);
    const registro = await registrar(preparado.supabase, entrada, preparado.datos, "whatsapp", `+${celular}`);
    revalidatePath(`/dashboard/leads/${entrada.leadId}`);
    return { ok: true, data: registro };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error, "No se pudo registrar la propuesta.") };
  }
}
