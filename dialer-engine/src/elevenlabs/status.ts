import type { ElevenLabsConversation, ElevenLabsConversationStatus } from "./client";

export type AtlasAiAttemptStatus =
  | "originating"
  | "answered"
  | "no_answer"
  | "busy"
  | "completed"
  | "failed";

export function mapElevenLabsStatus(status: ElevenLabsConversationStatus): AtlasAiAttemptStatus {
  switch (status) {
    case "initiated":
      return "originating";
    case "in-progress":
    case "processing":
      return "answered";
    case "done":
      return "completed";
    case "failed":
      return "failed";
  }
}

function nonBlank(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function elevenLabsConversationFailureReason(
  conversation: ElevenLabsConversation
): string | null {
  const terminationReason = nonBlank(conversation.metadata?.termination_reason);
  if (terminationReason) return terminationReason;

  const providerError = conversation.metadata?.error;
  const providerReason = nonBlank(providerError?.reason);
  if (providerReason) return providerReason;

  const providerType = nonBlank(providerError?.error_type);
  if (providerType && providerError?.code != null) {
    return `${providerType} (${providerError.code})`;
  }
  return providerType;
}

export function classifyElevenLabsOutboundFailure(error: unknown): AtlasAiAttemptStatus {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/\b486\b|busy here|ocupad[oa]/i.test(message)) return "busy";
  if (/\b408\b|\b480\b|no answer|request timeout|temporarily unavailable/i.test(message)) {
    return "no_answer";
  }
  return "failed";
}
