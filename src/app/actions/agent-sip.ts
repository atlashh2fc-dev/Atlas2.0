"use server";

import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";

const EXTENSION_RANGE_START = 6010; // 6001/6002 quedan reservados para las pruebas iniciales.

export type AgentSipRow = {
  profile_id: string;
  full_name: string;
  email: string;
  role: string;
  extension: string | null;
  is_active: boolean | null;
};

export type DialerContact = {
  id: string;
  name: string;
  phone: string;
  rut: string | null;
};

export type IncomingDialContext = {
  dial_attempt_id: string;
  lead_id: string;
  campaign_id: string;
  campaign_name: string;
  phone: string;
  full_name: string;
  rut: string | null;
  email: string | null;
  extra: Record<string, unknown>;
};

export type AgentDialerSessionStatus =
  | "offline"
  | "available"
  | "ringing"
  | "on_call"
  | "wrap_up";

export type AgentDialerOperatingMode = {
  mode: "manual" | "automatic";
  active_campaign_id: string | null;
  campaigns: Array<{
    id: string;
    name: string;
    dial_mode: "manual" | "preview" | "progressive" | "predictive";
    wrapup_seconds: number;
  }>;
  session: {
    campaign_id: string;
    status: AgentDialerSessionStatus;
    since: string;
  } | null;
};

/**
 * Cambia el skill operativo del ejecutivo. La RPC valida membresia y evita
 * cambios mientras exista una llamada o tipificacion en curso.
 */
export async function setMyActiveCampaign(campaignId: string): Promise<void> {
  await requireProfile(["agente"]);
  if (!campaignId) throw new Error("Selecciona una campaña.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_active_campaign", {
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(error.message);
}

export type AgentDialerHistoryItem = {
  id: string;
  lead_id: string;
  name: string;
  phone: string;
  status: string;
  started_at: string;
  ended_at: string | null;
};

export type AgentPhoneTelemetryPhase = "microphone" | "module" | "wss" | "register";

export type AgentPhoneTelemetryInput = {
  outcome: "failed" | "registered";
  phase: AgentPhoneTelemetryPhase;
  code: string;
  message?: string | null;
  attempt?: number;
};

const PHONE_TELEMETRY_PHASES = new Set<AgentPhoneTelemetryPhase>([
  "microphone",
  "module",
  "wss",
  "register",
]);

function sanitizePhoneTelemetryCode(value: unknown): string {
  const code = String(value ?? "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 80);
  return code || "unknown";
}

function sanitizePhoneTelemetryMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(
      /\b(password|authorization(?:password|username)?|token|secret|api[_-]?key|sip[_-]?password)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]"
    )
    .replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(wss?|https?):\/\/[^\s/]+/gi, "$1://[host]")
    .replace(/\bsips?:[^\s,;]+/gi, "sip:[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return message || null;
}

/**
 * Telemetría operativa del teléfono web. La entrada se valida y sanitiza en el
 * servidor para que errores de librerías/navegador nunca filtren credenciales,
 * tokens ni URLs internas dentro de la bitácora administrativa.
 */
export async function reportAgentPhoneTelemetry(input: AgentPhoneTelemetryInput): Promise<void> {
  const profile = await requireProfile(["agente"]);
  if (!PHONE_TELEMETRY_PHASES.has(input.phase)) throw new Error("Fase telefónica inválida.");
  if (input.outcome !== "failed" && input.outcome !== "registered") {
    throw new Error("Resultado telefónico inválido.");
  }

  const attempt = Number.isInteger(input.attempt)
    ? Math.min(Math.max(Number(input.attempt), 0), 100)
    : 0;
  const admin = createAdminClient();
  const { error } = await admin.from("sensitive_access_log").insert({
    actor_id: profile.id,
    action:
      input.outcome === "registered"
        ? "cti.phone_registered"
        : "cti.phone_registration_failed",
    target_profile_id: profile.id,
    metadata: {
      phase: input.phase,
      code: sanitizePhoneTelemetryCode(input.code),
      message: sanitizePhoneTelemetryMessage(input.message),
      attempt,
    },
  });
  if (error) throw new Error(error.message);
}

/**
 * Lista todos los ejecutivos (agentes) con su extensión SIP asignada, si
 * tienen una. Pantalla de gestión para admin: /dashboard/admin/agentes-sip.
 */
export async function listAgentSipRows(): Promise<AgentSipRow[]> {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  // La lista de extensiones (sin contraseña) sigue siendo visible para el
  // administrador; la política de la tabla ya solo permite leer la fila propia,
  // así que este listado usa la clave de servicio y nunca selecciona la clave.
  const service = createAdminClient();
  const [{ data: profiles, error: profilesError }, { data: creds, error: credsError }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role").eq("role", "agente").order("full_name"),
    service.from("agent_sip_credentials").select("profile_id, extension, is_active"),
  ]);

  if (profilesError) throw new Error(profilesError.message);
  if (credsError) throw new Error(credsError.message);

  const credByProfile = new Map((creds ?? []).map((c) => [c.profile_id, c]));

  return (profiles ?? []).map((p) => {
    const cred = credByProfile.get(p.id);
    return {
      profile_id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: p.role,
      extension: cred?.extension ?? null,
      is_active: cred?.is_active ?? null,
    };
  });
}

