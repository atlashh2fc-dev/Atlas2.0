import { config } from "../config";
import {
  getElevenLabsConversation,
  startElevenLabsOutboundCall,
  type ElevenLabsConversation,
} from "../elevenlabs/client";
import { mapElevenLabsStatus } from "../elevenlabs/status";
import { logger } from "../logger";
import {
  claimNextAiVoiceTargets,
  getActiveAiVoiceAttempts,
  getActiveAiVoiceCampaignConfigs,
  registerAiVoiceEvent,
} from "../supabaseClient";

const MAX_AI_BATCH_PER_TICK = 3;

function conversationResult(conversation: ElevenLabsConversation): Record<string, unknown> {
  return {
    provider_status: conversation.status,
    call_duration_seconds: conversation.metadata?.call_duration_secs ?? null,
    termination_reason: conversation.metadata?.termination_reason ?? null,
    call_successful: conversation.analysis?.call_successful ?? null,
    summary: conversation.analysis?.transcript_summary ?? null,
    has_user_audio: conversation.has_user_audio ?? null,
  };
}

async function reconcileCampaign(campaignId: string, apiKey: string): Promise<void> {
  const attempts = await getActiveAiVoiceAttempts(campaignId);
  for (const attempt of attempts) {
    try {
      const conversation = await getElevenLabsConversation(apiKey, attempt.provider_conversation_id);
      const previousProviderStatus = attempt.provider_result?.provider_status;
      if (previousProviderStatus === conversation.status && conversation.status !== "done") continue;

      const status = mapElevenLabsStatus(conversation.status);
      await registerAiVoiceEvent({
        dialAttemptId: attempt.id,
        status,
        providerConversationId: conversation.conversation_id,
        providerCallId: attempt.provider_call_id,
        result: conversationResult(conversation),
        hangupCause: conversation.status === "failed"
          ? conversation.metadata?.termination_reason ?? "ELEVENLABS_FAILED"
          : null,
      });
    } catch (err) {
      logger.error(
        { err, campaignId, dialAttemptId: attempt.id, conversationId: attempt.provider_conversation_id },
        "No se pudo reconciliar la conversación de ElevenLabs"
      );
    }
  }
}

export async function runAiVoiceCampaignTick(): Promise<{ ok: boolean; configuredCampaigns: number }> {
  if (config.aiVoiceCampaignIds.length === 0) {
    return { ok: true, configuredCampaigns: 0 };
  }
  if (!config.elevenLabsApiKey) {
    logger.error("AI_VOICE_CAMPAIGN_IDS tiene campañas, pero falta ELEVENLABS_API_KEY.");
    return { ok: false, configuredCampaigns: config.aiVoiceCampaignIds.length };
  }

  const configs = await getActiveAiVoiceCampaignConfigs(config.aiVoiceCampaignIds);
  let ok = true;

  for (const aiConfig of configs) {
    try {
      await reconcileCampaign(aiConfig.campaign_id, config.elevenLabsApiKey);

      const targets = await claimNextAiVoiceTargets(
        aiConfig.campaign_id,
        Math.min(aiConfig.max_concurrent_calls, MAX_AI_BATCH_PER_TICK)
      );

      for (const target of targets) {
        try {
          const outbound = await startElevenLabsOutboundCall({
            apiKey: config.elevenLabsApiKey,
            agentId: aiConfig.agent_id,
            phoneNumberId: aiConfig.phone_number_id,
            toNumber: target.phone,
            campaignId: aiConfig.campaign_id,
            dialAttemptId: target.dial_attempt_id,
            leadId: target.lead_id,
            contactName: target.full_name,
          });

          if (!outbound.success || !outbound.conversation_id) {
            throw new Error(outbound.message || "ElevenLabs no devolvió conversation_id");
          }

          await registerAiVoiceEvent({
            dialAttemptId: target.dial_attempt_id,
            status: "originating",
            providerConversationId: outbound.conversation_id,
            providerCallId: outbound.sip_call_id ?? null,
            result: {
              provider_status: "initiated",
              provider_message: outbound.message,
            },
          });
          logger.info(
            {
              campaignId: aiConfig.campaign_id,
              dialAttemptId: target.dial_attempt_id,
              conversationId: outbound.conversation_id,
            },
            "Llamada IA iniciada"
          );
        } catch (err) {
          ok = false;
          logger.error({ err, target }, "No se pudo iniciar la llamada IA");
          await registerAiVoiceEvent({
            dialAttemptId: target.dial_attempt_id,
            status: "failed",
            result: { stage: "elevenlabs_outbound_call" },
            hangupCause: err instanceof Error ? err.message.slice(0, 500) : "ELEVENLABS_OUTBOUND_FAILED",
          }).catch((registerErr) =>
            logger.error({ err: registerErr, target }, "No se pudo terminalizar el intento IA")
          );
        }
      }
    } catch (err) {
      ok = false;
      logger.error({ err, campaignId: aiConfig.campaign_id }, "Falló el ciclo de campaña IA");
    }
  }

  return { ok, configuredCampaigns: configs.length };
}
