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
import { AGENT_CONTROL_POLL_MS, processAgentControlCommands } from "./dialer/agentControl";
import { AmiRecordingController } from "./recording/controller";
import { assertPrivateRecordingBucket } from "./recording/storage";
import { registerRecordingIngestRoute } from "./recording/ingest";
import { OperationalHealthTracker } from "./operationalHealth";
import { publishOperationalHealth } from "./operationalHealthPublisher";

const AGENT_DIRECTORY_REFRESH_MS = 10_000;
const AGENT_PAUSE_SYNC_MS = 10_000;
const AGENT_HEARTBEAT_CHECK_MS = 30_000;

async function main() {
  const health = new OperationalHealthTracker();
  if (config.campaignIds.length === 0) {
    logger.warn("DIALER_CAMPAIGN_IDS vacío: el motor no originará llamadas hasta configurarlo.");
  }

  const ami = connectAmi();

  const recording = config.recording.enabled
    ? new AmiRecordingController(
        ami,
        config.recording.spoolDir,
        config.recording.bucket,
        config.recording.ingestBaseUrl,
        config.recording.uploadCommand,
        config.recording.ingestTokenTtlSeconds
      )
    : undefined;
  if (recording) {
    // Falla cerrado si alguien convirtió accidentalmente el bucket en público.
    await assertPrivateRecordingBucket(config.recording.bucket);
  }

  // Contexto de dialplan para AMD (dialer_campaign_configs.amd_enabled) — se
  // crea una sola vez, idempotente (no pisa nada si ya existe).
  await ensureAmdContext(ami).catch((err) => logger.error({ err }, "ensureAmdContext falló al arrancar"));

  // queue_name -> campaign_id, se completa en cada tick a partir de
  // dialer_campaign_configs (así el event router puede mapear
  // QueueMemberStatus a la campaña correcta sin config duplicada).
  const queueToCampaignId = new Map<string, string>();
  registerEventRouter(ami, queueToCampaignId, recording);

  // Directorio agente<->extensión: fuente de verdad viva en Supabase
  // (agent_sip_credentials), con el AGENT_EXTENSION_MAP estático del .env
  // como base para no romper 6001/6002 mientras no tengan fila en la tabla.
  // Cada refresh también aprovisiona en Asterisk (vía AMI) cualquier
  // extensión nueva y reconcilia las claves SIP existentes con la fuente de
  // verdad, corrigiendo divergencias DB↔PBX sin recargar si ya coinciden.
  const syncAgentDirectoryAndEndpoints = async () => {
    const directoryOk = await refreshAgentDirectory(config.agentExtensionMap);
    if (directoryOk) health.success("agentDirectory");
    else health.failure("agentDirectory", "supabase_agent_directory_failed");

    try {
      const report = await ensureAgentEndpoints(ami, getActiveCredentials());
      if (report.ok) health.success("agentConfigSync");
      else health.failure("agentConfigSync", "ami_agent_config_failed");
    } catch (err) {
      health.failure("agentConfigSync", "agent_config_unhandled_error");
      logger.error({ err }, "Sync de extensiones PJSIP falló");
    }
  };
  await syncAgentDirectoryAndEndpoints();
  setInterval(() => {
    syncAgentDirectoryAndEndpoints().catch((err) => {
      health.failure("agentDirectory", "agent_directory_unhandled_error");
      logger.error({ err }, "Sync de directorio de agentes falló");
    });
  }, AGENT_DIRECTORY_REFRESH_MS);

  // Estado del agente (AUX o cierre/tipificación): se sincroniza a QueuePause
  // antes de iniciar el pacing y luego continuamente. Así un reinicio del
  // motor no abre una ventana donde un agente en wrap_up reciba otra llamada.
  await syncAgentPauseStates(ami, { force: true })
    .then(() => health.success("agentPauseSync"))
    .catch((err) => {
      health.failure("agentPauseSync", "agent_pause_sync_failed");
      logger.error({ err }, "Sync inicial de pausas de agente falló");
    });
  setInterval(() => {
    syncAgentPauseStates(ami)
      .then(() => health.success("agentPauseSync"))
      .catch((err) => {
        health.failure("agentPauseSync", "agent_pause_sync_failed");
        logger.error({ err }, "Sync de pausas de agente falló");
      });
  }, AGENT_PAUSE_SYNC_MS);

  // Heartbeat: fuerza "Desconectado" a agentes que cerraron la pestaña/
  // navegador sin pasar por "Cerrar sesión" (markAgentLoggedOut cubre el
  // logout explícito; esto cubre el resto).
  setInterval(() => {
    checkAgentHeartbeats()
      .then(() => health.success("agentHeartbeat"))
      .catch((err) => {
        health.failure("agentHeartbeat", "agent_heartbeat_failed");
        logger.error({ err }, "Chequeo de heartbeats falló");
      });
  }, AGENT_HEARTBEAT_CHECK_MS);

  // Plano de control durable para cierres administrativos. Single-flight y
  // separado del pacing: nunca espera un tick de campaña para sacar capacidad.
  const scheduleAgentControl = () => {
    setTimeout(async () => {
      try {
        await processAgentControlCommands(ami);
        health.success("agentControl");
      } catch (err) {
        health.failure("agentControl", "agent_control_failed");
        logger.error({ err }, "Procesamiento de cierres remotos falló");
      } finally {
        scheduleAgentControl();
      }
    }, AGENT_CONTROL_POLL_MS);
  };
  scheduleAgentControl();

  // Ciclo single-flight: el siguiente tick se agenda cuando terminó el
  // anterior. setInterval permitía superposición si AMI/Supabase demoraban.
  const scheduleCampaignTick = () => {
    setTimeout(async () => {
      try {
        const report = await runCampaignTick(ami, config.campaignIds, queueToCampaignId);
        if (report.ok) health.success("campaignLoop");
        else health.failure("campaignLoop", "campaign_tick_partial_failure");
      } catch (err) {
        health.failure("campaignLoop", "campaign_tick_unhandled_error");
        logger.error({ err }, "runCampaignTick falló");
      } finally {
        scheduleCampaignTick();
      }
    }, config.tickMs);
  };
  scheduleCampaignTick();

  // Health-check HTTP: lo único que expone este servicio por red además de
  // AMI/Supabase. Un ALB/target group de AWS le pega a /health.
  const app = express();
  if (recording) {
    registerRecordingIngestRoute(app, {
      bucket: config.recording.bucket,
      maxUploadMb: config.recording.maxUploadMb,
      retryAttempts: config.recording.retryAttempts,
      retryBaseMs: config.recording.retryBaseMs,
    });
  }
  const currentHealth = () =>
    health.snapshot({
      amiConnected: ami.isConnected(),
      campaignCount: config.campaignIds.length,
      recordingEnabled: config.recording.enabled,
      release: config.release,
      tickMs: config.tickMs,
    });
  app.get("/health", (_req, res) => {
    const snapshot = currentHealth();
    res.status(snapshot.ok ? 200 : 503).json(snapshot);
  });
  app.listen(config.port, () => logger.info({ port: config.port }, "Health check escuchando"));

  const scheduleHealthPublish = () => {
    setTimeout(async () => {
      try {
        const published = await publishOperationalHealth(currentHealth());
        if (published) health.success("healthPublish");
        else health.failure("healthPublish", "supabase_health_publish_failed");
      } catch (err) {
        health.failure("healthPublish", "health_publish_unhandled_error");
        logger.error({ err }, "Publicación de salud operacional falló");
      } finally {
        scheduleHealthPublish();
      }
    }, 10_000);
  };
  scheduleHealthPublish();
}

main().catch((err) => {
  logger.error({ err }, "Fallo fatal al arrancar el motor");
  process.exit(1);
});