async function nextFreeExtension(service: SupabaseClient): Promise<string> {
  // Un administrador ya no puede leer las credenciales SIP de otros usuarios
  // mediante su sesión (la política protege también la contraseña). Calcular
  // el correlativo con ese cliente devolvía una lista vacía y hacía que se
  // intentara reutilizar la extensión 6010. El cliente de servicio se usa
  // solo en este action, después de validar el rol admin, y no expone claves.
  const { data, error } = await service.from("agent_sip_credentials").select("extension");
  if (error) throw new Error(error.message);

  let max = EXTENSION_RANGE_START - 1;
  for (const row of data ?? []) {
    const n = Number(row.extension);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(Math.max(max + 1, EXTENSION_RANGE_START));
}

/**
 * Genera una extensión SIP nueva para un agente (número + clave aleatoria).
 * El motor de discado (dialer-engine) la detecta solo en su próximo refresh
 * (cada 10s) y crea el endpoint PJSIP correspondiente en Asterisk via AMI —
 * no hace falta tocar la instancia a mano.
 */
export async function provisionAgentExtension(formData: FormData) {
  await requireProfile(["admin"]);
  const profileId = String(formData.get("profile_id") ?? "").trim();
  if (!profileId) throw new Error("No se pudo identificar al ejecutivo.");

  // Toda esta operación es administrativa. Usar el cliente autenticado aquí
  // rompe el cálculo de disponibilidad por RLS y termina en un 23505 que
  // Next oculta detrás del mensaje genérico de Server Components.
  const service = createAdminClient();

  const { data: agent, error: agentError } = await service
    .from("profiles")
    .select("id, role, active")
    .eq("id", profileId)
    .maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent || agent.role !== "agente") {
    throw new Error("El usuario seleccionado ya no es un ejecutivo válido.");
  }
  if (!agent.active) {
    throw new Error("Activa al ejecutivo antes de asignarle una extensión.");
  }

  const { data: existing, error: existingError } = await service
    .from("agent_sip_credentials")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) throw new Error("Este agente ya tiene una extensión asignada.");

  const sipPassword = randomBytes(16).toString("hex");

  // Dos administradores pueden aprovisionar al mismo tiempo. El índice
  // UNIQUE sigue siendo la autoridad; si ambos calcularon el mismo número,
  // el perdedor recalcula sobre el valor que el primero acaba de confirmar.
  let provisioned = false;
  for (let attempt = 0; attempt < 8 && !provisioned; attempt += 1) {
    const extension = await nextFreeExtension(service);
    const { error } = await service.from("agent_sip_credentials").insert({
      profile_id: profileId,
      extension,
      sip_password: sipPassword,
      is_active: true,
    });

    if (!error) {
      provisioned = true;
      break;
    }
    if (error.code !== "23505") throw new Error(error.message);

    const { data: concurrentlyCreated, error: concurrentError } = await service
      .from("agent_sip_credentials")
      .select("id")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (concurrentError) throw new Error(concurrentError.message);
    if (concurrentlyCreated) {
      throw new Error("Este agente ya recibió una extensión en otra operación.");
    }
  }
  if (!provisioned) {
    throw new Error("No se pudo reservar una extensión libre después de varios intentos.");
  }
  revalidatePath("/dashboard/admin/agentes-sip");
}

/**
 * Admin necesita poder ver la clave para configurar softphones (la barra CTI
 * la pide sola, pero un softphone de escritorio como el usado para validar
 * el motor necesita la clave a mano).
 */
