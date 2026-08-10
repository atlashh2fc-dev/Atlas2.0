import express from "express";
import { config } from "./config";
import { logger } from "./logger";
import { dispatchCampaign, getActiveConfigs } from "./supabase";

const app = express();
const startedAt = new Date();
let running = false;
let lastTickAt: Date | null = null;
let lastTickError: string | null = null;

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "atlas-lead-orchestrator",
    started_at: startedAt.toISOString(),
    last_tick_at: lastTickAt?.toISOString() ?? null,
    last_tick_error: lastTickError,
  });
});

async function tick() {
  if (running) return;
  running = true;
  try {
    const configs = await getActiveConfigs();
    for (const campaign of configs) {
      try {
        const assignments = await dispatchCampaign(campaign.campaign_id, campaign.max_dispatch_per_tick);
        if (assignments.length > 0) {
          logger.info(
            { campaignId: campaign.campaign_id, assignments: assignments.length },
            "Leads asignados"
          );
        }
      } catch (error) {
        logger.error({ error, campaignId: campaign.campaign_id }, "Fallo el despacho de campana");
      }
    }
    lastTickAt = new Date();
    lastTickError = null;
  } catch (error) {
    lastTickError = error instanceof Error ? error.message : String(error);
    logger.error({ error }, "Fallo el ciclo del orquestador");
  } finally {
    running = false;
  }
}

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, tickMs: config.TICK_MS }, "Orquestador de leads iniciado");
  void tick();
  setInterval(() => void tick(), config.TICK_MS);
});

