import "server-only";

import { randomUUID } from "node:crypto";

import { fechaEnChile, instanteEnChile } from "@/lib/citas";
import { graph } from "@/lib/meta-registro";
import {
  EMPRESAS_CON_WHATSAPP_AUTOMATICO,
  NOTAS,
  PLANTILLAS_DE_PROSPECCION,
  REGLAS,
  VIDEO_VETERINARIAS,
  definicionParaMeta,
  elegirEnvios,
  enHorario,
  esBaja,
  esVeterinaria,
  numeroSinWhatsapp,
  quiereVerElVideo,
  pideFrenar,
  type ClavePlantillaProspeccion,
  type FilaDeBandeja,
} from "@/lib/prospeccion-whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";
import { accesoDeMeta } from "@/lib/whatsapp-credenciales";
import { celularChileno } from "@/lib/prospeccion";
import { isWhatsAppProviderConfigured, sendWhatsAppMedia, sendWhatsAppTemplate, whatsappProvider } from "@/lib/whatsapp-provider";

/**
 * La corrida del WhatsApp automático (reglas en prospeccion-whatsapp.ts).
 *
 * Primero recoge lo que volvió: quien pidió la baja sale de la bandeja y un
 * mensaje que no se entregó vuelve a una persona. Eso corre siempre, aunque
 * el envío esté apagado. Después, si está encendido, en horario y con cupo,
 * escribe a los que tocan, de a pocos.
 *
 * Se frena solo: si Meta baja la calidad del número a amarilla o roja, o
 * rechaza por spam o velocidad, apaga el interruptor y deja el motivo. Un
 * número bloqueado no se recupera; un día sin mensajes, sí.
 *
 * En ensayo no escribe nada (ni en Meta ni en la base): devuelve a quién le
 * escribiría hoy y con qué texto.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Por ahora, solo Altius le escribe a sus prospectos. */
const [EMPRESA] = EMPRESAS_CON_WHATSAPP_AUTOMATICO;

type EstadoPlantilla = "aprobada" | "en_revision" | "rechazada" | "sin_registrar" | "desconocido";

export type InformeWhatsapp = {
  ensayo: boolean;
  estado: "sin_canal" | "apagado" | "pausado" | "fuera_de_horario" | "esperando_plantillas" | "tope" | "ok";
  resumen: string;
  enviados: { empresa: string | null; paso: ClavePlantillaProspeccion; texto: string }[];
  fallidos: { empresa: string | null; error: string }[];
  bajas: number;
  noEntregados: number;
  videos: number;
  plantillas: Partial<Record<ClavePlantillaProspeccion, EstadoPlantilla>>;
};

type Canal = {
  id: string;
  provider: string | null;
  status: string;
  waba_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  plantillas_aprobadas: string[] | null;
};

