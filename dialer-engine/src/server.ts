import express from "express";
import { config } from "./config";
import { logger } from "./logger";
import { connectAmi } from "./ami/client";
import { registerEventRouter } from "./ami/eventRouter";
import { runCampaignTick } from "./dialer/campaignLoop";
import { refreshAgentDirectory, getActiveCredentials } from "./dialer/agentDirectory";
import { ensureAgentEndpoints, ensureAmdContext } from "./asterisk/configSync";
import { syncAgentPauseStates } from "./dialer/agentPause";
import { checkAgentHeartbeats } from "./dialer/agentHeartbeat";

const AGENT_DIRECTORY_REFRESH_MS = 10_000;
const AGENT_PAUSE_SYNC_MS = 10_000;
const AGENT_HEARTBEAT_CHECK_MS = 30_000;

async function main() {
  if (config.campaignIds.length === 0) {
    logger.warn("DIALER_CAMPAIGN_IDS vacío: el motor no originará llamadas hasta configurarlo.");
  }

  const ami = connectAmi();

  // Contexto de dialplan para AMD (dialer_campaign_configs.amd_enabled) — se
  // crea una sola vez, idempotente (no pisa nada si ya existe).
  await ensureAmdContext(ami).catch((err) => logger.error({ err }, "ensureAmdContext falló al arrancar"));

  // queue_name -> campaign_id, se completa en cada tick a partir de
  // dialer_campaign_configs (así el event router puede mapear
  // QueueMemberStatus a la campaña correcta sin config duplicada).
  const queueToCampaignId = new Map<string, string>();
  registerEventRouter(ami, queueToCampaignId);

  // Directorio agente<->extensión: fuente de verdad viva en Supabase
  // (agent_sip_credentials), con el AGENT_EXTENSION_MAP estático del .env
  // como base para no romper 6001/6002 mientras no tengan fila en la tabla.
  // Cada refresh también aprovisiona en Asterisk (vía AMI) cualquier
  // extensión nueva que un admin haya generado desde el CRM.
  await refreshAgentDirectory(config.agentExtensionMap);
  setInterval(() => {
    refreshAgentDirectory(config.agentExtensionMap)
      .then(() => ensureAgentEndpoints(ami, getActiveCredentials()))
      .catch((err) => logger.error({ err }, "Sync de directorio de agentes falló"));
  }, AGENT_DIRECTORY_REFRESH_MS);

  // Estado de pausa del agente (Disponible/Auxiliar/Baño/Capacitación,
  // elegido desde la barra CTI): se sincroniza a QueuePause en Asterisk sin
  // esperar al tick de campaña, para que la pausa/despausa sea casi
  // inmediata sin importar en qué campaña esté el agente.
  setInterval(() => {
    syncAgentPauseStates(ami).catch((err) => logger.error({ err }, "Sync de pausas de agente falló"));
  }, AGENT_PAUSE_SYNC_MS);

  // Heartbeat: fuerza "Desconectado" a agentes que cerraron la pestaña/
  // navegador sin pasar por "Cerrar sesión" (markAgentLoggedOut cubre el
  // logout explícito; esto cubre el resto).
  setInterval(() => {
    checkAgentHeartbeats().catch((err) => logger.error({ err }, "Chequeo de heartbeats falló"));
  }, AGENT_HEARTBEAT_CHECK_MS);

  setInterval(() => {
    runCampaignTick(ami, config.campaignIds, queueToCampaignId).catch((err) =>
      logger.error({ err }, "runCampaignTick falló")
    );
  }, config.tickMs);

  // Health-check HTTP: lo único que expone este servicio por red además de
  // AMI/Supabase. Un ALB/target group de AWS le pega a /health.
  const app = express();
  app.get("/health", (_req, res) => {
    res.json({ ok: true, campaigns: config.campaignIds.length });
  });
  app.listen(config.port, () => logger.info({ port: config.port }, "Health check escuchando"));
}

main().catch((err) => {
  logger.error({ err }, "Fallo fatal al arrancar el motor");
  process.exit(1);
});
