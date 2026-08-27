import { z } from "zod";

export const AI_LOOP_POLICY_VERSION = "callback-v1";
export const AI_LOOP_EXTRACTOR_VERSION = "conversation-facts-v2";
export const AI_LOOP_MODEL = "mercury-2";
export const AI_LOOP_MAX_TRANSCRIPT_CHARS = 60_000;

const factSchema = z.object({
  kind: z.enum(["callback_request", "contact_restriction", "commitment", "objection"]),
  quote: z.string().trim().min(3).max(500),
  speaker: z.enum(["customer", "agent", "unknown"]),
  requested_time_text: z.string().trim().min(1).max(150).nullable(),
}).strict();

export const conversationFactsSchema = z.object({
  uncertain: z.boolean(),
  facts: z.array(factSchema).max(8),
}).strict();
export type ConversationFacts = z.infer<typeof conversationFactsSchema>;
export type ConversationFact = ConversationFacts["facts"][number];

/** The provider selects source fragments by ID instead of retyping quotes.
 * Every fragment remains an exact substring, including spelling/punctuation. */
export function conversationEvidence(transcript: string) {
  const fragments: Array<{ id: number; text: string }> = [];
  for (const sentence of transcript.split(/(?<=[.!?])\s+|\n+/u)) {
    let rest = sentence.trim();
    while (rest.length > 500) {
      const space = rest.lastIndexOf(" ", 500);
      const end = space >= 250 ? space : 500;
      fragments.push({ id: fragments.length, text: rest.slice(0, end).trim() });
      rest = rest.slice(end).trim();
    }
    if (rest.length >= 3) fragments.push({ id: fragments.length, text: rest });
  }
  return fragments;
}

export type LoopSource = {
  recording_id: string;
  call_id: string;
  lead_id: string;
  campaign_id: string;
  transcript_text: string;
  source_hash: string;
  call: { started_at: string; ended_at: string; updated_at: string; outcome: string | null; reason: string | null; next_action_at: string | null };
  lead: { next_action_at: string | null; workflow_status: string | null; assigned_to: string | null };
  campaign_active: boolean;
  has_open_call: boolean;
  memory: Array<{ id: string; kind: ConversationFact["kind"]; expires_at: string }>;
};

export type LoopDecision = {
  action: "callback_candidate" | "human_review" | "no_action";
  reason_code: string;
  reason: string;
  policy_version: typeof AI_LOOP_POLICY_VERSION;
  memory_ids: string[];
  execution: "not_executed_shadow";
};

/** Quotes and time expressions must occur literally in the supplied source.
 * This proves provenance, not speaker attribution or semantic correctness. */
export function validateConversationFacts(value: unknown, transcript: string): ConversationFacts {
  const result = conversationFactsSchema.parse(value);
  const seen = new Set<string>();
  for (const fact of result.facts) {
    if (!transcript.includes(fact.quote)) throw new Error("evidence_not_in_source");
    if (fact.requested_time_text && !fact.quote.includes(fact.requested_time_text)) {
      throw new Error("time_not_in_evidence");
    }
    const key = `${fact.kind}:${fact.quote}`;
    if (seen.has(key)) throw new Error("duplicate_fact");
    seen.add(key);
  }
  return result;
}

export function decideNextAction(source: LoopSource, analysis: ConversationFacts, now: Date): LoopDecision {
  const memory = source.memory.filter((fact) => Date.parse(fact.expires_at) > now.getTime());
  const make = (action: LoopDecision["action"], reason_code: string, reason: string): LoopDecision => ({
    action, reason_code, reason, policy_version: AI_LOOP_POLICY_VERSION,
    memory_ids: memory.map((fact) => fact.id), execution: "not_executed_shadow",
  });
  if (!source.campaign_active) return make("no_action", "campaign_inactive", "La campaña está inactiva.");
  if (source.has_open_call) return make("no_action", "open_call", "Existe una llamada abierta; se conserva la operación actual.");
  if (source.lead.next_action_at) return make("no_action", "existing_followup", "Ya existe un seguimiento; no se crea otro.");
  if (analysis.facts.some((fact) => fact.kind === "contact_restriction" && fact.speaker === "customer")) {
    return make("no_action", "contact_restriction", "Hay una restricción de contacto que requiere conservarse y revisarse.");
  }
  if (analysis.uncertain || analysis.facts.some((fact) => fact.speaker === "unknown")) {
    return make("human_review", "uncertain_evidence", "La atribución o el sentido de la evidencia requiere revisión.");
  }
  if (memory.some((fact) => fact.kind !== "objection")) {
    return make("human_review", "confirmed_memory", "Hay contexto previo confirmado; debe revisarse antes de proponer una acción.");
  }
  if (analysis.facts.some((fact) => fact.kind === "callback_request" && fact.speaker === "customer")) {
    return make("callback_candidate", "explicit_callback", "Se detectó una solicitud de retomar contacto. No se ha agendado ni llamado.");
  }
  return make("no_action", "no_supported_action", "La evidencia disponible no respalda una nueva acción.");
}

export const loopReviewSchema = z.object({
  runId: z.uuid(),
  expectedVersion: z.number().int().min(0),
  recommendation: z.enum(["accepted", "rejected"]),
  extraction: z.enum(["confirmed", "rejected", "unreviewed"]),
  note: z.string().trim().min(3).max(1000),
}).strict();

export const LOOP_ACTION_LABELS: Record<LoopDecision["action"], string> = {
  callback_candidate: "Callback propuesto",
  human_review: "Revisión humana",
  no_action: "Sin nueva acción",
};