export async function escribirAProspectos({ ensayo = false, ahora = new Date() }: { ensayo?: boolean; ahora?: Date } = {}): Promise<InformeWhatsapp> {
  const admin = createAdminClient();
  const informe: InformeWhatsapp = { ensayo, estado: "ok", resumen: "", enviados: [], fallidos: [], bajas: 0, noEntregados: 0, videos: 0, plantillas: {} };
  const terminar = (estado: InformeWhatsapp["estado"], resumen: string) => Object.assign(informe, { estado, resumen });

  const { data: empresa, error: empresaError } = await admin.from("organizations").select("id").eq("slug", EMPRESA).single();
  if (empresaError || !empresa) throw new Error(`No se encontró la empresa ${EMPRESA}.`);
  const org = empresa.id as string;

  informe.bajas = await cerrarBajas(admin, org, ensayo, ahora);
  informe.noEntregados = await revisarNoEntregados(admin, org, ensayo);

  const [{ data: config }, { data: canalData }] = await Promise.all([
    admin.from("sales_agent_configs").select("whatsapp_automatico, whatsapp_por_dia, whatsapp_pausa").eq("organization_id", org).maybeSingle(),
    admin
      .from("whatsapp_channels")
      .select("id, provider, status, waba_id, phone_number_id, display_phone_number, plantillas_aprobadas")
      .eq("organization_id", org)
      .eq("canal", "whatsapp")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);
  const encendido = config?.whatsapp_automatico === true;
  const porDia = Number(config?.whatsapp_por_dia ?? REGLAS.porDiaPorDefecto);
  const canal = canalData as Canal | null;

  if (!canal || canal.status !== "active" || !canal.phone_number_id || !isWhatsAppProviderConfigured(canal.provider)) {
    return terminar("sin_canal", "El WhatsApp de la empresa no está conectado a Atlas: no se escribe a nadie.");
  }

  const { estados, aprobadas } = await sincronizarPlantillas(admin, canal, { registrar: encendido && !ensayo });
  informe.plantillas = estados;

  if (!encendido && !ensayo) {
    return terminar(config?.whatsapp_pausa ? "pausado" : "apagado", config?.whatsapp_pausa ? `Pausado: ${config.whatsapp_pausa}` : "Apagado.");
  }

  if (encendido && !ensayo) {
    const calidad = await calidadDelNumero(canal);
    if (calidad === "YELLOW" || calidad === "RED") {
      const motivo = `Meta bajó la calidad del número a ${calidad === "RED" ? "roja" : "amarilla"}. Revisa los bloqueos antes de volver a encender.`;
      await pausar(admin, org, motivo);
      return terminar("pausado", motivo);
    }
  }

  // A la veterinaria que respondió el saludo le llega el video, aunque el cupo del día esté lleno:
  // contesta a una conversación que ella abrió, dentro de las 24 horas.
  if (encendido && !ensayo) informe.videos = await mandarVideoAVeterinarias(admin, org, canal, ahora);

  if (!ensayo && !enHorario(ahora)) return terminar("fuera_de_horario", "Fuera de horario (lunes a viernes, 10:00 a 19:00).");

  const inicioHoy = instanteEnChile(fechaEnChile(ahora), "00:00");
  const { count: hoy, error: hoyError } = await admin
    .from("prospeccion_whatsapp")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org)
    .eq("automatico", true)
    .not("texto", "like", "🎬%")
    .gte("occurred_at", inicioHoy.toISOString());
  if (hoyError) throw new Error(`No se pudo contar lo enviado hoy: ${hoyError.message}`);
  const quedan = porDia - (hoy ?? 0);
  if (quedan <= 0) return terminar("tope", `Llegó al tope del día (${porDia}).`);

  const { data: filas, error: bandejaError } = await admin.rpc("prospeccion_de_empresa", { p_org: org, p_dias: 14 });
  if (bandejaError) throw new Error(`No se pudo leer la bandeja: ${bandejaError.message}`);
  const envios = elegirEnvios((filas ?? []) as FilaDeBandeja[], { ahora, cupo: ensayo ? quedan : Math.min(quedan, REGLAS.porCorrida) });

  if (ensayo) {
    informe.enviados = envios.map((e) => ({ empresa: e.empresa, paso: e.clave, texto: e.texto }));
    return terminar("ok", `Ensayo: hoy le escribiría a ${envios.length} (quedan ${quedan} de ${porDia}).`);
  }

  const listos = envios.filter((e) => aprobadas.has(PLANTILLAS_DE_PROSPECCION[e.clave].nombre));
  if (envios.length > 0 && listos.length === 0) {
    return terminar("esperando_plantillas", `${envios.length} por escribir, esperando que Meta apruebe los mensajes.`);
  }

  for (const envio of listos) {
    const plantilla = PLANTILLAS_DE_PROSPECCION[envio.clave];
    try {
      const { providerMessageId } = await sendWhatsAppTemplate({
        provider: canal.provider,
        channelId: canal.id,
        phoneNumberId: canal.phone_number_id,
        from: canal.display_phone_number ?? "",
        to: envio.celular,
        template: plantilla.nombre,
        language: plantilla.idioma,
        parameters: envio.parametros,
        clientReference: randomUUID(),
      });
      const { error } = await admin.rpc("anotar_whatsapp_automatico", {
        p_org: org,
        p_lead: envio.leadId,
        p_wamid: providerMessageId,
        p_texto: envio.texto,
        p_nota: envio.nota,
        p_dias: envio.seguirEnDias,
      });
      // Ya salió: si no se pudo anotar, que se sepa, pero no se reintenta (sería escribirle dos veces).
      if (error) informe.fallidos.push({ empresa: envio.empresa, error: `Enviado, pero sin anotar en la bandeja: ${error.message}` });
      informe.enviados.push({ empresa: envio.empresa, paso: envio.clave, texto: envio.texto });
    } catch (error) {
      const detalle = error instanceof Error ? error.message : "Meta no aceptó el mensaje.";
      informe.fallidos.push({ empresa: envio.empresa, error: detalle });
      if (pideFrenar(detalle)) {
        await pausar(admin, org, `Meta pidió frenar los envíos: ${detalle.slice(0, 200)}`);
        break;
      }
    }
  }

  const resumen = [
    `Escribió a ${informe.enviados.length} (${(hoy ?? 0) + informe.enviados.length} de ${porDia} hoy)`,
    informe.fallidos.length ? `${informe.fallidos.length} con error` : null,
    informe.bajas ? `${informe.bajas} pidieron la baja` : null,
    informe.noEntregados ? `${informe.noEntregados} no entregados volvieron a la bandeja` : null,
    informe.videos ? `${informe.videos} videos a veterinarias que respondieron` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return terminar("ok", resumen);
}

/**
 * La veterinaria que contestó el saludo automático recibe el video, una sola vez,
 * si su respuesta no es un «no» y está dentro de las 24 horas que WhatsApp da
 * para responder (se usa 23, por margen). Queda anotado en prospeccion_whatsapp
 * para no repetirlo; la conversación sigue en el teléfono.
 */
async function mandarVideoAVeterinarias(admin: Admin, org: string, canal: Canal, ahora: Date): Promise<number> {
  const desde = new Date(ahora.getTime() - 23 * 60 * 60 * 1000).toISOString();
  const { data: respuestas, error } = await admin
    .from("prospeccion_whatsapp")
    .select("lead_id, texto, occurred_at")
    .eq("organization_id", org)
    .eq("direction", "inbound")
    .gte("occurred_at", desde)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error || !respuestas?.length) return 0;

  const ultimaRespuesta = new Map<string, string | null>();
  for (const fila of respuestas) {
    if (!ultimaRespuesta.has(fila.lead_id as string)) ultimaRespuesta.set(fila.lead_id as string, fila.texto as string | null);
  }
  const leadIds = [...ultimaRespuesta.keys()];
  const [{ data: salientes }, { data: leads }] = await Promise.all([
    admin.from("prospeccion_whatsapp").select("lead_id, texto").eq("organization_id", org).eq("automatico", true).in("lead_id", leadIds),
    admin.from("leads").select("id, full_name, phone, extra, campaigns(name)").eq("organization_id", org).in("id", leadIds),
  ]);
  const yaTieneVideo = new Set((salientes ?? []).filter((s) => String(s.texto ?? "").startsWith("🎬")).map((s) => s.lead_id as string));
  const recibioSaludo = new Set((salientes ?? []).filter((s) => !String(s.texto ?? "").startsWith("🎬")).map((s) => s.lead_id as string));

  let enviados = 0;
  for (const lead of leads ?? []) {
    const id = lead.id as string;
    const campana = (Array.isArray(lead.campaigns) ? lead.campaigns[0] : lead.campaigns) as { name?: string } | null;
    const empresa = String((lead.extra as Record<string, unknown> | null)?.company_name ?? lead.full_name ?? "");
    const celular = celularChileno(lead.phone as string | null);
    if (!celular || yaTieneVideo.has(id) || !recibioSaludo.has(id)) continue;
    if (!esVeterinaria({ campana: campana?.name ?? null, empresa })) continue;
    if (!quiereVerElVideo(ultimaRespuesta.get(id))) continue;
    try {
      const { providerMessageId } = await sendWhatsAppMedia({
        provider: canal.provider,
        channelId: canal.id,
        phoneNumberId: canal.phone_number_id ?? "",
        from: canal.display_phone_number ?? "",
        to: celular,
        messageType: "video",
        mediaUrl: VIDEO_VETERINARIAS.url,
        caption: VIDEO_VETERINARIAS.pie,
        clientReference: randomUUID(),
      });
      await admin.from("prospeccion_whatsapp").insert({
        organization_id: org,
        lead_id: id,
        direction: "outbound",
        wamid: providerMessageId,
        texto: `🎬 ${VIDEO_VETERINARIAS.nombre}: ${VIDEO_VETERINARIAS.pie}`,
        automatico: true,
        estado: "accepted",
      });
      enviados += 1;
    } catch (errorDeEnvio) {
      console.error("[whatsapp-automatico] video sin enviar", id, errorDeEnvio instanceof Error ? errorDeEnvio.message : errorDeEnvio);
    }
  }
  return enviados;
}

