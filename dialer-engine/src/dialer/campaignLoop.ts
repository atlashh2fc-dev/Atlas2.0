import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import { computeDialCapacity, computeEffectiveRatio } from "./pacing";
import { originateCall } from "../ami/originate";
import { ensureQueue, syncQueueMembers } from "../asterisk/configSync";
import {
  claimNextDialTargets,
  countAvailableAgents,
  countInFlightAttempts,
  getActiveCampaignConfigs,
  getCampaignAgentExtensions,
  getRecentAbandonmentRate,
} from "../supabaseClient";

const MAX_BATCH_PER_TICK = 10;
const ABANDONMENT_WINDOW_MINUTES = 15;

type CampaignConfig = {
  campaign_id: string;
  dial_mode: string;
  max_dial_ratio: number;
  caller_id: string | null;
  trunk_context: string;
  queue_name: string;
  wrapup_seconds: number;
  is_active: boolean;
  max_redial_attempts: number;
  abandon_timeout_seconds: number;
  target_abandonment_rate: number;
  amd_enabled: boolean;
};

/**
 * Un tick = un ciclo de pacing para todas las campañas activas configuradas
 * en DIALER_CAMPAIGN_IDS. Se corre en un setInterval simple: para 20
 * ejecutivos y unas pocas campañas esto es más que suficiente y evita la
 * complejidad de un scheduler dedicado en la v1.
 */
export async function runCampaignTick(ami: AmiClient, campaignIds: string[], queueToCampaignId: Map<string, string>) {
  if (campaignIds.length === 0) return;

  let configs: CampaignConfig[];
  try {
    configs = (await getActiveCampaignConfigs(campaignIds)) as CampaignConfig[];
  } catch (err) {
    logger.error({ err }, "No se pudo leer dialer_campaign_configs");
    return;
  }

  for (const cfg of configs) {
    queueToCampaignId.set(cfg.queue_name, cfg.campaign_id);

    try {
      // Cola + wrapuptime + miembros primero: esto tiene que reflejar lo que
      // haya en el CRM incluso en campañas manuales (el agente igual marca
      // manualmente y necesita quedar en la queue con el wrapuptime bien).
      const extensions = await getCampaignAgentExtensions(cfg.campaign_id);
      await ensureQueue(ami, cfg.queue_name, cfg.wrapup_seconds);
      await syncQueueMembers(ami, cfg.queue_name, extensions);
    } catch (err) {
      logger.error({ err, campaignId: cfg.campaign_id }, "Sync de cola/extensiones falló");
    }

    // 'manual': la campaña existe solo para marcación manual desde la barra
    // CTI (o un botón "Llamar" en la ficha del lead) — el motor no debe
    // auto-discar ni consumir capacidad de agentes disponibles acá.
    if (cfg.dial_mode === "manual") continue;

    try {
      const [available, inFlight] = await Promise.all([
        countAvailableAgents(cfg.campaign_id),
        countInFlightAttempts(cfg.campaign_id),
      ]);

      // Solo en modo predictivo esto hace algo distinto de usar
      // max_dial_ratio tal cual — ver computeEffectiveRatio en pacing.ts.
      let effectiveRatio = cfg.max_dial_ratio;
      if (cfg.dial_mode === "predictive") {
        let measuredAbandonmentRate: number | null = null;
        try {
          measuredAbandonmentRate = await getRecentAbandonmentRate(cfg.campaign_id, ABANDONMENT_WINDOW_MINUTES);
        } catch (err) {
          logger.error({ err, campaignId: cfg.campaign_id }, "No se pudo medir abandono reciente; se usa el ratio anterior");
        }
        effectiveRatio = computeEffectiveRatio({
          campaignId: cfg.campaign_id,
          dialMode: cfg.dial_mode,
          baseRatio: cfg.max_dial_ratio,
          targetAbandonmentRate: cfg.target_abandonment_rate,
          measuredAbandonmentRate,
        });
        logger.info(
          { campaignId: cfg.campaign_id, measuredAbandonmentRate, effectiveRatio, targetAbandonmentRate: cfg.target_abandonment_rate },
          "Ratio predictivo ajustado"
        );
      }

      const capacity = computeDialCapacity({
        availableAgents: available,
        ratio: effectiveRatio,
        inFlight,
        maxBatchPerTick: MAX_BATCH_PER_TICK,
      });

      if (capacity <= 0) continue;

      const targets = await claimNextDialTargets(cfg.campaign_id, capacity);
      if (targets.length === 0) continue;

      logger.info(
        { campaignId: cfg.campaign_id, available, inFlight, capacity, claimed: targets.length },
        "Originando lote de discado"
      );

      for (const target of targets) {
        await originateCall({
          ami,
          target,
          campaignId: cfg.campaign_id,
          queueName: cfg.queue_name,
          callerId: cfg.caller_id,
          trunkContext: cfg.trunk_context,
          abandonTimeoutSeconds: cfg.abandon_timeout_seconds,
          amdEnabled: cfg.amd_enabled,
        }).catch((err) => logger.error({ err, target }, "Originate falló para un lead"));
      }
    } catch (err) {
      logger.error({ err, campaignId: cfg.campaign_id }, "Tick de campaña falló");
    }
  }
}
