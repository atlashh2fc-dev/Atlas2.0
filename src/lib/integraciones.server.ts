import "server-only";

import type { LogoIntegracion } from "@/components/logo-integracion";
import type { AppModule } from "@/lib/modules";
import { haceCuanto } from "@/lib/prospeccion";
import { integrationV2Destinations } from "@/lib/integration-v2";
import { probeDialerHeartbeat } from "@/lib/dialer-health";
import { isWhatsAppProviderConfigured, whatsappProvider } from "@/lib/whatsapp-provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Catálogo de Integraciones: con qué sistemas habla Atlas y en qué estado está
 * cada conexión para la empresa que se está mirando. El estado sale de la
 * misma señal que usa el código que la opera (canal, buzón, latido del
 * discador, circuito del puente), no de una marca manual.
 */

export type EstadoIntegracion = "conectado" | "revisar" | "prueba" | "sin_conectar";

export type Integracion = {
  id: string;
  nombre: string;
  /** Quién está detrás: proveedor o producto de la suite. */
  proveedor: string;
  descripcion: string;
  logo: LogoIntegracion;
  categoria: CategoriaIntegracion;
  estado: EstadoIntegracion;
  /** Dato vivo de la conexión: número, buzones, última señal. */
  detalle: string;
  /** Pantalla donde se configura, si existe. */
  href?: string;
};

export type CategoriaIntegracion = "Canales de atención" | "Suite Altius" | "Telefonía" | "Inteligencia artificial" | "Pagos";

export const CATEGORIAS: CategoriaIntegracion[] = [
  "Canales de atención",
  "Suite Altius",
  "Telefonía",
  "Inteligencia artificial",
  "Pagos",
];

const tiene = (modulos: AppModule[], ...alguno: AppModule[]) => alguno.some((m) => modulos.includes(m));
const hay = (nombre: string) => Boolean(process.env[nombre]?.trim());

type Circuito = { state: string | null; last_success_at: string | null; last_failure_at: string | null };

/** Estado del puente v2 hacia un producto de la suite (Atlas Lead, Bigdata). */
function estadoDePuente(activo: boolean, configurado: boolean, circuito: Circuito | null): Pick<Integracion, "estado" | "detalle"> {
  if (!activo || !configurado) return { estado: "sin_conectar", detalle: "El puente no está habilitado en este servidor" };
  if (circuito?.state === "open") {
    return { estado: "revisar", detalle: `Entregas en pausa tras fallas · última falla ${haceCuanto(circuito.last_failure_at)}` };
  }
  return {
    estado: "conectado",
    detalle: circuito?.last_success_at ? `Última entrega ${haceCuanto(circuito.last_success_at)}` : "Puente firmado activo",
  };
}

