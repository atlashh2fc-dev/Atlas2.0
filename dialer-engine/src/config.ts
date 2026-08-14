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
  /** Prefijo de marcación que exige el carrier antepuesto al destino en el
   * Request-URI (Siptel Chile: 85848994 + 56 + número nacional). Vacío = sin
   * prefijo, comportamiento previo. */
  DIAL_PREFIX: z
    .string()
    .regex(/^\d*$/, "DIAL_PREFIX solo puede contener dígitos")
    .default(""),

  AGENT_EXTENSION_MAP: z.string().default("{}"),
  DIALER_CAMPAIGN_IDS: z.string().default(""),

  TICK_MS: z.coerce.number().int().positive().default(3000),
  PORT: z.coerce.number().int().positive().default(8080),

  // Grabaciones post-bridge. Esta ruta pertenece al filesystem remoto de
  // Asterisk; el motor sólo la envía en la acción AMI MixMonitor.
  RECORDING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  RECORDING_SPOOL_DIR: z
    .string()
    .regex(/^\/[a-zA-Z0-9._/-]+$/, "RECORDING_SPOOL_DIR debe ser un path absoluto seguro")
    .default("/var/spool/atlas-recordings"),
  RECORDING_BUCKET: z.string().min(1).default("call-recordings"),
  RECORDING_INGEST_BASE_URL: z.string().url().default("http://127.0.0.1:8080/internal/recordings"),
  RECORDING_UPLOAD_COMMAND: z
    .string()
    .regex(/^\/[a-zA-Z0-9._/-]+$/, "RECORDING_UPLOAD_COMMAND debe ser un path absoluto seguro")
    .default("/usr/local/bin/atlas-recording-upload"),
  RECORDING_INGEST_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(43_200),
  RECORDING_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(500).default(100),
  RECORDING_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  RECORDING_RETRY_BASE_MS: z.coerce.number().int().positive().default(1000),
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
  dialPrefix: env.DIAL_PREFIX,

  // extension -> profile_id
  agentExtensionMap,
  // profile_id -> extension (inverso, útil para originar hacia el agente)
  extensionByProfileId: Object.fromEntries(
    Object.entries(agentExtensionMap).map(([ext, profileId]) => [profileId, ext])
  ) as Record<string, string>,

  campaignIds: env.DIALER_CAMPAIGN_IDS.split(",").map((s) => s.trim()).filter(Boolean),

  tickMs: env.TICK_MS,
  port: env.PORT,

  recording: {
    enabled: env.RECORDING_ENABLED,
    spoolDir: env.RECORDING_SPOOL_DIR,
    bucket: env.RECORDING_BUCKET,
    ingestBaseUrl: env.RECORDING_INGEST_BASE_URL.replace(/\/$/, ""),
    uploadCommand: env.RECORDING_UPLOAD_COMMAND,
    ingestTokenTtlSeconds: env.RECORDING_INGEST_TOKEN_TTL_SECONDS,
    maxUploadMb: env.RECORDING_MAX_UPLOAD_MB,
    retryAttempts: env.RECORDING_RETRY_ATTEMPTS,
    retryBaseMs: env.RECORDING_RETRY_BASE_MS,
  },
};
