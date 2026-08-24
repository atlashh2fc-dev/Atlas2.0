import type { ElevenLabsConversationStatus } from "./client";

export type AtlasAiAttemptStatus =
  | "originating"
  | "answered"
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