export async function integracionesDeLaEmpresa(modulos: AppModule[]): Promise<Integracion[]> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: orgId } = await supabase.rpc("current_org_id");
  const organizationId = orgId as string;

  const [
    { data: canal },
    { data: buzones },
    { data: voz },
    { data: fuentes },
    { data: organizacion },
    latido,
  ] = await Promise.all([
    supabase
      .from("whatsapp_channels")
      .select("display_phone_number, status, provider, last_webhook_at, last_error, token_vence_at")
      .eq("organization_id", organizationId)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("inbound_mailboxes")
      .select("address, last_synced_at, last_sync_error")
      .eq("organization_id", organizationId)
      .eq("active", true),
    supabase
      .from("ai_voice_campaign_configs")
      .select("campaign_id, campaigns!inner(organization_id)")
      .eq("is_active", true)
      .eq("campaigns.organization_id", organizationId),
    admin.from("integration_sources").select("id, code, is_active").in("code", ["atlas_lead", "bigdata"]),
    admin.from("organizations").select("slug").eq("id", organizationId).maybeSingle(),
    tiene(modulos, "contact_center") ? probeDialerHeartbeat() : Promise.resolve("unknown" as const),
  ]);

  const fuenteIds = (fuentes ?? []).map((f) => f.id);
  const { data: circuitos } = fuenteIds.length
    ? await admin
        .from("integration_circuit_states")
        .select("destination_source_id, state, last_success_at, last_failure_at")
        .in("destination_source_id", fuenteIds)
    : { data: [] };
  const fuente = (code: string) => (fuentes ?? []).find((f) => f.code === code) ?? null;
  const circuitoDe = (code: string) =>
    ((circuitos ?? []) as (Circuito & { destination_source_id: string })[]).find(
      (c) => c.destination_source_id === fuente(code)?.id
    ) ?? null;
  const destinos = integrationV2Destinations(process.env.INTEGRATION_OUTBOX_DESTINATIONS_JSON);

  const lista: Integracion[] = [];

  if (tiene(modulos, "whatsapp")) {
    const proveedor = canal ? whatsappProvider(canal.provider) : "meta";
    const listo = isWhatsAppProviderConfigured(proveedor) && canal?.status === "active";
    const vence = canal?.token_vence_at ? (new Date(canal.token_vence_at).getTime() - Date.now()) / 86_400_000 : null;
    const porVencer = vence !== null && vence <= 10;
    lista.push({
      id: "whatsapp",
      nombre: "WhatsApp Business",
      proveedor: proveedor === "ycloud" ? "YCloud" : "Meta Cloud API",
      descripcion: "Conversaciones con clientes desde la bandeja del CRM, con o sin respuesta automática.",
      logo: "whatsapp",
      categoria: "Canales de atención",
      estado: !canal ? "sin_conectar" : listo && !porVencer && !canal.last_error ? "conectado" : "revisar",
      detalle: !canal
        ? "Conecta el número de la empresa"
        : porVencer
          ? "El acceso de Meta vence pronto: vuelve a conectarlo"
          : canal.last_webhook_at
            ? `${canal.display_phone_number} · último mensaje ${haceCuanto(canal.last_webhook_at)}`
            : `${canal.display_phone_number} · aún no llegan mensajes`,
      href: "/dashboard/admin/integraciones/whatsapp",
    });
  }

  if (tiene(modulos, "leads", "ventas_b2c")) {
    const conError = (buzones ?? []).filter((b) => b.last_sync_error);
    const ultima = (buzones ?? [])
      .map((b) => b.last_synced_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;
    const total = (buzones ?? []).length;
    lista.push({
      id: "correo",
      nombre: "Correo de la empresa",
      proveedor: "IMAP · SMTP",
      descripcion: "Los correos que llegan al buzón entran a la bandeja; las respuestas y propuestas salen desde él.",
      logo: "correo",
      categoria: "Canales de atención",
      estado: total === 0 ? "sin_conectar" : conError.length ? "revisar" : "conectado",
      detalle:
        total === 0
          ? "Conecta el buzón de la empresa"
          : conError.length
            ? `${conError.length} de ${total} ${total === 1 ? "buzón" : "buzones"} con error al sincronizar`
            : `${total} ${total === 1 ? "buzón" : "buzones"}${ultima ? ` · revisado ${haceCuanto(ultima)}` : ""}`,
      href: "/dashboard/admin/correo",
    });
  }

  if (tiene(modulos, "correo")) {
    lista.push({
      id: "atlas_lead",
      nombre: "Atlas Lead",
      proveedor: "Suite Altius",
      descripcion: "Campañas de correo: aperturas, clics y respuestas llegan al registro; el CRM le pide envíos.",
      logo: "atlas",
      categoria: "Suite Altius",
      ...estadoDePuente(Boolean(fuente("atlas_lead")?.is_active), destinos.has("atlas_lead"), circuitoDe("atlas_lead")),
      href: "/dashboard/admin/campanas",
    });
  }

  if (tiene(modulos, "contact_center", "leads", "bigdata")) {
    lista.push({
      id: "bigdata",
      nombre: "Atlas Bigdata",
      proveedor: "Suite Altius",
      descripcion: "Completa la ficha por RUT (contacto, región, rubro) y recibe la priorización de la base.",
      logo: "atlas",
      categoria: "Suite Altius",
      ...estadoDePuente(Boolean(fuente("bigdata")?.is_active), destinos.has("bigdata"), circuitoDe("bigdata")),
    });
  }

  // El sitio web que alimenta el embudo es el de Altius: a otra empresa no le dice nada.
  if (tiene(modulos, "ventas_b2b") && organizacion?.slug === "altius") {
    lista.push({
      id: "sitio_altius",
      nombre: "Sitio altiusignite.com",
      proveedor: "Formulario web",
      descripcion: "Reuniones, diagnósticos y formularios del sitio entran como negocio en Ventas.",
      logo: "web",
      categoria: "Suite Altius",
      estado: hay("ALTIUS_INTAKE_SECRET") ? "conectado" : "sin_conectar",
      detalle: hay("ALTIUS_INTAKE_SECRET") ? "Recibe con firma verificada" : "Falta la clave compartida con el sitio",
    });
  }

  if (tiene(modulos, "contact_center")) {
    lista.push({
      id: "discador",
      nombre: "Discador y anexos",
      proveedor: "Asterisk · SIP",
      descripcion: "Marcación automática, anexos de los ejecutivos y grabación de llamadas.",
      logo: "asterisk",
      categoria: "Telefonía",
      estado: latido === "ok" ? "conectado" : latido === "down" ? "revisar" : "sin_conectar",
      detalle:
        latido === "ok" ? "Motor en línea" : latido === "down" ? "El motor no responde hace más de 45 s" : "Sin señal del motor",
      href: "/dashboard/admin/agentes-sip",
    });

    const campanasConVoz = (voz ?? []).length;
    lista.push({
      id: "voz_ia",
      nombre: "Agentes de voz con IA",
      proveedor: "ElevenLabs",
      descripcion: "Un agente de voz llama o contesta por la campaña, sobre la misma troncal del discador.",
      logo: "elevenlabs",
      categoria: "Telefonía",
      estado: campanasConVoz ? "conectado" : "sin_conectar",
      detalle: campanasConVoz
        ? `Activo en ${campanasConVoz} ${campanasConVoz === 1 ? "campaña" : "campañas"}`
        : "Se activa por campaña, en la pestaña IA",
      href: "/dashboard/admin/campanas",
    });

    lista.push({
      id: "transcripcion",
      nombre: "Transcripción de llamadas",
      proveedor: "Groq · Whisper",
      descripcion: "Convierte las grabaciones en texto para revisar calidad sin escuchar la llamada completa.",
      logo: "transcripcion",
      categoria: "Inteligencia artificial",
      estado: hay("GROQ_API_KEY") ? "conectado" : "sin_conectar",
      detalle: hay("GROQ_API_KEY") ? "Disponible en Calidad" : "Falta la clave del proveedor en el servidor",
    });
  }

  if (tiene(modulos, "whatsapp", "contact_center")) {
    lista.push({
      id: "mercury",
      nombre: "Asistente de respuestas",
      proveedor: "Inception · Mercury",
      descripcion: "Redacta respuestas de WhatsApp y evalúa la calidad de las llamadas con la pauta de la campaña.",
      logo: "ia",
      categoria: "Inteligencia artificial",
      estado: hay("INCEPTION_API_KEY") ? "conectado" : "sin_conectar",
      detalle: hay("INCEPTION_API_KEY") ? "Se enciende por campaña" : "Falta la clave del proveedor en el servidor",
    });
  }

  if (tiene(modulos, "ventas_b2c")) {
    const produccion = hay("TBK_COMMERCE_CODE") && hay("TBK_API_KEY") && process.env.TBK_ENV !== "integracion";
    lista.push({
      id: "webpay",
      nombre: "Pago en línea",
      proveedor: "Transbank Webpay Plus",
      descripcion: "El paciente paga con tarjeta desde el enlace de cobro y el pago queda en Caja.",
      logo: "pagos",
      categoria: "Pagos",
      estado: produccion ? "conectado" : "prueba",
      detalle: produccion ? "Cobros reales" : "Ambiente de prueba de Transbank: no cobra",
    });
  }

  return lista;
}