export async function revealAgentSipCredential(profileId: string): Promise<{ extension: string; sip_password: string } | null> {
  const admin = await requireProfile(["admin"]);

  // La política de lectura ahora deja la contraseña solo en manos del dueño,
  // así que este acceso pasa por la clave de servicio y queda registrado: con
  // la clave de otro se puede llamar desde un softphone externo, sin grabación
  // ni tipificación.
  const service = createAdminClient();

  const { data, error } = await service
    .from("agent_sip_credentials")
    .select("extension, sip_password")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const { error: logError } = await service.from("sensitive_access_log").insert({
    actor_id: admin.id,
    action: "sip_credential.reveal",
    target_profile_id: profileId,
    metadata: { found: Boolean(data) },
  });
  if (logError) throw new Error(logError.message);

  return data ?? null;
}

export async function setAgentExtensionActive(formData: FormData) {
  await requireProfile(["admin"]);
  const profileId = formData.get("profile_id") as string;
  const active = formData.get("active") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_sip_credentials")
    .update({ is_active: !active, updated_at: new Date().toISOString() })
    .eq("profile_id", profileId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/agentes-sip");
}

/**
 * Credenciales SIP del usuario que llama la acción (RLS: solo su propia
 * fila). Las usa la barra CTI para registrarse con SU extensión, no una
 * línea compartida.
 */
export async function getMySipCredentials(): Promise<{ extension: string; sip_password: string } | null> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_sip_credentials")
    .select("extension, sip_password")
    .eq("profile_id", profile.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Agenda liviana del teléfono Atlas. Para agentes se acota explícitamente a
 * sus leads; supervisores/admin conservan el alcance que ya les entrega RLS.
 */
export async function listMyDialerContacts(): Promise<DialerContact[]> {
  const profile = await requireProfile();
  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select("id, full_name, phone, rut")
    .not("phone", "is", null)
    .order("updated_at", { ascending: false })
    .limit(80);

  if (profile.role === "agente") {
    query = query.eq("assigned_to", profile.id);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row): row is typeof row & { phone: string } => Boolean(row.phone?.trim()))
    .map((row) => ({
      id: row.id,
      name: row.full_name,
      phone: row.phone,
      rut: row.rut,
    }));
}

/**
 * La barra CTI se adapta a la operación real del agente. Si participa en al
 * menos una campaña automática activa, el teclado manual desaparece: el
 * motor es quien origina y entrega las llamadas. El modo manual solo queda
 * disponible cuando no existe una asignación automática activa.
 */
export async function getMyDialerOperatingMode(): Promise<AgentDialerOperatingMode> {
  const profile = await requireProfile(["agente"]);
  const admin = createAdminClient();

  const { data: memberships, error: membershipsError } = await admin
    .from("campaign_agents")
    .select("campaign_id")
    .eq("profile_id", profile.id);

  if (membershipsError) throw new Error(membershipsError.message);

  const campaignIds = [...new Set((memberships ?? []).map((row) => row.campaign_id))];
  if (campaignIds.length === 0) {
    return { mode: "manual", active_campaign_id: null, campaigns: [], session: null };
  }

  const [{ data: configs, error: configsError }, { data: campaigns, error: campaignsError }] =
    await Promise.all([
      admin
        .from("dialer_campaign_configs")
        .select("campaign_id, dial_mode, wrapup_seconds")
        .in("campaign_id", campaignIds)
        .eq("is_active", true),
      admin
        .from("campaigns")
        .select("id, name")
        .in("id", campaignIds)
        .eq("is_active", true),
    ]);

  if (configsError) throw new Error(configsError.message);
  if (campaignsError) throw new Error(campaignsError.message);

  const activeCampaignNames = new Map((campaigns ?? []).map((row) => [row.id, row.name]));
  const activeConfigs = (configs ?? [])
    .filter((config) => activeCampaignNames.has(config.campaign_id))
    .map((config) => ({
      id: config.campaign_id,
      name: activeCampaignNames.get(config.campaign_id) ?? "Campaña",
      dial_mode: config.dial_mode as AgentDialerOperatingMode["campaigns"][number]["dial_mode"],
      wrapup_seconds: config.wrapup_seconds,
    }));

  const automaticCampaignIds = activeConfigs
    .filter((config) => config.dial_mode !== "manual")
    .map((config) => config.id);

  const { data: selection, error: selectionError } = await admin
    .from("agent_active_campaigns")
    .select("campaign_id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (selectionError) throw new Error(selectionError.message);

  const selectedAutomaticCampaignId = automaticCampaignIds.includes(selection?.campaign_id ?? "")
    ? selection?.campaign_id ?? null
    : automaticCampaignIds.length === 1
      ? automaticCampaignIds[0]
      : null;

  const { data: session, error: sessionError } =
    automaticCampaignIds.length > 0
      ? await admin
          .from("dialer_agent_sessions")
          .select("campaign_id, status, last_state_change_at")
          .eq("profile_id", profile.id)
          .in(
            "campaign_id",
            selectedAutomaticCampaignId ? [selectedAutomaticCampaignId] : automaticCampaignIds
          )
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null, error: null };

  if (sessionError) throw new Error(sessionError.message);

  return {
    mode: automaticCampaignIds.length > 0 ? "automatic" : "manual",
    active_campaign_id: selectedAutomaticCampaignId,
    campaigns: activeConfigs,
    session: session
      ? {
          campaign_id: session.campaign_id,
          status: session.status as AgentDialerSessionStatus,
          since: session.last_state_change_at,
        }
      : null,
  };
}

/**
 * Historial operacional del discador, acotado siempre al agente autenticado.
 * Se consulta con service_role porque los intentos recién asignados pueden
 * atravesar estados del motor antes de quedar visibles por las políticas RLS.
 */
export async function listMyAutomaticDialHistory(): Promise<AgentDialerHistoryItem[]> {
  const profile = await requireProfile(["agente"]);
  const admin = createAdminClient();

  const { data: attempts, error: attemptsError } = await admin
    .from("dial_attempts")
    .select("id, lead_id, phone, status, created_at, originated_at, ended_at")
    .eq("agent_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(25);

  if (attemptsError) throw new Error(attemptsError.message);
  if (!attempts?.length) return [];

  const leadIds = [...new Set(attempts.map((attempt) => attempt.lead_id))];
  const { data: leads, error: leadsError } = await admin
    .from("leads")
    .select("id, full_name")
    .in("id", leadIds);

  if (leadsError) throw new Error(leadsError.message);
  const leadNames = new Map((leads ?? []).map((lead) => [lead.id, lead.full_name]));

  return attempts.map((attempt) => ({
    id: attempt.id,
    lead_id: attempt.lead_id,
    name: leadNames.get(attempt.lead_id) ?? "Contacto",
    phone: attempt.phone,
    status: attempt.status,
    started_at: attempt.originated_at ?? attempt.created_at,
    ended_at: attempt.ended_at,
  }));
}

/**
 * Screen-pop de una llamada automática. Se usa service_role únicamente en el
 * servidor y se acota al perfil autenticado, de modo que un agente nunca puede
 * consultar el intento asignado a otro ejecutivo.
 */
export async function getMyIncomingDialContext(): Promise<IncomingDialContext | null> {
  const profile = await requireProfile(["agente"]);
  const admin = createAdminClient();
  const recentCutoff = new Date(Date.now() - 2 * 60_000).toISOString();

  const { data: attempt, error: attemptError } = await admin
    .from("dial_attempts")
    .select("id, lead_id, campaign_id, phone")
    .eq("agent_id", profile.id)
    .in("status", ["ringing", "answered", "bridged"])
    .gte("updated_at", recentCutoff)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (attemptError) throw new Error(attemptError.message);
  if (!attempt) return null;

  const [{ data: lead, error: leadError }, { data: campaign, error: campaignError }] =
    await Promise.all([
      admin
        .from("leads")
        .select("id, full_name, phone, rut, email, extra")
        .eq("id", attempt.lead_id)
        .single(),
      admin.from("campaigns").select("name").eq("id", attempt.campaign_id).single(),
    ]);

  if (leadError) throw new Error(leadError.message);
  if (campaignError) throw new Error(campaignError.message);

  return {
    dial_attempt_id: attempt.id,
    lead_id: lead.id,
    campaign_id: attempt.campaign_id,
    campaign_name: campaign.name,
    phone: lead.phone ?? attempt.phone,
    full_name: lead.full_name,
    rut: lead.rut,
    email: lead.email,
    extra:
      lead.extra && typeof lead.extra === "object" && !Array.isArray(lead.extra)
        ? (lead.extra as Record<string, unknown>)
        : {},
  };
}
