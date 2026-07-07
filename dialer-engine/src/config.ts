import "dotenv/config";
import { z } from "zod";

/**
 * Config centralizada y validada. Falla rápido al arrancar si falta algo
 * crítico (mejor eso que un motor a medio conectar marcando llamadas).
 */
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "Falta SUPABASE_SERVICE_ROLE_KEY"),

  AMI_HOST: z.string().min(1),
  AMI_PORT: z.coerce.number().int().positive().default(5038),
  AMI_USERNAME: z.string().min(1),
  AMI_SECRET: z.string().min(1),

  DIAL_TECH: z.string().default("PJSIP"),
  DIAL_TRUNK: z.string().min(1),

  AGENT_EXTENSION_MAP: z.string().default("{}"),
  DIALER_CAMPAIGN_IDS: z.string().default(""),

  TICK_MS: z.coerce.number().int().positive().default(3000),
  PORT: z.coerce.number().int().positive().default(8080),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Config inválida:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

let agentExtensionMap: Record<string, string> = {};
try {
  agentExtensionMap = JSON.parse(env.AGENT_EXTENSION_MAP);
} catch {
  console.error("AGENT_EXTENSION_MAP no es JSON válido");
  process.exit(1);
}

export const config = {
  supabaseUrl: env.SUPABASE_URL,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,

  ami: {
    host: env.AMI_HOST,
    port: env.AMI_PORT,
    username: env.AMI_USERNAME,
    secret: env.AMI_SECRET,
  },

  dialTech: env.DIAL_TECH,
  dialTrunk: env.DIAL_TRUNK,

  // extension -> profile_id
  agentExtensionMap,
  // profile_id -> extension (inverso, útil para originar hacia el agente)
  extensionByProfileId: Object.fromEntries(
    Object.entries(agentExtensionMap).map(([ext, profileId]) => [profileId, ext])
  ) as Record<string, string>,

  campaignIds: env.DIALER_CAMPAIGN_IDS.split(",").map((s) => s.trim()).filter(Boolean),

  tickMs: env.TICK_MS,
  port: env.PORT,
};
