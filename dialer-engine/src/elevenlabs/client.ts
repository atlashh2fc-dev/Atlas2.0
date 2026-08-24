const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1/convai";

export type ElevenLabsOutboundCall = {
  success: boolean;
  message: string;
  conversation_id?: string | null;
  sip_call_id?: string | null;
};

export type ElevenLabsConversationStatus =
  | "initiated"
  | "in-progress"
  | "processing"
  | "done"
  | "failed";

export type ElevenLabsConversation = {
  conversation_id: string;
  status: ElevenLabsConversationStatus;
  has_audio?: boolean;
  has_user_audio?: boolean;
  metadata?: {
    call_duration_secs?: number;
    termination_reason?: string;
  };
  analysis?: {
    call_successful?: string;
    transcript_summary?: string;
  } | null;
};

function errorDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "respuesta sin detalle";
  const record = body as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  if (typeof record.message === "string") return record.message;
  return JSON.stringify(body);
}

async function elevenLabsRequest<T>(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${ELEVENLABS_API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "xi-api-key": apiKey,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`ElevenLabs ${response.status}: ${errorDetail(body)}`);
  }
  return body as T;
}

export function toChileE164(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.startsWith("56") && digits.length === 11) return `+${digits}`;
  if (digits.length === 9) return `+56${digits}`;
  if (digits.length === 8) return `+562${digits}`;
  return `+${digits}`;
}

export async function startElevenLabsOutboundCall(params: {
  apiKey: string;
  agentId: string;
  phoneNumberId: string;
  toNumber: string;
  campaignId: string;
  dialAttemptId: string;
  leadId: string;
  contactName: string;
}): Promise<ElevenLabsOutboundCall> {
  return elevenLabsRequest<ElevenLabsOutboundCall>(
    params.apiKey,
    "/sip-trunk/outbound-call",
    {
      method: "POST",
      body: JSON.stringify({
        agent_id: params.agentId,
        agent_phone_number_id: params.phoneNumberId,
        to_number: toChileE164(params.toNumber),
        conversation_initiation_client_data: {
          dynamic_variables: {
            atlas_campaign_id: params.campaignId,
            atlas_dial_attempt_id: params.dialAttemptId,
            atlas_lead_id: params.leadId,
            contact_name: params.contactName,
          },
        },
      }),
    }
  );
}

export async function getElevenLabsConversation(
  apiKey: string,
  conversationId: string
): Promise<ElevenLabsConversation> {
  return elevenLabsRequest<ElevenLabsConversation>(
    apiKey,
    `/conversations/${encodeURIComponent(conversationId)}`,
    { method: "GET" }
  );
}