async function pausar(admin: Admin, org: string, motivo: string) {
  await admin
    .from("sales_agent_configs")
    .update({ whatsapp_automatico: false, whatsapp_pausa: motivo.slice(0, 300), whatsapp_cambiado_at: new Date().toISOString() })
    .eq("organization_id", org);
}

/** Quien tocó «No me interesa, gracias» (o lo escribió) sale de la bandeja. */
async function cerrarBajas(admin: Admin, org: string, ensayo: boolean, ahora: Date): Promise<number> {
  const desde = new Date(ahora.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("prospeccion_whatsapp")
    .select("lead_id, texto")
    .eq("organization_id", org)
    .eq("direction", "inbound")
    .gte("occurred_at", desde)
    .limit(1000);
  if (error) throw new Error(`No se pudieron leer las respuestas por WhatsApp: ${error.message}`);
  const pidieron = [...new Set((data ?? []).filter((fila) => esBaja(fila.texto as string | null)).map((fila) => fila.lead_id as string))];
  if (pidieron.length === 0) return 0;

  const { data: cerrados, error: cerradosError } = await admin
    .from("prospeccion_toques")
    .select("lead_id")
    .in("lead_id", pidieron)
    .eq("resultado", "no_interesa");
  if (cerradosError) throw new Error(`No se pudieron leer los cierres: ${cerradosError.message}`);
  const yaCerrados = new Set((cerrados ?? []).map((fila) => fila.lead_id as string));
  const porCerrar = pidieron.filter((lead) => !yaCerrados.has(lead));
  if (ensayo) return porCerrar.length;

  for (const lead of porCerrar) {
    const { error: cierreError } = await admin.rpc("cerrar_prospecto_desde_whatsapp", { p_org: org, p_lead: lead, p_resultado: "no_interesa", p_nota: NOTAS.baja, p_dias: null });
    if (cierreError) console.error("[whatsapp-automatico] baja sin anotar", lead, cierreError.message);
  }
  return porCerrar.length;
}

/**
 * Un mensaje automático que WhatsApp no entregó vuelve a una persona: si el
 * número no tiene WhatsApp se marca así (hay que llamar o escribir correo); si
 * fue otra cosa, vuelve hoy a Por contactar con la nota.
 */
async function revisarNoEntregados(admin: Admin, org: string, ensayo: boolean): Promise<number> {
  const { data, error } = await admin
    .from("prospeccion_whatsapp")
    .select("id, lead_id, error")
    .eq("organization_id", org)
    .eq("automatico", true)
    .eq("estado", "failed")
    .is("revisado_at", null)
    .limit(50);
  if (error) throw new Error(`No se pudieron leer las entregas: ${error.message}`);
  const filas = data ?? [];
  if (ensayo) return filas.length;

  for (const fila of filas) {
    const sinWhatsapp = numeroSinWhatsapp(fila.error as string | null);
    const { error: cierreError } = await admin.rpc("cerrar_prospecto_desde_whatsapp", {
      p_org: org,
      p_lead: fila.lead_id,
      p_resultado: sinWhatsapp ? "numero_malo" : "posponer",
      p_nota: sinWhatsapp ? NOTAS.numeroSinWhatsapp : `${NOTAS.noEntregado}${fila.error ? ` (${String(fila.error).slice(0, 120)})` : ""}`,
      p_dias: sinWhatsapp ? null : 0,
    });
    if (cierreError) {
      console.error("[whatsapp-automatico] entrega fallida sin anotar", fila.lead_id, cierreError.message);
      continue;
    }
    await admin.from("prospeccion_whatsapp").update({ revisado_at: new Date().toISOString() }).eq("id", fila.id);
  }
  return filas.length;
}

const ESTADO_EN_META: Record<string, EstadoPlantilla> = {
  APPROVED: "aprobada",
  PENDING: "en_revision",
  IN_APPEAL: "en_revision",
  REJECTED: "rechazada",
  PAUSED: "rechazada",
  DISABLED: "rechazada",
};

/**
 * Las plantillas del agente, según Meta. Las aprobadas se suman a
 * plantillas_aprobadas del canal (sin tocar las de la clínica); si una deja
 * de estar aprobada, se saca. Si una no existe y el agente está encendido, se
 * registra: encender es la decisión de escribir, y registrar es parte de eso.
 */
async function sincronizarPlantillas(admin: Admin, canal: Canal, { registrar }: { registrar: boolean }) {
  const actuales = new Set(canal.plantillas_aprobadas ?? []);
  const estados: Partial<Record<ClavePlantillaProspeccion, EstadoPlantilla>> = {};
  const nuestras = Object.entries(PLANTILLAS_DE_PROSPECCION) as [ClavePlantillaProspeccion, (typeof PLANTILLAS_DE_PROSPECCION)[ClavePlantillaProspeccion]][];

  const token = whatsappProvider(canal.provider) === "meta" && canal.waba_id ? await accesoDeMeta(canal.id) : null;
  if (!token || !canal.waba_id) {
    for (const [clave, plantilla] of nuestras) estados[clave] = actuales.has(plantilla.nombre) ? "aprobada" : "desconocido";
    return { estados, aprobadas: actuales };
  }

  let enMeta = new Map<string, string>();
  try {
    const datos = await graph(`${encodeURIComponent(canal.waba_id)}/message_templates`, { token, query: { fields: "name,status", limit: "200" } });
    const lista = (Array.isArray(datos.data) ? datos.data : []) as { name?: string; status?: string }[];
    enMeta = new Map(lista.filter((t) => t.name).map((t) => [t.name as string, String(t.status ?? "")]));
  } catch (error) {
    console.error("[whatsapp-automatico] no se pudieron leer las plantillas", error instanceof Error ? error.message : error);
    for (const [clave, plantilla] of nuestras) estados[clave] = actuales.has(plantilla.nombre) ? "aprobada" : "desconocido";
    return { estados, aprobadas: actuales };
  }

  const aprobadas = new Set(actuales);
  for (const [clave, plantilla] of nuestras) {
    const status = enMeta.get(plantilla.nombre);
    if (!status && registrar) {
      try {
        await graph(`${encodeURIComponent(canal.waba_id)}/message_templates`, { token, metodo: "POST", cuerpo: definicionParaMeta(plantilla) });
        estados[clave] = "en_revision";
      } catch (error) {
        console.error("[whatsapp-automatico] Meta no recibió la plantilla", plantilla.nombre, error instanceof Error ? error.message : error);
        estados[clave] = "sin_registrar";
      }
      continue;
    }
    estados[clave] = status ? (ESTADO_EN_META[status] ?? "en_revision") : "sin_registrar";
    if (status === "APPROVED") aprobadas.add(plantilla.nombre);
    else aprobadas.delete(plantilla.nombre);
  }

  const cambio = aprobadas.size !== actuales.size || [...aprobadas].some((nombre) => !actuales.has(nombre));
  if (cambio) {
    await admin.from("whatsapp_channels").update({ plantillas_aprobadas: [...aprobadas] }).eq("id", canal.id);
  }
  return { estados, aprobadas };
}

/** GREEN, YELLOW, RED o UNKNOWN según Meta; null si no se pudo saber (no frena). */
async function calidadDelNumero(canal: Canal): Promise<string | null> {
  if (whatsappProvider(canal.provider) !== "meta" || !canal.phone_number_id) return null;
  try {
    const token = await accesoDeMeta(canal.id);
    if (!token) return null;
    const datos = await graph(encodeURIComponent(canal.phone_number_id), { token, query: { fields: "quality_rating" } });
    return typeof datos.quality_rating === "string" ? datos.quality_rating : null;
  } catch {
    return null;
  }
}
