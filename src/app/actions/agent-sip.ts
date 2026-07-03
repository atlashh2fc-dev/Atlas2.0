"use server";

import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
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

/**
 * Lista todos los ejecutivos (agentes) con su extensión SIP asignada, si
 * tienen una. Pantalla de gestión para admin: /dashboard/admin/agentes-sip.
 */
export async function listAgentSipRows(): Promise<AgentSipRow[]> {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const [{ data: profiles, error: profilesError }, { data: creds, error: credsError }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role").eq("role", "agente").order("full_name"),
    supabase.from("agent_sip_credentials").select("profile_id, extension, is_active"),
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

async function nextFreeExtension(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("agent_sip_credentials").select("extension");
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
  const profileId = formData.get("profile_id") as string;
  if (!profileId) throw new Error("Falta profile_id");

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("agent_sip_credentials")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existing) throw new Error("Este agente ya tiene una extensión asignada.");

  const extension = await nextFreeExtension();
  const sipPassword = randomBytes(16).toString("hex");

  const { error } = await supabase.from("agent_sip_credentials").insert({
    profile_id: profileId,
    extension,
    sip_password: sipPassword,
    is_active: true,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/agentes-sip");
}

/**
 * Admin necesita poder ver la clave para configurar softphones (la barra CTI
 * la pide sola, pero un softphone de escritorio como el usado para validar
 * el motor necesita la clave a mano).
 */
export async function revealAgentSipCredential(profileId: string): Promise<{ extension: string; sip_password: string } | null> {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_sip_credentials")
    .select("extension, sip_password")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) throw new Error(error.message);
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
