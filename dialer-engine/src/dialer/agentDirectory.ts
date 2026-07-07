import { logger } from "../logger";
import { supabase } from "../supabaseClient";

/**
 * Directorio agente <-> extensión, vivo desde Supabase (agent_sip_credentials)
 * en vez de un único mapeo estático en .env. Esto es lo que permite que un
 * admin aprovisione un agente nuevo desde el CRM y el motor lo reconozca sin
 * redeploy: se refresca en cada tick (ver server.ts).
 *
 * El mapeo estático original (AGENT_EXTENSION_MAP) se mantiene como base y
 * nunca se pisa por una fila de Supabase con la misma extensión, así no se
 * rompen las extensiones de prueba (6001/6002) ya validadas manualmente en
 * Asterisk mientras no tengan fila en agent_sip_credentials.
 */

export type AgentCredential = {
  profileId: string;
  extension: string;
  sipPassword: string;
};

let extensionToProfileId: Record<string, string> = {};
let credentialsByExtension = new Map<string, AgentCredential>();

export function getProfileIdForExtension(extension: string): string | undefined {
  return extensionToProfileId[extension];
}

export function getActiveCredentials(): AgentCredential[] {
  return Array.from(credentialsByExtension.values());
}

export async function refreshAgentDirectory(staticFallback: Record<string, string>): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("agent_sip_credentials")
      .select("profile_id, extension, sip_password")
      .eq("is_active", true);
    if (error) throw new Error(error.message);

    const nextMap: Record<string, string> = { ...staticFallback };
    const nextCreds = new Map<string, AgentCredential>();

    for (const row of (data ?? []) as { profile_id: string; extension: string; sip_password: string }[]) {
      nextMap[row.extension] = row.profile_id;
      nextCreds.set(row.extension, {
        profileId: row.profile_id,
        extension: row.extension,
        sipPassword: row.sip_password,
      });
    }

    extensionToProfileId = nextMap;
    credentialsByExtension = nextCreds;
  } catch (err) {
    logger.error({ err }, "No se pudo refrescar agent_sip_credentials; se mantiene el directorio anterior");
  }
}
