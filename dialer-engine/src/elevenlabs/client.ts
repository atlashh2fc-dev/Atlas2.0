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
  agent_id?: string;
  agent_name?: string | null;
  conversation_id: string;
  status: ElevenLabsConversationStatus;
  has_audio?: boolean;
  has_user_audio?: boolean;
  has_response_audio?: boolean;
  transcript?: Array<{
    role?: string;
    time_in_call_secs?: number;
    message?: string | null;
    [key: string]: unknown;
  }>;
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    termination_reason?: string;
    error?: {
      code?: number;
      reason?: string;
      error_type?: string;
    } | null;
  };
  analysis?: {
    call_successful?: string;
    transcript_summary?: string;
    data_collection_results?: Record<string, {
      data_collection_id?: string;
      value?: unknown;
      result?: unknown;
      rationale?: string;
      [key: string]: unknown;
    }>;
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

async function elevenLabsBinaryRequest(
  apiKey: string,
  path: string
): Promise<{ body: Buffer; contentType: string }> {
  const response = await fetch(`${ELEVENLABS_API_BASE}${path}`, {
    method: "GET",
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(`ElevenLabs ${response.status}: ${errorDetail(body)}`);
  }

  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg",
  };
}

export function toChileE164(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.startsWith("56") && digits.length === 11) return `+${digits}`;
  if (digits.length === 9) return `+56${digits}`;
  if (digits.length === 8) return `+562${digits}`;
  return `+${digits}`;
}

export type ElevenLabsOutboundCallParams = {
  apiKey: string;
  agentId: string;
  phoneNumberId: string;
  toNumber: string;
  campaignId: string;
  dialAttemptId?: string;
  leadId?: string;
  testCallId?: string;
  contactName: string;
};

export function buildElevenLabsOutboundCallPayload(params: ElevenLabsOutboundCallParams) {
  if ((!params.dialAttemptId || !params.leadId) && !params.testCallId) {
    throw new Error("Falta el identificador Atlas de la llamada saliente.");
  }

  const dynamicVariables: Record<string, string> = {
    atlas_campaign_id: params.campaignId,
    contact_name: params.contactName,
  };
  if (params.dialAttemptId) dynamicVariables.atlas_dial_attempt_id = params.dialAttemptId;
  if (params.leadId) dynamicVariables.atlas_lead_id = params.leadId;
  if (params.testCallId) dynamicVariables.atlas_test_call_id = params.testCallId;
  return {
    agent_id: params.agentId,
    agent_phone_number_id: params.phoneNumberId,
    to_number: toChileE164(params.toNumber),
    conversation_initiation_client_data: {
      dynamic_variables: dynamicVariables,
    },
  };
}

export async function startElevenLabsOutboundCall(
  params: ElevenLabsOutboundCallParams
): Promise<ElevenLabsOutboundCall> {
  return elevenLabsRequest<ElevenLabsOutboundCall>(
    params.apiKey,
    "/sip-trunk/outbound-call",
    {
      method: "POST",
      body: JSON.stringify(buildElevenLabsOutboundCallPayload(params)),
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

export async function getElevenLabsConversationAudio(
  apiKey: string,
  conversationId: string
): Promise<{ body: Buffer; contentType: string }> {
  return elevenLabsBinaryRequest(
    apiKey,
    `/conversations/${encodeURIComponent(conversationId)}/audio`
  );
}
